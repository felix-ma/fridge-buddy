# 测试手册

## 1. 分层

| 层 | 位置 | 依赖 | 跑法 |
| --- | --- | --- | --- |
| 状态机 | `test/inventory-engine.test.js` | 纯 Node，无 wx / 无网络 | `npm test` |
| 前端工具 | `test/utils.test.js` | mock 的 `globalThis.wx` | `npm test` |
| 格式化 | `test/format.test.js` | 纯函数 | `npm test` |
| 规格校验 | `test/specs.test.js` | 读 `specs/` 目录 | `npm test` |

全部用 Node 自带 `node:test`，不引 Jest/Vitest：工具层本来就是纯函数，零配置最快，CI 也简单。

## 2. 写测试的约定

- 被 `wx.*` 污染的逻辑不要放进纯函数模块；只有 `image.js` / `api.js` 碰 wx。
- mock wx 的写法见 `test/utils.test.js` 顶部：直接改 `globalThis.wx`，每个用例前重建。
- 时间相关断言传入固定 `now`（`reconcile({ now })`），不要用 `Date.now()`。
- 一条用例只验证一条规则，命名用「场景 → 期望」。

## 3. 哪些必须测

- 状态机每条规则（R1~R4）至少一正一反
- 压缩/体积/张数边界
- 错误码到用户文案的映射
- Provider 缓存不落 Key（安全回归）
- spec 的验收标准能指向具体用例

## 4. 本地跑

```bash
npm test
node --test test/utils.test.js      # 单文件
```

## 5. 真机检查清单（发版前）

这些没法自动化，按顺序手工过一遍：

1. 首次进入：未配 Key 时首页出现「去配置」，点拍照被拦截。
2. 配置 Key → 返回首页 → 拍照 3 张 → 摘要卡出现，文案无乱码。
3. 库存页：新食材在「在库」，点「已吃完」后进入「最近变动」，再「恢复」能回来。
4. 断网/弱网：识别超过 60 秒提示「可能未保存」，且不会出现半条记录。
5. 重拍：第二张重拍后，摘要里不出现重复食材。
6. 首页食谱：返回 3 道菜，缺料标注正确。
7. 订阅消息（若已接入）：授权一次，手动触发定时任务，收到推送。
8. 隐私检查：开发者工具 Storage 面板里搜不到 `sk-`。
