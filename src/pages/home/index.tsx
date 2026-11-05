import { useCallback, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Button, Empty } from '@nutui/nutui-react-taro'
import api from '../../utils/api'
import fmt from '../../utils/format'
import './index.css'

type Row = {
  id: string
  label: string
  quantity: number
  state: string
  expire_at?: string
  level?: string
  daysLeft?: number
}

export default function Home() {
  const [items, setItems] = useState<Row[]>([])
  const [expiring, setExpiring] = useState<Row[]>([])
  const [stats, setStats] = useState({ total: 0, soon: 0, expired: 0, pending: 0 })
  const [needKey, setNeedKey] = useState(false)
  const [error, setError] = useState('')
  const [recipes, setRecipes] = useState<any[]>([])
  const [recipeLoading, setRecipeLoading] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.getInventory()
      const list: Row[] = data.items || []
      setItems(list)
      setStats(fmt.summarize(list))
      setExpiring(data.expiring || [])
      setNeedKey(false)
    } catch (err: any) {
      if (api.needsProviderSetup(err)) setNeedKey(true)
      else setError(api.toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useDidShow(() => {
    load()
  })

  usePullDownRefresh(async () => {
    await load()
    Taro.stopPullDownRefresh()
  })

  const startScan = () => Taro.navigateTo({ url: '/pages/capture/index' })
  const goSettings = () => Taro.navigateTo({ url: '/pages/settings/index' })
  const goInventory = () => Taro.switchTab({ url: '/pages/inventory/index' })

  const recommend = async () => {
    if (recipeLoading) return
    setRecipeLoading(true)
    try {
      const data = await api.suggestRecipes({ servings: 2 })
      setRecipes(data.recipes || [])
    } catch (err: any) {
      if (api.needsProviderSetup(err)) setNeedKey(true)
      Taro.showToast({ title: api.toUserMessage(err), icon: 'none' })
    } finally {
      setRecipeLoading(false)
    }
  }

  return (
    <View className='page'>
      <View className='card hero'>
        <View className='row-between'>
          <Text className='hero-title'>冰箱里还有</Text>
          <Text className='muted small' onClick={goInventory}>
            全部 ›
          </Text>
        </View>
        <View className='metrics'>
          <View className='metric'>
            <Text className='metric-value'>{stats.total}</Text>
            <Text className='muted small'>在库</Text>
          </View>
          <View className='metric'>
            <Text className='metric-value warn'>{stats.soon}</Text>
            <Text className='muted small'>3 天内到期</Text>
          </View>
          <View className='metric'>
            <Text className='metric-value danger'>{stats.expired}</Text>
            <Text className='muted small'>已过期</Text>
          </View>
        </View>
      </View>

      {needKey && (
        <View className='card'>
          <Text className='bold'>还差一步：配置 API Key</Text>
          <Text className='muted small block'>Key 加密存在云端，不会出现在小程序里。</Text>
          <Button type='primary' size='large' onClick={goSettings}>
            去配置
          </Button>
        </View>
      )}

      {!!error && (
        <View className='card'>
          <Text className='danger-text'>{error}</Text>
        </View>
      )}

      <View className='card'>
        <Button type='primary' size='large' onClick={startScan}>
          拍照盘点（3 个视角）
        </Button>
        <Text className='muted small center block'>正面全景 → 上层 → 下层，拍完自动入库</Text>
      </View>

      <View className='card'>
        <View className='row-between'>
          <Text className='bold'>临期提醒</Text>
          <Text className='muted small'>{expiring.length ? `${expiring.length} 项` : '暂无'}</Text>
        </View>
        {expiring.length === 0 ? (
          <Empty description='没有临期食材' />
        ) : (
          expiring.map((it) => {
            const t = fmt.levelLabel(it.level || '', it.daysLeft)
            return (
              <View key={it.id} className='list-row'>
                <Text className='list-label'>{it.label}</Text>
                <Text className={`chip chip-${t.tone}`}>{t.text}</Text>
              </View>
            )
          })
        )}
      </View>

      <View className='card'>
        <View className='row-between'>
          <Text className='bold'>今晚吃什么</Text>
          <Text className='muted small' onClick={recommend}>
            {recipeLoading ? '生成中…' : '用现有食材推荐'}
          </Text>
        </View>
        {recipes.length === 0 ? (
          <Empty description='点击右上角生成食谱' />
        ) : (
          recipes.map((r) => (
            <View key={r.name} className='recipe'>
              <Text className='bold'>{r.name}</Text>
              {!!r.reason && <Text className='muted small block'>{r.reason}</Text>}
              {!!fmt.missingLine(r.missing) && (
                <Text className='small warn-text block'>{fmt.missingLine(r.missing)}</Text>
              )}
              {(r.steps || []).map((s: string, i: number) => (
                <Text key={i} className='small block step'>
                  {i + 1}. {s}
                </Text>
              ))}
            </View>
          ))
        )}
      </View>

      {loading && <Text className='muted small center block'>加载中…</Text>}
      {!loading && !needKey && items.length === 0 && (
        <Text className='muted small center block'>还没入库，先拍一次照吧</Text>
      )}
    </View>
  )
}
