import { parseCatalogPlacementKey, type CatalogTabKind } from '../asset-catalog'
import { useCatalogNav, type CatalogNavLocation } from '../../persist/catalogNavStore'

const IMAGE_GENERATION_TARGET_KEY = 'game-video:image-generation-target:v1'

/** Catalog location to restore when a generation page was opened from the new catalog. */
export type ImageGenerationCatalogLocation = Exclude<CatalogNavLocation, { kind: 'catalog-root' }>

export interface ImageGenerationTarget {
  gameId: string
  assetId?: string
  characterId?: string
  entityId?: string
  targetRoot?: 'image' | 'scene' | 'icon' | 'control' | 'character'
  catalogLocation?: ImageGenerationCatalogLocation
  returnView: 'assets' | 'characters'
}

export function requestImageGenerationTarget(target: ImageGenerationTarget): void {
  if (typeof window === 'undefined') return
  try {
    const catalogLocation = target.returnView === 'assets'
      ? target.catalogLocation ?? captureCatalogLocation()
      : target.catalogLocation
    window.sessionStorage.setItem(IMAGE_GENERATION_TARGET_KEY, JSON.stringify({
      ...target,
      ...(catalogLocation ? { catalogLocation } : {}),
    }))
  } catch {
    // Optional navigation context; the generated asset remains registered.
  }
}

export function consumeImageGenerationTarget(gameId: string): ImageGenerationTarget | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.sessionStorage.getItem(IMAGE_GENERATION_TARGET_KEY)
    window.sessionStorage.removeItem(IMAGE_GENERATION_TARGET_KEY)
    if (!raw) return undefined
    const value = JSON.parse(raw) as Partial<ImageGenerationTarget>
    const assetId = typeof value.assetId === 'string' && value.assetId ? value.assetId : undefined
    const characterId = typeof value.characterId === 'string' && value.characterId ? value.characterId : undefined
    const entityId = typeof value.entityId === 'string' && value.entityId ? value.entityId : undefined
    const targetRoot = value.targetRoot === 'image' || value.targetRoot === 'scene' || value.targetRoot === 'icon' || value.targetRoot === 'control' || value.targetRoot === 'character' ? value.targetRoot : undefined
    const catalogLocation = parseCatalogLocation(value.catalogLocation)
    return value.gameId === gameId
      && (assetId || characterId || targetRoot)
      && (value.returnView === 'assets' || value.returnView === 'characters')
      ? { gameId, ...(assetId ? { assetId } : {}), ...(characterId ? { characterId } : {}), ...(entityId ? { entityId } : {}), ...(targetRoot ? { targetRoot } : {}), ...(catalogLocation ? { catalogLocation } : {}), returnView: value.returnView }
      : undefined
  } catch {
    return undefined
  }
}

function captureCatalogLocation(): ImageGenerationCatalogLocation | undefined {
  const location = useCatalogNav.getState().location
  return location.kind === 'catalog-root' ? undefined : location
}

function parseCatalogLocation(value: unknown): ImageGenerationCatalogLocation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Partial<CatalogNavLocation>
  if (candidate.kind === 'tab-root' && isTabKind(candidate.tabKind)) {
    return { kind: 'tab-root', tabKind: candidate.tabKind, target: `root:${candidate.tabKind}` }
  }
  if (candidate.kind === 'folder' && isTabKind(candidate.tabKind)
    && typeof candidate.folderId === 'string' && candidate.folderId
    && typeof candidate.target === 'string' && candidate.target) {
    return { kind: 'folder', tabKind: candidate.tabKind, folderId: candidate.folderId, target: candidate.target }
  }
  if (candidate.kind === 'item' && isTabKind(candidate.tabKind)
    && typeof candidate.itemId === 'string' && candidate.itemId
    && typeof candidate.placementKey === 'string'
    && parseCatalogPlacementKey(candidate.placementKey)?.tabKind === candidate.tabKind
    && parseCatalogPlacementKey(candidate.placementKey)?.itemId === candidate.itemId
    && typeof candidate.target === 'string' && candidate.target) {
    return { kind: 'item', tabKind: candidate.tabKind, itemId: candidate.itemId, placementKey: candidate.placementKey, target: candidate.target }
  }
  return undefined
}

function isTabKind(value: unknown): value is CatalogTabKind {
  return value === 'image' || value === 'scene' || value === 'icon' || value === 'control'
    || value === 'character' || value === 'video' || value === 'audio' || value === 'font'
}
