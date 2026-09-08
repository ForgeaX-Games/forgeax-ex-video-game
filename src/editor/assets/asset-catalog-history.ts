import { useCallback, useEffect, useRef, useState } from 'react'
import { assetCatalogClient } from './asset-catalog-client'
import {
  ASSET_CATALOG_INVALIDATION_CHANNEL,
  ASSET_CATALOG_INVALIDATION_EVENT,
} from './asset-catalog-events'
import {
  EMPTY_ASSET_CATALOG,
  type AssetCatalog,
  type CatalogEntityKind,
} from './asset-catalog-model'

export interface AssetCatalogHistoryController {
  catalog: AssetCatalog
  loading: boolean
  error: string | null
  refresh(): Promise<void>
}

/** Loads version history only after an entity-owned generation surface is opened. */
export function useAssetCatalogHistory(
  tabKind: CatalogEntityKind | undefined,
  entityId: string | undefined,
): AssetCatalogHistoryController {
  const [catalog, setCatalog] = useState<AssetCatalog>(EMPTY_ASSET_CATALOG)
  const [loading, setLoading] = useState(Boolean(tabKind && entityId))
  const [error, setError] = useState<string | null>(null)
  const requestEpoch = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const epoch = ++requestEpoch.current
    if (!tabKind || !entityId) {
      setCatalog(EMPTY_ASSET_CATALOG)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await assetCatalogClient.readHistory({ tabKind, entityId })
      if (epoch === requestEpoch.current) setCatalog(result.catalog)
    } catch (cause) {
      if (epoch !== requestEpoch.current) return
      setCatalog(EMPTY_ASSET_CATALOG)
      setError(cause instanceof Error ? cause.message : '资产历史加载失败')
    } finally {
      if (epoch === requestEpoch.current) setLoading(false)
    }
  }, [entityId, tabKind])

  useEffect(() => {
    void refresh()
    return () => { requestEpoch.current += 1 }
  }, [refresh])

  useEffect(() => {
    if (!tabKind || !entityId) return
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
  }, [entityId, refresh, tabKind])

  return { catalog, loading, error, refresh }
}
