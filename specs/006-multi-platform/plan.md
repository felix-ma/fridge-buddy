# 技术方案（草案）

- 平台判断：`process.env.TARO_ENV`。
- 新增 `src/platform/{index,weapp,h5}.js`，暴露 `pickImages`、`callProxy`、`subscribe` 三个能力。
- 云开发替代：优先 Supabase Edge Functions（已有 Postgres，复用同一套 RLS/service 逻辑）。

## 测试计划

- 单测覆盖适配层的纯逻辑分支。
- 手工：H5 选图、支付宝小程序基础预览。

## 发布

未定，需先做技术验证（spike）。
