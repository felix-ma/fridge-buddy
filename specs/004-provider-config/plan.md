# 技术方案

- 加密在 `lib/crypto.js`：scrypt(secret) → 32 字节 key，AES-256-GCM，随机 iv。
- `loadProvider` 是唯一解密点，解密结果只在内存中传给 `chat()`。
- 前端 `api.cacheProvider` 只写 `{ baseUrl, modelName }`。

## 测试计划

- 安全回归：AC1 已覆盖。
- 真机：AC5。

## 发布

部署时设置 `PROVIDER_KEY_SECRET`（≥16 字符），文档标注更换后果。
