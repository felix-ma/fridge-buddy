'use strict';

/**
 * 前端图片处理：选图 → 逐张压缩 → Base64。
 *
 * 红线：图片只存在于临时路径和内存里，全程不写 Storage、不上传文件、
 * 不调用任何持久化 API。压缩产生的临时文件读完就删。
 *
 * 约束来源（见 README 第一节）：
 * - 模型侧会把图缩到约 1300×1300，长边 1280 已经吃满有效分辨率；
 * - 单图 Base64 上限 32 MiB、请求体 48 MiB，所以前端要在更早的地方拦住体积；
 * - Base64 会膨胀 4/3，判断体积时按膨胀后算。
 */

const MAX_IMAGES = 8;
const QUALITY = 0.7;
const MAX_EDGE = 1280;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BASE64 = 24 * 1024 * 1024; // 48 MiB 请求体，预留 prompt 与 JSON 的开销
const RETRY_BYTES = 6 * 1024 * 1024; // 压缩后仍偏大就降质再压一次

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function wxApi() {
  if (typeof wx === 'undefined') {
    throw Object.assign(new Error('当前环境没有微信小程序 API'), { code: 'E_NO_WX' });
  }
  return wx;
}

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/**
 * 计算等比缩放后的尺寸。纯函数，便于单测。
 * 只缩不放：小图原样返回，避免把 800px 的图拉成 1280px 反而更糊更占空间。
 */
function planResize(width, height, maxEdge = MAX_EDGE) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return { width: 0, height: 0, scaled: false };
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { width: Math.round(w), height: Math.round(h), scaled: false };
  const ratio = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(w * ratio)),
    height: Math.max(1, Math.round(h * ratio)),
    scaled: true,
  };
}

/** Base64 编码后的字符数。纯函数。 */
function estimateBase64Length(byteLength) {
  const n = Number(byteLength) || 0;
  if (n <= 0) return 0;
  return 4 * Math.ceil(n / 3);
}

function guessMime(path) {
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(String(path || ''));
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || 'image/jpeg';
}

function toDataUrl(base64, mime) {
  return `data:${mime || 'image/jpeg'};base64,${base64}`;
}

function callWx(method, options) {
  const api = wxApi();
  if (typeof api[method] !== 'function') {
    return Promise.reject(Object.assign(new Error(`当前基础库不支持 ${method}`), { code: 'E_NO_API' }));
  }
  return new Promise((resolve, reject) => {
    api[method](Object.assign({}, options, { success: resolve, fail: reject }));
  });
}

/** 取本地图片宽高。 */
async function getImageInfo(path) {
  const res = await callWx('getImageInfo', { src: path });
  return { width: res.width, height: res.height, path: res.path || path, type: res.type };
}

/**
 * 压一张图。优先带上目标宽高让微信直接缩放（compressedWidth / compressedHeight，
 * 新版基础库支持；官方文档页正文抓不到，参数名未能核实，旧库可能直接忽略）。
 * 所以压完重新读一次尺寸和体积做校验，不假设参数一定生效。
 */
async function compressOne(path) {
  const info = await getImageInfo(path);
  const plan = planResize(info.width, info.height);

  const options = { src: path, quality: QUALITY };
  if (plan.scaled) {
    options.compressedWidth = plan.width;
    options.compressedHeight = plan.height;
  }

  let res;
  try {
    res = await callWx('compressImage', options);
  } catch (err) {
    // 旧基础库可能因为不认识的参数直接 fail，退回只传 quality 再试一次
    res = await callWx('compressImage', { src: path, quality: QUALITY });
  }

  let outPath = res.tempFilePath;
  let outInfo = await getImageInfo(outPath);
  let size = await statSize(outPath);

  if (size > RETRY_BYTES) {
    const again = await callWx('compressImage', { src: outPath, quality: 0.5 });
    await safeUnlink(outPath);
    outPath = again.tempFilePath;
    outInfo = await getImageInfo(outPath);
    size = await statSize(outPath);
  }

  if (size > MAX_IMAGE_BYTES) {
    await safeUnlink(outPath);
    fail('E_IMAGE_TOO_LARGE', '这张图压缩后仍然过大，换一张或换个角度重拍');
  }

  return { path: outPath, width: outInfo.width, height: outInfo.height, bytes: size };
}

function statSize(path) {
  const api = wxApi();
  const fsm = api.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fsm.stat({ path, success: (r) => resolve((r.stats && r.stats.size) || 0), fail: reject });
  });
}

/** 读成 Base64。读完文件即释放（调用方负责删）。 */
function readAsBase64(path) {
  const api = wxApi();
  const fsm = api.getFileSystemManager();
  return new Promise((resolve, reject) => {
    fsm.readFile({ filePath: path, encoding: 'base64', success: (r) => resolve(r.data), fail: reject });
  });
}

function safeUnlink(path) {
  const api = wxApi();
  if (!path || typeof api.getFileSystemManager !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    api.getFileSystemManager().unlink({ filePath: path, success: () => resolve(), fail: () => resolve() });
  });
}

/**
 * 拍照/选图。count 由调用方按"还差几张"传入，避免选完再裁。
 * sizeType 用 compressed：相册原图动辄 4000px，让微信先过一遍再交给我们，
 * 内存峰值低一档；最终 quality 0.7 仍由下面的 compressOne 决定。
 */
async function pickImages({ count = 1, sourceType = ['camera', 'album'] } = {}) {
  const want = Math.min(Math.max(1, count), MAX_IMAGES);
  const res = await callWx('chooseMedia', {
    count: want,
    mediaType: ['image'],
    sourceType,
    sizeType: ['compressed'],
    camera: 'back',
  });
  const files = (res.tempFiles || []).filter((f) => f && f.tempFilePath);
  return files.map((f) => ({ path: f.tempFilePath, size: f.size }));
}

/**
 * 把一批本地路径处理成可直接发给云函数的 Base64 数组。
 * 严格串行：一张压完、读成 Base64、删掉临时文件，再处理下一张。
 * 并发压缩是内存压力最大的来源，这里刻意不并发。
 */
async function prepareImages(paths, { onProgress } = {}) {
  const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
  if (!list.length) fail('E_BAD_INPUT', '还没有选图');
  if (list.length > MAX_IMAGES) fail('E_TOO_MANY_IMAGES', `最多 ${MAX_IMAGES} 张，建议按上/中/下三层拍摄`);

  const images = [];
  let total = 0;

  for (let i = 0; i < list.length; i += 1) {
    if (typeof onProgress === 'function') onProgress({ index: i, total: list.length });
    let compressed = null;
    try {
      compressed = await compressOne(list[i]);
      const base64 = await readAsBase64(compressed.path);
      total += base64.length;
      if (total > MAX_TOTAL_BASE64) {
        fail('E_IMAGE_TOO_LARGE', '图片总量太大，少拍两张或换个角度重拍');
      }
      images.push({
        base64,
        dataUrl: toDataUrl(base64, guessMime(compressed.path)),
        width: compressed.width,
        height: compressed.height,
        bytes: compressed.bytes,
      });
    } catch (err) {
      if (err && err.code === 'E_IMAGE_TOO_LARGE') throw err;
      fail('E_IMAGE_PROCESS', `第 ${i + 1} 张图片处理失败，请重拍这一张`);
    } finally {
      // 压缩产物和源图都删：源图是 chooseMedia 的临时文件，留着也没用
      if (compressed && compressed.path !== list[i]) await safeUnlink(compressed.path);
      await safeUnlink(list[i]);
    }
  }

  return { images, totalBytes: total };
}

module.exports = {
  MAX_IMAGES,
  QUALITY,
  MAX_EDGE,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_BASE64,
  planResize,
  estimateBase64Length,
  guessMime,
  toDataUrl,
  getImageInfo,
  compressOne,
  readAsBase64,
  safeUnlink,
  pickImages,
  prepareImages,
};
