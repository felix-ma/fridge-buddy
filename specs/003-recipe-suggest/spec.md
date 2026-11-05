---
id: 003
title: 按现有食材推荐食谱
status: implemented
owner: felix
updated: 2026-11-05
---

# 背景

临期食材最常见的结局是坏掉。推荐食谱的目标不是"告诉你还能做什么"，而是"优先把快坏的吃掉"。

## 目标

- 基于当前活跃库存生成 3 道菜
- 优先消耗临期（3 天内）与 `probably_removed`（可能取出但未确认）的食材
- 明确标注"缺什么"，不让用户以为材料齐全

## 范围

**做**：`recipe.suggest`、首页推荐入口、菜品卡片（名称/理由/已有/缺少/步骤）。

**不做**：菜谱收藏、步骤计时器、按菜系筛选、菜品图片。

## 交互与规则

1. 首页点「用现有食材推荐」→ 调 `recipe.suggest`。
2. 库存为空抛 `E_EMPTY_INVENTORY`，前端提示先拍照。
3. 返回 3 道菜；`missing` 非空时展示"还需准备：…"。
4. Prompt 要求优先消耗临期，并在 `reason` 给一句理由。

## 验收标准

- [x] AC1 空库存不调用模型（`cloudfunctions/aiProxy/index.js` `suggestRecipes` 先判空抛 `E_EMPTY_INVENTORY`）
- [x] AC2 解析失败抛 `E_PARSE` 且不缓存（代码审阅）
- [x] AC3 `missing` 渲染文案（`test/format.test.js` → `fmtDate / missingLine`）
- [ ] AC4 真机：库存 10 项时返回 3 道菜且缺料标注正确（人工，待验证）

## 数据契约

`recipe.suggest` → `{ recipes: [{ name, reason, uses_existing, missing, steps }], usage }`。

## 风险与未决

- 没有缓存：连续点击会重复计费，建议按"库存签名 + 6 小时"缓存（见 tasks）。
- `uses_existing` 不做二次校验，模型可能漏用库存里的食材。
