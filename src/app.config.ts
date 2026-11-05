export default defineAppConfig({
  pages: [
    'pages/home/index',
    'pages/inventory/index',
    'pages/capture/index',
    'pages/settings/index',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '冰箱助手',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f6f7f9',
  },
  tabBar: {
    color: '#8b909a',
    selectedColor: '#1f6feb',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/inventory/index', text: '库存' },
    ],
  },
})
