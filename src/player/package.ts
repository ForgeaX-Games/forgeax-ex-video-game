import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

export const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/

export interface RuntimeAsset {
  id: string
  kind?: string
  mimeType?: string
  url?: string
  file?: string
  externalPath?: string
  provider?: {
    kind?: string
    ref?: string
  }
}

export interface RuntimeAssetManifest {
  version: number
  assets: RuntimeAsset[]
  assetCatalog?: {
    entities: { audio: Record<string, RuntimeCatalogEntity> }
  }
}

export interface RuntimeCatalogEntity {
  id: string
  name?: string
  current?: { assetId: string }
}

export interface RuntimeGamePackage {
  project: unknown | null
  blueprint: GraphLibraryDocument
  assetsManifest: RuntimeAssetManifest
}

export class GamePackageError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GamePackageError'
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isBlueprint(value: unknown): value is GraphLibraryDocument {
  if (!isObject(value) || !isObject(value.graph) || !isObject(value.manifest)) return false
  const graph = value.graph
  const manifest = value.manifest
  return Array.isArray(graph.nodes)
    && Array.isArray(graph.edges)
    && typeof manifest.mainPackId === 'string'
    && isObject(manifest.packs)
}

function parseAssetManifest(value: unknown): RuntimeAssetManifest | null {
  if (!isObject(value) || typeof value.version !== 'number' || !Array.isArray(value.assets)) return null
  const assets: RuntimeAsset[] = []
  for (const candidate of value.assets) {
    if (!isObject(candidate) || typeof candidate.id !== 'string') return null
    assets.push(candidate as unknown as RuntimeAsset)
  }
  const rawCatalog = isObject(value.assetCatalog) ? value.assetCatalog : undefined
  const rawEntities = rawCatalog && isObject(rawCatalog.entities) ? rawCatalog.entities : undefined
  const parseEntities = (raw: unknown): Record<string, RuntimeCatalogEntity> => {
    if (!isObject(raw)) return {}
    return Object.fromEntries(Object.entries(raw).flatMap(([key, candidate]) => {
      if (!isObject(candidate) || typeof candidate.id !== 'string') return []
      const current = isObject(candidate.current) && typeof candidate.current.assetId === 'string'
        ? { assetId: candidate.current.assetId }
        : undefined
      return [[key, {
        id: candidate.id,
        ...(typeof candidate.name === 'string' ? { name: candidate.name } : {}),
        ...(current ? { current } : {}),
      } satisfies RuntimeCatalogEntity]]
    }))
  }
  const assetCatalog = rawEntities
    ? { entities: { audio: parseEntities(rawEntities.audio) } }
    : undefined
  return { version: value.version, assets, ...(assetCatalog ? { assetCatalog } : {}) }
}

export function parseGamePackage(value: unknown): RuntimeGamePackage {
  if (!isObject(value) || !isBlueprint(value.blueprint)) {
    throw new GamePackageError('Game package has no valid blueprint.json')
  }
  const assetsManifest = parseAssetManifest(value.assetsManifest)
  if (!assetsManifest) {
    throw new GamePackageError('Game package has no valid assets/manifest.json')
  }

  return {
    project: value.project ?? null,
    blueprint: value.blueprint,
    assetsManifest,
  }
}
