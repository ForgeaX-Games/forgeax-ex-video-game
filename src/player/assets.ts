import type { ResolveAsset } from '@/runtime/react/play'
import type { RuntimeAssetManifest } from './package'

const PLAYABLE_LOCATOR = /^(?:https?:|blob:|data:|\/)/

export function createAssetResolver(manifest: RuntimeAssetManifest): ResolveAsset {
  const assets = new Map(manifest.assets.map((asset) => [asset.id, asset]))
  const audioEntities = manifest.assetCatalog?.entities.audio ?? {}

  return (mediaId) => {
    if (!mediaId) return undefined
    if (PLAYABLE_LOCATOR.test(mediaId)) return mediaId
    const audioAssetId = audioEntities[mediaId]?.current?.assetId
    const asset = assets.get(audioAssetId ?? mediaId)
    if (!asset) return undefined
    if (!audioAssetId && asset.kind === 'audio') return undefined
    return asset.url && PLAYABLE_LOCATOR.test(asset.url) ? asset.url : undefined
  }
}
