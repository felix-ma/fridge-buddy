# 部署手册

## 0. 前置条件

- 微信小程序 AppID（测试可用 `touristappid`，但云开发与订阅消息需要真实 AppID）
- 已开通微信云开发环境
- 一个 Supabase 项目（Postgres）
- 一个 DeepSeek API Key（用户自填，或在云函数配兜底 Key）

## 1. 本地构建

```bash
npm install
npm run build:weapp        # 产物 dist/
npm test                   # 单测应全绿
```

改代码时用 `npm run dev:weapp` 监听编译，微信开发者工具会热更新。

## 2. 微信开发者工具

1. 导入**仓库根目录**（`project.config.json` 里 `miniprogramRoot` 指向 `dist/`）。
2. AppID 换成自己的。
3. `src/config.js` 的 `cloudEnv` 填云开发环境 ID（留空则用默认环境）。
4. 重新构建后即可预览。

## 3. Supabase

1. 新建项目，记下 `SUPABASE_URL` 与 `service_role` key。
2. SQL Editor 整段执行 `supabase/schema.sql`（可重复执行）。
3. 不需要建 storage bucket —— 本产品不存图片。

## 4. 云函数

```bash
cd cloudfunctions/aiProxy && npm install
```

微信开发者工具里右键 `aiProxy` → 上传并部署（云端安装依赖）。

**控制台一定要把超时从默认 3 秒改成 60 秒**，否则视觉请求必然超时。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `SUPABASE_URL` | 是 | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | 是 | 只放云函数，绝不进前端 |
| `PROVIDER_KEY_SECRET` | 是 | ≥16 字符随机串；**换掉 = 所有用户 Key 失效** |
| `DEEPSEEK_API_KEY` | 否 | 兜底 Key，用户没配时使用 |
| `SUBSCRIBE_TEMPLATE_ID` | 否 | 不配则定时任务只统计不推送 |
| `MP_STATE` | 否 | `formal` / `trial` / `developer` |

## 5. 定时触发器

云开发控制台 → 云函数 → aiProxy → 触发器：每天 08:00，cron `0 0 8 * * *`，事件内容随意（代码靠 `event.Type === 'Timer'` 识别）。

## 6. 订阅消息

1. 小程序后台 → 订阅消息 → 选用或申请模板，字段需包含 `thing1`、`date2`、`thing3`。
2. 模板 ID 填进 `SUBSCRIBE_TEMPLATE_ID`。
3. 前端在用户点击时调 `wx.requestSubscribeMessage`（当前版本尚未接入，见 `specs/004-expiry-reminders`）。

## 7. 上线前检查

- [ ] 小程序端构建产物里搜不到 `sk-`、`encrypted_key`、`SERVICE_ROLE`
- [ ] 用 anon key 访问 Supabase 五张表全部被拒
- [ ] 云函数超时 ≥60 秒
- [ ] 真机：拍照 → 识别 → 摘要 → 库存状态变化（spec 001 验收）
- [ ] 真机：设置页存 Key → 首页能生成食谱；换设备后不需要重新配（同一 openid）
- [ ] 手动触发定时任务，`reminder_logs` 有记录、订阅消息能收到

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 3 秒就报超时 | 云函数默认超时没改 | 控制台改 60 秒 |
| 全员 `E_KEY_BROKEN` | `PROVIDER_KEY_SECRET` 被换过 | 让用户重填 Key，或恢复旧 secret |
| 订阅消息 `47003` | 模板字段与代码约定不一致 | 核对 `thing1/date2/thing3` |
| 构建报找不到 `@babel/preset-react` | 镜像默认装了 Babel 8 | 钉 `@babel/preset-react@^7.24.4`、`@babel/preset-typescript@^7.24.4` |
| 总报 `E_TOO_MANY_IMAGES` | 绕过前端直接传图 | `utils/image.js` 已拦截 8 张 |
