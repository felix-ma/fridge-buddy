# 技术方案

- `prompts/recipe.js` 构造提示：库存清单（label + 数量）、临期清单、人数。
- 复用用户 Provider 配置与同一个云函数。
- 返回结构用 `normalizeRecipe` 兜底，缺字段不崩。

## 测试计划

- 格式化层：`missingLine` 已覆盖。
- 真机：AC4。

## 发布

无。
