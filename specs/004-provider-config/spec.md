---
id: 004
title: Provider 配置（Key 只进不出）
status: implemented
owner: felix
updated: 2026-11-05
---

# 背景

用户要能用自己（或第三方兼容）的模型服务。Key 必须安全：不进前端制品、不明文落库、不回传前端。

## 目标

- 用户填 base_url / model_name / api_key 后即可用
- 任何接口都不返回 Key 或密文
- 本地只缓存非敏感字段

## 范围

**做**：设置页、`config.put` / `config.get`、AES-256-GCM 加密、服务端兜底 Key。

**不做**：多 Provider 管理、Key 轮换、用量统计、OAuth 授权。

## 交互与规则

1. 设置页展示当前 base_url / model_name / key_hint。
2. 保存：校验长度与字符集 → 加密 → upsert → 返回 `key_hint`。
3. 未配置时首页与拍照入口被 `flow.ensureProviderReady` 拦截。
4. `source` 为 `env` 时说明用的是服务端内置 Key。

## 验收标准

- [x] AC1 本地缓存不含 Key（`test/utils.test.js` → `cacheProvider：只缓存 base_url / model_name，绝不写 Key`）
- [x] AC2 Key 过短/非法字符被拒（代码审阅：`putProvider` 校验 ≥16 与可打印 ASCII）
- [x] AC3 `config.get` 返回体无 `encrypted_key`（代码审阅：select 只取 4 列）
- [x] AC4 未配 Key 时拍照被拦（`flow.ensureProviderReady：没配 Key 就拦住拍照`）
- [ ] AC5 真机保存后重启小程序仍可用（人工，待验证）

## 数据契约

`user_provider_configs`：`encrypted_key` 格式 `v1.<iv>.<tag>.<ct>`，`key_hint` 末四位。

## 风险与未决

- 更换 `PROVIDER_KEY_SECRET` 会使全部 Key 失效，设置页需明确提示并提供重填路径。
