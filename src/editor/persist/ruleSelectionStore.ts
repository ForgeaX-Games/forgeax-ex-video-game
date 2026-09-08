import { create } from 'zustand'
import { gameKeySuffix } from './gameScope'

export type RuleSection = 'entities' | 'variables' | 'formulas'

interface RuleSelectionStore {
  section: RuleSection
  itemId: string | null
  select(section: RuleSection, itemId?: string | null): void
}

// 按 game 隔离频道，避免同源多开不同 game 时跨 tab 串台。
// 后缀在 install 时才求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const CHANNEL_BASE = 'game-video:rule-selection-sync'
let channel: BroadcastChannel | null = null
let applyingRemote = false

export const useRuleSelection = create<RuleSelectionStore>((set) => ({
  section: 'entities',
  itemId: null,
  select(section, itemId = null) {
    set((state) => {
      if (state.section === section && state.itemId === itemId) return state
      if (!applyingRemote) channel?.postMessage({ section, itemId })
      return { section, itemId }
    })
  },
}))

export function installRuleSelectionSync(): () => void {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data as { section?: unknown, itemId?: unknown }
      if (value.section !== 'entities' && value.section !== 'variables' && value.section !== 'formulas') return
      applyingRemote = true
      try {
        useRuleSelection.getState().select(value.section, typeof value.itemId === 'string' ? value.itemId : null)
      } finally {
        applyingRemote = false
      }
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}
