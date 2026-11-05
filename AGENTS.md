# AGENTS.md · 冰箱助手（fridge-buddy）

给在本仓库里工作的 AI agent 的入口文档。人类读者请从 `README.md` 开始。

---

## 1. 这是什么

微信小程序（Taro 4 + React 18 + TypeScript）：对着冰箱逐层拍 3 张照片 → 云函数把图片转发给 DeepSeek 视觉模型 →
云函数内的库存状态机推断"多了什么 / 少了什么" → 默认零点击入库 → 临期提醒 + 按现有食材推荐食谱。

- 前端：`src/`（Taro 编译到 `dist/`，微信开发者工具导入仓库根目录）
- 后端：微信云开发云函数 `cloudfunctions/aiProxy/`（Key 保管、转发、状态机、写库、定时提醒）
- 数据库：Supabase Postgres（只存结构化 JSON，不存图片），表结构见 `supabase/schema.sql`

## 2. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装前端依赖 |
| `npm test` | 全部单测（node:test，58 个） |
| `npm run typecheck` | `tsc --noEmit`，只查 `src/`、`config/` |
| `npm run build:weapp` | 构建微信小程序到 `dist/` |
| `npm run dev:weapp` | 构建并监听 |
| `npm run specs` | 列出 `specs/` 下的规格与状态 |
| `npm run spec:check` | 校验规格 frontmatter 完整性（CI 会跑） |

云函数依赖在 `cloudfunctions/aiProxy/package.json` 里单独安装，仓库根目录的依赖与它无关。

## 3. 仓库地图

```
src/pages/{home,capture,inventory,settings}   页面（tsx + 同目录 css + index.config.ts）
src/utils/{image,api,capture,flow,format}.js  前端工具层（不依赖 React，尽量纯函数）
cloudfunctions/aiProxy/index.js               action 路由 + 云函数入口
cloudfunctions/aiProxy/lib/*.js               状态机、DeepSeek 调用、PostgREST、加密
supabase/schema.sql                           建表 + 索引 + RLS
docs/                                         稳定知识：产品、架构、数据模型、API、ADR、部署
specs/                                        每个功能的规格（SDD）：spec / plan / tasks
test/                                         node:test 单测
```

详细文档索引见 `docs/README.md`。

## 4. 三条不可协商的原则

1. **图片零服务器持久化**。照片只在本地临时路径和内存里；压缩转 Base64 后直发 DeepSeek；请求结束即释放。
   Supabase 里只有识别结果的 JSON。禁止新增任何存图的 bucket、表或云存储路径。
2. **API Key 不进前端制品、不明文落本地**。Key 由云函数用 `PROVIDER_KEY_SECRET` 加密后存 `user_provider_configs`；
   云函数解密后只用于转发，`config.get` 只返回 `key_hint`（末四位）。前端 Storage 只能存 `baseUrl` / `modelName`。
3. **默认零点击，例外驱动**。库存由观测层推断，用户不逐项确认；只在低置信、不可逆删除、数量大幅突变时轻提示，
   且每个变更都要能撤回。

改代码前先看一眼 `docs/adr/`：这四条设计都有决策记录，推翻要写新的 ADR。

## 5. SDD 工作流（改功能时按这个顺序）

1. **找规格**：`npm run specs` 看现有规格，读对应 `specs/NNN-*/spec.md`。
2. **新功能先写规格**：复制 `specs/_template/` 到 `specs/NNN-<slug>/`，status 先写 `draft`。
3. **写 `plan.md`**：技术方案、要改的文件、数据结构变化、测试计划。有架构级取舍就补 ADR。
4. **拆 `tasks.md`**：可勾选的小步骤，一次提交别跨太多任务。
5. **实现**：小步提交；纯规则（状态机、格式化、压缩计算）必须能被 `node:test` 直接测。
6. **验收**：逐条对照 spec 的「验收标准」，在 spec 里勾上并注明测试文件/用例名。
7. **更新状态**：`draft → approved → in-progress → implemented → verified`；`verified` 只给真机跑过的功能。

规格不是文档装饰——验收标准必须能被测试或人工步骤验证，"能跑就行"不是验收标准。

## 6. 代码约定

- 页面用 `tsx`；工具层优先写成不依赖 React / Taro 运行时的纯函数（`capture.js`、`format.js`、`inventory-engine.js` 都是这样），
  这样测试不需要 mock 整个小程序环境。
- 会碰 `wx.*` 的代码集中放在 `src/utils/image.js`、`src/utils/api.js`，测试里用 `globalThis.wx` mock。
- 错误统一用 `{ code, message }`；给用户看的文案走 `api.toUserMessage()`，不要直接抛英文异常。
- 错误码见 `docs/api/cloud-functions.md`，新增错误码要同时更新该文档和 `api.js` 的 MESSAGES。
- 文案中文、短句、说清下一步动作（"去配置"而不是"缺少配置"）。
- 不引第三方状态库；页面级状态用 hooks，跨页共享只走 `src/utils/api.js` 的缓存。

## 7. 禁区与安全检查清单

提交前自查：

- [ ] 没有在小程序端 `import` 任何 Supabase 客户端（前端一律走云函数）
- [ ] 没有把 `api_key` / `encrypted_key` 写进 `wx.setStorage`、日志、错误信息
- [ ] 没有新增存图的存储（bucket / 表 / 云存储路径）
- [ ] 没有把 RLS 关掉，也没有给 anon/authenticated 授 `inventory_items` 等表的写权限
- [ ] 云函数超时仍 ≥ 60 秒（前端兜底 60 秒，比它长）
- [ ] 新增的规则都能被测试覆盖，或写清了不能测的原因
- [ ] 改了表结构 → 同步 `supabase/schema.sql` 与 `docs/architecture/data-model.md`

## 8. Definition of Done

- `npm test` 全绿，`npm run spec:check` 通过
- `npm run build:weapp` 构建成功（只有体积警告可以接受）
- 对应 spec 的验收标准逐条有证据（测试用例或真机记录）
- `docs/` 若有行为变化同步更新；新增决策补 ADR

## 9. 提交信息

`<type>(<scope>): <summary>`，type ∈ `feat|fix|docs|spec|refactor|test|chore`，scope 如 `capture`、`cloudfn`、`schema`。
示例：`spec(reminders): 拆出订阅消息授权任务`、`fix(cloudfn): 多图超限时返回 E_TOO_MANY_IMAGES`。
