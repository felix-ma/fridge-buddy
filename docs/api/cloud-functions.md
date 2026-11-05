# 云函数接口契约

单入口云函数 `aiProxy`，用 `action` 路由。小程序侧统一用 `src/utils/api.js` 的 `callProxy(action, payload)` 调用。

## 1. 调用方式

```js
wx.cloud.callFunction({
  name: 'aiProxy',
  data: { action: 'inventory.get' },
})
```

返回信封：

```js
// 成功
{ ok: true, data: { ... }, elapsedMs: 1234 }
// 失败
{ ok: false, error: { code: 'E_NO_KEY', message: '还没配置 API Key' }, elapsedMs: 12 }
```

前端 `callProxy` 会把 `ok === false` 转成带 `code` 的异常，并用 `MESSAGES[code]` 生成用户文案。

## 2. action 一览

### `inventory.scan`

| 入参 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `images` | `string[]` | 是 | Base64 或 `data:image/jpeg;base64,...`，最多 8 张，单张 ≤32 MiB，合计 ≤40 MiB |
| `session_id` | `string` | 否 | 缺省时云函数生成 |
| `zone_hint` | `string` | 否 | 本轮覆盖的分区说明，≤32 字符 |
| `zones` | `string[]` | 否 | 本轮拍摄的分区列表，缺省用 `正面全景/上层/中层/下层/果蔬盒/冰箱门` |

返回：

```js
{
  observation_id, session_id,
  summary: { added, updated, missing, restored, uncertainCount },
  summary_card: { zeroTap: true, lines: [{ icon: '✅', text: '新增 2 项：西兰花、酸奶' }] },
  questions: [{ id, type: 'restore'|'quantity', itemId, text }],
  items: [...],          // 只看活跃状态
  expiring: [...],       // 3 天内到期，最多 10 条
  usage: { prompt_tokens, completion_tokens, total_tokens }
}
```

约束：先写 `observations` 再跑状态机；解析失败抛 `E_PARSE` 且不写任何库存变更 —— **不允许写半成品数据**。

### `inventory.get`

无入参。返回 `{ items, history, expiring }`：
`items` 为 `present` / `probably_removed`，`history` 为 `removed` / `consumed`（最多 50 条），`expiring` 为 3 天内到期的全部活跃项。

### `inventory.action`

| 入参 | 说明 |
| --- | --- |
| `type` | `restore` / `ignore_removal` / `delete` / `consume` / `accept_quantity` / `keep_quantity` / `move_zone` |
| `item_id` | 必填 |
| `zone` | `move_zone` 时使用 |

返回 `{ item }`（更新后的单条）。`E_NOT_FOUND` 表示不存在或不属于该用户。

### `recipe.suggest`

| 入参 | 说明 |
| --- | --- |
| `servings` | 可选，默认 2 |

返回：

```js
{
  recipes: [{ name, reason, uses_existing: [], missing: [], steps: [] }],
  usage: {...}
}
```

库存为空时抛 `E_EMPTY_INVENTORY`。Prompt 要求优先消耗临期食材与 `probably_removed` 项。

### `config.put`

| 入参 | 说明 |
| --- | --- |
| `base_url` | 用户 Provider 地址，默认 `https://api.deepseek.com` |
| `model_name` | 默认 `deepseek-flash` |
| `api_key` | 必填，≥16 字符；云函数加密后存储 |

返回 `{ base_url, model_name, has_key: true, key_hint: '••••a1b2' }`。**任何情况下都不返回 Key 或密文。**

### `config.get`

无入参。返回 `{ base_url, model_name, has_key, key_hint, source }`，
`source` ∈ `user`（用户自己的 Key）/ `env`（服务端兜底 Key）/ `none`。`has_key=false` 时前端应引导去设置页。

## 3. 定时任务

触发器事件（`event.Type === 'Timer'`）或手动 `{ action: 'cron.remind' }` 都会执行 `runReminder`：

- 扫描 `expire_at <= now + 3 天` 且状态活跃的库存
- 按 `daysLeft` 分级：`expired` / `today` / `due1` / `due3`
- 通过订阅消息模板推送，`page: 'pages/home/index'`
- 写 `reminder_logs`，唯一索引保证同一天同一食材同一等级只推一次
- 返回 `{ users, items, sent, skipped: [{ item_id, reason }], }`，`skipped` 最多 10 条

模板字段约定（必须与小程序后台模板一致，否则 `errCode 47003`）：

| 字段 | 内容 |
| --- | --- |
| `thing1` | 食材名（≤20 字） |
| `date2` | 到期日 `YYYY-MM-DD` |
| `thing3` | "还有 N 天到期" / "已经过期了，记得清理" |

## 4. 错误码

| code | 含义 | 前端文案要点 |
| --- | --- | --- |
| `E_NO_KEY` | 用户没配 Key，也没有服务端兜底 | 引导去设置页 |
| `E_BAD_KEY` | 上游 401/403 | 提示 Key 可能失效，去设置页换 |
| `E_KEY_BROKEN` | 密文解密失败（通常换了 `PROVIDER_KEY_SECRET`） | 提示重填 Key |
| `E_PARSE` | 模型输出不是合法 JSON | 重试，不写半成品 |
| `E_EMPTY` | 没识别出任何食材 | 换个角度再拍 |
| `E_TOO_MANY_IMAGES` | 超过 8 张 | 提示建议三层各一张 |
| `E_IMAGE_TOO_LARGE` | 单张 >32 MiB 或合计 >40 MiB | 建议重拍/降质 |
| `E_BAD_INPUT` | 参数缺失或格式不对 | 一般属程序错误 |
| `E_NO_OPENID` | 非小程序环境调用 | 仅调试时出现 |
| `E_UNKNOWN_ACTION` | action 拼错 | 程序错误 |
| `E_NOT_FOUND` | 库存项不存在 | 刷新列表 |
| `E_EMPTY_INVENTORY` | 库存为空时请求食谱 | 先拍照入库 |
| `E_UPSTREAM` | 模型服务其它错误 | 稍后重试 |
| `E_TIMEOUT` | 上游请求超时（60 秒） | 重试 |
| `E_DB` | Supabase 写入/查询失败 | 稍后重试 |
| `E_INTERNAL` | 未归类异常 | 稍后重试 |

新增错误码时：本表 + `src/utils/api.js` 的 `MESSAGES` + 对应 spec 的验收标准，三处一起改。
