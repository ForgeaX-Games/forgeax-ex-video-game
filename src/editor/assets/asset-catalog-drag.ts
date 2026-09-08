import {
  CATALOG_TAB_KINDS,
  parseCatalogPlacementKey,
  type CatalogPlacementTarget,
  type CatalogTabKind,
} from './asset-catalog'

export const CATALOG_ITEM_DRAG_TYPE = 'application/x-game-video-catalog-item'
const CATALOG_ITEM_DRAG_IMAGE_OPACITY = '0.72'

function catalogItemTabDragType(tabKind: CatalogTabKind): string {
  return `${CATALOG_ITEM_DRAG_TYPE}-${tabKind}`
}

export interface CatalogItemDragPayload {
  placementKey: string
  tabKind: CatalogTabKind
  name: string
  sourceTarget: CatalogPlacementTarget
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function writeCatalogItemDrag(
  transfer: DataTransfer,
  payload: CatalogItemDragPayload,
): void {
  transfer.effectAllowed = 'move'
  transfer.setData(CATALOG_ITEM_DRAG_TYPE, JSON.stringify(payload))
  // dragenter/dragover run while the browser keeps drag data in protected mode:
  // types are visible there, but getData() is only reliable again on drop.
  transfer.setData(catalogItemTabDragType(payload.tabKind), '')
}

export function setCatalogItemDragImage(
  transfer: DataTransfer,
  card: HTMLElement,
): void {
  const thumbnail = card.querySelector<HTMLElement>('.acp-thumb')
  if (!thumbnail) return
  const { width, height } = thumbnail.getBoundingClientRect()
  // Keep the thumbnail above-left of the pointer so it does not cover the
  // drop-target hint rendered below-right of the pointer.
  const previousOpacity = thumbnail.style.opacity
  thumbnail.style.opacity = CATALOG_ITEM_DRAG_IMAGE_OPACITY
  try {
    transfer.setDragImage(thumbnail, Math.round(width), Math.round(height))
  } finally {
    thumbnail.style.opacity = previousOpacity
  }
}

export function canAcceptCatalogItemDrag(transfer: DataTransfer, tabKind: CatalogTabKind): boolean {
  return Array.from(transfer.types).includes(catalogItemTabDragType(tabKind))
}

export function readCatalogItemDrag(transfer: DataTransfer): CatalogItemDragPayload | null {
  const raw = transfer.getData(CATALOG_ITEM_DRAG_TYPE)
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      !isRecord(value)
      || typeof value.placementKey !== 'string'
      || typeof value.tabKind !== 'string'
      || !CATALOG_TAB_KINDS.includes(value.tabKind as CatalogTabKind)
      || parseCatalogPlacementKey(value.placementKey)?.tabKind !== value.tabKind
      || typeof value.name !== 'string'
      || typeof value.sourceTarget !== 'string'
    ) return null
    return value as unknown as CatalogItemDragPayload
  } catch {
    return null
  }
}

export function catalogDragPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  return {
    x: Number.isFinite(event.clientX) ? event.clientX : 0,
    y: Number.isFinite(event.clientY) ? event.clientY : 0,
  }
}

export function canDropCatalogItem(
  payload: CatalogItemDragPayload | null,
  tabKind: CatalogTabKind,
  target: CatalogPlacementTarget,
): payload is CatalogItemDragPayload {
  return payload?.tabKind === tabKind && payload.sourceTarget !== target
}
