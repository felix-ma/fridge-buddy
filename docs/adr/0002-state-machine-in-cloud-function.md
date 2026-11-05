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


## 备选路线：supabase-mp-js + 云函数代理（未采用）

如果将来确实需要「前端用 Supabase 客户端习惯写代码」（例如 H5 端复用同一套查询），可以走这条路线，但有三个必须提前知道的点：

1. **域名白名单**：`supabase-mp-js` 只解决小程序缺 `fetch` / `localStorage` / `FormData` 的 API 适配，**不解决** `wx.request` 的合法域名校验。它的 `baseURL` 必须指向云函数的 HTTP 访问地址（云开发自带免备案域名），由云函数把 `/rest/v1/*`、`/auth/v1/*` 反向代理到 Supabase。Storage 不需要代理（本产品不存图片）。
2. **认证**：小程序端没有浏览器会话，需要 `wx.login` → 云函数 `jscode2session` 换 openid → 用 service_role 调 Admin API 查找/创建用户并签发 session，前端持 JWT 透传。service_role 仍然只能待在云函数环境变量里。
3. **RLS 语义**：代理层透传用户 JWT 时，Supabase 按该用户执行 RLS；一旦代理层把 `Authorization` 换成 service_role，就等于绕过 RLS —— 这是最容易写错的地方。

当前实现不采用这条路线，原因是它比现有方案多出：代理路由、jscode2session、session 刷新、JWT 透传正确性，四处都是安全敏感面；
而我们并不需要前端直连（见上）。等 H5 / 支付宝端真正落地（spec 006）时再评估。

## 何时重新审视

出现实时协作（家庭成员共享冰箱）需要 Realtime 推送时：可让云函数往 Realtime 频道推，而不是把 DB 凭证下发前端。
