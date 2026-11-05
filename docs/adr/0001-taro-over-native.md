# ADR-0001 用 Taro 4 + React 替代微信原生

- 状态：已采纳
- 日期：2026-11-05

## 背景

PRD 原定微信原生（WXML/WXSS/JS），理由是相机体验最稳、包体最小。但需求方后来要求「一套代码多平台发布 + 现成样式库」，
原生方案在这两点上直接出局。

## 决策

采用 **Taro 4.3.2 + React 18 + TypeScript + NutUI React Taro**。相机、文件系统、云开发继续直接调 `wx.*`，
不引入 Taro 的封装层，保证"稳的部分"不受框架影响。

## 后果

- 好处：`taro build --type weapp/h5/alipay` 一套源码多端；组件化与状态管理更顺手；工具层零改动即可复用。
- 代价：多一层 Taro runtime，`dist` 约 737 KB（微信主包 2 MB 内）；NutUI 全量样式让 `app-origin.wxss` 到 258 KB。
- 退路：`src/utils/*.js` 不依赖 React，若将来退回原生，只换 `src/pages`。

## 备选方案

- 原生 + Vant Weapp：样式库可用，但多端要重写，否决。
- uni-app：多端成熟，但 Vue 生态与团队 React 经验不匹配，且 `wx.cloud` 适配不如 Taro 直接。

## 何时重新审视

小程序主包逼近 2 MB，或某端（H5/支付宝）成为真实发布目标且适配成本高于重写页面时。
