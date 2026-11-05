# 数据模型

DDL 唯一来源：`supabase/schema.sql`（在 Supabase SQL Editor 整段执行，可重复执行）。
本文解释**为什么**这样设计；字段级细节以 SQL 为准。

## 1. 总览

```
app_users 1 ──< observations（只增不改）
          1 ──< inventory_items（当前库存 + 最近变动）
          1 ──1 user_provider_configs（Key 密文）
          1 ──< reminder_logs（防重复推送）
```

所有业务表只认 `app_users.id`（uuid），`openid` 只出现在 `app_users` 一列，避免在业务表里散落可关联身份的明文。

## 2. 表

### app_users

| 字段 | 说明 |
| --- | --- |
| `id` | uuid 主键 |
| `openid` | 微信 openid，唯一。云函数首次见到就插入（`ensureUser`） |
| `created_at` | |

### observations（只增不改）

一次拍摄会话一条。触发器 `observations_no_update` 会直接 `raise exception` 拒绝 UPDATE/DELETE —— 历史观测是不可篡改的账本，
库存推断永远从"最新观测 + 当前库存"重算。

| 字段 | 说明 |
| --- | --- |
| `user_id` / `session_id` | 会话归属 |
| `captured_at` | 拍摄时间 |
| `zone_hint` | 本轮覆盖的分区（如"正面全景+上层+下层"） |
| `items_json` | 归一后的观测清单 |
| `uncertain_json` | 低置信项，不参与推断 |
| `meta` | `{ model, usage, elapsed_ms }`，排查成本与延迟用 |

索引：`(user_id, captured_at desc)`。

### inventory_items

状态机的物化结果。**只存当前状态**，历史靠 `observations` 追溯。

| 字段 | 说明 |
| --- | --- |
| `label` | 归一后的名称（写入前必须过 `normalizeLabel`） |
| `quantity` | 数量，`>= 0` |
| `state` | `present` / `probably_removed` / `removed` / `consumed` |
| `confidence` | 0~1，观测置信度的指数平滑（新 0.3、旧 0.7） |
| `miss_count` | 连续未观测次数，见状态机文档 |
| `shelf_life_days` / `expire_at` | 保质期推导，`expire_at = 首次见到 + 天数` |
| `pending_quantity` | 数量突变待确认时的观测值；为空表示无待确认 |
| `first_seen_at` / `last_seen_at` | |

索引：

- `(user_id, state)`：列表页按状态过滤
- `expire_at where state in ('present','probably_removed')`：提醒任务扫描临期
- **唯一索引** `(user_id, lower(label)) where state in ('present','probably_removed')`：活跃实体不允许重名，
  从数据库层兜住"并发两次扫描建出两行鸡蛋"。撞唯一键时云函数按 23505 重试一次。

### user_provider_configs

| 字段 | 说明 |
| --- | --- |
| `base_url` | 用户 Provider 地址，默认 `https://api.deepseek.com` |
| `model_name` | 默认 `deepseek-flash` |
| `encrypted_key` | AES-256-GCM 密文，格式 `v1.<iv>.<tag>.<ciphertext>`，种子来自云函数环境变量 `PROVIDER_KEY_SECRET` |
| `key_hint` | 末四位展示用（`••••a1b2`），不是密钥本体 |

**解密只发生在云函数进程内**，结果只用于一次上游请求；日志、返回体、错误信息里都不允许出现 `encrypted_key` 或明文。
换掉 `PROVIDER_KEY_SECRET` = 所有已存 Key 失效（无法解密），用户需要重填。

### reminder_logs

`unique (user_id, item_id, level, sent_date)` —— 同一天同一食材同一等级只推一次。重跑定时任务不会轰炸用户。

## 3. 权限模型

- 小程序端**不直连** Supabase，不持有任何 key（连 anon key 都不下发）。
- 云函数用 `service_role`，绕过 RLS。
- 五张表全部 `enable row level security`，并且 `revoke all ... from anon, authenticated`。
  这样即使有人在网上扫到项目 URL 并拿到 anon key，也读不到任何业务数据。
- 注意：`service_role` key 只存在于云函数环境变量，绝不写进仓库、前端、日志。

## 4. 变更流程

1. 改 `supabase/schema.sql`（保持 `create ... if not exists` 可重复执行）。
2. 同步更新本文档。
3. 如果改了字段语义，检查 `cloudfunctions/aiProxy/lib/db.js` 与 `index.js` 的映射。
4. 生产环境执行前先在一个 Supabase 新项目里跑一遍。
