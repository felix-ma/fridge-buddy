# 术语表

| 术语 | 含义 |
| --- | --- |
| 观测（observation） | 一次拍摄会话里模型返回的结构化清单，写入 `observations`，只增不改 |
| 库存实体（inventory item） | 状态机推断出的「冰箱里现在有什么」，在 `inventory_items` |
| 活跃状态 | `present` + `probably_removed`，算作在库 |
| 置信度分级 | `high`(≥0.85) / `medium`(0.60) / `low`(≤0.30)，由 prompt 要求模型给出 |
| `uncertain` | 低置信项集合：不参与匹配、不建实体，只在摘要里提示 |
| `miss_count` | 连续未观测次数；2 次降 `probably_removed`，3 次降 `removed` |
| `pending_quantity` | 数量突变时暂存的观测值，等用户「采纳/保持」 |
| 摘要卡（summary card） | 入库后展示的零点击结果卡，只有带 `questionId` 的行需要操作 |
| 临期四级 | `expired` / `today`（≤12h）/ `due1`（≤24h）/ `due3`（≤3 天） |
| 分区（zone） | 冰箱内位置：正面全景、上层、中层、下层、果蔬盒、冰箱门 |
| Provider | 用户自带的模型服务配置：`base_url` + `model_name` + Key |
| 兜底 Key | 云函数环境变量 `DEEPSEEK_API_KEY`，用户没配时使用 |
| key_hint | Key 末四位提示（如 `••••a1b2`），仅用于界面展示 |
| 只增不改 | `observations` 表的约束：触发器拒绝 UPDATE/DELETE |
| Harness 仓库 | 本仓库的组织方式：`AGENTS.md` 入口 + `docs/` 稳定知识 + `specs/` 规格驱动开发 |
