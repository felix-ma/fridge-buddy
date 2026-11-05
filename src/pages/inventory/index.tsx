import { useCallback, useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { Empty } from '@nutui/nutui-react-taro'
import api from '../../utils/api'
import fmt from '../../utils/format'
import './index.css'

type Item = {
  id: string
  label: string
  quantity: number
  zone_id?: string
  state: string
  expire_at?: string
  first_seen_at?: string
}

const ACTIONS: Record<string, { label: string; type: string }[]> = {
  present: [
    { label: '已吃完', type: 'consume' },
    { label: '从库存移除', type: 'delete' },
  ],
  probably_removed: [
    { label: '其实还在冰箱里', type: 'restore' },
    { label: '已吃完', type: 'consume' },
    { label: '从库存移除', type: 'delete' },
  ],
  removed: [{ label: '放回库存', type: 'restore' }],
  consumed: [{ label: '放回库存', type: 'restore' }],
}

export default function Inventory() {
  const [items, setItems] = useState<Item[]>([])
  const [history, setHistory] = useState<Item[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.getInventory()
      setItems(data.items || [])
      setHistory(data.history || [])
      setError('')
    } catch (err: any) {
      if (api.needsProviderSetup(err)) setError('还没配置 API Key，先去设置页配置')
      else setError(api.toUserMessage(err))
    }
  }, [])

  useDidShow(() => {
    load()
  })

  usePullDownRefresh(async () => {
    await load()
    Taro.stopPullDownRefresh()
  })

  const onTap = async (item: Item) => {
    const actions = ACTIONS[item.state] || ACTIONS.present
    try {
      const res = await Taro.showActionSheet({ itemList: actions.map((a) => a.label) })
      const action = actions[res.tapIndex]
      if (!action) return
      await api.actOnItem({ type: action.type, itemId: item.id })
      Taro.showToast({ title: '已更新', icon: 'success' })
      load()
    } catch (err: any) {
      if (err && err.errMsg && /cancel/i.test(err.errMsg)) return
      Taro.showToast({ title: api.toUserMessage(err), icon: 'none' })
    }
  }

  const renderItem = (it: Item) => {
    const exp = fmt.expireLabel(it.expire_at)
    return (
      <View key={it.id} className='item' onClick={() => onTap(it)}>
        <View className='item-main'>
          <Text className='item-label'>{it.label}</Text>
          <Text className='muted small'>{fmt.quantityLabel(it.quantity)}</Text>
        </View>
        <View className='item-side'>
          <Text className={`chip chip-${fmt.stateTone(it.state)}`}>{fmt.stateLabel(it.state)}</Text>
          <Text className={`chip chip-${exp.tone}`}>{exp.text}</Text>
        </View>
      </View>
    )
  }

  return (
    <View className='page'>
      {!!error && (
        <View className='card'>
          <Text className='danger-text'>{error}</Text>
        </View>
      )}

      <View className='card'>
        <View className='row-between'>
          <Text className='bold'>在库 · {items.length}</Text>
          <Text className='muted small'>点一项可改状态</Text>
        </View>
        {items.length === 0 ? <Empty description='还没有食材' /> : items.map(renderItem)}
      </View>

      {history.length > 0 && (
        <View className='card'>
          <Text className='bold'>最近变动</Text>
          {history.slice(0, 10).map(renderItem)}
        </View>
      )}
    </View>
  )
}
