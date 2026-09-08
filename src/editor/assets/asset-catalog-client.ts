import { pluginFetch, pluginUrl } from '../../lib/plugin-http'
import {
  EMPTY_ASSET_CATALOG,
  type AssetCatalog,
  type CatalogEntityKind,
} from './asset-catalog-model'
import { parseAssetCatalogResponse } from './asset-catalog-codec'
import { emitAssetCatalogInvalidation } from './asset-catalog-events'
import { projectAssetCatalogMediaUrls } from './asset-catalog-media-projection'

export const ASSET_CATALOG_CAPABILITY_ID = 'game-video.asset-catalog'
export const ASSET_CATALOG_CAPABILITY_VERSION = 2
export { ASSET_CATALOG_INVALIDATION_EVENT } from './asset-catalog-events'

export interface AssetCatalogRevision {
  catalogRevision?: number
  blueprintRevision?: number
  revision?: number
}

export interface AssetCatalogReadResult extends AssetCatalogRevision {
  catalog: AssetCatalog
}

export type AssetCatalogApplyTarget =
  | { kind: 'character-preview'; characterId: string }
  | { kind: 'node-video'; blueprintId: string; nodeId: string; graphPath?: string[] }
  | { kind: 'node-scene'; blueprintId: string; nodeId: string; index: number }
  | { kind: 'node-extra-image'; blueprintId: string; nodeId: string; index: number }
  | { kind: 'node-first-frame'; blueprintId: string; nodeId: string }
  | { kind: 'node-last-frame'; blueprintId: string; nodeId: string }

/** The two independent state owners for an apply operation. */
export type AssetCatalogApplyMode = 'blueprint' | 'catalog'

interface AssetCatalogApplyBase {
  operationId: string
  assetId: string
  source?: 'generate' | 'upload' | 'select' | 'copy'
  expectedCatalogRevision?: number
}

export type AssetCatalogApplyInput = AssetCatalogApplyBase & (
  | {
    mode: 'blueprint'
    tabKind: CatalogEntityKind | 'image'
    target: AssetCatalogApplyTarget
    entityId?: never
    createEntity?: never
  }
  | {
    mode: 'catalog'
    tabKind: CatalogEntityKind
    entityId: string
    createEntity?: { name: string }
    target?: never
  }
)

type ApplyInputForMode<Mode extends AssetCatalogApplyMode> = Omit<
  Extract<AssetCatalogApplyInput, { mode: Mode }>,
  'operationId' | 'assetId'
>

export interface AssetCatalogMutationInput {
  operationId: string
  expectedCatalogRevision?: number
}

export interface AssetCatalogGeneratedInput {
  operationId: string
  asset: Record<string, unknown>
  placement: { placementKey: string; folderId: string; sortKey: string }
  apply?: ApplyInputForMode<'catalog'>
  blueprintApply?: ApplyInputForMode<'blueprint'>
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function revision(value: Record<string, unknown>): AssetCatalogRevision {
  return {
    ...(typeof value.catalogRevision === 'number' ? { catalogRevision: value.catalogRevision } : {}),
    ...(typeof value.blueprintRevision === 'number' ? { blueprintRevision: value.blueprintRevision } : {}),
    ...(typeof value.revision === 'number' ? { revision: value.revision } : {}),
  }
}

function parseResult(value: unknown): AssetCatalogReadResult {
  if (!record(value)) throw new Error('Asset catalog capability returned an invalid response')
  const parsed = parseAssetCatalogResponse(value)
  if (!parsed) throw new Error('Asset catalog capability returned an invalid catalog')
  const catalog = projectAssetCatalogMediaUrls(
    parsed,
    (assetId) => pluginUrl(`media/assets/${encodeURIComponent(assetId)}`),
  )
  return { catalog, ...revision(value) }
}

async function responseError(response: Response, action: string): Promise<Error> {
  let message = `${action} failed (${response.status})`
  try {
    const body = await response.json() as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') message = body.error.message
  } catch { /* response is not JSON */ }
  return new Error(message)
}

export interface AssetCatalogClient {
  read(): Promise<AssetCatalogReadResult>
  readHistory(input: { tabKind: CatalogEntityKind; entityId: string }): Promise<AssetCatalogReadResult>
  apply(input: AssetCatalogApplyInput): Promise<void>
  upsertAsset(input: { operationId: string; asset: Record<string, unknown>; expectedCatalogRevision?: number }): Promise<void>
  place(input: { operationId: string; placementKey: string; folderId: string; sortKey: string; expectedCatalogRevision?: number }): Promise<void>
  registerGenerated(input: AssetCatalogGeneratedInput): Promise<void>
  createFolder(input: AssetCatalogMutationInput & { folderId: string; tabKind: string; parentId?: string | null; name: string; sortKey?: string }): Promise<void>
  renameFolder(input: AssetCatalogMutationInput & { folderId: string; name: string; sortKey?: string }): Promise<void>
  moveFolder(input: AssetCatalogMutationInput & { folderId: string; parentId?: string | null; sortKey?: string }): Promise<void>
  deleteFolder(input: AssetCatalogMutationInput & { folderId: string }): Promise<void>
  renameEntity(input: AssetCatalogMutationInput & { tabKind: CatalogEntityKind; entityId: string; name: string }): Promise<void>
  deleteEntity(input: AssetCatalogMutationInput & { tabKind: CatalogEntityKind; entityId: string }): Promise<void>
  renameAsset(input: AssetCatalogMutationInput & { assetId: string; name: string }): Promise<void>
  moveAsset(input: AssetCatalogMutationInput & { placementKey?: string; assetId?: string; tabKind?: string; entityId?: string; folderId: string; sortKey: string }): Promise<void>
  deleteAsset(input: AssetCatalogMutationInput & { assetId?: string; placementKey?: string }): Promise<void>
  deleteAssets(input: AssetCatalogMutationInput & { assetIds: string[]; placementKeys: string[] }): Promise<void>
}

export function createAssetCatalogClient(): AssetCatalogClient {
  const mutate = async (operation: string, input: Record<string, unknown>): Promise<void> => {
    const response = await pluginFetch('asset-catalog', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, ...input }),
    })
    if (!response.ok) throw await responseError(response, `Asset catalog ${operation}`)
    if (typeof window !== 'undefined') emitAssetCatalogInvalidation()
  }
  return {
    async read() {
      const response = await pluginFetch('asset-catalog')
      if (!response.ok) throw await responseError(response, 'Asset catalog request')
      return parseResult(await response.json())
    },
    async readHistory(input) {
      const query = new URLSearchParams({ tabKind: input.tabKind, entityId: input.entityId })
      const response = await pluginFetch(`asset-catalog/history?${query.toString()}`)
      if (!response.ok) throw await responseError(response, 'Asset catalog history request')
      return parseResult(await response.json())
    },
    async apply(input) {
      await mutate('apply', { ...input })
    },
    async upsertAsset(input) {
      await mutate('upsert-asset', input)
    },
    async place(input) {
      await mutate('place', input)
    },
    async registerGenerated(input) {
      await mutate('register-generated', { ...input })
    },
    async createFolder(input) {
      await mutate('create-folder', { ...input })
    },
    async renameFolder(input) {
      await mutate('rename-folder', { ...input })
    },
    async moveFolder(input) {
      await mutate('move-folder', { ...input })
    },
    async deleteFolder(input) {
      await mutate('delete-folder', { ...input })
    },
    async renameEntity(input) {
      await mutate('rename-entity', { ...input })
    },
    async deleteEntity(input) {
      await mutate('delete-entity', { ...input })
    },
    async renameAsset(input) {
      await mutate('rename-asset', { ...input })
    },
    async moveAsset(input) {
      await mutate('move-asset', { ...input })
    },
    async deleteAsset(input) {
      await mutate('delete-asset', { ...input })
    },
    async deleteAssets(input) {
      await mutate('delete-assets', { ...input })
    },
  }
}

export const assetCatalogClient = createAssetCatalogClient()

export function emptyCatalogResult(): AssetCatalogReadResult {
  return { catalog: EMPTY_ASSET_CATALOG }
}
