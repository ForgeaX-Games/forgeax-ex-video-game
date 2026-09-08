import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { t } from '../../i18n'
import {
  useVideoGenerationStore,
  videoGenerationStoreGamePrefix,
} from './generation/videoGenerationStore'
import {
  createKinoVideoClient,
  KinoClientError,
  MAX_KINO_RESOURCE_PAGE_SIZE,
  type KinoResourceDTO,
  type KinoVideoClient,
} from './kino-api'
import { useKinoVideoCache, useKinoVideoResources } from './kinoVideoCacheStore'
import { VideoUploadError } from './video-upload'
import {
  appendVideoRevision,
  toVideoAssetListItem,
  type VideoAssetListItem,
} from './kino-resource-projections'

export const DEFAULT_VIDEO_PAGE_SIZE = 20

export type { VideoAssetListItem } from './kino-resource-projections'

export interface UseVideoAssetsOptions {
  client?: KinoVideoClient
  initialPage?: number
  pageSize?: number
}

export interface VideoAssetRequestLifecycle {
  mountedRef: MutableRefObject<boolean>
  abortRef: MutableRefObject<AbortController | null>
}

export interface VideoAssetSource {
  client: KinoVideoClient
  lifecycle: VideoAssetRequestLifecycle
  items: VideoAssetListItem[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: string | null
  shared: boolean
  refresh(): Promise<void>
  loadPage(page: number): Promise<void>
  loadMore(): Promise<void>
  setError(error: string | null): void
  replaceLocal(resourceId: string, resource: KinoResourceDTO): void
  prependLocal(resource: KinoResourceDTO): void
  removeLocal(resourceIds: readonly string[]): void
  upsertShared(resource: KinoResourceDTO, replacementResourceId?: string): void
  removeShared(resourceId: string): void
}

export function safeVideoAssetError(error: unknown): string {
  if (error instanceof KinoClientError || error instanceof VideoUploadError) return error.message
  if (error instanceof Error) return error.message
  return t('videoAssets.unexpectedError')
}

export { appendVideoRevision } from './kino-resource-projections'

function mergeUniqueItems(
  existing: VideoAssetListItem[],
  incoming: VideoAssetListItem[],
): VideoAssetListItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()]
}

export function useVideoAssetSource(
  gameId: string,
  options: UseVideoAssetsOptions,
): VideoAssetSource {
  const hasGameId = gameId.trim().length > 0
  const pageSize = Math.min(options.pageSize ?? DEFAULT_VIDEO_PAGE_SIZE, MAX_KINO_RESOURCE_PAGE_SIZE)
  const initialPage = options.initialPage ?? 1
  const client = useMemo(() => options.client ?? createKinoVideoClient(), [options.client])
  const cacheUpsert = useKinoVideoCache((state) => state.upsert)
  const cacheRemove = useKinoVideoCache((state) => state.remove)
  const kinoResources = useKinoVideoResources(gameId, !options.client && hasGameId)
  const generationCompletionRevision = useVideoGenerationStore(
    (state) => Object.entries(state.byScope)
      .filter(([key]) => key.startsWith(videoGenerationStoreGamePrefix(gameId)))
      .reduce((revision, [, entry]) => revision + (entry?.completionRevision ?? 0), 0),
  )
  const observedCompletionRevision = useRef(generationCompletionRevision)
  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localItems, setLocalItems] = useState<VideoAssetListItem[]>([])
  const [localTotal, setLocalTotal] = useState(0)
  const [page, setPage] = useState(initialPage)
  const listGeneration = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    abortRef.current = new AbortController()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const fetchPage = useCallback(async (targetPage: number, mode: 'replace' | 'append') => {
    if (!hasGameId) {
      setLocalLoading(false)
      return
    }
    const generation = ++listGeneration.current
    setLocalLoading(true)
    setLocalError(null)
    try {
      const result = await client.list({
        game_id: gameId,
        media_type: 'video',
        page: targetPage,
        page_size: pageSize,
      }, { signal: abortRef.current?.signal })
      if (!mountedRef.current || generation !== listGeneration.current) return
      const mapped = result.items
        .filter((dto) => dto.media_type === 'video')
        .map(toVideoAssetListItem)
      setLocalItems((current) => mode === 'append'
        ? mergeUniqueItems(current, mapped)
        : mergeUniqueItems([], mapped))
      setLocalTotal(result.total)
      setPage(result.page)
    } catch (error) {
      if (mountedRef.current && generation === listGeneration.current) {
        setLocalError(safeVideoAssetError(error))
      }
    } finally {
      if (mountedRef.current && generation === listGeneration.current) setLocalLoading(false)
    }
  }, [client, gameId, hasGameId, pageSize])

  const refresh = useCallback(async () => {
    if (options.client) await fetchPage(1, 'replace')
    else await kinoResources.refresh()
  }, [fetchPage, kinoResources, options.client])

  useEffect(() => {
    if (options.client || generationCompletionRevision === observedCompletionRevision.current) return
    observedCompletionRevision.current = generationCompletionRevision
    void kinoResources.refresh()
  }, [generationCompletionRevision, kinoResources, options.client])

  const loadPage = useCallback(async (targetPage: number) => {
    if (options.client) await fetchPage(targetPage, 'replace')
    else setPage(targetPage)
  }, [fetchPage, options.client])

  const items = options.client
    ? localItems
    : kinoResources.items.slice(0, page * pageSize).map(toVideoAssetListItem)
  const total = options.client ? localTotal : kinoResources.total
  const loading = options.client ? localLoading : kinoResources.loading
  const error = options.client ? localError : localError ?? kinoResources.error

  const loadMore = useCallback(async () => {
    if (items.length >= total) return
    if (options.client) await fetchPage(page + 1, 'append')
    else await loadPage(page + 1)
  }, [fetchPage, items.length, loadPage, options.client, page, total])

  useEffect(() => {
    if (options.client) void fetchPage(initialPage, 'replace')
  }, [fetchPage, gameId, initialPage, options.client])

  const replaceLocal = useCallback((resourceId: string, resource: KinoResourceDTO) => {
    const replacement = toVideoAssetListItem({ ...resource, resource_id: resourceId })
    setLocalItems((current) => current.map((item) => item.id === resourceId ? replacement : item))
  }, [])

  const prependLocal = useCallback((resource: KinoResourceDTO) => {
    setLocalItems((current) => mergeUniqueItems([toVideoAssetListItem(resource)], current))
    setLocalTotal((current) => current + 1)
  }, [])

  const removeLocal = useCallback((resourceIds: readonly string[]) => {
    const ids = new Set(resourceIds)
    setLocalItems((current) => current.filter((item) => !ids.has(item.id)))
    setLocalTotal((current) => Math.max(0, current - resourceIds.length))
  }, [])

  const upsertShared = useCallback((resource: KinoResourceDTO, replacementResourceId?: string) => {
    if (options.client) return
    cacheUpsert(
      gameId,
      replacementResourceId ? { ...resource, resource_id: replacementResourceId } : resource,
    )
  }, [cacheUpsert, gameId, options.client])

  const removeShared = useCallback((resourceId: string) => {
    if (!options.client) cacheRemove(gameId, resourceId)
  }, [cacheRemove, gameId, options.client])

  return {
    client,
    lifecycle: { mountedRef, abortRef },
    items,
    total,
    page,
    pageSize,
    loading,
    error,
    shared: !options.client,
    refresh,
    loadPage,
    loadMore,
    setError: setLocalError,
    replaceLocal,
    prependLocal,
    removeLocal,
    upsertShared,
    removeShared,
  }
}
