# 技术方案

- 后端已完成：`runReminder` 在 `cloudfunctions/aiProxy/index.js`。
- 待做：前端授权页/按钮，在首次入库成功后弹出订阅授权；授权结果存 `wx.setStorageSync('fb.subscribed', true)` 仅作展示用（真正能否推送以服务端返回为准）。
- 可选：把每天推送时间做成云端配置，暂不做。

## 测试计划

- 新增 `runReminder` 的可测片段（分级已由 `expiring` 覆盖；推送部分依赖 wx-server-sdk，保持人工验证）。
- 真机：AC5。

## 发布

需要 `SUBSCRIBE_TEMPLATE_ID` 与小程序后台模板配置。
