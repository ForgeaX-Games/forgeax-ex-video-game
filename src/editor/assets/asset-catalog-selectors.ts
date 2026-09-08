import type { CatalogAssetRef, CatalogEntity } from '@/authoring/assets/registry-types'
import {
  CATALOG_ROOT_TARGET,
  CATALOG_TAB_KINDS,
  type AssetCatalog,
  type CatalogAsset,
  type CatalogFolder,
  type CatalogPlacement,
  type CatalogPlacementTarget,
  type CatalogSelection,
  type CatalogTabKind,
} from './asset-catalog-model'

export function catalogRootTarget(tabKind: CatalogTabKind): CatalogPlacementTarget {
  return `root:${tabKind}`
}

export function isCatalogRootTarget(target: string): target is typeof CATALOG_ROOT_TARGET {
  return target === CATALOG_ROOT_TARGET
}

export function parseCatalogTabRoot(target: string): CatalogTabKind | null {
  if (!target.startsWith('root:')) return null
  const tabKind = target.slice('root:'.length) as CatalogTabKind
  return CATALOG_TAB_KINDS.includes(tabKind) ? tabKind : null
}

export function isCatalogTabRootTarget(target: string): boolean {
  return parseCatalogTabRoot(target) !== null
}

export function catalogPlacementKey(tabKind: CatalogTabKind, itemId: string): string {
  return `${tabKind}:${itemId}`
}

export interface CatalogItemLocation {
  tabKind: CatalogTabKind
  itemId: string
  placementKey: string
  target: CatalogPlacementTarget
}

export function resolveCatalogItemLocation(
  catalog: AssetCatalog,
  input: { tabKind?: CatalogTabKind; itemId: string },
): CatalogItemLocation | undefined {
  const itemId = input.itemId.trim()
  if (!itemId) return undefined
  const tabKinds = input.tabKind ? [input.tabKind] : CATALOG_TAB_KINDS
  for (const tabKind of tabKinds) {
    const placementKey = catalogPlacementKey(tabKind, itemId)
    const placement = catalog.placements[placementKey]
    if (placement) return { tabKind, itemId, placementKey, target: placement.folderId }
  }

  const asset = Object.values(catalog.assets).find(
    (candidate) => candidate.id === itemId || candidate.resourceId === itemId,
  )
  if (!asset) return undefined
  const directAsset = catalog.placements[catalogPlacementKey('image', asset.id)]
  if (directAsset && (!input.tabKind || input.tabKind === 'image')) {
    return {
      tabKind: 'image',
      itemId: asset.id,
      placementKey: catalogPlacementKey('image', asset.id),
      target: directAsset.folderId,
    }
  }

  for (const tabKind of tabKinds) {
    if (tabKind === 'image') continue
    for (const entity of Object.values(catalog.entities[tabKind] ?? {})) {
      if (entity.current?.assetId !== asset.id) continue
      const placementKey = catalogPlacementKey(tabKind, entity.id)
      const placement = catalog.placements[placementKey]
      if (placement) return { tabKind, itemId: entity.id, placementKey, target: placement.folderId }
    }
  }
  for (const tabKind of tabKinds) {
    if (tabKind === 'image') continue
    for (const entity of Object.values(catalog.entities[tabKind] ?? {})) {
      if (!entity.history.some((entry) => entry.assetId === asset.id)) continue
      const placementKey = catalogPlacementKey(tabKind, entity.id)
      const placement = catalog.placements[placementKey]
      if (placement) return { tabKind, itemId: entity.id, placementKey, target: placement.folderId }
    }
  }
  return undefined
}

export function parseCatalogPlacementKey(
  key: string,
): { tabKind: CatalogTabKind, itemId: string } | null {
  const separator = key.indexOf(':')
  if (separator <= 0) return null
  const tabKind = key.slice(0, separator) as CatalogTabKind
  const itemId = key.slice(separator + 1)
  if (!itemId || !CATALOG_TAB_KINDS.includes(tabKind)) return null
  return { tabKind, itemId }
}

function compareBySortKey(
  left: { sortKey: string, name: string },
  right: { sortKey: string, name: string },
): number {
  const bySortKey = left.sortKey.localeCompare(right.sortKey)
  return bySortKey !== 0 ? bySortKey : left.name.localeCompare(right.name, 'zh-CN')
}

export function catalogFolderChildren(
  catalog: AssetCatalog,
  target: CatalogPlacementTarget,
  tabKind: CatalogTabKind,
): CatalogFolder[] {
  const parentId = target === catalogRootTarget(tabKind) ? null : target
  return catalog.folders
    .filter((folder) => folder.tabKind === tabKind && folder.parentId === parentId)
    .sort(compareBySortKey)
}

export interface CatalogItemRow {
  placementKey: string
  tabKind: CatalogTabKind
  itemId: string
  name: string
  placement: CatalogPlacement
  entity: CatalogEntity | null
  asset: CatalogAsset | null
  pendingAsset: CatalogAsset | null
}

function catalogGenerationScope(asset: CatalogAsset): Record<string, unknown> | undefined {
  const generation = asset.meta?.catalogGeneration
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) return undefined
  const scope = (generation as Record<string, unknown>).scope
  return scope && typeof scope === 'object' && !Array.isArray(scope)
    ? scope as Record<string, unknown>
    : undefined
}

function pendingEntityAsset(
  catalog: AssetCatalog,
  tabKind: CatalogTabKind,
  entityId: string,
): CatalogAsset | null {
  if (tabKind === 'image') return null
  return Object.values(catalog.assets)
    .filter((asset) => {
      if (asset.status !== 'generating' && asset.status !== 'placeholder') return false
      const scope = catalogGenerationScope(asset)
      return scope?.targetRoot === tabKind && scope.entityId === entityId
    })
    .sort((left, right) => (right.createdAt ?? right.updatedAt ?? 0) - (left.createdAt ?? left.updatedAt ?? 0))[0]
    ?? null
}

export function catalogItemsIn(
  catalog: AssetCatalog,
  target: CatalogPlacementTarget,
  tabKind: CatalogTabKind,
): CatalogItemRow[] {
  const placed = Object.entries(catalog.placements)
    .flatMap(([placementKey, placement]): CatalogItemRow[] => {
      if (placement.folderId !== target) return []
      const parsed = parseCatalogPlacementKey(placementKey)
      if (!parsed || parsed.tabKind !== tabKind) return []
      if (tabKind === 'image') {
        const asset = catalog.assets[parsed.itemId]
        if (!asset || asset.kind !== 'image') return []
        return [{ placementKey, tabKind, itemId: parsed.itemId, name: asset.name, placement, entity: null, asset, pendingAsset: null }]
      }
      const entity = catalog.entities[tabKind]?.[parsed.itemId]
      if (!entity) return []
      return [{
        placementKey,
        tabKind,
        itemId: parsed.itemId,
        name: entity.name,
        placement,
        entity,
        asset: entity.current ? catalog.assets[entity.current.assetId] ?? null : null,
        pendingAsset: pendingEntityAsset(catalog, tabKind, entity.id),
      }]
    })
  const unplacedImages = tabKind === 'image' && target === catalogRootTarget('image')
    ? Object.values(catalog.assets)
      .filter((asset) => {
        if (asset.kind !== 'image' || catalog.placements[catalogPlacementKey('image', asset.id)]) return false
        const generationTarget = catalogGenerationScope(asset)?.targetRoot
        return generationTarget === undefined || generationTarget === 'image'
      })
      .map((asset): CatalogItemRow => ({
        placementKey: catalogPlacementKey('image', asset.id),
        tabKind: 'image',
        itemId: asset.id,
        name: asset.name,
        placement: {
          folderId: catalogRootTarget('image'),
          sortKey: asset.name,
          createdAt: asset.createdAt ?? 0,
          updatedAt: asset.updatedAt ?? 0,
        },
        entity: null,
        asset,
        pendingAsset: null,
      }))
    : []
  return [...placed, ...unplacedImages].sort((left, right) => compareBySortKey(
    { sortKey: left.placement.sortKey, name: left.name },
    { sortKey: right.placement.sortKey, name: right.name },
  ))
}

export interface CatalogEntityOption {
  id: string
  label: string
  assetId: string
  url?: string
  mime?: string
}

export function resolveCatalogEntityAsset(
  catalog: AssetCatalog,
  kind: Exclude<CatalogTabKind, 'image'>,
  entityId: string,
): CatalogAsset | undefined {
  const assetId = catalog.entities[kind]?.[entityId]?.current?.assetId
  if (!assetId) return undefined
  const asset = catalog.assets[assetId]
  return asset?.kind === kind ? asset : undefined
}

/** Node-authoring options keep the stable catalog entity id and expose only its ready current asset. */
export function catalogEntityOptions(
  catalog: AssetCatalog,
  kind: Exclude<CatalogTabKind, 'image'>,
): CatalogEntityOption[] {
  return Object.values(catalog.entities[kind] ?? {})
    .flatMap((entity): CatalogEntityOption[] => {
      const asset = resolveCatalogEntityAsset(catalog, kind, entity.id)
      if (!asset || asset.status !== 'ready') return []
      return [{
        id: entity.id,
        label: entity.name.trim() || entity.id,
        assetId: asset.id,
        ...(asset.url ? { url: asset.url } : {}),
        ...(asset.mime ? { mime: asset.mime } : {}),
      }]
    })
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function catalogFolderSubtree(
  catalog: AssetCatalog,
  target: CatalogPlacementTarget,
  tabKind: CatalogTabKind,
): CatalogPlacementTarget[] {
  const collected: CatalogPlacementTarget[] = []
  const pending: CatalogPlacementTarget[] = [target]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (collected.includes(current)) continue
    collected.push(current)
    for (const child of catalogFolderChildren(catalog, current, tabKind)) pending.push(child.id)
  }
  return collected
}

export function catalogFolderPath(catalog: AssetCatalog, folderId: string): CatalogFolder[] {
  const chain: CatalogFolder[] = []
  let current = catalog.folders.find((folder) => folder.id === folderId)
  while (current) {
    chain.unshift(current)
    const parentId: string | null = current.parentId
    current = parentId ? catalog.folders.find((folder) => folder.id === parentId) : undefined
  }
  return chain
}

export function resolveCatalogAsset(catalog: AssetCatalog, ref: CatalogAssetRef): CatalogAsset | undefined {
  return catalog.assets[ref.assetId]
}

/** Resolve the still shown by a catalog video before playback starts. */
export function catalogVideoPosterUrl(catalog: AssetCatalog, asset: CatalogAsset): string | undefined {
  const explicit = stringMeta(asset.meta, 'posterUrl') ?? stringMeta(asset.meta, 'thumbnailUrl')
  if (explicit) return explicit
  const parameters = asset.provenance?.recipe?.parameters
  const firstFrame = typeof parameters?.firstFrameResourceId === 'string'
    ? parameters.firstFrameResourceId.trim()
    : ''
  const references = Array.isArray(parameters?.referenceImageResourceIds)
    ? parameters.referenceImageResourceIds.flatMap((value) => (
        typeof value === 'string' && value.trim() ? [value.trim()] : []
      ))
    : []
  for (const reference of [firstFrame, ...references]) {
    if (!reference) continue
    const image = Object.values(catalog.assets).find((candidate) => (
      candidate.kind === 'image'
        && (candidate.id === reference || candidate.resourceId === reference)
        && candidate.url
    ))
    if (image?.url) return image.url
  }
  return undefined
}

function stringMeta(meta: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function describeCatalogRoot(catalog: AssetCatalog): Extract<CatalogSelection, { kind: 'catalog-root' }> {
  return {
    kind: 'catalog-root',
    target: CATALOG_ROOT_TARGET,
    tabKinds: CATALOG_TAB_KINDS,
    folderCount: catalog.folders.length,
    itemCount: Object.keys(catalog.placements).length,
    tabs: CATALOG_TAB_KINDS.map((tabKind) => {
      const target = catalogRootTarget(tabKind)
      return {
        tabKind,
        rootFolderIds: catalogFolderChildren(catalog, target, tabKind).map((folder) => folder.id),
        rootItemKeys: catalogItemsIn(catalog, target, tabKind).map((row) => row.placementKey),
      }
    }),
  }
}

export function describeCatalogTabRoot(
  catalog: AssetCatalog,
  tabKind: CatalogTabKind,
  name: string,
): Extract<CatalogSelection, { kind: 'tab-root' }> {
  const target = catalogRootTarget(tabKind)
  return {
    kind: 'tab-root',
    tabKind,
    target,
    name,
    childFolderIds: catalogFolderChildren(catalog, target, tabKind).map((folder) => folder.id),
    itemKeys: catalogItemsIn(catalog, target, tabKind).map((row) => row.placementKey),
    subtreeTargets: catalogFolderSubtree(catalog, target, tabKind),
  }
}

export function describeCatalogFolder(
  catalog: AssetCatalog,
  tabKind: CatalogTabKind,
  folderId: string,
): Extract<CatalogSelection, { kind: 'folder' }> | null {
  const folder = catalog.folders.find((candidate) => candidate.id === folderId && candidate.tabKind === tabKind)
  if (!folder) return null
  return {
    kind: 'folder',
    tabKind,
    target: folder.id,
    folderId: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    path: catalogFolderPath(catalog, folder.id).map((ancestor) => ancestor.name),
    childFolderIds: catalogFolderChildren(catalog, folder.id, tabKind).map((child) => child.id),
    itemKeys: catalogItemsIn(catalog, folder.id, tabKind).map((row) => row.placementKey),
    subtreeTargets: catalogFolderSubtree(catalog, folder.id, tabKind),
  }
}

export function describeCatalogItem(row: CatalogItemRow): Extract<CatalogSelection, { kind: 'item' }> {
  return {
    kind: 'item',
    tabKind: row.tabKind,
    placementKey: row.placementKey,
    itemId: row.itemId,
    name: row.name,
    folderTarget: row.placement.folderId,
    entity: row.entity ? { id: row.entity.id, historyCount: row.entity.history.length } : null,
    asset: row.asset
      ? {
        id: row.asset.id,
        kind: row.asset.kind,
        name: row.asset.name,
        ...(row.asset.url ? { url: row.asset.url } : {}),
      }
      : null,
  }
}
