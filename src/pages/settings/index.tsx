import { useEffect, useState } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { Button } from '@nutui/nutui-react-taro'
import api from '../../utils/api'
import './index.css'

export default function Settings() {
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
  const [modelName, setModelName] = useState('deepseek-flash')
  const [apiKey, setApiKey] = useState('')
  const [hint, setHint] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getProvider()
      .then((data: any) => {
        if (data.base_url) setBaseUrl(data.base_url)
        if (data.model_name) setModelName(data.model_name)
        setHint(data.key_hint || '')
        if (data.has_key && data.source === 'env') setHint('（服务端内置 Key）')
      })
      .catch((err: any) => {
        if (!api.needsProviderSetup(err)) Taro.showToast({ title: api.toUserMessage(err), icon: 'none' })
      })
  }, [])

  const save = async () => {
    if (saving) return
    if (!apiKey.trim()) {
      Taro.showToast({ title: '请填写 API Key', icon: 'none' })
      return
    }
    setSaving(true)
    Taro.showLoading({ title: '保存中', mask: true })
    try {
      const data = await api.putProvider({ baseUrl: baseUrl.trim(), modelName: modelName.trim(), apiKey: apiKey.trim() })
      api.cacheProvider({ baseUrl: data.base_url, modelName: data.model_name })
      setApiKey('')
      setHint(data.key_hint || '')
      Taro.hideLoading()
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (err: any) {
      Taro.hideLoading()
      Taro.showToast({ title: api.toUserMessage(err), icon: 'none' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <View className='page'>
      <View className='card'>
        <Text className='bold'>模型服务</Text>
        <View className='field'>
          <Text className='field-label'>Base URL</Text>
          <Input className='field-input' value={baseUrl} onInput={(e) => setBaseUrl(e.detail.value)} placeholder='https://api.deepseek.com' />
        </View>
        <View className='field'>
          <Text className='field-label'>模型名</Text>
          <Input className='field-input' value={modelName} onInput={(e) => setModelName(e.detail.value)} placeholder='deepseek-flash' />
        </View>
        <View className='field'>
          <Text className='field-label'>API Key</Text>
          <Input
            className='field-input'
            password
            value={apiKey}
            onInput={(e) => setApiKey(e.detail.value)}
            placeholder={hint ? `已配置 ${hint}，如需更换请重填` : 'sk-...'}
          />
        </View>
        <Button type='primary' size='large' loading={saving} onClick={save}>
          保存
        </Button>
      </View>

      <View className='card'>
        <Text className='bold'>关于 Key 的安全边界</Text>
        <Text className='muted small block'>· Key 通过云函数加密后存在 Supabase，只有云函数能解密。</Text>
        <Text className='muted small block'>· Key 不会返回小程序，也不会写进本地缓存；本地只记 Base URL 和模型名。</Text>
        <Text className='muted small block'>· 换掉云函数的 PROVIDER_KEY_SECRET 会让所有已存 Key 失效，需要重填。</Text>
      </View>
    </View>
  )
}
