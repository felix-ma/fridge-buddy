'use strict';

const config = require('./config');

App({
  globalData: {
    cloudReady: false,
    // 首页缓存一次库存，页面间跳转不必重复拉
    lastScan: null,
  },

  onLaunch() {
    if (!wx.cloud) {
      // 基础库 < 2.2.3 没有云开发，整个 App 没法用，早点暴露
      wx.showModal({
        title: '微信版本过低',
        content: '请升级微信后再打开小程序',
        showCancel: false,
      });
      return;
    }
    wx.cloud.init({
      env: config.cloudEnv || undefined,
      traceUser: true,
    });
    this.globalData.cloudReady = true;
  },

  onError(err) {
    // 生产环境建议接实时日志；MVP 先打 console，避免噪声上报
    console.error('[app error]', err);
  },
});
