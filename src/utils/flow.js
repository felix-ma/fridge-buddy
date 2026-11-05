'use strict';

/**
 * 把 capture / image / api 串成一条可用的链路。页面层只跟这里打交道，
 * 不直接调 wx.chooseMedia / wx.compressImage，也不拼云函数参数。
 */

const image = require('./image');
const api = require('./api');
const capture = require('./capture');

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** 没配 Key 就别让用户白拍三张——先问配置，再放行拍照。 */
async function ensureProviderReady() {
  const provider = await api.getProvider();
  if (!provider || !provider.has_key) fail('E_NO_KEY', api.MESSAGES.E_NO_KEY);
  api.cacheProvider({ baseUrl: provider.base_url, modelName: provider.model_name });
  return provider;
}

/** 拍下一张并计入会话。拍满了返回 null，页面据此收起按钮。 */
async function pickNext(session) {
  if (!session.canAddMore()) return null;
  const picked = await image.pickImages({ count: 1 });
  if (!picked.length) return null; // 用户取消
  session.add(picked[0].path);
  return session.prompt;
}

/**
 * 会话 → 压缩 → Base64 → 云函数。
 * 无论成功失败，临时文件都会在 prepareImages 里释放。
 */
async function scanSession(session, { onProgress, sessionId } = {}) {
  if (!session || !session.paths.length) fail('E_BAD_INPUT', '还没有拍图');
  const prepared = await image.prepareImages(session.paths, { onProgress });
  const params = capture.toScanParams(session);
  return api.scanInventory({
    images: prepared.images,
    sessionId,
    zoneHint: params.zone_hint,
    zones: params.zones,
  });
}

/** 一次性全流程：确保有 Key → 已拍的图入库。 */
async function captureAndScan(session, opts) {
  await ensureProviderReady();
  return scanSession(session, opts);
}

module.exports = { ensureProviderReady, pickNext, scanSession, captureAndScan };
