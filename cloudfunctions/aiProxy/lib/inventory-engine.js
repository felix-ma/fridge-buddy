'use strict';

/**
 * inventory-engine.js —— 观测层 → 库存状态机（纯函数，无 IO）
 *
 * 设计要点：
 *  1. 纯函数：时间、id 生成器都由外部传入，便于单测与在云函数/前端复用同一份规则。
 *  2. 默认零点击：只有"数量大幅突变"和"疑似已取出"会产出 questions，其余自动落库。
 *  3. 不误删：连续 missToRemoved(3) 次未观测才置 removed，中间态 probably_removed 仍算库存。
 *  4. 低置信不污染主库存：confidence=low 只进 uncertain 折叠区，不参与匹配、不创建实体。
 */

const ALIASES = {
  西红柿: '番茄',
  圣女果: '小番茄',
  马铃薯: '土豆',
  洋芋: '土豆',
  生菜叶: '生菜',
  鸡子: '鸡蛋',
  纯牛奶: '牛奶',
  酸牛奶: '酸奶',
};

/** 保质期天数（冷藏、未开封的粗略估计）。识别不到时用 defaultShelfLifeDays。 */
const SHELF_LIFE_DAYS = {
  牛奶: 7,
  酸奶: 14,
  鸡蛋: 30,
  豆腐: 3,
  豆浆: 3,
  生菜: 4,
  菠菜: 4,
  油菜: 4,
  西兰花: 6,
  番茄: 8,
  小番茄: 8,
  黄瓜: 7,
  胡萝卜: 14,
  土豆: 21,
  洋葱: 21,
  猪肉: 3,
  牛肉: 3,
  鸡胸肉: 3,
  鱼: 2,
  虾: 2,
  苹果: 21,
  橙子: 14,
  香蕉: 5,
  草莓: 3,
  面包: 5,
  剩菜: 2,
};

const DEFAULTS = Object.freeze({
  missToProbablyRemoved: 2,
  missToRemoved: 3,
  quantityJumpAbs: 2,
  quantityJumpRatio: 0.5,
  confidenceHigh: 0.85,
  confidenceMedium: 0.6,
  confidenceLow: 0.3,
  defaultShelfLifeDays: 7,
  maxLabelLength: 24,
});

const ACTIVE_STATES = ['present', 'probably_removed'];

function iso(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('无效时间: ' + value);
  return d.toISOString();
}

function normalizeLabel(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  s = s.replace(/[（(][^)）]*[)）]/g, '').trim(); // 去掉「（约500g）」这类备注
  if (!s) return '';
  return ALIASES[s] || s;
}

function confidenceValue(level, cfg) {
  const key = String(level || 'medium').toLowerCase();
  if (key === 'high') return cfg.confidenceHigh;
  if (key === 'low') return cfg.confidenceLow;
  return cfg.confidenceMedium;
}

function shelfLifeDaysFor(label, cfg) {
  const key = normalizeLabel(label);
  const hit = SHELF_LIFE_DAYS[key];
  return Number.isFinite(hit) ? hit : cfg.defaultShelfLifeDays;
}

function addDays(baseIso, days) {
  return new Date(new Date(baseIso).getTime() + days * 86400000).toISOString();
}

function defaultIdFactory(items, now) {
  let max = 0;
  for (const it of items) {
    const m = /^item_(\d+)$/.exec(String(it.id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  const base = `${new Date(now).getTime()}`;
  return () => `item_${++max}_${base}`;
}

function toQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n));
}

function summarizeUncertain(entry) {
  return {
    label: entry.label,
    quantity: entry.quantity,
    zone: entry.zone || '',
    reason: entry.reason || '置信度低，未入库',
  };
}

/**
 * 核心：把一次观测合并进当前库存。
 *
 * @param {object} input
 * @param {Array}  input.items        当前库存（可能来自 DB）
 * @param {object} input.observation  模型观测 { items:[], uncertain:[] }
 * @param {Date|string} [input.now]
 * @param {object} [input.options]
 * @param {Function} [input.idFactory]
 * @returns {{items: Array, changed: Array, summary: object, questions: Array}}
 */
function reconcile(input = {}) {
  const { items = [], observation = {}, now = new Date(), options = {}, idFactory } = input;
  const cfg = { ...DEFAULTS, ...options };
  const ts = iso(now);
  const newId = typeof idFactory === 'function' ? idFactory : defaultIdFactory(items, ts);

  const next = items.map((it) => ({ ...it }));
  const byId = new Map(next.map((it) => [it.id, it]));
  const changedIds = new Set();
  const matched = new Set();

  const summary = { added: [], quantityChanged: [], removed: [], restored: [], uncertain: [], unchanged: 0 };
  const questions = [];

  const obsItems = Array.isArray(observation.items) ? observation.items : [];
  const obsUncertain = Array.isArray(observation.uncertain) ? observation.uncertain : [];
  const visible = []; // 本轮参与匹配的观测（高/中置信）

  for (const raw of obsItems) {
    const label = normalizeLabel(raw && raw.label).slice(0, cfg.maxLabelLength);
    if (!label) continue;
    const level = String((raw && raw.confidence) || 'medium').toLowerCase();
    const quantity = toQuantity(raw && raw.quantity_estimate);
    const zone = typeof raw.zone_hint === 'string' ? raw.zone_hint.slice(0, 32) : '';
    if (level === 'low') {
      summary.uncertain.push(summarizeUncertain({ label, quantity, zone, reason: '模型自评低置信' }));
      continue;
    }
    visible.push({ label, level, quantity, zone });
  }

  for (const obs of obsUncertain) {
    const label = normalizeLabel(obs && obs.label).slice(0, cfg.maxLabelLength);
    if (!label) continue;
    summary.uncertain.push(summarizeUncertain({ label, quantity: toQuantity(obs.quantity), zone: obs.zone, reason: '模型列入 uncertain' }));
  }

  // —— 一、匹配已有库存 ——
  for (const obs of visible) {
    const target = next.find((it) => ACTIVE_STATES.includes(it.state) && !matched.has(it.id) && normalizeLabel(it.label) === obs.label);

    if (!target) continue; // 先标记，统一在后面创建，避免同轮重复创建
    matched.add(target.id);
    changedIds.add(target.id);

    if (target.state === 'probably_removed') {
      summary.restored.push({ itemId: target.id, label: target.label });
    }
    target.state = 'present';
    target.miss_count = 0;
    target.last_seen_at = ts;
    if (obs.zone && !target.zone_id) target.zone_id = obs.zone;

    const obsConf = confidenceValue(obs.level, cfg);
    // 指数平滑：既不被单帧噪声带跑，也能逐步收敛
    target.confidence = Math.round(((Number(target.confidence) || obsConf) * 0.7 + obsConf * 0.3) * 100) / 100;

    if (obs.quantity != null && obs.quantity !== target.quantity) {
      const from = Number(target.quantity) || 1;
      const diff = Math.abs(obs.quantity - from);
      const ratio = diff / Math.max(from, 1);
      // 只有"真的会吓人"的变化才打断：绝对差 ≥2；或基数够大时相对变化 ≥50%。
      // 2 → 1 这种日常消耗不该弹窗。
      const isJump = diff >= cfg.quantityJumpAbs || (from >= 4 && ratio >= cfg.quantityJumpRatio);
      if (isJump) {
        // 大幅突变：不改数量，挂起等用户轻确认（可撤回）
        target.pending_quantity = obs.quantity;
        summary.quantityChanged.push({ itemId: target.id, label: target.label, from, to: obs.quantity, pending: true });
        questions.push({
          id: `qty_${target.id}`,
          type: 'quantity',
          itemId: target.id,
          label: target.label,
          message: `${target.label}数量可能变化：${from} → ${obs.quantity}`,
          options: [
            { id: 'accept_quantity', label: `改成 ${obs.quantity}` },
            { id: 'keep_quantity', label: '保持原样' },
          ],
        });
      } else {
        summary.quantityChanged.push({ itemId: target.id, label: target.label, from, to: obs.quantity, pending: false });
        target.quantity = obs.quantity;
      }
    } else if (obs.quantity == null) {
      summary.unchanged += 1;
    }
  }

  // —— 二、观测到但没有对应实体的 → 新建 ——
  for (const obs of visible) {
    const exists = next.some((it) => ACTIVE_STATES.includes(it.state) && normalizeLabel(it.label) === obs.label);
    if (exists) continue;
    const id = newId();
    const shelfLife = shelfLifeDaysFor(obs.label, cfg);
    const conf = confidenceValue(obs.level, cfg);
    const item = {
      id,
      label: obs.label,
      quantity: obs.quantity == null ? 1 : obs.quantity,
      zone_id: obs.zone || '',
      state: 'present',
      confidence: conf,
      first_seen_at: ts,
      last_seen_at: ts,
      miss_count: 0,
      shelf_life_days: shelfLife,
      expire_at: addDays(ts, shelfLife),
      pending_quantity: null,
    };
    next.push(item);
    changedIds.add(id);
    matched.add(id); // 本轮刚建的实体不算"没拍到"
    summary.added.push({ itemId: id, label: item.label, quantity: item.quantity });
  }

  // —— 三、在库但本轮没看到 → miss_count 递增，三振出局 ——
  for (const it of next) {
    if (!ACTIVE_STATES.includes(it.state)) continue;
    if (matched.has(it.id)) continue;

    const before = it.state;
    it.miss_count = (Number(it.miss_count) || 0) + 1;
    changedIds.add(it.id); // miss_count 本身也要落库，否则计数永远停在 0
    if (it.miss_count >= cfg.missToRemoved) it.state = 'removed';
    else if (it.miss_count >= cfg.missToProbablyRemoved) it.state = 'probably_removed';

    if (it.state !== before) {
      summary.removed.push({ itemId: it.id, label: it.label, from: before, to: it.state, missCount: it.miss_count });
    }
  }

  // 被判定"疑似取出"的实体，给用户一个可撤回入口（默认不打断）
  for (const it of next) {
    if (it.state !== 'probably_removed') continue;
    if (!summary.removed.some((r) => r.itemId === it.id)) continue;
    questions.push({
      id: `restore_${it.id}`,
      type: 'restore',
      itemId: it.id,
      label: it.label,
      message: `${it.label}似乎已取出`,
      options: [
        { id: 'restore', label: '恢复' },
        { id: 'delete', label: '确实没了' },
      ],
    });
  }

  for (const it of next) {
    if (!changedIds.has(it.id)) continue;
    it.updated_at = ts;
  }

  return {
    items: next,
    changed: next.filter((it) => changedIds.has(it.id)),
    summary,
    questions,
  };
}

/**
 * 用户对提示的响应。所有动作都可重复执行（幂等）。
 */
function applyAction(items = [], action = {}, now = new Date()) {
  const ts = iso(now);
  const idx = items.findIndex((it) => it.id === action.itemId);
  if (idx < 0) throw new Error('库存项不存在: ' + action.itemId);

  const next = items.map((it) => ({ ...it }));
  const it = next[idx];

  switch (action.type) {
    case 'restore':
    case 'ignore_removal':
      it.state = 'present';
      it.miss_count = 0;
      it.last_seen_at = ts;
      it.confidence = Math.max(Number(it.confidence) || 0.6, 0.6);
      break;
    case 'delete':
      it.state = 'removed';
      it.pending_quantity = null;
      break;
    case 'consume':
      it.state = 'consumed';
      it.pending_quantity = null;
      break;
    case 'accept_quantity':
      if (it.pending_quantity == null) throw new Error('没有待确认的数量变更');
      it.quantity = it.pending_quantity;
      it.pending_quantity = null;
      it.confidence = Math.min(0.99, (Number(it.confidence) || 0.6) + 0.1);
      break;
    case 'keep_quantity':
      it.pending_quantity = null;
      break;
    case 'move_zone':
      it.zone_id = String(action.zone || '').slice(0, 32);
      break;
    default:
      throw new Error('未知动作: ' + action.type);
  }

  it.updated_at = ts;
  return { items: next, item: it };
}

/**
 * 临期清单：给定时触发器与首页角标用。
 * level: expired | today | due1 | due3
 */
function expiring(items = [], now = new Date(), { withinDays = 3 } = {}) {
  const ts = new Date(now).getTime();
  const out = [];
  for (const it of items) {
    if (it.state !== 'present' && it.state !== 'probably_removed') continue;
    if (!it.expire_at) continue;
    const leftMs = new Date(it.expire_at).getTime() - ts;
    const daysLeft = Math.ceil(leftMs / 86400000); // 不足一天按 1 天算，"还剩几天"更符合直觉
    let level = null;
    if (leftMs < 0) level = 'expired';
    else if (leftMs <= 12 * 3600 * 1000) level = 'today'; // 半天内到期 = 今天
    else if (daysLeft <= 1) level = 'due1';
    else if (daysLeft <= withinDays) level = 'due3';
    if (!level) continue;
    out.push({ ...it, daysLeft, level });
  }
  const rank = { expired: 0, today: 1, due1: 2, due3: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.daysLeft - b.daysLeft);
}

/** 生成"变更摘要卡"的展示行（前端直接渲染，不需再判逻辑） */
function buildSummaryCard(result = {}) {
  const s = result.summary || {};
  const lines = [];
  if (s.added.length) lines.push({ icon: '✅', text: `新增 ${s.added.length} 项：${s.added.map((a) => a.label).join('、')}` });
  const autoQty = s.quantityChanged.filter((q) => !q.pending);
  if (autoQty.length) lines.push({ icon: '🔄', text: `${autoQty.map((q) => q.label).join('、')}数量已更新` });
  const pendingQty = s.quantityChanged.filter((q) => q.pending);
  if (pendingQty.length) lines.push({ icon: '🔄', text: `${pendingQty.map((q) => q.label).join('、')}数量可能变化 · 待确认` });
  const gone = (result.questions || []).filter((q) => q.type === 'restore');
  for (const q of gone) lines.push({ icon: '❓', text: `${q.label}似乎已取出`, questionId: q.id });
  if (s.uncertain.length) lines.push({ icon: '📎', text: `${s.uncertain.length} 项待整理：${s.uncertain.map((u) => u.label).slice(0, 3).join('、')}` });
  return { lines, zeroTap: (result.questions || []).length === 0 };
}

module.exports = {
  DEFAULTS,
  ALIASES,
  SHELF_LIFE_DAYS,
  normalizeLabel,
  shelfLifeDaysFor,
  reconcile,
  applyAction,
  expiring,
  buildSummaryCard,
};
