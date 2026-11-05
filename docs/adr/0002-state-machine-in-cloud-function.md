# ADR-0002 库存状态机放在云函数，前端不直连 Supabase

- 状态：已采纳
- 日期：2026-11-05

## 背景

PRD 把 `inventory-engine.js` 放在小程序端，前端直连 Supabase（`supabase-mp-js` + Auth）。这有两个问题：

1. 规则在前端 = 规则可被改包绕过，且前后端各有一份容易分叉；
2. 前端必须持有 Supabase anon key，RLS 一旦写漏就是越权。

## 决策

- 状态机（`cloudfunctions/aiProxy/lib/inventory-engine.js`）只跑在云函数里，纯函数、无 IO，可被 `node:test` 直接测。
- 小程序**不引入任何 Supabase 客户端**，不持有 anon/service key；所有读写经过云函数。
- 云函数用 `service_role`，五张表 RLS 全开并对 `anon` / `authenticated` 全部 `revoke`。

## 后果

- 好处：规则单点、不可篡改；前端零 DB 凭证；该链路本来就要过云函数（Key 不落前端），没有额外跳转。
- 代价：多一次云函数调用（可忽略）；离线/弱网时前端无法直接读缓存（MVP 可接受）。
- 影响：前端不再需要 Supabase Auth 登录态，用户身份由 `wx.cloud` 的 `OPENID` 提供。

## 参考

MemFire 的 `memfire-taro-template` 走的是另一条路：前端用 `supabase-wechat-stable-v2` 直连数据库 + RLS，状态放在 Pinia。
那套适合"前端为主、表结构简单"的 demo；本产品把可信推断放在云函数、并强制 Key 不落前端，所以刻意不沿用它。

## 何时重新审视

出现实时协作（家庭成员共享冰箱）需要 Realtime 推送时：可让云函数往 Realtime 频道推，而不是把 DB 凭证下发前端。
