# 规格驱动开发（SDD）

`specs/` 是"这一版要做到什么"的唯一出处。功能先有规格、再有代码；代码改了但规格没改，视为没做完。

## 1. 目录

```
specs/
  _template/          复制这个目录开始新功能
  NNN-<slug>/
    spec.md           需求 + 验收标准（要测试能对上）
    plan.md           技术方案、改动面、测试计划
    tasks.md          可勾选的实施清单
```

## 2. frontmatter

每个 `spec.md` 开头必须是：

```yaml
---
id: 001
title: 拍照盘点入库
status: implemented
owner: felix
updated: 2026-11-05
---
```

`status` 的语义：

| status | 含义 | 进入条件 |
| --- | --- | --- |
| `draft` | 想法，未评审 | 随手记，不承诺 |
| `approved` | 已确认要做 | 范围和验收标准清晰 |
| `in-progress` | 正在实现 | 已有 plan + tasks |
| `implemented` | 代码完成、单测通过 | 验收标准有测试证据 |
| `verified` | 真机/线上验证过 | 有手工验收记录 |
| `dropped` | 放弃 | 写清原因，别删文件 |

## 3. 写验收标准的要求

每条 AC 必须能被验证：

- 能单测的 → 指向 `test/xxx.test.js` 的具体用例名
- 只能人工的 → 写清操作步骤和预期现象（如"真机拍 3 张，摘要 15 秒内出现"）
- 不允许写"性能良好""体验流畅"这种不可判定的句子

## 4. 命令

```bash
npm run specs         # 列出所有规格与状态
npm run spec:check    # 校验 frontmatter 与文件完整性（CI + npm test 都会跑）
```

## 5. 和 docs/ 的分工

- `docs/` 回答"系统现在是什么样"（稳定知识）
- `specs/` 回答"这一版为什么做、做到什么程度"（会随版本变化）

规格里的技术取舍如果影响架构，抽一条 ADR 到 `docs/adr/`，spec 里只链接。
