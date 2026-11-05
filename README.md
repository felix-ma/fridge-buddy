# 冰箱助手 · fridge-buddy

对着冰箱逐层拍 3 张照片 → AI 跨图识别食材 → 推断库存增减 → 默认零点击入库 → 临期提醒 + 按现有食材推荐食谱。

- 形态：微信小程序（Taro 4 + React 18 + TypeScript + NutUI）
- 后端：微信云开发云函数 `aiProxy` + Supabase Postgres
- 模型：DeepSeek `deepseek-flash`（原生多模态，视觉/文本同模型）
- 状态：四个页面可构建、云函数与表结构就绪、61 个单测全绿；**尚未真机验证**

## 快速开始

```bash
npm install
npm test                 # 61 个单测
npm run typecheck        # tsc --noEmit
npm run build:weapp      # 产物在 dist/
npm run dev:weapp        # 监听编译
```

用微信开发者工具导入**仓库根目录**（`project.config.json` 里 `miniprogramRoot` 指向 `dist/`），AppID 换成自己的。
云函数、Supabase、定时任务的部署步骤见 [docs/ops/deploy.md](docs/ops/deploy.md)。

## 这个仓库怎么组织

这是一个 **Harness 仓库**：给人和 AI agent 共用，文档与规格先于实现。

```
AGENTS.md                 agent 入口：命令、仓库地图、原则、SDD 流程、DoD
docs/                     稳定知识：产品、架构、数据模型、API 契约、ADR、部署、术语
specs/                    每个功能的规格（spec / plan / tasks）与状态
src/                      Taro 前端（pages + utils）
cloudfunctions/aiProxy/   云函数：Key 保管、模型转发、库存状态机、定时提醒
supabase/schema.sql       建表 + 索引 + RLS
test/                     node:test 单测
```

- 改功能前先看 [specs/README.md](specs/README.md) 的流程，新功能从 `specs/_template/` 复制。
- 架构与取舍看 [docs/README.md](docs/README.md) 的索引，关键决策在 [docs/adr/](docs/adr/)。
- 给 agent 的工作规则在 [AGENTS.md](AGENTS.md)。

## 三条不可妥协的原则

1. **图片零服务器存储**：只在设备临时目录与内存中流转，Base64 直发模型，请求结束即释放。
2. **API Key 不进前端、不明文落库**：云函数 AES-256-GCM 加密存储，调用时解密转发，接口只回末四位提示。
3. **默认零点击、例外驱动**：库存由状态机推断，只在低置信、不可逆删除、数量突变时轻提示，且可撤回。

## 功能状态

| 规格 | 状态 | 说明 |
| --- | --- | --- |
| [001 拍照盘点入库](specs/001-capture-inventory/spec.md) | implemented | 三视角引导、压缩上传、状态机、摘要卡 |
| [002 库存手动修正](specs/002-inventory-actions/spec.md) | implemented | 吃完 / 移除 / 恢复 / 数量采纳 |
| [003 食谱推荐](specs/003-recipe-suggest/spec.md) | implemented | 3 道菜，优先临期，标注缺料 |
| [004 Provider 配置](specs/004-provider-config/spec.md) | implemented | Key 加密、只进不出 |
| [005 临期提醒](specs/005-expiry-reminders/spec.md) | in-progress | 后端完成；前端订阅授权待做 |
| [006 多端发布](specs/006-multi-platform/spec.md) | draft | H5 / 支付宝，未投入 |

`npm run specs` 可随时查看最新状态。

## 测试

```bash
npm test    # 61 个：状态机 13 + 前端工具 35 + 格式化 10 + 规格校验 3
```

CI（`.github/workflows/ci.yml`）在每次 push 时跑 `npm test`、`npm run spec:check`、`npm run typecheck`、`npm run build:weapp`。

## 已知限制

- 没真机跑过；相机、压缩、订阅消息都要在真机上验证（见 `docs/ops/testing.md` 的清单）。
- 多端只是能编译，H5 / 支付宝需要适配 `Taro.cloud` 与 `wx.chooseMedia`（spec 006）。
- 食谱没有缓存，重复点击会重复计费。
- NutUI 样式全量引入，`app-origin.wxss` 约 258 KB，可改按需引入。
