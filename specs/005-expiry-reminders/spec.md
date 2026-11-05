---
id: 005
title: 临期提醒（定时扫描 + 订阅消息）
status: in-progress
owner: felix
updated: 2026-11-05
---

# 背景

食材坏掉往往不是"没买"，而是"忘了"。提醒要在坏掉前 1~3 天出现，且不能一天推三次。

## 目标

- 每天一次扫描，临期 3 天 / 1 天 / 已过期分三级
- 同一天同一食材同一等级只推一次
- 没有订阅授权时不推送、不报错，只记录 skipped

## 范围

**做**：定时触发器、`runReminder`、`reminder_logs` 去重、模板字段映射。

**不做**：用户自定义提醒时间、按食材设置不同提前量、推送频率控制面板。

## 交互与规则

- 触发器每天 08:00（cron `0 0 8 * * *`），`event.Type === 'Timer'` 或 `action === 'cron.remind'` 触发。
- 扫描 `expire_at <= now + 3 天` 且 `state in (present, probably_removed)`，最多 500 条。
- 分级：`expired`（<0 天）/ `today`（≤0）/ `due1`（≤1）/ `due3`（≤3）。
- 推送模板字段：`thing1` 食材、`date2` 到期日、`thing3` 剩余天数文案，`page` 指向首页。
- 写 `reminder_logs` 失败（唯一键冲突）视为已推过，忽略。

## 验收标准

- [x] AC1 临期四级分类正确（`test/inventory-engine.test.js` → `临期分级：过期 / 今天 / 1 天 / 3 天`）
- [x] AC2 没有 openid / 没有模板 ID 时进入 skipped 而不是抛错（代码审阅：`runReminder` 分支）
- [x] AC3 同一天重复触发不会重复入库（`reminder_logs` 唯一索引 + 捕获异常）
- [ ] AC4 前端调用 `wx.requestSubscribeMessage` 获取授权（**未实现**）
- [ ] AC5 真机收到一条推送（需要模板 ID + 授权，待验证）

## 数据契约

`reminder_logs (user_id, item_id, level, sent_date)` 唯一；返回 `{ users, items, sent, skipped[] }`。

## 风险与未决

- 微信订阅消息是"一次性订阅"：用户点一次只能收一条。AC4 需要在合适时机（如入库成功后）引导授权，否则后续推送会被拒。
- 模板字段必须与后台模板完全一致，否则 `47003`。
