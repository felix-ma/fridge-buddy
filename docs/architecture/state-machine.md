# 库存状态机

代码：`cloudfunctions/aiProxy/lib/inventory-engine.js`（纯函数，无 IO；测试 `test/inventory-engine.test.js`）

## 1. 输入输出

```js
reconcile({ items, observation, now, options, idFactory })
// observation: { items: [{ label, zone_hint, confidence, quantity_estimate }], uncertain: [...] }
// 返回 { items, changed, summary, questions }
```

- `items`：现有库存实体数组（来自 `inventory_items`）
- `changed`：**只有这里面的实体才写回数据库**（没变化的不写，省请求也避免无意义 `updated_at`）
- `summary` / `questions`：给摘要卡用的结构化结果，前端用 `buildSummaryCard()` 转成行

`applyAction(items, action, now)` 处理用户点击：`restore` / `ignore_removal` / `delete` / `consume` / `accept_quantity` / `keep_quantity` / `move_zone`。

## 2. 四条规则

### R1 标签归一后匹配

`normalizeLabel()`：NFKC → 去空白 → 去掉括号备注（"（约1L）"）→ 别名表（西红柿→番茄、马铃薯→土豆…）。
同一次观测里重复标签会先合并（数量取最大，置信取最高），避免同一张图里出现两行。

### R2 置信度决定是否入库

| confidence | 阈值 | 行为 |
| --- | --- | --- |
| high | ≥ 0.85 | 参与匹配；匹配不到则新建实体 |
| medium | 0.60 | 参与匹配；匹配不到则新建实体 |
| low | ≤ 0.30 | **只进 `uncertain`，不匹配、不新建、不改变库存** |

低置信的出现也会让 `miss_count` 保持不变（不算"看到"，也不算"没看到"），避免误删。

### R3 没拍到不等于没有（不误删）

| 连续未观测次数 `miss_count` | 状态 | 是否算库存 |
| --- | --- | --- |
| 0~1 | `present` | 是 |
| 2 | `probably_removed` | 是（仍参与临期提醒） |
| 3+ | `removed` | 否 |

每次降级都进 `changed`，并且可以 `restore`（回 `present`、`miss_count=0`）。
重新观测到时：`last_seen_at` 更新、`miss_count` 归零、`removed`/`probably_removed` 直接恢复为 `present`。

### R4 数量突变要确认，小幅变化直接生效

```
diff  = abs(observed - current)
ratio = diff / max(current, 1)
isJump = diff >= quantityJumpAbs(2) || (current >= 4 && ratio >= quantityJumpRatio(0.5))
```

- 不构成突变（如 2→1、6→5）：直接采用观测数量。
- 构成突变（如 6→2、1→3）：不改 `quantity`，把观测值写进 `pending_quantity`，摘要卡出现"鸡蛋数量可能变化 [采纳] [保持]"，等到 `accept_quantity` / `keep_quantity` 才落定。
- `quantity_estimate` 缺失时不动数量，只更新 `last_seen_at`。

## 3. 保质期与临期

新建实体时按 `SHELF_LIFE_DAYS` 推导 `expire_at = first_seen_at + shelf_life_days`。
表里覆盖常见食材（牛奶 7、酸奶 14、鸡蛋 30、西兰花 6、豆腐 3、剩菜 2…），未知食材默认 7 天。

`expiring(items, now, { withinDays: 3 })` 分四级，供首页和提醒任务共用：

| level | 条件 | 文案 |
| --- | --- | --- |
| `expired` | `expire_at < now` | 已过期 |
| `today` | 12 小时内到期 | 今天到期 |
| `due1` | ≤ 24 小时 | 明天到期 |
| `due3` | ≤ 3 天 | 3 天内到期 |

## 4. 摘要卡

`buildSummaryCard(result)` 输出 `{ zeroTap, lines: [{ icon, text, questionId? }] }`：

- ✅ 新增 N 项：…
- 🔄 数量可能变化（带 `questionId`，需要点）
- ❓ 某物似乎已取出（带 `questionId`，需要点）
- `zeroTap = true` 表示整张卡不需要任何点击

## 5. 调整参数

所有阈值集中在文件顶部 `DEFAULTS`，通过 `reconcile(..., { options })` 覆盖。改阈值必须同步更新本文档与测试。
