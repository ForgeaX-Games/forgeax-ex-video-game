import { create } from 'zustand'
import { CATALOG_ROOT_TARGET, CATALOG_TAB_KINDS, parseCatalogPlacementKey, type CatalogTabKind } from '@/editor/assets/asset-catalog'
import { gameKeySuffix } from './gameScope'

export type CatalogNavLocation =
  | { kind: 'catalog-root'; target: typeof CATALOG_ROOT_TARGET }
  | { kind: 'tab-root'; tabKind: CatalogTabKind; target: `root:${CatalogTabKind}` }
  | { kind: 'folder'; tabKind: CatalogTabKind; folderId: string; target: string }
  | { kind: 'item'; tabKind: CatalogTabKind; itemId: string; placementKey: string; target: string }

interface CatalogNavState {
  location: CatalogNavLocation
  setLocation(location: CatalogNavLocation): void
}

const STORAGE_KEY = 'game-video:asset-catalog:location'
const CHANNEL_BASE = 'game-video:asset-catalog:location'

let channel: BroadcastChannel | null = null
let applyingRemote = false

function storageKey(): string { return `${STORAGE_KEY}${gameKeySuffix()}` }

function parseLocation(value: unknown): CatalogNavLocation | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<CatalogNavLocation>
  if (candidate.kind === 'catalog-root') return { kind: 'catalog-root', target: CATALOG_ROOT_TARGET }
  if (candidate.kind === 'tab-root' && isTabKind(candidate.tabKind)) {
    return { kind: 'tab-root', tabKind: candidate.tabKind, target: `root:${candidate.tabKind}` }
  }
  if (candidate.kind === 'folder' && isTabKind(candidate.tabKind) && typeof candidate.folderId === 'string') {
    return { kind: 'folder', tabKind: candidate.tabKind, folderId: candidate.folderId, target: candidate.folderId }
  }
  if (candidate.kind === 'item' && isTabKind(candidate.tabKind) && typeof candidate.itemId === 'string' && typeof candidate.placementKey === 'string' && typeof candidate.target === 'string') {
    const placement = parseCatalogPlacementKey(candidate.placementKey)
    if (placement?.tabKind === candidate.tabKind && placement.itemId === candidate.itemId) {
      return { kind: 'item', tabKind: candidate.tabKind, itemId: candidate.itemId, placementKey: candidate.placementKey, target: candidate.target }
    }
  }
  return null
}

function readStored(): CatalogNavLocation {
  try {
    return parseLocation(JSON.parse(localStorage.getItem(storageKey()) ?? '')) ?? { kind: 'catalog-root', target: CATALOG_ROOT_TARGET }
  } catch { /* storage is optional */ }
  return { kind: 'catalog-root', target: CATALOG_ROOT_TARGET }
}

function isTabKind(value: unknown): value is CatalogTabKind {
  return typeof value === 'string' && CATALOG_TAB_KINDS.includes(value as CatalogTabKind)
}

export const useCatalogNav = create<CatalogNavState>((set) => ({
  location: readStored(),
  setLocation(location) {
    try { localStorage.setItem(storageKey(), JSON.stringify(location)) } catch { /* best effort */ }
    if (!applyingRemote) channel?.postMessage(location)
    set({ location })
  },
}))

/** Keeps the catalog selection identical in Arrival's split panes, scoped by game. */
export function installCatalogNavSync(): () => void {
  const apply = (value: unknown): void => {
    const next = parseLocation(value)
    if (!next) return
    try {
      localStorage.setItem(storageKey(), JSON.stringify(next))
      applyingRemote = true
      useCatalogNav.getState().setLocation(next)
    } catch { /* storage is optional */ } finally {
      applyingRemote = false
    }
  }
  const key = storageKey()
  const onStorage = (event: StorageEvent): void => {
    if (event.key === key && event.newValue) {
      try { apply(JSON.parse(event.newValue)) } catch { /* ignore malformed remote state */ }
    }
  }
  const stored = readStored()
  useCatalogNav.setState({ location: stored })
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
    channel.onmessage = (event: MessageEvent) => apply(event.data)
  }
  return () => {
    channel?.close()
    channel = null
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
