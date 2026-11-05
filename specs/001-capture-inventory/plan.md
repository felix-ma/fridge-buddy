# 技术方案

## 改动面

| 文件 | 改动 |
| --- | --- |
| `src/pages/capture/index.tsx` | 三视角引导页，逐张拍 + 重拍 + 提交 |
| `src/utils/image.js` | 压缩/Base64/临时文件清理，串行执行 |
| `src/utils/capture.js` | 纯函数会话状态机 |
| `src/utils/flow.js` | 拍一张 / 扫一轮 |
| `cloudfunctions/aiProxy/index.js` | `inventory.scan`：多图组装、解析、落观测、跑状态机 |
| `cloudfunctions/aiProxy/lib/inventory-engine.js` | `reconcile` / `buildSummaryCard` |
| `cloudfunctions/aiProxy/prompts/inventory.js` | 跨图对齐 + 强制 JSON + uncertain 规则 |

## 设计要点

- 压缩放在本地而非云端：省流量、避免大图上传、符合"图片零存储"。
- 状态机在云函数：ADR-0002。
- 先落 `observations` 再动库存：失败时观测可追溯，库存不被污染。
- `changed` 过滤：没变化的行不写库，避免 `updated_at` 抖动与无效请求。

## 测试计划

- `test/utils.test.js`：压缩边界、串行、临时文件、8 张拦截、超时
- `test/inventory-engine.test.js`：R1~R4、摘要卡零点击
- 真机：AC10 延迟与识别率

## 发布

无迁移；需要云函数超时 ≥60 秒。
