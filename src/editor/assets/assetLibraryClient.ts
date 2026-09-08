import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createKinoVideoClient,
  type KinoProviderCapabilities,
  type KinoVideoClient,
} from './kino-api'
import {
  BROWSER_UPLOAD_POLICIES,
  uploadProviderResource,
  VideoUploadError,
  type UploadTransport,
} from './video-upload'
import { useProjectAssetCache } from './projectAssetCacheStore'
import { deleteSequentially } from './batch-delete'
import { listAllKinoResources } from './kino-resource-pagination'
import { renameKinoResource } from './kino-resource-operations'
import {
  toManagedAsset,
  type ManagedAsset,
  type ManagedAssetKind,
} from './kino-resource-projections'

export type { ManagedAsset, ManagedAssetKind } from './kino-resource-projections'

export interface AssetLibraryClient {
  capabilities(options?: { signal?: AbortSignal }): Promise<KinoProviderCapabilities>
  list(gameId: string, kind: ManagedAssetKind, options?: { signal?: AbortSignal }): Promise<ManagedAsset[]>
  upload(gameId: string, kind: ManagedAssetKind, file: File, options?: { signal?: AbortSignal }): Promise<ManagedAsset>
  rename(gameId: string, id: string, name: string, options?: { signal?: AbortSignal }): Promise<ManagedAsset>
  remove(gameId: string, id: string, options?: { signal?: AbortSignal }): Promise<void>
}

const MANAGED_ASSET_KINDS: readonly ManagedAssetKind[] = ['image', 'audio', 'font']
const FORMAT_LABEL_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'audio/mpeg': 'MP3',
  'audio/wav': 'WAV',
  'audio/ogg': 'OGG',
  'audio/mp4': 'M4A',
  'audio/aac': 'AAC',
  'font/woff2': 'WOFF2',
  'font/woff': 'WOFF',
  'font/ttf': 'TTF',
  'font/otf': 'OTF',
}

export class AssetLibraryUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetLibraryUploadError'
  }
}

export interface CreateKinoAssetLibraryClientOptions {
  client?: KinoVideoClient
  transport?: UploadTransport
}

function displayName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName
}

function kindLabel(kind: ManagedAssetKind): string {
  return kind === 'image' ? '图片' : kind === 'audio' ? '音频' : '字体'
}

function managedKinds(capabilities: KinoProviderCapabilities): ManagedAssetKind[] {
  return MANAGED_ASSET_KINDS.filter((kind) => capabilities.media_types.includes(kind))
}

function allowedUploadMimes(
  kind: ManagedAssetKind,
  capabilities: KinoProviderCapabilities,
): string[] {
  const supported = new Set<string>(capabilities.upload_mimes)
  return BROWSER_UPLOAD_POLICIES[kind].mimeTypes.filter((mime) => supported.has(mime))
}

function joinChoices(values: readonly string[]): string {
  if (values.length < 2) return values[0] ?? ''
  return `${values.slice(0, -1).join('、')} 或 ${values.at(-1)}`
}

function supportedFormatLabel(kind: ManagedAssetKind, capabilities: KinoProviderCapabilities): string {
  const labels = allowedUploadMimes(kind, capabilities).map((mime) => FORMAT_LABEL_BY_MIME[mime] ?? mime)
  return `${joinChoices(labels)} ${kindLabel(kind)}`
}

function assertProviderAssetUploadFile(
  kind: ManagedAssetKind,
  file: File,
  capabilities: KinoProviderCapabilities,
): void {
  if (!capabilities.media_types.includes(kind)) {
    throw new AssetLibraryUploadError(`当前 ${capabilities.provider} provider 不支持${kindLabel(kind)}资产`)
  }
  if (!allowedUploadMimes(kind, capabilities).includes(file.type)) {
    throw new AssetLibraryUploadError(
      `不支持的${kindLabel(kind)}格式；仅支持${supportedFormatLabel(kind, capabilities)}`,
    )
  }
}

function acceptedExtensions(
  kind: ManagedAssetKind,
  capabilities: KinoProviderCapabilities,
): string {
  const allowed = new Set(allowedUploadMimes(kind, capabilities))
  return Object.entries(BROWSER_UPLOAD_POLICIES[kind].extensions)
    .filter(([mime]) => allowed.has(mime))
    .flatMap(([, extensions]) => extensions.map((extension) => `.${extension}`))
    .join(',')
}

/**
 * Production adapter for assets in Kino's provider-backed resource API.
 * Kino's resource DTO owns the HTTPS CDN URL used for browser preview.
 */
export function createKinoAssetLibraryClient(
  options: CreateKinoAssetLibraryClientOptions = {},
): AssetLibraryClient {
  const client = options.client ?? createKinoVideoClient()

  return {
    async capabilities(requestOptions) {
      return client.capabilities(requestOptions)
    },

    async list(gameId, kind, requestOptions) {
      const { items } = await listAllKinoResources(client, {
        game_id: gameId,
        media_type: kind,
        // 角色图与场景图归语义根管，通用图片池不再重复展示同一张图。
        exclude_registered: true,
      }, { ...requestOptions, completion: 'unique' })
      return items.map((resource) => toManagedAsset(resource, kind))
    },

    async upload(gameId, kind, file, requestOptions) {
      try {
        const capabilities = await client.capabilities(requestOptions)
        assertProviderAssetUploadFile(kind, file, capabilities)
        const resource = await uploadProviderResource({
          client,
          transport: options.transport,
          gameId,
          mediaType: kind,
          file,
          name: displayName(file.name),
          source: 'game-video',
          sourceMeta: { extra: { bytes: file.size } },
          signal: requestOptions?.signal,
        })
        return toManagedAsset(resource, kind)
      } catch (error) {
        if (!(error instanceof VideoUploadError)) throw error
        const policy = BROWSER_UPLOAD_POLICIES[kind]
        if (error.code === 'invalid_media_type') {
          throw new AssetLibraryUploadError(`不支持的${kindLabel(kind)}格式`)
        }
        if (error.code === 'invalid_file_name') {
          throw new AssetLibraryUploadError('文件名或扩展名与媒体格式不匹配')
        }
        if (error.code === 'invalid_upload_size') {
          throw new AssetLibraryUploadError(
            `文件大小必须在 ${(policy.maxBytes / (1024 * 1024)).toFixed(0)} MB 以内`,
          )
        }
        throw error
      }
    },

    async rename(gameId, id, name, requestOptions) {
      const updated = await renameKinoResource(client, id, gameId, name, requestOptions)
      if (updated.media_type !== 'image' && updated.media_type !== 'audio' && updated.media_type !== 'font') {
        throw new AssetLibraryUploadError('只能重命名图片、音频或字体资产')
      }
      return toManagedAsset(updated, updated.media_type)
    },

    async remove(gameId, id, requestOptions) {
      await client.delete(id, gameId, requestOptions)
    },
  }
}

export interface AssetLibraryController {
  available: boolean
  loading: boolean
  error: string | null
  provider: KinoProviderCapabilities['provider'] | null
  supportedKinds: readonly ManagedAssetKind[]
  accept: Readonly<Partial<Record<ManagedAssetKind, string>>>
  uploading: ManagedAssetKind | null
  mutating: boolean
  items: ManagedAsset[]
  refresh(): Promise<void>
  upload(kind: ManagedAssetKind, file: File): Promise<ManagedAsset | undefined>
  rename(id: string, name: string): Promise<ManagedAsset | undefined>
  remove(id: string): Promise<void>
  removeMany(ids: readonly string[], onProgress?: (current: number, total: number) => void): Promise<{ completed: number, failedId?: string }>
}

const UNAVAILABLE_MESSAGE = '资产资源 API 尚未启用'

export function useAssetLibrary(gameId: string, client?: AssetLibraryClient): AssetLibraryController {
  const hasGameId = gameId.trim().length > 0
  const cache = useProjectAssetCache((state) => state.byGame[gameId])
  const refreshCached = useProjectAssetCache((state) => state.refresh)
  const upsertCached = useProjectAssetCache((state) => state.upsert)
  const removeCached = useProjectAssetCache((state) => state.remove)
  const [capabilities, setCapabilities] = useState<KinoProviderCapabilities | null>(null)
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  const supportedKinds = useMemo(
    () => capabilities ? managedKinds(capabilities) : [],
    [capabilities],
  )
  const accept = useMemo(() => {
    if (!capabilities) return {}
    return Object.fromEntries(
      supportedKinds.map((kind) => [kind, acceptedExtensions(kind, capabilities)]),
    ) as Partial<Record<ManagedAssetKind, string>>
  }, [capabilities, supportedKinds])
  const items = supportedKinds.flatMap((kind) => cache?.[kind]?.items ?? [])
  const loading = capabilitiesLoading || supportedKinds.some((kind) => cache?.[kind]?.loading)
  const errors = supportedKinds.flatMap((kind) => {
    const error = cache?.[kind]?.error
    return error ? [`${kindLabel(kind)}：${error}`] : []
  })
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<ManagedAssetKind | null>(null)
  const [mutating, setMutating] = useState(false)
  const error = !client
    ? UNAVAILABLE_MESSAGE
    : mutationError
      ?? capabilitiesError
      ?? (errors.length > 0 ? `部分资产加载失败；保留已缓存内容。${errors.join('；')}` : null)

  const refresh = useCallback(async () => {
    if (!client || !hasGameId) {
      setCapabilities(null)
      setCapabilitiesError(null)
      setCapabilitiesLoading(false)
      return
    }
    setCapabilitiesLoading(true)
    setCapabilitiesError(null)
    try {
      const nextCapabilities = await client.capabilities()
      const nextKinds = managedKinds(nextCapabilities)
      setCapabilities(nextCapabilities)
      await Promise.all(nextKinds.map((kind) => refreshCached(gameId, kind, client)))
    } catch (cause) {
      setCapabilitiesError(cause instanceof Error ? cause.message : '读取 provider 能力失败')
    } finally {
      setCapabilitiesLoading(false)
    }
  }, [client, gameId, hasGameId, refreshCached])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const upload = useCallback(async (kind: ManagedAssetKind, file: File) => {
    if (!client || !hasGameId || !supportedKinds.includes(kind)) {
      return undefined
    }
    setUploading(kind)
    setMutationError(null)
    try {
      const asset = await client.upload(gameId, kind, file)
      upsertCached(gameId, asset)
      return asset
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : '资产操作失败')
      throw cause
    } finally {
      setUploading(null)
    }
  }, [client, gameId, hasGameId, supportedKinds, upsertCached])

  const rename = useCallback(async (id: string, name: string) => {
    if (!client || !hasGameId) {
      return undefined
    }
    const nextName = name.trim()
    if (!nextName) return undefined
    setMutating(true)
    setMutationError(null)
    try {
      const asset = await client.rename(gameId, id, nextName)
      upsertCached(gameId, asset)
      return asset
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : '资产操作失败')
      return undefined
    } finally {
      setMutating(false)
    }
  }, [client, gameId, hasGameId, upsertCached])

  const remove = useCallback(async (id: string) => {
    if (!client || !hasGameId) {
      return
    }
    const current = useProjectAssetCache.getState().byGame[gameId]
    const asset = supportedKinds
      .flatMap((kind) => current?.[kind]?.items ?? [])
      .find((item) => item.id === id)
    if (!asset) return
    setMutating(true)
    setMutationError(null)
    try {
      await client.remove(gameId, id)
      removeCached(gameId, asset.kind, id)
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : '资产操作失败')
      throw cause
    } finally {
      setMutating(false)
    }
  }, [client, gameId, hasGameId, removeCached, supportedKinds])

  const removeMany = useCallback(async (ids: readonly string[], onProgress?: (current: number, total: number) => void) => {
    if (!client || !hasGameId || ids.length === 0) return { completed: 0 }
    setMutating(true)
    setMutationError(null)
    const result = await deleteSequentially(ids, async (id) => {
      const current = useProjectAssetCache.getState().byGame[gameId]
      const asset = supportedKinds.flatMap((kind) => current?.[kind]?.items ?? []).find((item) => item.id === id)
      if (!asset) return
      await client.remove(gameId, id)
      removeCached(gameId, asset.kind, id)
    }, ({ current, total }) => onProgress?.(current, total))
    setMutating(false)
    if (result.error) setMutationError(result.error instanceof Error ? result.error.message : '资产操作失败')
    return { completed: result.completed, failedId: result.failedId }
  }, [client, gameId, hasGameId, removeCached, supportedKinds])

  return {
    available: Boolean(client),
    loading,
    error,
    provider: capabilities?.provider ?? null,
    supportedKinds,
    accept,
    uploading,
    mutating,
    items,
    refresh,
    upload,
    rename,
    remove,
    removeMany,
  }
}
