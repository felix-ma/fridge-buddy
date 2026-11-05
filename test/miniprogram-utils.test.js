'use strict';

/**
 * 前端工具层单测。wx API 用内存 mock 替掉，验证的是"顺序、释放、边界"，
 * 不验证微信内部压缩效果（那只能真机验）。
 */

const test = require('node:test');
const assert = require('node:assert');

const image = require('../miniprogram/utils/image.js');
const api = require('../miniprogram/utils/api.js');
const capture = require('../miniprogram/utils/capture.js');

// ---------------------------------------------------------------------------
// image.js：纯函数
// ---------------------------------------------------------------------------

test('planResize：横图缩到长边 1280，等比', () => {
  assert.deepStrictEqual(image.planResize(4000, 3000), { width: 1280, height: 960, scaled: true });
});

test('planResize：竖图按长边算', () => {
  assert.deepStrictEqual(image.planResize(3000, 4000), { width: 960, height: 1280, scaled: true });
});

test('planResize：小图不放大', () => {
  assert.deepStrictEqual(image.planResize(800, 600), { width: 800, height: 600, scaled: false });
});

test('planResize：非法尺寸返回 0 且不崩', () => {
  assert.deepStrictEqual(image.planResize(0, 100), { width: 0, height: 0, scaled: false });
  assert.deepStrictEqual(image.planResize(undefined, undefined), { width: 0, height: 0, scaled: false });
});

test('planResize：支持自定义长边，且最小 1px', () => {
  assert.deepStrictEqual(image.planResize(4000, 3, 1000), { width: 1000, height: 1, scaled: true });
});

test('estimateBase64Length：按 4/3 膨胀并补足 4 的倍数', () => {
  assert.strictEqual(image.estimateBase64Length(0), 0);
  assert.strictEqual(image.estimateBase64Length(1), 4);
  assert.strictEqual(image.estimateBase64Length(3), 4);
  assert.strictEqual(image.estimateBase64Length(4), 8);
  assert.strictEqual(image.estimateBase64Length(1024 * 1024), 1398104);
});

test('guessMime / toDataUrl', () => {
  assert.strictEqual(image.guessMime('wxfile://tmp_abc.png'), 'image/png');
  assert.strictEqual(image.guessMime('wxfile://tmp_abc.WEBP'), 'image/webp');
  assert.strictEqual(image.guessMime('wxfile://tmp_abc'), 'image/jpeg');
  assert.strictEqual(image.toDataUrl('AAA', 'image/png'), 'data:image/png;base64,AAA');
});

test('常量与云函数侧上限一致', () => {
  assert.strictEqual(image.MAX_IMAGES, 8);
  assert.strictEqual(image.QUALITY, 0.7);
  assert.strictEqual(image.MAX_EDGE, 1280);
  assert.strictEqual(image.MAX_IMAGE_BYTES, 32 * 1024 * 1024);
  assert.ok(image.MAX_TOTAL_BASE64 < 48 * 1024 * 1024, '必须给请求体留余量');
});

// ---------------------------------------------------------------------------
// image.js：prepareImages（mock wx）
// ---------------------------------------------------------------------------

function makeWxMock({ sourceWidth = 4000, sourceHeight = 3000, size = 1024, compressFailOnce = false } = {}) {
  const log = [];
  const dims = new Map();
  const sizes = new Map();
  let seq = 0;
  let failNext = compressFailOnce;

  const wxMock = {
    getImageInfo({ src, success }) {
      log.push(['getImageInfo', src]);
      const d = dims.get(src) || { width: sourceWidth, height: sourceHeight };
      success(Object.assign({ path: src }, d));
    },
    compressImage({ src, quality, compressedWidth, compressedHeight, success, fail }) {
      if (failNext) {
        failNext = false;
        log.push(['compressImage:fail', src, quality]);
        fail({ errMsg: 'compressImage:fail unsupported params' });
        return;
      }
      seq += 1;
      const out = `wxfile://compressed_${seq}.jpg`;
      const base = dims.get(src) || { width: sourceWidth, height: sourceHeight };
      const width = compressedWidth || base.width;
      const height = compressedHeight || base.height;
      dims.set(out, { width, height });
      sizes.set(out, size);
      log.push(['compressImage', src, quality, width, height]);
      success({ tempFilePath: out });
    },
    getFileSystemManager() {
      return {
        stat({ path, success }) {
          log.push(['stat', path]);
          success({ stats: { size: sizes.has(path) ? sizes.get(path) : size } });
        },
        readFile({ filePath, encoding, success }) {
          log.push(['readFile', filePath, encoding]);
          const n = sizes.get(filePath) || size;
          success({ data: 'A'.repeat(image.estimateBase64Length(n)) });
        },
        unlink({ filePath, success }) {
          log.push(['unlink', filePath]);
          success({});
        },
      };
    },
  };
  return { wxMock, log, dims, sizes };
}

test('prepareImages：逐张串行，压完读完立即删临时文件', async (t) => {
  const { wxMock, log } = makeWxMock();
  global.wx = wxMock;

  const out = await image.prepareImages(['wxfile://a.jpg', 'wxfile://b.jpg']);
  assert.strictEqual(out.images.length, 2);
  assert.ok(out.images[0].base64.startsWith('AAAA'));
  assert.strictEqual(out.images[0].width, 1280);
  assert.strictEqual(out.images[0].height, 960);
  assert.ok(out.images[0].dataUrl.startsWith('data:image/jpeg;base64,'));

  const compressIdx = log.filter((c) => c[0] === 'compressImage').map((c) => log.indexOf(c));
  const readIdx = log.filter((c) => c[0] === 'readFile').map((c) => log.indexOf(c));
  assert.ok(readIdx[0] < compressIdx[1], '第 1 张读完才压第 2 张');

  const unlinked = log.filter((c) => c[0] === 'unlink').map((c) => c[1]);
  assert.ok(unlinked.includes('wxfile://compressed_1.jpg'), '压缩产物必须删');
  assert.ok(unlinked.includes('wxfile://a.jpg'), '源临时文件也要删');
});

test('prepareImages：压缩参数被拒时退回只传 quality', async (t) => {
  const { wxMock } = makeWxMock({ compressFailOnce: true });
  global.wx = wxMock;
  const out = await image.prepareImages(['wxfile://a.jpg']);
  assert.strictEqual(out.images.length, 1);
});

test('prepareImages：超过 8 张直接拦，不浪费压缩开销', async () => {
  global.wx = makeWxMock().wxMock;
  const paths = Array.from({ length: 9 }, (_, i) => `wxfile://p${i}.jpg`);
  await assert.rejects(() => image.prepareImages(paths), (err) => err.code === 'E_TOO_MANY_IMAGES');
});

test('prepareImages：单张过大时降质重压一次', async (t) => {
  const { wxMock, log } = makeWxMock({ size: 7 * 1024 * 1024 });
  global.wx = wxMock;
  await image.prepareImages(['wxfile://a.jpg']);
  const qualities = log.filter((c) => c[0] === 'compressImage').map((c) => c[2]);
  assert.deepStrictEqual(qualities, [0.7, 0.5]);
});

test('prepareImages：总量超限抛 E_IMAGE_TOO_LARGE', async () => {
  global.wx = makeWxMock({ size: 20 * 1024 * 1024 }).wxMock;
  await assert.rejects(() => image.prepareImages(['wxfile://a.jpg']), (err) => err.code === 'E_IMAGE_TOO_LARGE');
});

// ---------------------------------------------------------------------------
// capture.js
// ---------------------------------------------------------------------------

test('capture：三视角依次引导，拍完 done', () => {
  const s = capture.createSession();
  assert.strictEqual(s.total, 3);
  assert.deepStrictEqual([s.prompt.step, s.prompt.total], [1, 3]);
  assert.strictEqual(s.prompt.label, '正面全景');

  s.add('wxfile://1.jpg');
  assert.strictEqual(s.prompt.step, 2);
  assert.strictEqual(s.prompt.zone, '上层');

  s.add('wxfile://2.jpg');
  s.add('wxfile://3.jpg');
  assert.strictEqual(s.done, true);
  assert.strictEqual(s.prompt, null);
});

test('capture：拍完后再 add 不改变状态（防止误点多张）', () => {
  const s = capture.createSession();
  s.add('a').add('b').add('c').add('d');
  assert.strictEqual(s.paths.length, 3);
});

test('capture：可重拍最后一张', () => {
  const s = capture.createSession();
  s.add('a').add('b');
  s.removeLast();
  assert.deepStrictEqual(s.paths, ['a']);
  assert.strictEqual(s.prompt.label, '上层');
});

test('capture：reset 清空', () => {
  const s = capture.createSession();
  s.add('a').reset();
  assert.strictEqual(s.paths.length, 0);
  assert.strictEqual(s.prompt.step, 1);
});

test('capture：引导拍完即不可再加（也没有随便拍的入口）', () => {
  const s = capture.createSession();
  s.add('a').add('b').add('c');
  assert.strictEqual(s.done, true);
  assert.strictEqual(s.canAddMore(), false);
  const many = capture.createSession();
  for (let i = 0; i < 8; i += 1) many.add(`p${i}`);
  assert.strictEqual(many.canAddMore(), false);
});

test('capture：toScanParams 去重并拼 zone_hint', () => {
  const s = capture.createSession();
  s.add('a').add('b');
  assert.deepStrictEqual(capture.toScanParams(s), { zone_hint: '正面全景+上层', zones: ['正面全景', '上层'] });
});

// ---------------------------------------------------------------------------
// api.js
// ---------------------------------------------------------------------------

function stubCloud(impl) {
  global.wx = { cloud: { callFunction: impl } };
}

test('callProxy：成功时解出 result.data', async () => {
  let received;
  stubCloud((args) => {
    received = args;
    return Promise.resolve({ result: { ok: true, data: { hello: 1 } } });
  });
  const data = await api.callProxy('inventory.get', { a: 1 });
  assert.deepStrictEqual(data, { hello: 1 });
  assert.strictEqual(received.name, 'aiProxy');
  assert.deepStrictEqual(received.data, { a: 1, action: 'inventory.get' });
});

test('callProxy：业务错误带 code 抛出', async () => {
  stubCloud(() => Promise.resolve({ result: { ok: false, error: { code: 'E_NO_KEY', message: 'x' } } }));
  await assert.rejects(() => api.callProxy('recipe.suggest'), (err) => err.code === 'E_NO_KEY' && err.message === 'x');
});

test('callProxy：本地 60 秒兜底（用 20ms 模拟）', async () => {
  stubCloud(() => new Promise(() => {}));
  const started = Date.now();
  await assert.rejects(
    () => api.callProxy('inventory.scan', {}, { timeoutMs: 20 }),
    (err) => err.code === 'E_CLIENT_TIMEOUT'
  );
  assert.ok(Date.now() - started < 1000);
});

test('callProxy：云函数层网络错误归一成 E_NET', async () => {
  stubCloud(() => Promise.reject({ errMsg: 'cloud.callFunction:fail' }));
  await assert.rejects(() => api.callProxy('inventory.get'), (err) => err.code === 'E_NET');
});

test('callProxy：没有 wx 环境时不崩', async () => {
  delete global.wx;
  await assert.rejects(() => api.callProxy('inventory.get'), (err) => err.code === 'E_NO_CLOUD');
});

test('scanInventory：把 {base64,dataUrl} 转成 dataUrl 数组并带上 session', async () => {
  let received;
  stubCloud((args) => {
    received = args.data;
    return Promise.resolve({ result: { ok: true, data: {} } });
  });
  await api.scanInventory({
    images: [{ base64: 'AAA', dataUrl: 'data:image/jpeg;base64,AAA' }],
    sessionId: 's1',
    zoneHint: '上层',
  });
  assert.deepStrictEqual(received.images, ['data:image/jpeg;base64,AAA']);
  assert.strictEqual(received.session_id, 's1');
  assert.strictEqual(received.zone_hint, '上层');
});

test('scanInventory：裸 base64 字符串也能用', async () => {
  let received;
  stubCloud((args) => {
    received = args.data;
    return Promise.resolve({ result: { ok: true, data: {} } });
  });
  await api.scanInventory({ images: ['AAA'] });
  assert.deepStrictEqual(received.images, ['AAA']);
});

test('toUserMessage：已知码走文案，未知码回退 message', () => {
  assert.strictEqual(api.toUserMessage({ code: 'E_NO_KEY' }), api.MESSAGES.E_NO_KEY);
  assert.strictEqual(api.toUserMessage({ code: 'E_WHATEVER', message: '自定义' }), '自定义');
  assert.strictEqual(api.toUserMessage(null), api.MESSAGES.E_INTERNAL);
});

test('needsProviderSetup：只对 Key 相关错误返回 true', () => {
  assert.strictEqual(api.needsProviderSetup({ code: 'E_NO_KEY' }), true);
  assert.strictEqual(api.needsProviderSetup({ code: 'E_KEY_BROKEN' }), true);
  assert.strictEqual(api.needsProviderSetup({ code: 'E_NET' }), false);
  assert.strictEqual(api.needsProviderSetup(null), false);
});

test('cacheProvider：只缓存 base_url / model_name，绝不写 Key', () => {
  const store = {};
  global.wx = {
    setStorageSync: (k, v) => {
      store[k] = v;
    },
    getStorageSync: (k) => store[k],
    removeStorageSync: (k) => delete store[k],
  };
  api.cacheProvider({ baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-flash' });
  const cached = api.readCachedProvider();
  assert.deepStrictEqual(cached, { baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-flash' });
  const raw = JSON.stringify(store[api.STORAGE_KEY]);
  assert.ok(!/key|sk-/i.test(raw), 'Storage 里不能出现 Key 字段');
  api.clearCachedProvider();
  assert.deepStrictEqual(api.readCachedProvider(), { baseUrl: '', modelName: '' });
});

// ---------------------------------------------------------------------------
// flow.js：串起来用
// ---------------------------------------------------------------------------

const flow = require('../miniprogram/utils/flow.js');

function makeFlowWx({ hasKey = true, choosePaths = ['wxfile://a.jpg'], scanResult = { ok: true, data: { summary_card: { lines: [], zeroTap: true } } } } = {}) {
  const { wxMock } = makeWxMock();
  const cloudCalls = [];
  wxMock.chooseMedia = ({ count, success }) => {
    wxMock.lastChoose = { count };
    success({ tempFiles: choosePaths.slice(0, count).map((p) => ({ tempFilePath: p, size: 1024 })) });
  };
  wxMock.cloud = {
    callFunction: (args) => {
      cloudCalls.push(args.data);
      if (args.data.action === 'config.get') {
        return Promise.resolve({ result: { ok: true, data: { has_key: hasKey, base_url: 'https://api.deepseek.com', model_name: 'deepseek-flash' } } });
      }
      return Promise.resolve({ result: scanResult });
    },
  };
  wxMock.setStorageSync = () => {};
  return { wxMock, cloudCalls };
}

test('flow.pickNext：把 chooseMedia 的结果计入会话，并返回下一条提示', async () => {
  const { wxMock } = makeFlowWx();
  global.wx = wxMock;
  const s = capture.createSession();
  const prompt = await flow.pickNext(s);
  assert.strictEqual(s.paths.length, 1);
  assert.strictEqual(prompt.step, 2);
  assert.strictEqual(prompt.label, '上层');
  assert.strictEqual(wxMock.lastChoose.count, 1, '一次只选一张，避免内存峰值');
});

test('flow.pickNext：拍满后返回 null 且不再调 chooseMedia', async () => {
  const { wxMock } = makeFlowWx();
  global.wx = wxMock;
  const s = capture.createSession();
  s.add('a').add('b').add('c');
  assert.strictEqual(await flow.pickNext(s), null);
  assert.strictEqual(wxMock.lastChoose, undefined);
});

test('flow.scanSession：三张图打完包走 inventory.scan，带 zones 与 session', async () => {
  const { wxMock, cloudCalls } = makeFlowWx({ choosePaths: ['wxfile://a.jpg'] });
  global.wx = wxMock;
  const s = capture.createSession();
  s.add('a').add('b').add('c');

  const data = await flow.scanSession(s, { sessionId: 's_test' });
  assert.deepStrictEqual(data, { summary_card: { lines: [], zeroTap: true } });

  const scan = cloudCalls.find((c) => c.action === 'inventory.scan');
  assert.strictEqual(scan.images.length, 3);
  assert.ok(scan.images[0].startsWith('data:image/jpeg;base64,'));
  assert.deepStrictEqual(scan.zones, ['正面全景', '上层', '下层']);
  assert.strictEqual(scan.zone_hint, '正面全景+上层+下层');
  assert.strictEqual(scan.session_id, 's_test');
});

test('flow.scanSession：会话为空时直接报错，不发请求', async () => {
  const { wxMock, cloudCalls } = makeFlowWx();
  global.wx = wxMock;
  const s = capture.createSession();
  await assert.rejects(() => flow.scanSession(s), (err) => err.code === 'E_BAD_INPUT');
  assert.strictEqual(cloudCalls.length, 0);
});

test('flow.ensureProviderReady：没配 Key 就拦住拍照', async () => {
  const { wxMock } = makeFlowWx({ hasKey: false });
  global.wx = wxMock;
  await assert.rejects(() => flow.ensureProviderReady(), (err) => err.code === 'E_NO_KEY');
});

test('flow.captureAndScan：先校验 Key，再扫描', async () => {
  const { wxMock, cloudCalls } = makeFlowWx();
  global.wx = wxMock;
  const s = capture.createSession();
  s.add('a');
  await flow.captureAndScan(s);
  const actions = cloudCalls.map((c) => c.action);
  assert.deepStrictEqual(actions, ['config.get', 'inventory.scan']);
});
