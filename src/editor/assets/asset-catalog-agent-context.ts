import type { ContextReference } from '../../platform/context-reference'
import type { CatalogFolder, CatalogItemRow } from './asset-catalog'
import { SOURCE_EXTENSION_ID, truncatePayloadIfNeeded, toolsAction } from '../shell/reference-payload'

export function buildAssetCatalogItemContextReference(input: {
  gameId: string
  row: CatalogItemRow
}): ContextReference {
  const payload = {
    kind: 'game-video.asset-catalog-item-reference.v1',
    gameId: input.gameId,
    informational: true,
    item: input.row,
  }
  return {
    refKind: 'game-video.asset-catalog-item.v1',
    sourceExtensionId: SOURCE_EXTENSION_ID,
    display: { title: input.row.name, icon: '📦', subtitle: '资产库 · 资产' },
    payload: truncatePayloadIfNeeded(payload, {
      kind: payload.kind, gameId: input.gameId, item: { placementKey: input.row.placementKey, name: input.row.name },
    }),
    action: toolsAction(['game-video:get-graph']),
  }
}

export function buildAssetCatalogFolderContextReference(input: {
  gameId: string
  folder: CatalogFolder
  items: readonly CatalogItemRow[]
}): ContextReference {
  const payload = {
    kind: 'game-video.asset-catalog-folder-reference.v1',
    gameId: input.gameId,
    informational: true,
    folder: input.folder,
    items: input.items,
  }
  return {
    refKind: 'game-video.asset-catalog-folder.v1',
    sourceExtensionId: SOURCE_EXTENSION_ID,
    display: { title: input.folder.name, icon: '📁', subtitle: '资产库 · 文件夹' },
    payload: truncatePayloadIfNeeded(payload, {
      kind: payload.kind, gameId: input.gameId, folder: { id: input.folder.id, name: input.folder.name },
    }),
    action: toolsAction(['game-video:get-graph']),
  }
}
