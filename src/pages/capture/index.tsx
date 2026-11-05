import { useState } from 'react'
import { View, Text, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button } from '@nutui/nutui-react-taro'
import capture from '../../utils/capture'
import flow from '../../utils/flow'
import api from '../../utils/api'
import './index.css'

export default function Capture() {
  const [session] = useState(() => capture.createSession())
  const [prompt, setPrompt] = useState(() => session.prompt)
  const [shots, setShots] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const sync = () => {
    setPrompt(session.prompt)
    setShots(session.paths)
  }

  const onShoot = async () => {
    if (busy) return
    setBusy(true)
    try {
      await flow.pickNext(session)
      sync()
    } catch (err: any) {
      if (err && err.errMsg && /cancel/i.test(err.errMsg)) return
      Taro.showToast({ title: api.toUserMessage(err), icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const onRetake = () => {
    session.removeLast()
    sync()
  }

  const onSubmit = async () => {
    if (!session.paths.length || busy) return
    setBusy(true)
    Taro.showLoading({ title: '识别中，约 10 秒', mask: true })
    try {
      const data = await flow.captureAndScan(session)
      Taro.hideLoading()
      const lines = (data && data.summary_card && data.summary_card.lines) || []
      const content = lines.length
        ? lines.map((l: any) => `${l.icon} ${l.text}`).join('\n')
        : '这次没有新增，库存已是最新'
      await Taro.showModal({ title: '已入库', content, showCancel: false, confirmText: '好的' })
      Taro.navigateBack()
    } catch (err: any) {
      Taro.hideLoading()
      if (api.needsProviderSetup(err)) {
        const res = await Taro.showModal({
          title: '还没配置 API Key',
          content: 'Key 加密存在云端，配置后才能识别。',
          confirmText: '去配置',
        })
        if (res.confirm) Taro.redirectTo({ url: '/pages/settings/index' })
        return
      }
      Taro.showModal({
        title: '识别失败',
        content: api.toUserMessage(err),
        showCancel: false,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className='page capture'>
      <View className='prompt-bar'>
        {prompt ? (
          <>
            <Text className='prompt-title'>{prompt.title}</Text>
            <Text className='prompt-hint'>{prompt.hint}</Text>
          </>
        ) : (
          <>
            <Text className='prompt-title'>三个视角都拍好了</Text>
            <Text className='prompt-hint'>点下方「识别入库」，也可以重拍最后一张</Text>
          </>
        )}
      </View>

      <View className='shots'>
        {[0, 1, 2].map((i) => {
          const path = shots[i]
          return (
            <View key={i} className={`shot ${path ? 'shot-done' : ''}`}>
              {path ? <Image className='shot-img' src={path} mode='aspectFill' /> : <Text className='shot-idx'>{i + 1}</Text>}
              <Text className='shot-label'>{capture.VIEWS[i].label}</Text>
            </View>
          )
        })}
      </View>

      <View className='actions'>
        {!session.done && (
          <Button type='primary' size='large' loading={busy} onClick={onShoot}>
            {`拍第 ${shots.length + 1} 张 · ${prompt ? prompt.label : ''}`}
          </Button>
        )}
        {session.done && (
          <Button type='primary' size='large' loading={busy} onClick={onSubmit}>
            识别入库
          </Button>
        )}
        {shots.length > 0 && (
          <Button size='large' fill='outline' disabled={busy} onClick={onRetake}>
            重拍上一张
          </Button>
        )}
      </View>

      <Text className='muted small footnote'>
        照片只在本地压缩后上传识别，用完即删，云端只存识别结果。
      </Text>
    </View>
  )
}
