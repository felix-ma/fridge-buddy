'use strict';

const cloud = require('wx-server-sdk');
const nodeCrypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { createDb, ensureUser } = require('./lib/db');
const { encrypt, decrypt, hint } = require('./lib/crypto');
const { chat, parseJsonLoose, DEFAULT_MODEL, DEFAULT_BASE_URL } = require('./lib/deepseek');
const { buildInventoryPrompt, ZONE_DEFAULT } = require('./prompts/inventory');
const { buildRecipePrompt } = require('./prompts/recipe');
const { normalizeObservation, normalizeRecipe } = require('./lib/validate');
const engine = require('./lib/inventory-engine');

// 产品上限：API 单请求其实允许 600 张，但冰箱盘点 3~5 张足够，多拍只是多花钱。
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024; // 请求体硬上限 48 MiB，留余量
const ITEM_FIELDS =
  'id,label,quantity,zone_id,state,confidence,first_seen_at,last_seen_at,miss_count,shelf_life_days,expire_at,pending_quantity';

const ACTIVE_STATES = ['present', 'probably_removed'];

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function ok(data, extra = {}) {
  return { ok: true, data, ...extra };
}

function uuid() {
  if (typeof nodeCrypto.randomUUID === 'function') return nodeCrypto.randomUUID();
  const b = nodeCrypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// 图片：只在这里转成 data URL，不落盘、不写库
// ---------------------------------------------------------------------------
function sniffMime(b64) {
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('R0lG')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

function normalizeImages(input) {
  if (!Array.isArray(input) || !input.length) fail('E_BAD_INPUT', '至少需要 1 张图片');
  if (input.length > MAX_IMAGES) fail('E_TOO_MANY_IMAGES', `最多 ${MAX_IMAGES} 张，建议按上/中/下三层拍摄`);

  let total = 0;
  return input.map((raw, idx) => {
    if (typeof raw !== 'string' || raw.length < 100) fail('E_BAD_INPUT', `第 ${idx + 1} 张图片数据为空`);
    const m = /^data:([^;]+);base64,(.*)$/s.exec(raw);
    const mime = m ? m[1] : sniffMime(raw.slice(0, 16));
    const b64 = m ? m[2] : raw;
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) {
      fail('E_BAD_INPUT', `第 ${idx + 1} 张图片格式不支持：${mime}`);
    }
    const bytes = Math.floor(b64.length * 0.75);
    if (bytes > MAX_IMAGE_BYTES) fail('E_IMAGE_TOO_LARGE', `第 ${idx + 1} 张图片超过 32 MiB，请先压缩`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) fail('E_IMAGE_TOO_LARGE', '图片总量过大，请减少张数或压缩后重试');
    return { dataUrl: `data:${mime};base64,${b64}` };
  });
}

// ---------------------------------------------------------------------------
// Provider 配置
// ---------------------------------------------------------------------------
async function loadProvider(db, userId) {
  const rows = await db.select(
    'user_provider_configs',
    `user_id=eq.${userId}&select=base_url,model_name,encrypted_key,key_hint`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  const baseUrl = (row && row.base_url) || DEFAULT_BASE_URL;
  const model = (row && row.model_name) || DEFAULT_MODEL;

  let apiKey = null;
  let source = 'user';
  if (row && row.encrypted_key) {
    try {
      apiKey = decrypt(row.encrypted_key, process.env.PROVIDER_KEY_SECRET);
    } catch (e) {
      fail('E_KEY_BROKEN', '本地保存的 Key 无法解密，请重新配置');
    }
  }
  if (!apiKey && process.env.DEEPSEEK_API_KEY) {
    apiKey = process.env.DEEPSEEK_API_KEY;
    source = 'env';
  }
  if (!apiKey) fail('E_NO_KEY', '还没有配置 API Key，先到设置页填一个');
  return { baseUrl, model, apiKey, source };
}

function parseBaseUrl(input) {
  const raw = String(input || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_BASE_URL;
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    fail('E_BAD_INPUT', 'base_url 不是合法网址');
  }
  if (u.protocol !== 'https:') fail('E_BAD_INPUT', 'base_url 必须是 https');
  return raw;
}

// ---------------------------------------------------------------------------
// 1）拍照入库
// ---------------------------------------------------------------------------
async function scanInventory(db, userId, event) {
  const images = normalizeImages(event.images);
  const sessionId = String(event.session_id || `s_${Date.now()}`);
  const zoneHint = String(event.zone_hint || '').slice(0, 32);
  const zones = Array.isArray(event.zones) && event.zones.length ? event.zones.slice(0, 8) : ZONE_DEFAULT;

  const current = await db.select(
    'inventory_items',
    `user_id=eq.${userId}&state=in.(present,probably_removed)&select=${ITEM_FIELDS}&limit=300`
  );
  const items = Array.isArray(current) ? current : [];

  const provider = await loadProvider(db, userId);
  const prompt = buildInventoryPrompt({
    zones,
    existingLabels: items.map((it) => it.label),
    imageCount: images.length,
  });

  const result = await chat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    timeoutMs: 50000,
    maxTokens: 2048,
    messages: [
      {
        role: 'user',
        content: [...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'original' } })), prompt],
      },
    ],
  });

  let parsed;
  try {
    parsed = parseJsonLoose(result.content);
  } catch (e) {
    fail('E_PARSE', '识别结果不是合法 JSON，本次未入库，请重试');
  }
  const observation = normalizeObservation(parsed);
  if (!observation.items.length && !observation.uncertain.length) {
    fail('E_EMPTY', '这次没认出食材，换个角度再拍一次？');
  }

  // 先落观测（只增不改，是后续回溯的原始凭据），再做状态机
  const obsRows = await db.insert('observations', [
    {
      user_id: userId,
      session_id: sessionId,
      zone_hint: zoneHint,
      items_json: observation.items,
      uncertain_json: observation.uncertain,
      meta: {
        model: result.model,
        usage: result.usage,
        image_count: images.length,
        finish_reason: result.finishReason,
        key_source: provider.source,
      },
    },
  ]);
  const observationId = Array.isArray(obsRows) && obsRows[0] ? obsRows[0].id : null;

  const now = new Date();
  const outcome = engine.reconcile({ items, observation, now, idFactory: () => uuid() });

  if (outcome.changed.length) {
    const rows = outcome.changed.map((it) => ({
      id: it.id,
      user_id: userId,
      label: it.label,
      quantity: it.quantity,
      zone_id: it.zone_id || null,
      state: it.state,
      confidence: it.confidence,
      first_seen_at: it.first_seen_at,
      last_seen_at: it.last_seen_at,
      miss_count: it.miss_count,
      shelf_life_days: it.shelf_life_days,
      expire_at: it.expire_at,
      pending_quantity: it.pending_quantity == null ? null : it.pending_quantity,
      updated_at: new Date().toISOString(),
    }));
    await db.upsert('inventory_items', rows, 'id');
  }

  return {
    observation_id: observationId,
    session_id: sessionId,
    summary: outcome.summary,
    summary_card: engine.buildSummaryCard(outcome),
    questions: outcome.questions,
    items: outcome.items.filter((it) => ACTIVE_STATES.includes(it.state)),
    expiring: engine.expiring(outcome.items, now, { withinDays: 3 }).slice(0, 10),
    usage: result.usage,
  };
}

// ---------------------------------------------------------------------------
// 2）库存读取 / 用户动作
// ---------------------------------------------------------------------------
async function getInventory(db, userId) {
  const rows = await db.select(
    'inventory_items',
    `user_id=eq.${userId}&select=${ITEM_FIELDS}&order=last_seen_at.desc&limit=300`
  );
  const items = Array.isArray(rows) ? rows : [];
  return {
    items: items.filter((it) => ACTIVE_STATES.includes(it.state)),
    history: items.filter((it) => !ACTIVE_STATES.includes(it.state)).slice(0, 50),
    expiring: engine.expiring(items, new Date(), { withinDays: 3 }),
  };
}

async function doInventoryAction(db, userId, event) {
  const type = String(event.type || '');
  const itemId = String(event.item_id || '');
  if (!itemId) fail('E_BAD_INPUT', '缺少 item_id');

  const rows = await db.select(
    'inventory_items',
    `id=eq.${encodeURIComponent(itemId)}&user_id=eq.${userId}&select=${ITEM_FIELDS}`
  );
  if (!Array.isArray(rows) || !rows.length) fail('E_NOT_FOUND', '库存项不存在');

  const result = engine.applyAction(rows, { type, itemId, zone: event.zone }, new Date());
  const it = result.item;
  await db.patch(`inventory_items`, `id=eq.${encodeURIComponent(itemId)}&user_id=eq.${userId}`, {
    state: it.state,
    quantity: it.quantity,
    miss_count: it.miss_count,
    last_seen_at: it.last_seen_at,
    confidence: it.confidence,
    pending_quantity: it.pending_quantity == null ? null : it.pending_quantity,
    zone_id: it.zone_id || null,
    updated_at: it.updated_at,
  });
  return { item: it };
}

// ---------------------------------------------------------------------------
// 3）食谱
// ---------------------------------------------------------------------------
async function suggestRecipes(db, userId, event) {
  const rows = await db.select(
    'inventory_items',
    `user_id=eq.${userId}&state=in.(present,probably_removed)&select=${ITEM_FIELDS}&limit=80`
  );
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) fail('E_EMPTY_INVENTORY', '冰箱还是空的，先拍一次照吧');

  const upcoming = engine.expiring(items, new Date(), { withinDays: 3 });
  const provider = await loadProvider(db, userId);
  const result = await chat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    timeoutMs: 45000,
    maxTokens: 1600,
    messages: [
      {
        role: 'user',
        content: [
          buildRecipePrompt({
            items: items.slice(0, 40).map((it) => ({ label: it.label, quantity: it.quantity })),
            upcoming: upcoming.map((u) => ({ label: u.label })),
            servings: Number(event.servings) > 0 ? Number(event.servings) : 2,
          }),
        ],
      },
    ],
  });

  let parsed;
  try {
    parsed = parseJsonLoose(result.content);
  } catch (e) {
    fail('E_PARSE', '食谱生成失败，请重试');
  }
  return { ...normalizeRecipe(parsed), usage: result.usage };
}

// ---------------------------------------------------------------------------
// 4）Provider 配置（Key 只进不出）
// ---------------------------------------------------------------------------
async function putProvider(db, userId, event) {
  const apiKey = String(event.api_key || '').trim();
  if (!apiKey) fail('E_BAD_INPUT', 'API Key 不能为空');
  if (apiKey.length < 16) fail('E_BAD_INPUT', 'API Key 看起来太短了');
  if (!/^[\x20-\x7e]+$/.test(apiKey)) fail('E_BAD_INPUT', 'API Key 含有非法字符');

  const baseUrl = parseBaseUrl(event.base_url);
  const model = String(event.model_name || DEFAULT_MODEL).trim().slice(0, 64);
  if (!/^[A-Za-z0-9._:\-/]+$/.test(model)) fail('E_BAD_INPUT', '模型名含有非法字符');

  const encrypted = encrypt(apiKey, process.env.PROVIDER_KEY_SECRET);
  await db.upsert(
    'user_provider_configs',
    [
      {
        user_id: userId,
        base_url: baseUrl,
        model_name: model,
        encrypted_key: encrypted,
        key_hint: hint(apiKey),
        updated_at: new Date().toISOString(),
      },
    ],
    'user_id'
  );
  return { base_url: baseUrl, model_name: model, has_key: true, key_hint: hint(apiKey) };
}

async function getProvider(db, userId) {
  const rows = await db.select(
    'user_provider_configs',
    `user_id=eq.${userId}&select=base_url,model_name,key_hint,updated_at`
  );
  const row = (Array.isArray(rows) && rows[0]) || null;
  const envKey = Boolean(process.env.DEEPSEEK_API_KEY);
  return {
    base_url: (row && row.base_url) || DEFAULT_BASE_URL,
    model_name: (row && row.model_name) || DEFAULT_MODEL,
    has_key: Boolean(row && row.key_hint) || envKey,
    key_hint: (row && row.key_hint) || (envKey ? '（服务端内置 Key）' : ''),
    source: row ? 'user' : envKey ? 'env' : 'none',
  };
}

// ---------------------------------------------------------------------------
// 5）定时任务：临期提醒
// ---------------------------------------------------------------------------
async function runReminder(db) {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const rows = await db.select(
    'inventory_items',
    `state=in.(present,probably_removed)&expire_at=lte.${soon}&select=id,user_id,label,quantity,expire_at&limit=500`
  );
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return { users: 0, items: 0, sent: 0 };

  const userIds = [...new Set(items.map((i) => i.user_id))];
  const users = await db.select('app_users', `id=in.(${userIds.join(',')})&select=id,openid`);
  const openidOf = new Map((Array.isArray(users) ? users : []).map((u) => [u.id, u.openid]));

  const templateId = process.env.SUBSCRIBE_TEMPLATE_ID;
  const now = new Date();
  let sent = 0;
  const skipped = [];

  for (const it of items) {
    const openid = openidOf.get(it.user_id);
    const daysLeft = Math.ceil((new Date(it.expire_at).getTime() - now.getTime()) / 86400000);
    const level = daysLeft < 0 ? 'expired' : daysLeft <= 0 ? 'today' : daysLeft <= 1 ? 'due1' : 'due3';

    if (!openid || !templateId) {
      skipped.push({ item_id: it.id, reason: !openid ? 'no_openid' : 'no_template' });
      continue;
    }
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: openid,
        templateId,
        page: 'pages/home/index',
        miniprogramState: process.env.MP_STATE || 'formal',
        data: {
          thing1: { value: String(it.label).slice(0, 20) },
          date2: { value: new Date(it.expire_at).toISOString().slice(0, 10) },
          thing3: { value: daysLeft < 0 ? '已经过期了，记得清理' : `还有 ${Math.max(daysLeft, 0)} 天到期` },
        },
      });
      sent += 1;
      try {
        await db.insert('reminder_logs', [{ user_id: it.user_id, item_id: it.id, level }]);
      } catch (e) {
        // 唯一索引已存在同一天记录，忽略
      }
    } catch (e) {
      skipped.push({ item_id: it.id, reason: String((e && e.errCode) || (e && e.message) || e).slice(0, 80) });
    }
  }

  return { users: userIds.length, items: items.length, sent, skipped: skipped.slice(0, 10) };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
exports.main = async (event = {}, context = {}) => {
  const started = Date.now();
  const action = String(event.action || '').trim();
  try {
    const db = createDb({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });

    const isTimer = event.Type === 'Timer' || event.type === 'timer' || action === 'cron.remind';
    if (isTimer) return ok(await runReminder(db));

    if (!action) fail('E_BAD_INPUT', '缺少 action');

    const openid = (cloud.getWXContext() || {}).OPENID;
    if (!openid) fail('E_NO_OPENID', '无法识别用户身份，请在小程序内调用');
    const userId = await ensureUser(db, openid);

    let data;
    switch (action) {
      case 'inventory.scan':
        data = await scanInventory(db, userId, event);
        break;
      case 'inventory.get':
        data = await getInventory(db, userId);
        break;
      case 'inventory.action':
        data = await doInventoryAction(db, userId, event);
        break;
      case 'recipe.suggest':
        data = await suggestRecipes(db, userId, event);
        break;
      case 'config.put':
        data = await putProvider(db, userId, event);
        break;
      case 'config.get':
        data = await getProvider(db, userId);
        break;
      default:
        fail('E_UNKNOWN_ACTION', '未知操作：' + action);
    }
    return ok(data, { elapsedMs: Date.now() - started });
  } catch (err) {
    console.error('[aiProxy]', action, err && err.message);
    return {
      ok: false,
      error: {
        code: (err && err.code) || 'E_INTERNAL',
        message: (err && err.message) || '服务异常',
      },
      elapsedMs: Date.now() - started,
    };
  }
};
