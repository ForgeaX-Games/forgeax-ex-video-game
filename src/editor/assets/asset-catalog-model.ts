import type { CatalogEntity, CatalogEntityKind } from '@/authoring/assets/registry-types'

export type {
  CatalogAssetRef,
  CatalogEntity,
  CatalogEntityKind,
  CatalogHistoryItem,
} from '@/authoring/assets/registry-types'

export type CatalogTabKind = CatalogEntityKind | 'image'
export type CatalogPlacementTarget = string

export const CATALOG_ROOT_TARGET = 'root:catalog' as const

export type CatalogSelection =
  | {
    kind: 'catalog-root'
    target: typeof CATALOG_ROOT_TARGET
    tabKinds: readonly CatalogTabKind[]
    folderCount: number
    itemCount: number
    tabs: Array<{
      tabKind: CatalogTabKind
      rootFolderIds: string[]
      rootItemKeys: string[]
    }>
  }
  | {
    kind: 'tab-root'
    tabKind: CatalogTabKind
    target: CatalogPlacementTarget
    name: string
    childFolderIds: string[]
    itemKeys: string[]
    subtreeTargets: CatalogPlacementTarget[]
  }
  | {
    kind: 'folder'
    tabKind: CatalogTabKind
    target: string
    folderId: string
    parentId: string | null
    name: string
    path: string[]
    childFolderIds: string[]
    itemKeys: string[]
    subtreeTargets: CatalogPlacementTarget[]
  }
  | {
    kind: 'item'
    tabKind: CatalogTabKind
    placementKey: string
    itemId: string
    name: string
    folderTarget: CatalogPlacementTarget
    entity: { id: string, historyCount: number } | null
    asset: { id: string, kind: string, name: string, url?: string } | null
  }

export interface CatalogTimestamps {
  createdAt: number
  updatedAt: number
}

export interface CatalogFolder extends CatalogTimestamps {
  id: string
  parentId: string | null
  tabKind: CatalogTabKind
  name: string
  sortKey: string
}

export interface CatalogPlacement extends CatalogTimestamps {
  folderId: CatalogPlacementTarget
  sortKey: string
}

/** Read-only catalog projection of one `manifest.assets` entry. */
export interface CatalogAsset {
  id: string
  kind: string
  name: string
  url?: string
  mime?: string
  bytes?: number
  productionType?: string
  prompt?: string
  generationId?: string
  createdAt?: number
  updatedAt?: number
  resourceId?: string
  status?: 'placeholder' | 'generating' | 'ready' | 'failed' | string
  provider?: { kind?: string, ref?: string, upstreamResourceId?: string }
  meta?: Record<string, unknown>
  provenance?: { recipe?: { parameters?: Record<string, unknown> } }
  error?: string
  externalPath?: string
}

export interface AssetCatalog {
  version: 1
  folders: CatalogFolder[]
  placements: Record<string, CatalogPlacement>
  entities: Record<CatalogEntityKind, Record<string, CatalogEntity>>
  assets: Record<string, CatalogAsset>
}

export const CATALOG_ENTITY_KINDS: readonly CatalogEntityKind[] = [
  'character',
  'scene',
  'video',
  'icon',
  'control',
  'audio',
  'font',
]

export const CATALOG_TAB_KINDS: readonly CatalogTabKind[] = [
  'character',
  'scene',
  'video',
  'image',
  'icon',
  'control',
  'audio',
  'font',
]

/** Tabs currently exposed by the catalog UI. Hidden kinds remain valid persisted data. */
export const VISIBLE_CATALOG_TAB_KINDS: readonly CatalogTabKind[] = CATALOG_TAB_KINDS
  .filter((tabKind) => tabKind !== 'font')

export const EMPTY_ASSET_CATALOG: AssetCatalog = {
  version: 1,
  folders: [],
  placements: {},
  entities: {
    character: {},
    scene: {},
    video: {},
    icon: {},
    control: {},
    audio: {},
    font: {},
  },
  assets: {},
}
