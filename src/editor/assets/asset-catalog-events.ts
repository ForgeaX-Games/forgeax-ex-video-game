/** Browser event emitted once after a successful catalog mutation. */
export const ASSET_CATALOG_INVALIDATION_EVENT = 'game-video:asset-catalog-invalidated'
export const ASSET_CATALOG_INVALIDATION_CHANNEL = 'game-video:asset-catalog-invalidated:v1'

export function emitAssetCatalogInvalidation(): void {
  window.dispatchEvent(new Event(ASSET_CATALOG_INVALIDATION_EVENT))
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(ASSET_CATALOG_INVALIDATION_CHANNEL)
  channel.postMessage({ type: 'invalidated' })
  channel.close()
}
