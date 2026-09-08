import type { AssetCatalog, CatalogAsset, CatalogEntityKind } from '../asset-catalog'
import type { ImageGenerationAsset } from './ImageGenerationSurface'

export interface ScopedImageGenerationAssets {
  historyAssets: ImageGenerationAsset[]
}

/**
 * Business image pages are scoped by their catalog entity.  Entity
 * current/history owns the output lineage. Prompt mentions are sourced from
 * the full catalog separately, just like video generation.
 */
export function imageGenerationAssetsFromManifest(
  catalog: AssetCatalog,
  targetRoot: CatalogEntityKind | 'image',
  entityId?: string,
  initialAssetId?: string,
): ScopedImageGenerationAssets {
  const allImages = Object.values(catalog.assets)
    .filter((asset) => asset.kind === 'image')
    .map(toImageGenerationAsset)
  const scoped = targetRoot !== 'image' || Boolean(entityId || initialAssetId)
  if (!scoped) return { historyAssets: [] }

  const entity = targetRoot === 'image' || !entityId
    ? undefined
    : catalog.entities[targetRoot][entityId]
  const historyIds = new Set([
    ...(initialAssetId ? [initialAssetId] : []),
    ...(entity?.current?.assetId ? [entity.current.assetId] : []),
    ...[...(entity?.history ?? [])]
      .sort((left, right) => right.appliedAt - left.appliedAt)
      .map((item) => item.assetId),
  ])
  const historyAssets = allImages.filter((asset) => historyIds.has(asset.id))

  return { historyAssets }
}

function toImageGenerationAsset(asset: CatalogAsset): ImageGenerationAsset {
  return {
    id: asset.id,
    ...(asset.resourceId ? { resourceId: asset.resourceId } : {}),
    ...(asset.generationId ? { generationId: asset.generationId } : {}),
    label: asset.name,
    ...(asset.url ? { url: asset.url } : {}),
    ...(asset.prompt ? { prompt: asset.prompt } : {}),
    ...(typeof asset.meta?.kinoModel === 'string' ? { model: asset.meta.kinoModel } : {}),
    ...(asset.provenance?.recipe?.parameters ? { params: asset.provenance.recipe.parameters } : {}),
    ...(asset.createdAt !== undefined ? { createdAt: asset.createdAt } : {}),
    ...(asset.updatedAt !== undefined ? { updatedAt: asset.updatedAt } : {}),
    status: imageHistoryStatus(asset.status),
  }
}

function imageHistoryStatus(status: string | undefined): ImageGenerationAsset['status'] {
  if (status === 'generating' || status === 'placeholder') return 'polling'
  if (status === 'failed') return 'failed'
  return 'succeeded'
}
