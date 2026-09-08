import type { CatalogAssetRef, CatalogEntity, CatalogHistoryItem } from '@/authoring/assets/registry-types'
import {
  CATALOG_ENTITY_KINDS,
  CATALOG_TAB_KINDS,
  EMPTY_ASSET_CATALOG,
  type AssetCatalog,
  type CatalogAsset,
  type CatalogFolder,
  type CatalogPlacement,
  type CatalogTimestamps,
  type CatalogTabKind,
} from './asset-catalog-model'
import { isCatalogRootTarget, parseCatalogPlacementKey } from './asset-catalog-selectors'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function timestamps(value: Record<string, unknown>): CatalogTimestamps | null {
  return typeof value.createdAt === 'number' && typeof value.updatedAt === 'number'
    ? { createdAt: value.createdAt, updatedAt: value.updatedAt }
    : null
}

function parseFolder(value: unknown): CatalogFolder | null {
  if (!isRecord(value)) return null
  const time = timestamps(value)
  const tabKind = value.tabKind as CatalogTabKind
  if (
    !time
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.sortKey !== 'string'
    || !CATALOG_TAB_KINDS.includes(tabKind)
    || !(value.parentId === null || typeof value.parentId === 'string')
  ) return null
  return {
    id: value.id,
    parentId: (value.parentId as string | null) ?? null,
    tabKind,
    name: value.name,
    sortKey: value.sortKey,
    ...time,
  }
}

function parsePlacement(value: unknown): CatalogPlacement | null {
  if (!isRecord(value)) return null
  const time = timestamps(value)
  if (!time || typeof value.folderId !== 'string' || typeof value.sortKey !== 'string') return null
  if (isCatalogRootTarget(value.folderId)) return null
  return { folderId: value.folderId, sortKey: value.sortKey, ...time }
}

function parseAssetRef(value: unknown): CatalogAssetRef | null {
  if (!isRecord(value) || typeof value.assetId !== 'string' || !value.assetId) return null
  return { assetId: value.assetId }
}

function parseEntity(value: unknown): CatalogEntity | null {
  if (!isRecord(value)) return null
  const time = timestamps(value)
  const current = parseAssetRef(value.current)
  if (!time || typeof value.id !== 'string' || typeof value.name !== 'string') return null
  const history = Array.isArray(value.history)
    ? value.history.flatMap((item) => {
      const ref = parseAssetRef(item)
      if (!ref || !isRecord(item) || typeof item.appliedAt !== 'number') return []
      return [{
        ...ref,
        appliedAt: item.appliedAt,
        ...(typeof item.source === 'string' ? { source: item.source as CatalogHistoryItem['source'] } : {}),
        ...(typeof item.note === 'string' ? { note: item.note } : {}),
      }]
    })
    : []
  return {
    id: value.id,
    name: value.name,
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof value.entityId === 'string' ? { entityId: value.entityId } : {}),
    ...(current ? { current } : {}),
    history,
    ...time,
  }
}

function parseAsset(value: unknown): CatalogAsset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.kind !== 'string') return null
  const meta = isRecord(value.meta) ? value.meta : {}
  const hostMedia = isRecord(meta.hostMedia) ? meta.hostMedia : {}
  const provider = isRecord(value.provider) ? value.provider : {}
  const resourceId = typeof provider.upstreamResourceId === 'string'
    ? provider.upstreamResourceId
    : typeof provider.resourceId === 'string'
      ? provider.resourceId
      : typeof meta.kinoResourceId === 'string' ? meta.kinoResourceId : undefined
  const url = typeof value.url === 'string'
    ? value.url
    : typeof hostMedia.locator === 'string' ? hostMedia.locator : undefined
  return {
    id: value.id,
    kind: value.kind,
    name: typeof value.label === 'string' && value.label
      ? value.label
      : typeof value.name === 'string' && value.name ? value.name : value.id,
    ...(url ? { url } : {}),
    ...(typeof value.mime === 'string' ? { mime: value.mime } : {}),
    ...(typeof value.bytes === 'number' ? { bytes: value.bytes } : {}),
    ...(typeof value.productionType === 'string' ? { productionType: value.productionType } : {}),
    ...(typeof value.prompt === 'string' ? { prompt: value.prompt } : {}),
    ...(typeof meta.kinoGenerationId === 'string' ? { generationId: meta.kinoGenerationId } : {}),
    ...(typeof value.createdAt === 'number' ? { createdAt: value.createdAt } : {}),
    ...(typeof value.updatedAt === 'number' ? { updatedAt: value.updatedAt } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.externalPath === 'string' ? { externalPath: value.externalPath } : {}),
    ...(Object.keys(provider).length > 0 ? {
      provider: {
        ...(typeof provider.kind === 'string' ? { kind: provider.kind } : {}),
        ...(typeof provider.ref === 'string' ? { ref: provider.ref } : {}),
        ...(typeof provider.upstreamResourceId === 'string'
          ? { upstreamResourceId: provider.upstreamResourceId }
          : {}),
      },
    } : {}),
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
    ...(isRecord(value.provenance) ? {
      provenance: {
        ...(isRecord(value.provenance.recipe) && isRecord(value.provenance.recipe.parameters)
          ? { recipe: { parameters: value.provenance.recipe.parameters } }
          : {}),
      },
    } : {}),
  }
}

export function parseCatalogAssets(value: unknown): Record<string, CatalogAsset> {
  if (!Array.isArray(value)) return {}
  return Object.fromEntries(value.flatMap((asset) => {
    const parsed = parseAsset(asset)
    return parsed ? [[parsed.id, parsed] as const] : []
  }))
}

export function parseAssetCatalog(manifest: unknown): AssetCatalog | null {
  if (!isRecord(manifest)) return null
  const value = manifest.assetCatalog
  if (!isRecord(value) || value.version !== 1) return null
  const rawEntities = isRecord(value.entities) ? value.entities : {}
  const rawPlacements = isRecord(value.placements) ? value.placements : {}

  const entities = { ...EMPTY_ASSET_CATALOG.entities }
  for (const entityKind of CATALOG_ENTITY_KINDS) {
    const table = rawEntities[entityKind]
    entities[entityKind] = isRecord(table)
      ? Object.fromEntries(Object.entries(table).flatMap(([id, entity]) => {
        const parsed = parseEntity(entity)
        return parsed ? [[id, parsed] as const] : []
      }))
      : {}
  }

  return {
    version: 1,
    folders: Array.isArray(value.folders)
      ? value.folders.flatMap((folder) => {
        const parsed = parseFolder(folder)
        return parsed ? [parsed] : []
      })
      : [],
    placements: Object.fromEntries(Object.entries(rawPlacements).flatMap(([key, placement]) => {
      const parsed = parsePlacement(placement)
      return parsed && parseCatalogPlacementKey(key) ? [[key, parsed] as const] : []
    })),
    entities,
    assets: parseCatalogAssets(manifest.assets),
  }
}

export function parseAssetCatalogResponse(value: unknown): AssetCatalog | null {
  if (!isRecord(value)) return null
  const rawCatalog = value.catalog ?? value
  const direct = parseAssetCatalog(rawCatalog)
  if (direct) return direct
  if (!isRecord(rawCatalog)) return null
  return parseAssetCatalog({
    assets: Array.isArray(value.assets) ? value.assets : rawCatalog.assets,
    assetCatalog: rawCatalog.assetCatalog ?? rawCatalog,
  })
}
