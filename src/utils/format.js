'use strict';

/**
 * 展示层格式化。纯函数，不依赖 wx / DOM，方便单测。
 * 所有"还剩几天 / 过期没"的判断只在这里做一次，页面里不要重复写时间计算。
 */

const DAY = 24 * 60 * 60 * 1000;

function toMs(v) {
  if (!v) return NaN;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function daysLeft(expireAt, now = Date.now()) {
  const t = toMs(expireAt);
  const n = toMs(now);
  if (!Number.isFinite(t) || !Number.isFinite(n)) return null;
  return Math.ceil((t - n) / DAY);
}

/**
 * 单个食材的到期标签。
 * tone 与 app.css 的 chip-* 一一对应，页面直接拼 class。
 */
function expireLabel(expireAt, now = Date.now()) {
  const t = toMs(expireAt);
  if (!Number.isFinite(t)) return { text: '保质期未知', tone: 'muted', days: null };

  const left = t - toMs(now);
  if (left <= 0) {
    const days = Math.max(1, Math.round(-left / DAY));
    return { text: `已过期 ${days} 天`, tone: 'danger', days: -days };
  }
  if (left <= 12 * 60 * 60 * 1000) return { text: '今天到期', tone: 'danger', days: 0 };

  const days = Math.ceil(left / DAY);
  if (days <= 1) return { text: '明天到期', tone: 'warn', days: 1 };
  if (days <= 3) return { text: `还剩 ${days} 天`, tone: 'warn', days };
  return { text: `还剩 ${days} 天`, tone: 'ok', days };
}

/** 云函数 expiring() 已给出 level，这里只翻成文案，避免两边判断不一致。 */
const LEVEL_TEXT = {
  expired: { text: '已过期', tone: 'danger' },
  today: { text: '今天到期', tone: 'danger' },
  due1: { text: '明天到期', tone: 'warn' },
  due3: { text: '临期', tone: 'warn' },
};

function levelLabel(level, daysLeftN) {
  const base = LEVEL_TEXT[level] || { text: '临期', tone: 'warn' };
  if (level === 'due3' && typeof daysLeftN === 'number' && daysLeftN > 0) {
    return { text: `还剩 ${daysLeftN} 天`, tone: base.tone };
  }
  return base;
}

const STATE_TEXT = {
  present: { text: '在库', tone: 'ok' },
  probably_removed: { text: '待确认', tone: 'warn' },
  removed: { text: '已移除', tone: 'muted' },
  consumed: { text: '已吃完', tone: 'muted' },
};

function stateLabel(state) {
  return (STATE_TEXT[state] || { text: state || '未知', tone: 'muted' }).text;
}

function stateTone(state) {
  return (STATE_TEXT[state] || { tone: 'muted' }).tone;
}

function quantityLabel(quantity) {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) return '数量未知';
  return `${q} 件`;
}

/**
 * 首页概览。只统计"还在冰箱里"的：present + probably_removed。
 * soon 是 3 天内到期但还没过期的；expired 单独算，方便用红色。
 */
function summarize(items = [], now = Date.now()) {
  const stats = { total: 0, soon: 0, expired: 0, pending: 0 };
  for (const it of items) {
    if (it.state !== 'present' && it.state !== 'probably_removed') continue;
    stats.total += 1;
    if (it.state === 'probably_removed') stats.pending += 1;
    const t = toMs(it.expire_at);
    if (!Number.isFinite(t)) continue;
    const left = t - toMs(now);
    if (left <= 0) stats.expired += 1;
    else if (left <= 3 * DAY) stats.soon += 1;
  }
  return stats;
}

/** '2026-11-08T12:00:00Z' → '11-08'；没值返回空串，不显示 "Invalid Date"。 */
function fmtDate(v) {
  const t = toMs(v);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** 食谱里"缺的东西"一行展示，空数组返回 null，页面据此隐藏。 */
function missingLine(missing = []) {
  const list = (missing || []).filter(Boolean);
  if (!list.length) return null;
  return `缺：${list.join('、')}`;
}

module.exports = {
  DAY,
  daysLeft,
  expireLabel,
  levelLabel,
  stateLabel,
  stateTone,
  quantityLabel,
  summarize,
  fmtDate,
  missingLine,
};
