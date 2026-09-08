import { create } from 'zustand'
import type { AssetLibraryRootKind } from '@/authoring/assets/registry-types'
import { gameKeySuffix } from './gameScope'

const ROOT_KINDS: readonly AssetLibraryRootKind[] = [
  'image', 'video', 'control', 'sound', 'audio', 'character', 'scene', 'font',
]
// 按 game 隔离键 / 频道：storage 事件与 BroadcastChannel 同源跨 tab，避免多开不同 game 串台。
// 后缀惰性求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const LS_KEY_BASE = 'game-video:asset:root'
const CHANNEL_BASE = 'game-video:asset-root-sync'

function lsKey(): string {
  return `${LS_KEY_BASE}${gameKeySuffix()}`
}

function initialRoot(): AssetLibraryRootKind | null {
  try {
    const value = localStorage.getItem(lsKey())
    return value && ROOT_KINDS.includes(value as AssetLibraryRootKind) ? value as AssetLibraryRootKind : null
  } catch {
    return null
  }
}

interface AssetNavStore {
  root: AssetLibraryRootKind | null
  folderId: string | null
  entryKey: string | null
  setLocation(location: { root: AssetLibraryRootKind | null, folderId?: string | null, entryKey?: string | null }): void
  setRoot(root: AssetLibraryRootKind | null): void
}

let channel: BroadcastChannel | null = null
let applyingRemote = false

export const useAssetNav = create<AssetNavStore>((set) => ({
  root: initialRoot(),
  folderId: null,
  entryKey: null,
  setLocation(location) {
    set((state) => {
      const root = location.root
      const folderId = location.folderId ?? null
      const entryKey = location.entryKey ?? null
      if (state.root === root && state.folderId === folderId && state.entryKey === entryKey) return state
      try {
        if (root) localStorage.setItem(lsKey(), root)
        else localStorage.removeItem(lsKey())
      } catch { /* best effort */ }
      if (!applyingRemote) channel?.postMessage({ root, folderId, entryKey })
      return { root, folderId, entryKey }
    })
  },
  setRoot(root) {
    useAssetNav.getState().setLocation({ root })
  },
}))

export function installAssetNavSync(): () => void {
  const applyRemoteLocation = (value: unknown): void => {
    const location = typeof value === 'string' || value === null
      ? { root: value }
      : value as { root?: unknown, folderId?: unknown, entryKey?: unknown }
    const root = location.root
    if (root !== null && !ROOT_KINDS.includes(root as AssetLibraryRootKind)) return
    const folderId = typeof location.folderId === 'string' ? location.folderId : null
    const entryKey = typeof location.entryKey === 'string' ? location.entryKey : null
    applyingRemote = true
    try {
      useAssetNav.getState().setLocation({ root: root as AssetLibraryRootKind | null, folderId, entryKey })
    } finally {
      applyingRemote = false
    }
  }
  const scopedKey = lsKey()
  const onStorage = (event: StorageEvent): void => {
    if (event.key === scopedKey) applyRemoteLocation(event.newValue)
  }
  // 模块求值时宿主可能还没注入 game 标识，此刻的键才是最终的，补一次 hydrate。
  const stored = initialRoot()
  if (stored) applyRemoteLocation(stored)
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
    channel.onmessage = (event: MessageEvent) => applyRemoteLocation(event.data)
  }
  return () => {
    channel?.close()
    channel = null
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
