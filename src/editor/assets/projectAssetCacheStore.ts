import { useEffect } from 'react'
import { create } from 'zustand'
import type { AssetLibraryClient, ManagedAsset, ManagedAssetKind } from './assetLibraryClient'
import {
  beginResourceRefresh,
  completeResourceRefresh,
  failResourceRefresh,
  removeResource,
  upsertResource,
} from './resource-cache-entry'

export interface ProjectAssetCacheEntry {
  items: ManagedAsset[]
  loading: boolean
  error: string | null
  generation: number
}

type ByKind = Partial<Record<ManagedAssetKind, ProjectAssetCacheEntry>>

interface ProjectAssetCacheStore {
  byGame: Record<string, ByKind | undefined>
  ensure: (gameId: string, kind: ManagedAssetKind, client: AssetLibraryClient) => Promise<void>
  refresh: (gameId: string, kind: ManagedAssetKind, client: AssetLibraryClient) => Promise<void>
  upsert: (gameId: string, asset: ManagedAsset) => void
  remove: (gameId: string, kind: ManagedAssetKind, assetId: string) => void
}

export const EMPTY_ASSET_CACHE_ENTRY: ProjectAssetCacheEntry = {
  items: [],
  loading: false,
  error: null,
  generation: 0,
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '资产操作失败'
}

function entry(
  state: ProjectAssetCacheStore,
  gameId: string,
  kind: ManagedAssetKind,
): ProjectAssetCacheEntry {
  return state.byGame[gameId]?.[kind] ?? EMPTY_ASSET_CACHE_ENTRY
}

export const useProjectAssetCache = create<ProjectAssetCacheStore>((set, get) => ({
  byGame: {},

  async ensure(gameId, kind, client) {
    if (get().byGame[gameId]?.[kind]) return
    await get().refresh(gameId, kind, client)
  },

  async refresh(gameId, kind, client) {
    const current = entry(get(), gameId, kind)
    const pending = beginResourceRefresh(current)
    const { generation } = pending
    set((state) => ({
      byGame: {
        ...state.byGame,
        [gameId]: {
          ...state.byGame[gameId],
          [kind]: pending.entry,
        },
      },
    }))
    try {
      const items = await client.list(gameId, kind)
      if (entry(get(), gameId, kind).generation !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          [gameId]: {
            ...state.byGame[gameId],
            [kind]: completeResourceRefresh(current, items, generation),
          },
        },
      }))
    } catch (cause) {
      if (entry(get(), gameId, kind).generation !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          [gameId]: {
            ...state.byGame[gameId],
            [kind]: failResourceRefresh(current, message(cause), generation),
          },
        },
      }))
    }
  },

  upsert(gameId, asset) {
    const current = entry(get(), gameId, asset.kind)
    const items = upsertResource(current.items, asset, (item) => item.id, 'prepend')
    set((state) => ({
      byGame: {
        ...state.byGame,
        [gameId]: {
          ...state.byGame[gameId],
          [asset.kind]: { ...current, items, error: null, generation: current.generation + 1 },
        },
      },
    }))
  },

  remove(gameId, kind, assetId) {
    const current = entry(get(), gameId, kind)
    set((state) => ({
      byGame: {
        ...state.byGame,
        [gameId]: {
          ...state.byGame[gameId],
          [kind]: {
            ...current,
            items: removeResource(current.items, assetId, (item) => item.id),
            error: null,
            generation: current.generation + 1,
          },
        },
      },
    }))
  },
}))

/** 资产消费者的共享读取入口；首次挂载只拉自己需要的资产类型。 */
export function useProjectAssets(
  gameId: string,
  kind: ManagedAssetKind,
  client: AssetLibraryClient | undefined,
  enabled = true,
): ProjectAssetCacheEntry {
  const cacheEntry = useProjectAssetCache((state) => state.byGame[gameId]?.[kind])
  const ensure = useProjectAssetCache((state) => state.ensure)

  useEffect(() => {
    if (enabled && client) void ensure(gameId, kind, client)
  }, [client, enabled, ensure, gameId, kind])

  return cacheEntry ?? EMPTY_ASSET_CACHE_ENTRY
}
