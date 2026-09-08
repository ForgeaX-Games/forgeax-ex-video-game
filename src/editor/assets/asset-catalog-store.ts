import { useCallback, useEffect, useRef, useState } from 'react'
import { pluginFetch, pluginUrl } from '../../lib/plugin-http'
import { parseAssetCatalogResponse } from './asset-catalog-codec'
import { projectAssetCatalogMediaUrls } from './asset-catalog-media-projection'
import {
  ASSET_CATALOG_INVALIDATION_CHANNEL,
  ASSET_CATALOG_INVALIDATION_EVENT,
} from './asset-catalog-events'
import { EMPTY_ASSET_CATALOG, type AssetCatalog } from './asset-catalog-model'

const catalogSnapshots = new Map<string, AssetCatalog>()

export function rememberAssetCatalog(gameId: string, catalog: AssetCatalog): void {
  if (gameId.trim()) catalogSnapshots.set(gameId, catalog)
}

export function getAssetCatalogSnapshot(gameId: string): AssetCatalog | undefined {
  return catalogSnapshots.get(gameId)
}

export async function fetchAssetCatalog(): Promise<AssetCatalog> {
  const response = await pluginFetch('asset-catalog')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const catalog = parseAssetCatalogResponse(await response.json()) ?? EMPTY_ASSET_CATALOG
  return projectAssetCatalogMediaUrls(
    catalog,
    (assetId) => pluginUrl(`media/assets/${encodeURIComponent(assetId)}`),
  )
}

export interface AssetCatalogController {
  catalog: AssetCatalog
  loading: boolean
  error: string | null
  refresh(): Promise<void>
}

export function useAssetCatalog(
  gameId: string,
  load: () => Promise<AssetCatalog> = fetchAssetCatalog,
): AssetCatalogController {
  const [catalog, setCatalog] = useState<AssetCatalog>(EMPTY_ASSET_CATALOG)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestEpoch = useRef(0)

  const refresh = useCallback(async () => {
    const epoch = ++requestEpoch.current
    setLoading(true)
    setError(null)
    try {
      const next = await load()
      if (epoch !== requestEpoch.current) return
      setCatalog(next)
      rememberAssetCatalog(gameId, next)
    } catch (cause) {
      if (epoch !== requestEpoch.current) return
      setCatalog(EMPTY_ASSET_CATALOG)
      rememberAssetCatalog(gameId, EMPTY_ASSET_CATALOG)
      setError(cause instanceof Error ? cause.message : '资产库加载失败')
    } finally {
      if (epoch === requestEpoch.current) setLoading(false)
    }
  }, [load, gameId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onInvalidated = (): void => { void refresh() }
    window.addEventListener(ASSET_CATALOG_INVALIDATION_EVENT, onInvalidated)
    const channel = typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(ASSET_CATALOG_INVALIDATION_CHANNEL)
    if (channel) channel.onmessage = onInvalidated
    return () => {
      window.removeEventListener(ASSET_CATALOG_INVALIDATION_EVENT, onInvalidated)
      channel?.close()
    }
  }, [refresh])

  return { catalog, loading, error, refresh }
}
