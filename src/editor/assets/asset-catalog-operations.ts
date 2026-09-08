import type { CatalogNavLocation } from '../persist/catalogNavStore'
import {
  assetCatalogClient,
  type AssetCatalogClient,
} from './asset-catalog-client'
import {
  catalogRootTarget,
  type CatalogFolder,
  type CatalogItemRow,
  type CatalogTabKind,
} from './asset-catalog'
import { createKinoVideoClient, type KinoVideoClient } from './kino-api'
import { validateExternalVideoUrl } from './video-external-import'
import { uploadProviderResource, type BrowserUploadMediaType } from './video-upload'
import { t } from '../../i18n'

export type CatalogCardTarget =
  | { kind: 'asset'; row: CatalogItemRow }
  | { kind: 'folder'; folder: CatalogFolder }

interface CreateAssetCatalogOperationsOptions {
  catalogClient?: AssetCatalogClient
  kinoClient?: KinoVideoClient
  upload?: typeof uploadProviderResource
  operationId?: () => string
}

/** Local-import media kinds the catalog can register. Mirrors `BROWSER_UPLOAD_POLICIES`. */
export type CatalogUploadKind = Extract<BrowserUploadMediaType, 'image' | 'video' | 'audio'>

interface UploadRegistrationInput {
  gameId: string
  location: CatalogNavLocation
  file: File
  kind: CatalogUploadKind
  targetTabKind?: CatalogTabKind
}

interface ExternalVideoRegistrationInput {
  gameId: string
  url: string
  name: string
}

function defaultOperationId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `catalog-${Date.now()}`
}

function displayName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName
}

const UPLOAD_PRODUCTION_TYPES: Readonly<Record<CatalogUploadKind, string>> = {
  image: 'shot_image',
  video: 'video_clip',
  audio: 'audio_track',
}

function uploadedAsset(
  kind: CatalogUploadKind,
  file: File,
  resource: { resource_id: string, url: string },
): Record<string, unknown> {
  const id = `asset_upload_${resource.resource_id}`
  return {
    id,
    kind,
    productionType: UPLOAD_PRODUCTION_TYPES[kind],
    status: 'ready',
    label: displayName(file.name),
    name: displayName(file.name),
    url: resource.url,
    mime: file.type,
    bytes: file.size,
    provider: { kind: 'kino', ref: resource.resource_id, upstreamResourceId: resource.resource_id },
    meta: { kinoResourceId: resource.resource_id },
    sourceModule: 'game-video',
  }
}

export function createAssetCatalogOperations(
  options: CreateAssetCatalogOperationsOptions = {},
) {
  const catalogClient = options.catalogClient ?? assetCatalogClient
  const kinoClient = options.kinoClient ?? createKinoVideoClient()
  const upload = options.upload ?? uploadProviderResource
  const operationId = options.operationId ?? defaultOperationId

  return {
    async createUploadRegistration({
      gameId,
      location,
      file,
      kind,
      targetTabKind = kind,
    }: UploadRegistrationInput): Promise<() => Promise<void>> {
      const resource = await upload({
        client: kinoClient,
        gameId,
        mediaType: kind,
        file,
        source: 'upload',
      })
      const asset = uploadedAsset(kind, file, resource)
      if (targetTabKind === 'character') asset.productionType = 'character_ref'
      if (targetTabKind === 'scene') asset.productionType = 'scene_ref'
      const registrationId = operationId()
      const entityId = `${targetTabKind}_${registrationId}`
      const catalogItemId = targetTabKind === 'image' ? String(asset.id) : entityId
      const placementTarget = location.kind !== 'catalog-root' && location.tabKind === targetTabKind
        ? location.target
        : catalogRootTarget(targetTabKind)
      const input = {
        operationId: registrationId,
        asset,
        placement: {
          placementKey: `${targetTabKind}:${catalogItemId}`,
          folderId: placementTarget,
          sortKey: String(asset.label),
        },
        ...(targetTabKind === 'image' ? {} : {
          apply: {
            mode: 'catalog' as const,
            tabKind: targetTabKind,
            entityId,
            createEntity: { name: String(asset.label) },
            source: 'upload' as const,
          },
        }),
      }
      return () => catalogClient.registerGenerated(input)
    },

    async createExternalVideoRegistration({
      gameId,
      url,
      name,
    }: ExternalVideoRegistrationInput): Promise<() => Promise<void>> {
      const resource = await kinoClient.create({
        game_id: gameId,
        media_type: 'video',
        url: validateExternalVideoUrl(url),
        name: name || undefined,
        type: 'OTHER',
        source: 'external-import',
      })
      const asset = uploadedAsset(
        'video',
        new File([], name || resource.name || resource.resource_id, { type: 'video/mp4' }),
        resource,
      )
      const assetId = String(asset.id)
      const label = String(asset.label)
      const input = {
        operationId: operationId(),
        asset,
        placement: {
          placementKey: `video:${assetId}`,
          folderId: catalogRootTarget('video'),
          sortKey: label,
        },
        apply: {
          mode: 'catalog' as const,
          tabKind: 'video' as const,
          entityId: assetId,
          createEntity: { name: label },
          source: 'upload' as const,
        },
      }
      return () => catalogClient.registerGenerated(input)
    },

    createFolder(tabKind: CatalogTabKind, name: string): Promise<void> {
      const id = operationId()
      return catalogClient.createFolder({
        operationId: id,
        folderId: `folder_${id}`,
        tabKind,
        parentId: null,
        name,
        sortKey: name,
      })
    },

    moveCatalogItem(row: CatalogItemRow, folderId: string): Promise<void> {
      return catalogClient.moveAsset({
        operationId: operationId(),
        placementKey: row.placementKey,
        folderId,
        sortKey: row.name,
      })
    },

    renameCard(target: CatalogCardTarget, name: string): Promise<void> {
      if (target.kind === 'folder') {
        return catalogClient.renameFolder({ operationId: operationId(), folderId: target.folder.id, name })
      }
      const { row } = target
      if (row.tabKind !== 'image') {
        return catalogClient.renameEntity({
          operationId: operationId(),
          tabKind: row.tabKind,
          entityId: row.itemId,
          name,
        })
      }
      if (!row.asset) return Promise.reject(new Error(t('assetCatalog.operationFailed')))
      return catalogClient.renameAsset({ operationId: operationId(), assetId: row.asset.id, name })
    },

    deleteCard(target: CatalogCardTarget): Promise<void> {
      if (target.kind === 'folder') {
        return catalogClient.deleteFolder({ operationId: operationId(), folderId: target.folder.id })
      }
      const { row } = target
      if (row.tabKind !== 'image') {
        return catalogClient.deleteEntity({
          operationId: operationId(),
          tabKind: row.tabKind,
          entityId: row.itemId,
        })
      }
      if (!row.asset) return Promise.reject(new Error(t('assetCatalog.operationFailed')))
      return catalogClient.deleteAsset({ operationId: operationId(), assetId: row.asset.id })
    },

    deleteImageRows(rows: readonly CatalogItemRow[]): Promise<void> {
      return catalogClient.deleteAssets({
        operationId: operationId(),
        assetIds: rows.flatMap((row) => row.asset ? [row.asset.id] : []),
        placementKeys: rows.flatMap((row) => row.asset ? [`image:${row.asset.id}`] : []),
      })
    },
  }
}

export type AssetCatalogOperations = ReturnType<typeof createAssetCatalogOperations>
