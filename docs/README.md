# 文档索引

仓库里的文档分两类，别混着写：

- **`docs/`**：稳定的"是什么、为什么"。架构、数据模型、接口契约、决策记录。改代码时以这里为准。
- **`specs/`**：会随功能演进变化的"这一版要做到什么"。每个功能一份 spec / plan / tasks。

## 建议阅读顺序

| 顺序 | 文档 | 你会得到什么 |
| --- | --- | --- |
| 1 | [product/prd.md](product/prd.md) | 产品定位、三条原则、MVP 范围 |
| 2 | [architecture/overview.md](architecture/overview.md) | 分层、数据流、职责边界 |
| 3 | [architecture/data-model.md](architecture/data-model.md) | 5 张表的字段、索引、为什么这么设计 |
| 4 | [architecture/state-machine.md](architecture/state-machine.md) | 库存怎么从照片变成"少了两个鸡蛋" |
| 5 | [api/cloud-functions.md](api/cloud-functions.md) | 云函数 action / 返回 / 错误码 |
| 6 | [adr/](adr/) | 关键取舍与推翻条件 |
| 7 | [ops/deploy.md](ops/deploy.md) / [ops/testing.md](ops/testing.md) | 怎么发、怎么测 |

## 维护约定

- 行为改变 → 先改对应的 spec，再改代码，最后回来更新 `docs/`（如果稳定知识变了）。
- 架构级取舍 → 新增 `docs/adr/NNNN-<slug>.md`，不要改历史 ADR（被取代就写 "Superseded by ADR-XXXX"）。
- 文档里的代码示例必须是能跑的（路径、函数名、参数照抄仓库现状）。不确定就不写示例。
