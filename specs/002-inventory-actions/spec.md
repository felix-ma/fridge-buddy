---
id: 002
title: 库存状态的手动修正
status: implemented
owner: felix
updated: 2026-11-05
---

# 背景

状态机只是推断，用户偶尔要纠正：真的吃完了、其实还在、数量不对。纠正必须可撤回，且不能绕开置信度规则。

## 目标

- 每种库存状态都有明确可用的动作
- 任何一次手动操作都能回退
- 操作立即生效，不需要等下一次拍照

## 范围

**做**：`restore` / `ignore_removal` / `delete` / `consume` / `accept_quantity` / `keep_quantity` / `move_zone` 与库存页入口。

**不做**：批量操作、撤销历史、跨设备同步冲突处理。

## 交互与规则

| 状态 | 可用动作 |
| --- | --- |
| `present` | 已吃完（consume）、从库存移除（delete） |
| `probably_removed` | 其实还在（restore）、已吃完、移除 |
| `removed` / `consumed` | 放回库存（restore） |

数量突变时摘要卡提供"采纳"（accept_quantity）与"保持"（keep_quantity）。

## 验收标准

- [x] AC1 remove → restore 回到 present（`test/inventory-engine.test.js` → `可撤回：remove→restore 回到 present`）
- [x] AC2 数量突变时 accept/keep 分别落定（`数量大幅突变只提问，不改数（等用户确认）`）
- [x] AC3 库存页按状态给不同动作（人工：库存页点 `probably_removed` 项出现 3 个动作）
- [ ] AC4 真机：操作后列表立即刷新且首页概览同步（人工，待验证）

## 数据契约

`inventory.action` 更新单行，字段见 `docs/api/cloud-functions.md`。

## 风险与未决

- 并发两次操作同一行可能后写覆盖先写；MVP 单用户，暂不处理乐观锁。
