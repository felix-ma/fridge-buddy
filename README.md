# 冰箱助手 · MVP 骨架

技术栈：**Taro 4 + React 18 + TypeScript + NutUI**（一套代码可发微信 / H5 / 支付宝等多端），
云函数与数据库仍是微信云开发 + Supabase。

已交付 PRD 里点名的 **1）aiProxy 云函数**、**2）inventory-engine 状态机**、**3）三视角拍摄引导页**、**4）建表 SQL 与权限**，
外加四个页面（首页 / 库存 / 盘点 / 设置）与前端工具层，共 58 个单测。

---

## 一、PRD 里已经过时的四条技术事实

核对于 2026-11-05 的官方文档（[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)、[图像理解](https://api-docs.deepseek.com/zh-cn/guides/vision)、[V4.1 Flash 发布](https://www.deepseek.com/news/deepseek-v4-1-flash/)）：

| PRD 写的 | 实际情况 | 代码里的处理 |
| --- | --- | --- |
| 模型 `deepseek-v4-flash-vision-exp` | 该模型**已下线**，请求会被路由到 V4.1 Flash；现役模型名是 `deepseek-flash`。且 V4.1 Flash 原生多模态，**视觉和文本是同一个模型**；`deepseek-v4-pro` 反而**不支持**图片 | `DEFAULT_MODEL = 'deepseek-flash'`；`inventory.scan` 与 `recipe.suggest` 共用一个模型名，少一套配置 |
| 多图硬上限 8 张 | 单请求最多 **600 张**；请求体 48 MiB；单图（base64）32 MiB | 8 张是**产品选择**（省钱、好对齐），不是 API 边界。超了返回 `E_TOO_MANY_IMAGES`，文案不承诺"API 会拒" |
| 图片很大、要狠狠压 | 模型侧会把图缩到约 1300×1300、**单图最多 1024 tokens** | `quality 0.7` 已足够；还可以把长边先缩到 1280，视觉质量几乎不掉，传输更省 |
| 云函数默认超时 3 秒 | 各版本默认值不同，但都在控制台可调 | 不靠默认值：README 要求手动确认 ≥ 60 秒，前端另有本地 60 秒兜底 |

顺带的成本量级：`deepseek-flash` 输入（未命中缓存）闲时 1 元 / 高峰 2 元每百万 tokens，输出 4 / 8 元。一次 5 图盘点 ≈ 5k 输入 + 1k 输出 ≈ **0.01 元量级**，MVP 阶段不必为省钱牺牲识别质量。

---


---

## 一·五、为什么从原生换成了 Taro

PRD 原本写的是"微信小程序原生"，理由是相机体验最稳、包体最小。这个判断没错，但它把"只发微信"也一起写死了。现在改成 Taro 4 + React，取舍如下：

| | 原生 WXML | Taro 4 + React（当前） |
| --- | --- | --- |
| 多端统一发布 | 不能，只能微信 | `--type weapp / h5 / alipay` 同一套源码 |
| 相机、文件、云开发 | 直接 `wx.*` | 仍直接调 `wx.*`（Taro 不做二次封装），稳的部分没变 |
| 页面组织 | 四个 `Page()` 各一份 setData | React 函数组件 + hooks，工具层不用重写 |
| UI 组件 | 自己写 / 用 Vant Weapp（绑定原生） | NutUI（京东出品，Taro 官方推荐，跨端可用） |
| 包体 | 最省 | 多一层 runtime，`dist` 现在 737 KB，仍在 2 MB 主包内 |

迁移时**工具层一行没改**：`src/utils/*.js` 仍用 `wx.chooseMedia` / `wx.cloud.callFunction`，只是被 React 页面 import 进来。这也是刻意留的退路——真觉得 Taro 不合适，把页面换回原生，工具层和云函数侧都不用动。

UI 库选择：**NutUI React Taro**（v2.7.14）。同厂、有 Taro 4 适配、组件齐；代价是全局引了 `dist/style.css`，`app-origin.wxss` 258 KB，后续要做按需引入再砍。

---

## 二、与 PRD 的一处架构改动

| | PRD 方案 | 本实现 |
| --- | --- | --- |
| 状态机位置 | 小程序端 `inventory-engine.js` | **云函数内**（同一请求里完成 观测→落库→状态机） |
| 数据库访问 | 前端用 `supabase-mp-js` 直连 + RLS | 前端**不直连**，全部走云函数；Supabase 只接受 service_role |

理由：

1. **规则只有一份。** 前后端各一份副本，改规则必漏一处；而且前端算出来的库存能被改包篡改。
2. **前端不需要 anon key。** 没有 key 就没有"RLS 写漏 → 串号/越权"的风险。`schema.sql` 里 RLS 全开、`anon`/`authenticated` 全部 revoke，service_role 只存在于云函数环境变量。
3. **这条链路本来就要经过云函数**（Key 不落前端），顺路跑状态机比"云函数存观测 → 前端再拉 → 前端再写回"少两次往返。

`inventory-engine.js` 仍然是**纯函数**（无 IO，时间与 id 由外部注入），13 个单测覆盖全部规则。将来要挪回前端或做离线预演，`npm run sync:engine` 拷一份即可，规则不会分叉。

---

## 三、目录

```
src/
  app.tsx                  云开发 init、全局样式（Taro 入口）
  app.config.ts            pages / window / tabBar
  pages/home               首页：概览、临期、食谱推荐
  pages/capture            三视角引导拍摄 → 识别入库
  pages/inventory          库存列表 + 状态操作（吃完 / 移除 / 恢复）
  pages/settings           Provider 配置（Key 只进不出）
  utils/image.js           选图 → 逐张压缩 → Base64 → 删临时文件
  utils/api.js             callProxy + 60 秒兜底 + 错误码文案 + Provider 缓存
  utils/capture.js         三视角引导状态机（纯函数）
  utils/flow.js            拍摄 / 扫描链路
  utils/format.js          到期标签、状态标签、概览统计
config/                    Taro 构建配置
dist/                      构建产物（微信开发者工具导入这个目录，不进 git）
cloudfunctions/aiProxy/
  index.js                 入口：inventory.scan / inventory.get / inventory.action /
                           recipe.suggest / config.put / config.get / 定时提醒
  config.json              openapi 权限（subscribeMessage.send）
  lib/inventory-engine.js  状态机（纯函数）
  lib/deepseek.js          OpenAI 兼容调用 + 容错 JSON 解析
  lib/db.js                PostgREST 客户端（不引 supabase-js，冷启动更快）
  lib/crypto.js            AES-256-GCM 加解密用户 Key
  lib/http.js              零依赖 https 客户端，带超时
  lib/validate.js          模型输出收敛到固定字段（脏数据在这里拦住）
  prompts/inventory.js     跨图对齐 prompt（强制 json）
  prompts/recipe.js        食谱 prompt（优先临期）
supabase/schema.sql        建表 / 索引 / 唯一约束 / RLS / 观测只增不改触发器
miniprogram/utils/
test/inventory-engine.test.js   13 个状态机单测
test/utils.test.js              35 个前端单测（含 wx mock）
test/format.test.js             10 个格式化单测
```

---

## 四、部署顺序

0. **装依赖并构建**：`npm install` → `npm run build:weapp`（产物在 `dist/`）。之后改代码用 `npm run dev:weapp` 持续编译。
1. **Supabase**：新建项目 → SQL Editor 整段执行 `supabase/schema.sql`。
2. **云函数环境变量**（控制台 → 云开发 → 云函数 → aiProxy → 配置）：

   | 变量 | 必填 | 说明 |
   | --- | --- | --- |
   | `SUPABASE_URL` | 是 | `https://xxxx.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | 是 | 只在云函数里，绝不进前端 |
   | `PROVIDER_KEY_SECRET` | 是 | ≥16 字符随机串。**换掉它 = 已存的所有用户 Key 全部失效** |
   | `DEEPSEEK_API_KEY` | 否 | 兜底 Key：用户没配自己的就用它 |
   | `SUBSCRIBE_TEMPLATE_ID` | 否 | 不配则定时任务只统计不推送 |
   | `MP_STATE` | 否 | `formal` / `trial` / `developer` |

3. 右键 `aiProxy` → 上传并部署（云端安装依赖）→ **控制台把超时改到 60 秒**。
4. 定时触发器：每天 08:00（cron `0 0 8 * * *`）。代码靠 `event.Type === 'Timer'` 识别，事件内容随便填。
5. **微信开发者工具**：导入项目根目录（`project.config.json` 里 `miniprogramRoot` 已指向 `dist/`），AppID 换成自己的；云开发环境 ID 填到 `src/config.js` 的 `cloudEnv`（留空则用默认环境）。

---

## 五、接口

| action | 入参 | 返回要点 |
| --- | --- | --- |
| `inventory.scan` | `images: string[]`（base64 或 dataURL，≤8）、`session_id`、`zone_hint` | `summary`、`summary_card`（可直接渲染的摘要行）、`questions`（需要点的那几行）、`items`、`expiring`、`observation_id` |
| `inventory.get` | — | `items`、`history`、`expiring` |
| `inventory.action` | `type`：`restore` / `delete` / `consume` / `accept_quantity` / `keep_quantity` / `move_zone`，`item_id` | 更新后的单条 `item` |
| `recipe.suggest` | `servings` | `recipes[]`（`name` / `reason` / `uses_existing` / `missing` / `steps`） |
| `config.put` | `base_url`、`model_name`、`api_key` | 只回 `key_hint`，**Key 不回传** |
| `config.get` | — | `has_key`、`key_hint`、`base_url`、`model_name` |

统一返回 `{ ok, data, elapsedMs }` / `{ ok: false, error: { code, message } }`。
错误码：`E_NO_KEY` `E_BAD_KEY` `E_PARSE` `E_EMPTY` `E_TOO_MANY_IMAGES` `E_IMAGE_TOO_LARGE` `E_BAD_INPUT` `E_NOT_FOUND` `E_DB` `E_TIMEOUT`。

---

## 六、前端工具层

页面里不用直接碰 `wx.compressImage` / `wx.cloud.callFunction`，四个模块包完了（`src/pages/capture/index.tsx` 是完整用法示例）：

```js
import { useState } from 'react'
import capture from '../../utils/capture'
import flow from '../../utils/flow'
import api from '../../utils/api'

export default function Capture() {
  const [session] = useState(() => capture.createSession())
  const [prompt, setPrompt] = useState(() => session.prompt)

  // 拍照按钮：一次一张，拍完自动切到下一视角
  const onShoot = async () => {
    try {
      setPrompt(await flow.pickNext(session))
    } catch (err) {
      Taro.showToast({ title: api.toUserMessage(err), icon: 'none' })
    }
  }

  // 拍完调云函数
  const onSubmit = async () => {
    try {
      const result = await flow.captureAndScan(session)
      // result.summary_card.lines 直接渲染，零点击
    } catch (err) {
      if (api.needsProviderSetup(err)) Taro.navigateTo({ url: '/pages/settings/index' })
    }
  }

  return null
}
```

关键行为：

| 场景 | 实际发生什么 |
| --- | --- |
| 相册原图 4000px | 先 `wx.getImageInfo` 算等比尺寸 → `compressImage` 带 `compressedWidth/Height`（新基础库生效，**该参数名未能从官方文档页核实，故按"可能被忽略"处理**）→ 压完重新 stat 校验体积。旧基础库忽略这两个参数时自动退回只传 `quality: 0.7`，不报错 |
| 压缩后仍 > 6 MiB | 降质到 0.5 再压一次，只对那一张 |
| 8 张上限 | `prepareImages` 在压缩前就拦，抛 `E_TOO_MANY_IMAGES`，不做无谓的 CPU 开销 |
| 总量超限 | 按 Base64 膨胀后累计，超过 24 MiB 抛 `E_IMAGE_TOO_LARGE`（请求体 48 MiB 留足余量） |
| 内存压力 | 严格串行：压一张 → 读 Base64 → 删压缩产物和源临时文件 → 下一张。全程不 `Promise.all` |
| 云函数慢 | 本地 `Promise.race` 60 秒兜底，文案"可能未保存"（云函数可能还在跑并已落库） |
| 没配 Key | `flow.ensureProviderReady()` 在拍照前就拦，不浪费用户三张照片 |

本地超时**不代表云函数停了**——它可能还在写、并且已经写进去了。所以文案说"可能未保存"，配合"观测只增不改"，重试不会破坏历史。

---

## 七、工程约定

- **图片零持久化**：`index.js` 里图片只在 `normalizeImages` 中变成 data URL 进请求体，函数返回后随内存释放；库里只有 `observations.items_json` 这类结构化字段。全仓没有把图片写盘/写库的路径。
- **观测只增不改**：`observations` 上挂了 `before update or delete` 触发器，任何人（包括 service_role）改历史观测都会报错。
- **Key 只进不出**：`config.put` 只返回末四位提示；`config.get` 永远不返回明文或密文。解密只发生在 `loadProvider` 里，结果只用于这一次上游请求。
- **不误删**：`reconcile` 要求连续 3 次未观测才 `removed`，中间态 `probably_removed` 仍算库存、仍参与临期提醒；每次降级都带可撤回的 `restore` 动作。

---

## 八、测试

```bash
npm test        # node --test test/*.test.js
```

当前 **58/58** 通过，三个文件：

- `test/format.test.js`（10）：已过期 / 今天 / 明天 / 3 天内 / 更远的边界、状态标签与配色、数量文案、概览统计只算在库与待确认、日期与"缺料"文案。
- `test/inventory-engine.test.js`（13）：新建实体与保质期推导、拍漏一次只加 `miss_count`、2/3 次降级、重新拍到的恢复、低置信不污染主库存、数量突变的确认/保持、小幅数量自动生效、同物异名归一、同轮重复标签、临期四级分类、摘要卡零点击、整轮混合场景。
- `test/utils.test.js`（35）：缩放计算不放大、Base64 膨胀估算、8 张拦截、逐张串行与临时文件释放、压缩参数被拒的降级、超体积降质重压、总量超限、三视角引导状态、重拍、云函数成功/业务错误/网络错误/本地超时、错误码文案、Provider 缓存不落 Key、以及 mock wx 下的完整链路 `pickNext → scanSession → inventory.scan`。

---

## 九、没做 / 已知风险

- **还没真机跑过**：构建通过（`taro build --type weapp` ✔），但相机、压缩、云函数调用都要在真机上验证一遍。
- **多端只是能编译**：发 H5 / 支付宝前，`Taro.cloud` 和 `wx.chooseMedia` 需要按端做适配层；当前代码只针对 `weapp` 写过。
- **NutUI 样式全量引入**：`app-origin.wxss` 258 KB，后面做按需引入能砍掉一大半。
- **并发写冲突**：`inventory_items` 上 `(user_id, lower(label)) where state in (...)` 是活跃唯一索引，但两次扫描并发仍可能撞 `23505`；MVP 单用户低频，暂时只在重试层面留意，没有做分布式锁。
- **食谱没有缓存**：同一份库存反复点"推荐"会重复计费，建议加 6 小时缓存（按库存签名）。
- **订阅消息模板字段**：`thing1 / date2 / thing3` 是代码里的约定，必须和小程序后台选的模板字段对上，否则 `errCode 47003`。
