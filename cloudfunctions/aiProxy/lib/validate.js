'use strict';

const CONFIDENCE = ['high', 'medium', 'low'];

function clampText(v, max) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, max);
}

/** 食材名：去掉「（约1L）」这类规格备注，避免同一食材因包装描述分裂成多条 */
function cleanLabel(v) {
  return clampText(v, 24)
    .replace(/[（(][^)）]*[)）]/g, '')
    .trim()
    .slice(0, 24);
}

function toInt(v, { min = 0, max = 99 } = {}) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 把模型的自由发挥收敛到固定字段，脏数据在这里就被拦住 */
function normalizeObservation(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rawItems = Array.isArray(src.items) ? src.items : [];
  const rawUncertain = Array.isArray(src.uncertain) ? src.uncertain : [];

  const items = [];
  const seen = new Set();
  for (const it of rawItems) {
    if (!it || typeof it !== 'object') continue;
    const label = cleanLabel(it.label);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const appears = Array.isArray(it.appears_in)
      ? it.appears_in.map((n) => toInt(n, { min: 1, max: 32 })).filter((n) => n !== null)
      : [];
    const conf = CONFIDENCE.includes(String(it.confidence || '').toLowerCase())
      ? String(it.confidence).toLowerCase()
      : 'medium';
    items.push({
      label,
      appears_in: appears,
      zone_hint: clampText(it.zone_hint, 32),
      confidence: conf,
      quantity_estimate: toInt(it.quantity_estimate, { min: 1, max: 99 }),
    });
  }

  const uncertain = [];
  for (const it of rawUncertain) {
    if (!it || typeof it !== 'object') continue;
    const label = cleanLabel(it.label);
    if (!label) continue;
    uncertain.push({
      label,
      zone_hint: clampText(it.zone_hint, 32),
      quantity: toInt(it.quantity, { min: 1, max: 99 }),
    });
  }

  return { items, uncertain };
}

function normalizeRecipe(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(src.recipes) ? src.recipes : [];
  const recipes = [];
  for (const r of list.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue;
    const name = clampText(r.name, 40);
    if (!name) continue;
    recipes.push({
      name,
      reason: clampText(r.reason, 120),
      uses_existing: Array.isArray(r.uses_existing) ? r.uses_existing.map((x) => clampText(x, 24)).filter(Boolean).slice(0, 12) : [],
      missing: Array.isArray(r.missing) ? r.missing.map((x) => clampText(x, 24)).filter(Boolean).slice(0, 12) : [],
      steps: Array.isArray(r.steps) ? r.steps.map((x) => clampText(x, 120)).filter(Boolean).slice(0, 10) : [],
    });
  }
  return { recipes };
}

module.exports = { normalizeObservation, normalizeRecipe, CONFIDENCE };
