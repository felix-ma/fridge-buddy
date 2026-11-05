'use strict';

/**
 * 云函数调用封装。
 *
 * 三件事：
 * 1. 统一入口：所有 action 都走 callProxy，前端不拼 URL、不碰 Supabase；
 * 2. 本地 60 秒兜底：云函数最长可设 900 秒，前端不能干等；
 * 3. 错误码 → 中文文案：UI 层只认 code，不判断 message 字符串。
 *
 * 本地超时不代表云函数已停——它可能还在跑并且已经落库了。所以文案统一用
 * "可能未保存"，配合"观测只增不改"，重试不会污染历史。
 */

const CLOUD_FN = 'aiProxy';
const CLIENT_TIMEOUT_MS = 60000;
const STORAGE_KEY = 'fb.provider'; // 只缓存 base_url / model_name，绝不存 Key

const MESSAGES = {
  E_CLIENT_TIMEOUT: '识别超时，本次结果可能未保存，请重试',
  E_NET: '网络连接失败，检查一下网络再试',
  E_NO_CLOUD: '云开发没有初始化，请确认小程序已开通云开发',
  E_NO_OPENID: '无法识别用户身份，请重新进入小程序',
  E_NO_KEY: '还没有配置 API Key，先到设置页填一个',
  E_KEY_BROKEN: '保存的 Key 无法解密，请到设置页重新配置',
  E_BAD_KEY: 'API Key 无效，请检查后重填',
  E_PARSE: '识别结果解析失败，请重试一次',
  E_EMPTY: '这次没认出食材，换个角度再拍一次',
  E_EMPTY_INVENTORY: '冰箱还是空的，先拍一次照吧',
  E_TOO_MANY_IMAGES: '最多 8 张，建议按上/中/下三层拍摄',
  E_IMAGE_TOO_LARGE: '图片太大，少拍两张或换个角度重拍',
  E_IMAGE_PROCESS: '图片处理失败，请重拍',
  E_NOT_FOUND: '这项食材已经不在库存里了',
  E_BAD_INPUT: '参数不对，请重试',
  E_UNKNOWN_ACTION: '版本过旧，请更新小程序',
  E_DB: '服务暂时不可用，稍后再试',
  E_INTERNAL: '服务开小差了，稍后再试',
  E_NO_WX: '当前环境没有微信小程序 API',
  E_NO_API: '微信版本过低，请升级微信后重试',
  E_UPSTREAM: '模型服务暂时不可用，稍后再试',
};

function apiError(code, message, detail) {
  const err = new Error(message || MESSAGES[code] || MESSAGES.E_INTERNAL);
  err.code = code || 'E_INTERNAL';
  if (detail) err.detail = detail;
  return err;
}

function hasWx() {
  return typeof wx !== 'undefined';
}

/**
 * 调云函数。payload 直接展开进 data，action 由本函数填。
 * resolve 的是 result.data；业务失败 reject 一个带 code 的 Error。
 */
function callProxy(action, payload = {}, opts = {}) {
  const timeoutMs = opts.timeoutMs || CLIENT_TIMEOUT_MS;

  if (!hasWx() || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject(apiError('E_NO_CLOUD'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(
      () => finish(reject, apiError('E_CLIENT_TIMEOUT', MESSAGES.E_CLIENT_TIMEOUT, { timeoutMs })),
      timeoutMs
    );

    wx.cloud
      .callFunction({ name: CLOUD_FN, data: Object.assign({}, payload, { action }) })
      .then((res) => {
        const result = (res && res.result) || {};
        if (result.ok) {
          finish(resolve, result.data);
          return;
        }
        const err = result.error || {};
        finish(reject, apiError(err.code || 'E_INTERNAL', err.message || MESSAGES.E_INTERNAL));
      })
      .catch((err) => {
        // wx.cloud 层的失败（函数不存在、网络断了、云环境没配）
        finish(reject, apiError('E_NET', MESSAGES.E_NET, err && (err.errMsg || err.message)));
      });
  });
}

// ---------------------------------------------------------------------------
// 业务封装：UI 层只调这些，不直接写 action 字符串
// ---------------------------------------------------------------------------

/** 盘点：images 是 prepareImages 产出的数组（或裸 Base64 字符串数组）。 */
function scanInventory({ images, sessionId, zoneHint, zones } = {}) {
  const list = (images || []).map((it) => (typeof it === 'string' ? it : it.dataUrl || it.base64));
  return callProxy('inventory.scan', {
    images: list,
    session_id: sessionId || `s_${Date.now()}`,
    zone_hint: zoneHint || '',
    zones: zones || undefined,
  });
}

function getInventory() {
  return callProxy('inventory.get');
}

/** type: restore / ignore_removal / delete / consume / accept_quantity / keep_quantity / move_zone */
function actOnItem({ type, itemId, zone } = {}) {
  return callProxy('inventory.action', { type, item_id: itemId, zone });
}

function suggestRecipes({ servings } = {}) {
  return callProxy('recipe.suggest', { servings });
}

function putProvider({ baseUrl, modelName, apiKey } = {}) {
  return callProxy('config.put', { api_key: apiKey, base_url: baseUrl, model_name: modelName });
}

function getProvider() {
  return callProxy('config.get');
}

// ---------------------------------------------------------------------------
// Provider 展示缓存：只存 base_url / model_name，Key 永远不进 Storage
// ---------------------------------------------------------------------------

function cacheProvider({ baseUrl, modelName } = {}) {
  if (!hasWx() || !wx.setStorageSync) return;
  try {
    wx.setStorageSync(STORAGE_KEY, { baseUrl: baseUrl || '', modelName: modelName || '' });
  } catch (e) {
    // 缓存失败不影响主流程
  }
}

function readCachedProvider() {
  if (!hasWx() || !wx.getStorageSync) return { baseUrl: '', modelName: '' };
  try {
    const v = wx.getStorageSync(STORAGE_KEY);
    return { baseUrl: (v && v.baseUrl) || '', modelName: (v && v.modelName) || '' };
  } catch (e) {
    return { baseUrl: '', modelName: '' };
  }
}

function clearCachedProvider() {
  if (!hasWx() || !wx.removeStorageSync) return;
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    // ignore
  }
}

/** 错误 → 可直接展示的一句话。未知错误不吞，回退到原始 message。 */
function toUserMessage(err) {
  if (!err) return MESSAGES.E_INTERNAL;
  if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
  if (err.message && err.message !== 'undefined') return err.message;
  return MESSAGES.E_INTERNAL;
}

/** 需要引导去设置页的情况：没 Key 或 Key 解不开。 */
function needsProviderSetup(err) {
  return Boolean(err && (err.code === 'E_NO_KEY' || err.code === 'E_KEY_BROKEN' || err.code === 'E_BAD_KEY'));
}

module.exports = {
  CLOUD_FN,
  CLIENT_TIMEOUT_MS,
  STORAGE_KEY,
  MESSAGES,
  callProxy,
  scanInventory,
  getInventory,
  actOnItem,
  suggestRecipes,
  putProvider,
  getProvider,
  cacheProvider,
  readCachedProvider,
  clearCachedProvider,
  toUserMessage,
  needsProviderSetup,
};
