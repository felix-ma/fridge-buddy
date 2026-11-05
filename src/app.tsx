import { PropsWithChildren, useEffect } from 'react'
import Taro from '@tarojs/taro'
import config from './config'
import '@nutui/nutui-react-taro/dist/style.css'
import './app.css'

function App({ children }: PropsWithChildren) {
  useEffect(() => {
    if (!Taro.cloud) {
      Taro.showModal({
        title: '微信版本过低',
        content: '请升级微信后再打开小程序',
        showCancel: false,
      })
      return
    }
    Taro.cloud.init({
      env: config.cloudEnv || undefined,
      traceUser: true,
    })
  }, [])

  return children
}

export default App
