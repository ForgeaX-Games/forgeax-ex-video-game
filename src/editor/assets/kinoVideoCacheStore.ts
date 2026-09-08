import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import {
  createKinoVideoClient,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'
import { listAllKinoResources } from './kino-resource-pagination'
import {
  beginResourceRefresh,
  completeResourceRefresh,
  failResourceRefresh,
  removeResource,
  upsertResource,
} from './resource-cache-entry'

export interface KinoVideoCacheEntry {
  items: KinoResourceDTO[]
  total: number
  loading: boolean
  error: string | null
  generation: number
}

export interface KinoVideoResources extends KinoVideoCacheEntry {
  refresh: () => Promise<void>
}

interface KinoVideoCacheStore {
  byGame: Record<string, KinoVideoCacheEntry | undefined>
  refresh: (gameId: string, client?: KinoVideoClient) => Promise<void>
  ensure: (gameId: string, client?: KinoVideoClient) => Promise<void>
  upsert: (gameId: string, item: KinoResourceDTO) => void
  remove: (gameId: string, resourceId: string) => void
}

type KinoVideoCacheMessage =
  | { type: 'upsert', gameId: string, item: KinoResourceDTO }
  | { type: 'remove', gameId: string, resourceId: string }

const CHANNEL = 'game-video:kino-video-cache-sync'
let channel: BroadcastChannel | null = null
let applyingRemote = false

const EMPTY: KinoVideoCacheEntry = {
  items: [],
  total: 0,
  loading: false,
  error: null,
  generation: 0,
}

let defaultClient: KinoVideoClient | undefined

function clientOf(client?: KinoVideoClient): KinoVideoClient {
  defaultClient ??= createKinoVideoClient()
  return client ?? defaultClient
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to load Kino videos'
}

export const useKinoVideoCache = create<KinoVideoCacheStore>((set, get) => ({
  byGame: {},

  async refresh(gameId, client) {
    const current = get().byGame[gameId] ?? EMPTY
    const pending = beginResourceRefresh(current)
    const { generation } = pending
    set((state) => ({
      byGame: {
        ...state.byGame,
        [gameId]: pending.entry,
      },
    }))
    try {
      const kino = clientOf(client)
      const { items, total } = await listAllKinoResources(kino, {
        game_id: gameId,
        media_type: 'video',
      }, {
        // Cached or misrouted responses are not guaranteed to be type-pure.
        accept: (item) => item.media_type === 'video',
      })
      if ((get().byGame[gameId]?.generation ?? 0) !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
          [gameId]: completeResourceRefresh(current, items, generation, { total }),
        },
      }))
    } catch (error) {
      if ((get().byGame[gameId]?.generation ?? 0) !== generation) return
      set((state) => ({
        byGame: {
          ...state.byGame,
        [gameId]: failResourceRefresh(state.byGame[gameId] ?? EMPTY, message(error), generation),
        },
      }))
    }
  },

  async ensure(gameId, client) {
    if (get().byGame[gameId]) return
    await get().refresh(gameId, client)
  },

  upsert(gameId, item) {
    set((state) => {
      const cache = state.byGame[gameId] ?? EMPTY
      const existing = cache.items.some((entry) => entry.resource_id === item.resource_id)
      const items = upsertResource(cache.items, item, (entry) => entry.resource_id)
      return {
        byGame: {
          ...state.byGame,
          [gameId]: { ...cache, items, total: existing ? cache.total : cache.total + 1 },
        },
      }
    })
    if (!applyingRemote) channel?.postMessage({ type: 'upsert', gameId, item } satisfies KinoVideoCacheMessage)
  },

  remove(gameId, resourceId) {
    set((state) => {
      const cache = state.byGame[gameId] ?? EMPTY
      const items = removeResource(cache.items, resourceId, (item) => item.resource_id)
      return {
        byGame: {
          ...state.byGame,
          [gameId]: { ...cache, items, total: Math.min(cache.total, items.length) },
        },
      }
    })
    if (!applyingRemote) channel?.postMessage({ type: 'remove', gameId, resourceId } satisfies KinoVideoCacheMessage)
  },
}))

function validMessage(value: unknown): value is KinoVideoCacheMessage {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<KinoVideoCacheMessage> & { item?: Partial<KinoResourceDTO> }
  if (typeof candidate.gameId !== 'string' || candidate.gameId.length === 0) return false
  if (candidate.type === 'remove') {
    return typeof candidate.resourceId === 'string' && candidate.resourceId.length > 0
  }
  return candidate.type === 'upsert'
    && candidate.item?.game_id === candidate.gameId
    && candidate.item.media_type === 'video'
    && typeof candidate.item.resource_id === 'string'
    && candidate.item.resource_id.length > 0
}

/** Keeps the left and center Extension panes on the same canonical video list. */
export function installKinoVideoCacheSync(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    if (!validMessage(event.data)) return
    applyingRemote = true
    try {
      if (event.data.type === 'upsert') {
        useKinoVideoCache.getState().upsert(event.data.gameId, event.data.item)
      } else {
        useKinoVideoCache.getState().remove(event.data.gameId, event.data.resourceId)
      }
    } finally {
      applyingRemote = false
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}

/**
 * Project-scoped Kino resource consumer. It owns initial cache hydration so
 * editor surfaces only consume resource state; call `refresh()` to re-pull.
 */
export function useKinoVideoResources(gameId: string, enabled = true): KinoVideoResources {
  const entry = useKinoVideoCache((state) => state.byGame[gameId])
  const ensure = useKinoVideoCache((state) => state.ensure)
  const refreshCache = useKinoVideoCache((state) => state.refresh)

  useEffect(() => {
    if (!enabled) return
    void ensure(gameId)
  }, [enabled, ensure, gameId])

  const refresh = useCallback(() => refreshCache(gameId), [gameId, refreshCache])
  return { ...(entry ?? EMPTY), refresh }
}
