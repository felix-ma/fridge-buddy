# 技术方案

- 动作逻辑全部放 `engine.applyAction(items, action, now)`，纯函数返回更新后的单条。
- 云函数只负责校验归属（`user_id`）与 `patch`，不复制规则。
- 前端库存页用 `Taro.showActionSheet` 动态生成动作列表。

## 测试计划

- `applyAction` 的每个动作至少一条断言（当前覆盖 restore/accept/keep/delete）。
- 真机：AC3 / AC4。

## 发布

无。
