# 架构总览

## 1. 分层

```
┌──────────────────────── 微信小程序（Taro 4 / React 18 / TS）────────────────────────┐
│ pages/home        总览、临期、食谱入口                                                │
│ pages/capture     三视角引导 → 逐张压缩 → Base64 → 调云函数                            │
│ pages/inventory   在库 / 最近变动 / 状态操作（吃完、移除、恢复）                        │
│ pages/settings    Provider 配置（Key 只进云函数）                                     │
│ utils/image.js    选图、压缩、Base64、删临时文件（碰 wx.*）                            │
│ utils/api.js      callProxy + 60 秒兜底 + 错误码文案 + 非敏感缓存                      │
│ utils/capture.js  三视角状态机（纯函数）                                              │
│ utils/format.js   展示格式化（纯函数）                                                │
└───────────────────────────────────┬──────────────────────────────────────────────────┘
                                    │ wx.cloud.callFunction('aiProxy')
┌───────────────────────────────────▼──────────────────────────────────────────────────┐
│ 云函数 aiProxy（Node.js 18，超时 60 秒）                                              │
│  index.js        action 路由 / 定时提醒入口 / 统一返回 { ok, data, error }             │
│  lib/deepseek.js 组装多图请求、解析 JSON（容错围栏/尾逗号）                            │
│  lib/inventory-engine.js  纯函数状态机：reconcile / applyAction / expiring              │
│  lib/crypto.js   AES-256-GCM 加解密用户 Key（scrypt 派生）                             │
│  lib/db.js       PostgREST 客户端 + ensureUser(openid → uuid)                          │
│  lib/http.js     零依赖 https 请求（60 秒超时）                                        │
└───────────────────────────────────┬──────────────────────────────────────────────────┘
                                    │ PostgREST（service_role）
┌───────────────────────────────────▼──────────────────────────────────────────────────┐
│ Supabase Postgres：app_users / observations / inventory_items /                          │
│                     user_provider_configs / reminder_logs                              │
└──────────────────────────────────────────────────────────────────────────────────────┘
                                    │ HTTPS（用户 Key 或内置 Key，仅此一次请求）
                          DeepSeek API（deepseek-flash，多模态）
```

## 2. 一次盘点发生了什么

1. `capture` 页用 `capture.createSession()` 建三视角会话，用户逐张拍，`flow.pickNext` 每拍一张切换到下一视角。
2. 每张拍完立即 `wx.compressImage`（quality 0.7，长边 1280）→ 读 Base64 → `wx.getFileSystemManager().unlink` 删临时文件。
3. 拍完调 `aiProxy` 的 `inventory.scan`，参数是 `images[]`（dataURL）、`session_id`、`zone_hint`。
4. 云函数：`ensureUser(openid)` → 取用户 Provider 配置（没有就退到环境变量 `DEEPSEEK_API_KEY`）→ 解密 Key →
   组装多图请求（每图一个 `image_url` block，`detail: original`）→ 调 DeepSeek。
5. 模型返回统一观测清单 JSON → `normalizeObservation` 校验 → **先落 `observations`（只增不改）** →
   读出该用户全部库存 → `reconcile()` 推断 → 只把有变化的行写回 `inventory_items`。
6. 返回 `summary_card.lines`（可直接渲染）+ `questions`（需要用户点的那几行）+ 最新 `items`。
7. 小程序展示 `Taro.showModal` 摘要，用户关掉即完成，默认零点击。

## 3. 职责边界

| 关注点 | 归属 | 原因 |
| --- | --- | --- |
| 压缩、Base64、临时文件清理 | 小程序端 | 图片不能离开设备内存之外被持久化 |
| **Key 保管与解密** | 云函数 | Key 永不进入前端制品或本地缓存 |
| **库存推断（状态机）** | 云函数 | 规则只有一份，改包也篡改不了；前端不需要可信规则 |
| 调用 DeepSeek | 云函数 | 直连会暴露 Key；模型调用也需要长超时 |
| 结构化数据读写 | 云函数（service_role） | 前端不持 anon key，RLS 即使写漏也没有入口 |
| 展示格式化 | 小程序端 `format.js` | 纯展示逻辑，放前端省一次取值 |
| 定时提醒 | 云函数定时触发器 | 不依赖用户打开小程序 |

## 4. 关键超时参数

| 位置 | 值 | 说明 |
| --- | --- | --- |
| 云函数控制台超时 | ≥60 秒 | 默认 3 秒肯定不够，必须手动改 |
| `lib/http.js` 上游请求 | 60 秒 | 防止云函数挂死 |
| `api.js` 本地兜底 | 60 秒 | 比云函数略长或相等；超时文案用"可能未保存"，因为本地超时不代表云端停了 |

## 5. 多端

Taro 一套源码可编 `weapp` / `h5` / `alipay` 等。当前只按 `weapp` 验证过。发其它端要处理的差异：

- `Taro.cloud` 是微信云开发专有（H5 没有），需要换 REST 网关并重新解决鉴权。
- `wx.chooseMedia` / `wx.getFileSystemManager` 在 H5 上不可用，`utils/image.js` 需要按端分支。
- 小程序订阅消息在支付宝是另一套模板机制。
