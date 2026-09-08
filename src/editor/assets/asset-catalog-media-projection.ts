import type { AssetCatalog, CatalogAsset } from './asset-catalog-model'

type HostMediaMeta = {
  assetId?: unknown
  provenance?: unknown
}

function hostMediaAssetId(asset: CatalogAsset): string | undefined {
  if (asset.provider?.kind !== 'local' || typeof asset.provider.ref !== 'string') return undefined
  const hostMedia = asset.meta?.hostMedia as HostMediaMeta | undefined
  if (
    hostMedia?.provenance !== 'extension-media-capability'
    || typeof hostMedia.assetId !== 'string'
    || hostMedia.assetId !== asset.provider.ref
  ) return undefined
  return hostMedia.assetId
}

/**
 * Projects stable Host media ids to URLs for the current handshake/runtime.
 * This is a read-only browser projection; persisted Catalog state remains server-owned.
 */
export function projectAssetCatalogMediaUrls(
  catalog: AssetCatalog,
  resolveHostMediaUrl: (assetId: string) => string,
): AssetCatalog {
  let changed = false
  const assets = Object.fromEntries(Object.entries(catalog.assets).map(([id, asset]) => {
    const mediaAssetId = hostMediaAssetId(asset)
    if (!mediaAssetId) return [id, asset]
    const url = resolveHostMediaUrl(mediaAssetId)
    if (url === asset.url) return [id, asset]
    changed = true
    return [id, { ...asset, url }]
  }))
  return changed ? { ...catalog, assets } : catalog
}
