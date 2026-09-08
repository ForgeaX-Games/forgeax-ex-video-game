import {
  CATALOG_ENTITY_KINDS,
  type AssetCatalog,
  type CatalogAsset,
} from '../asset-catalog'
import type {
  PromptMentionAsset,
  PromptMentionAssetCategory,
} from './PromptMentionEditor'

function catalogAssetCategory(asset: CatalogAsset): PromptMentionAssetCategory | null {
  if (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'audio' || asset.kind === 'font') return asset.kind
  return null
}

/** Build the shared @-mention catalog used by both image and video generation. */
export function catalogPromptMentionAssets(catalog: AssetCatalog): PromptMentionAsset[] {
  const businessContext = new Map<string, { category: PromptMentionAssetCategory, label: string }>()
  for (const kind of CATALOG_ENTITY_KINDS) {
    for (const entity of Object.values(catalog.entities[kind])) {
      if (entity.current) {
        businessContext.set(entity.current.assetId, { category: kind, label: entity.name })
      }
      for (const history of entity.history) {
        if (!businessContext.has(history.assetId)) businessContext.set(history.assetId, { category: kind, label: entity.name })
      }
    }
  }
  return Object.values(catalog.assets)
    .flatMap((asset): PromptMentionAsset[] => {
      const context = businessContext.get(asset.id)
      const category = context?.category ?? catalogAssetCategory(asset)
      if (!category) return []
      const resourceId = asset.status && asset.status !== 'ready' ? undefined : nonEmptyString(asset.resourceId)
      const thumbUrl = stringMeta(asset.meta, 'posterUrl')
        ?? stringMeta(asset.meta, 'thumbnailUrl')
        ?? (asset.kind === 'image' ? asset.url : undefined)
      return [{
        id: asset.id,
        ...(resourceId ? { resourceId } : {}),
        label: context?.label ?? asset.name,
        category,
        ...(thumbUrl ? { thumbUrl } : {}),
        ...(asset.url ? { mediaUrl: asset.url } : {}),
        ...(asset.prompt ? { prompt: asset.prompt } : {}),
      }]
    })
    .sort((left, right) => (catalog.assets[right.id]?.updatedAt ?? 0) - (catalog.assets[left.id]?.updatedAt ?? 0))
}

function stringMeta(meta: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' ? value : undefined
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
