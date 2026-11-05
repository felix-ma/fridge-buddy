'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../cloudfunctions/aiProxy/lib/inventory-engine');

const T0 = '2026-11-05T12:00:00.000Z';
const T1 = '2026-11-06T12:00:00.000Z';
const T2 = '2026-11-07T12:00:00.000Z';
const T3 = '2026-11-08T12:00:00.000Z';

function obs(items, uncertain = []) {
  return { items, uncertain };
}

function baseItem(over) {
  return {
    id: 'item_1_000',
    label: '牛奶',
    quantity: 2,
    zone_id: '中层',
    state: 'present',
    confidence: 0.85,
    first_seen_at: T0,
    last_seen_at: T0,
    miss_count: 0,
    shelf_life_days: 7,
    expire_at: '2026-11-12T12:00:00.000Z',
    pending_quantity: null,
    ...over,
  };
}

test('新出现的高置信食材会建实体，并按保质期算出 expire_at', () => {
  const r = engine.reconcile({
    items: [],
    now: T0,
    observation: obs([{ label: '西兰花', confidence: 'high', quantity_estimate: 1, zone_hint: '果蔬盒' }]),
  });
  assert.equal(r.items.length, 1);
  const it = r.items[0];
  assert.equal(it.label, '西兰花');
  assert.equal(it.state, 'present');
  assert.equal(it.shelf_life_days, 6);
  assert.equal(it.expire_at, '2026-11-11T12:00:00.000Z');
  assert.deepEqual(r.summary.added.map((a) => a.label), ['西兰花']);
  assert.equal(r.questions.length, 0, '默认零点击');
});

test('拍漏一次不降级，只累加 miss_count', () => {
  const r = engine.reconcile({ items: [baseItem()], now: T1, observation: obs([{ label: '鸡蛋', confidence: 'high' }]) });
  const milk = r.items.find((i) => i.label === '牛奶');
  assert.equal(milk.state, 'present');
  assert.equal(milk.miss_count, 1);
  // miss_count 必须回传 changed，否则库里的计数永远停在 0
  assert.ok(r.changed.some((i) => i.label === '牛奶'));
});

test('连续未观测：2 次降 probably_removed，3 次才 removed', () => {
  const r1 = engine.reconcile({ items: [baseItem()], now: T1, observation: obs([]) });
  assert.equal(r1.items[0].state, 'present');
  assert.equal(r1.items[0].miss_count, 1);

  const r2 = engine.reconcile({ items: r1.items, now: T2, observation: obs([]) });
  assert.equal(r2.items[0].state, 'probably_removed');
  assert.equal(r2.questions.filter((q) => q.type === 'restore').length, 1);
  assert.equal(r2.summary.removed[0].to, 'probably_removed');

  const r3 = engine.reconcile({ items: r2.items, now: T3, observation: obs([]) });
  assert.equal(r3.items[0].state, 'removed');
});

test('重新拍到 → 恢复 present，miss_count 归零', () => {
  const faded = baseItem({ state: 'probably_removed', miss_count: 2 });
  const r = engine.reconcile({ items: [faded], now: T2, observation: obs([{ label: '牛奶', confidence: 'high', quantity_estimate: 2 }]) });
  const milk = r.items[0];
  assert.equal(milk.state, 'present');
  assert.equal(milk.miss_count, 0);
  assert.equal(milk.last_seen_at, T2);
  assert.equal(r.summary.restored.length, 1);
});

test('低置信只进待整理，不匹配也不创造实体', () => {
  const r = engine.reconcile({
    items: [baseItem()],
    now: T1,
    observation: obs([{ label: '牛奶', confidence: 'low' }], [{ label: '疑似酱料瓶' }]),
  });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].miss_count, 1, '低置信不算"看见了"');
  assert.deepEqual(r.summary.uncertain.map((u) => u.label).sort(), ['牛奶', '疑似酱料瓶'].sort());
  assert.equal(r.items[0].state, 'present');
});

test('数量大幅突变只提问，不改数（等用户确认）', () => {
  const r = engine.reconcile({
    items: [baseItem({ label: '鸡蛋', quantity: 2 })],
    now: T1,
    observation: obs([{ label: '鸡蛋', confidence: 'high', quantity_estimate: 8 }]),
  });
  const eggs = r.items[0];
  assert.equal(eggs.quantity, 2, '未经确认不覆盖');
  assert.equal(eggs.pending_quantity, 8);
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].type, 'quantity');

  const accepted = engine.applyAction(r.items, { type: 'accept_quantity', itemId: eggs.id }, T1);
  assert.equal(accepted.item.quantity, 8);
  assert.equal(accepted.item.pending_quantity, null);

  const kept = engine.applyAction(r.items, { type: 'keep_quantity', itemId: eggs.id }, T1);
  assert.equal(kept.item.quantity, 2);
  assert.equal(kept.item.pending_quantity, null);
});

test('小幅数量变化直接生效，不打断用户', () => {
  const r = engine.reconcile({
    items: [baseItem({ label: '鸡蛋', quantity: 6 })],
    now: T1,
    observation: obs([{ label: '鸡蛋', confidence: 'high', quantity_estimate: 5 }]),
  });
  assert.equal(r.items[0].quantity, 5);
  assert.equal(r.questions.length, 0);
  assert.equal(r.summary.quantityChanged[0].pending, false);
});

test('可撤回：remove→restore 回到 present', () => {
  const removed = baseItem({ state: 'removed', miss_count: 3 });
  const r = engine.applyAction([removed], { type: 'restore', itemId: removed.id }, T2);
  assert.equal(r.item.state, 'present');
  assert.equal(r.item.miss_count, 0);
  assert.equal(r.item.last_seen_at, T2);
});

test('同物异名会被归一，不重复建档', () => {
  const r = engine.reconcile({
    items: [baseItem({ label: '番茄', quantity: 3 })],
    now: T1,
    observation: obs([{ label: '西红柿', confidence: 'high', quantity_estimate: 3 }]),
  });
  assert.equal(r.items.length, 1);
  assert.equal(r.summary.added.length, 0);
  assert.equal(r.items[0].miss_count, 0);
});

test('同一轮里重复标签只建一条', () => {
  const r = engine.reconcile({
    items: [],
    now: T0,
    observation: obs([
      { label: '酸奶', confidence: 'high' },
      { label: ' 酸奶 ', confidence: 'high' },
    ]),
  });
  assert.equal(r.items.length, 1);
});

test('临期分级：过期 / 今天 / 1 天 / 3 天', () => {
  const items = [
    baseItem({ id: 'a', label: '牛奶', expire_at: '2026-11-04T12:00:00.000Z' }),
    baseItem({ id: 'b', label: '酸奶', expire_at: '2026-11-05T20:00:00.000Z' }),
    baseItem({ id: 'c', label: '鸡蛋', expire_at: '2026-11-06T09:00:00.000Z' }),
    baseItem({ id: 'd', label: '面包', expire_at: '2026-11-08T09:00:00.000Z' }),
    baseItem({ id: 'e', label: '苹果', expire_at: '2026-11-30T09:00:00.000Z' }),
    baseItem({ id: 'f', label: '剩菜', state: 'consumed', expire_at: '2026-11-01T09:00:00.000Z' }),
  ];
  const out = engine.expiring(items, T0, { withinDays: 3 });
  assert.deepEqual(out.map((i) => i.level), ['expired', 'today', 'due1', 'due3']);
  assert.ok(!out.some((i) => i.label === '苹果'), '还早的不进清单');
  assert.ok(!out.some((i) => i.label === '剩菜'), '已消耗的不提醒');
});

test('摘要卡默认零点击；有问题时才需要操作', () => {
  const clean = engine.buildSummaryCard({
    summary: { added: [{ label: '酸奶' }], quantityChanged: [], removed: [], restored: [], uncertain: [] },
    questions: [],
  });
  assert.equal(clean.zeroTap, true);
  assert.match(clean.lines[0].text, /新增 1 项/);

  const needsTap = engine.buildSummaryCard({
    summary: { added: [], quantityChanged: [], removed: [], restored: [], uncertain: [] },
    questions: [{ id: 'restore_x', type: 'restore', itemId: 'x', label: '牛奶' }],
  });
  assert.equal(needsTap.zeroTap, false);
  assert.equal(needsTap.lines[0].icon, '❓');
});

test('整轮合并：新增 + 消失 + 数量变化 同时发生', () => {
  const items = [baseItem({ id: 'milk', label: '牛奶', quantity: 2 }), baseItem({ id: 'egg', label: '鸡蛋', quantity: 10 })];
  const r = engine.reconcile({
    items,
    now: T1,
    observation: obs([
      { label: '牛奶', confidence: 'high', quantity_estimate: 1 },
      { label: '西兰花', confidence: 'high', quantity_estimate: 1 },
    ]),
  });
  const byLabel = Object.fromEntries(r.items.map((i) => [i.label, i]));
  assert.equal(byLabel['西兰花'].state, 'present');
  assert.equal(byLabel['牛奶'].quantity, 1);
  assert.equal(byLabel['鸡蛋'].miss_count, 1);
  assert.equal(byLabel['鸡蛋'].state, 'present');
  assert.equal(r.summary.added.length, 1);
  assert.equal(r.questions.length, 0);
});
