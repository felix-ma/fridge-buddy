'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fmt = require('../src/utils/format.js');

const NOW = new Date('2026-11-05T12:00:00+08:00').getTime();
const H = 3600 * 1000;
const D = 24 * H;

test('expireLabel：已过期按天进 danger', () => {
  const r = fmt.expireLabel(NOW - 2.2 * D, NOW);
  assert.strictEqual(r.tone, 'danger');
  assert.strictEqual(r.text, '已过期 2 天');
});

test('expireLabel：12 小时内算今天到期', () => {
  assert.strictEqual(fmt.expireLabel(NOW + 6 * H, NOW).text, '今天到期');
  assert.strictEqual(fmt.expireLabel(NOW + 6 * H, NOW).tone, 'danger');
});

test('expireLabel：明天 / 3 天内 / 更远', () => {
  assert.strictEqual(fmt.expireLabel(NOW + 20 * H, NOW).text, '明天到期');
  assert.strictEqual(fmt.expireLabel(NOW + 2.2 * D, NOW).text, '还剩 3 天');
  assert.strictEqual(fmt.expireLabel(NOW + 2.2 * D, NOW).tone, 'warn');
  const far = fmt.expireLabel(NOW + 20 * D, NOW);
  assert.strictEqual(far.text, '还剩 20 天');
  assert.strictEqual(far.tone, 'ok');
});

test('expireLabel：没有保质期不显示 Invalid Date', () => {
  assert.strictEqual(fmt.expireLabel(null, NOW).text, '保质期未知');
  assert.strictEqual(fmt.expireLabel('not-a-date', NOW).tone, 'muted');
});

test('levelLabel：沿用云函数的分级，due3 用真实天数', () => {
  assert.strictEqual(fmt.levelLabel('expired').text, '已过期');
  assert.strictEqual(fmt.levelLabel('today').tone, 'danger');
  assert.strictEqual(fmt.levelLabel('due1').text, '明天到期');
  assert.strictEqual(fmt.levelLabel('due3', 2).text, '还剩 2 天');
});

test('stateLabel / stateTone 覆盖四种状态，未知不崩', () => {
  assert.deepStrictEqual([fmt.stateLabel('present'), fmt.stateTone('present')], ['在库', 'ok']);
  assert.strictEqual(fmt.stateTone('probably_removed'), 'warn');
  assert.strictEqual(fmt.stateLabel('weird'), 'weird');
  assert.strictEqual(fmt.stateTone(undefined), 'muted');
});

test('quantityLabel', () => {
  assert.strictEqual(fmt.quantityLabel(3), '3 件');
  assert.strictEqual(fmt.quantityLabel(0), '数量未知');
  assert.strictEqual(fmt.quantityLabel('abc'), '数量未知');
});

test('summarize：只算在库和待确认，过期与临期分开计数', () => {
  const items = [
    { state: 'present', expire_at: NOW + 20 * D },
    { state: 'probably_removed', expire_at: NOW + 1 * D },
    { state: 'present', expire_at: NOW - 1 * D },
    { state: 'present', expire_at: null },
    { state: 'removed', expire_at: NOW },
    { state: 'consumed', expire_at: NOW },
  ];
  assert.deepStrictEqual(fmt.summarize(items, NOW), { total: 4, soon: 1, expired: 1, pending: 1 });
});

test('summarize：空库存全 0', () => {
  assert.deepStrictEqual(fmt.summarize([], NOW), { total: 0, soon: 0, expired: 0, pending: 0 });
});

test('fmtDate / missingLine', () => {
  assert.strictEqual(fmt.fmtDate('2026-11-08T00:00:00+08:00'), '11-08');
  assert.strictEqual(fmt.fmtDate(''), '');
  assert.strictEqual(fmt.missingLine(['盐', '葱']), '缺：盐、葱');
  assert.strictEqual(fmt.missingLine([]), null);
  assert.strictEqual(fmt.missingLine(['', null]), null);
});
