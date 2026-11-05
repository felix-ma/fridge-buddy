# ADR-0003 用户 Provider Key 加密存储、云函数内解密

- 状态：已采纳
- 日期：2026-11-05

## 背景

DeepSeek Key 属于用户资产，不能出现在小程序前端制品里（可被反编译），也不能明文落库（拖库即泄漏）。

## 决策

- `config.put` 在云函数内用 **AES-256-GCM** 加密（key 由 `PROVIDER_KEY_SECRET` 经 scrypt 派生），
  密文格式 `v1.<iv>.<tag>.<ciphertext>`，存 `user_provider_configs.encrypted_key`。
- 读出后只在云函数内存里解密，用于一次上游请求；`config.get` 只返回 `key_hint`（末四位）。
- 前端 Storage 只缓存 `baseUrl` / `modelName`，不缓存 Key。
- 允许服务端兜底 Key（`DEEPSEEK_API_KEY` 环境变量），`source` 字段告诉前端当前用的是哪种。

## 后果

- 好处：拖库拿不到明文 Key；前端反编译也拿不到；换 Key 不需要重新登录。
- 代价：`PROVIDER_KEY_SECRET` 丢失/更换 = 所有用户 Key 失效（无法解密），需要用户重填；文档和设置页必须写明。
- 约束：`PROVIDER_KEY_SECRET` ≥16 字符，只存在于云函数环境变量，禁止写进仓库、日志、错误信息。

## 何时重新审视

接入多家 Provider、需要用户级密钥轮换或多副本部署且要求零停机时，改为 KMS/密钥托管。
