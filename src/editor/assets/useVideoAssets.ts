import { useCallback, useRef, useState } from 'react'
import { t } from '../../i18n'
import { deleteSequentially } from './batch-delete'
import type { KinoResourceDTO } from './kino-api'
import { createExternalVideoImportInput } from './video-external-import'
import { renameKinoResource } from './kino-resource-operations'
import {
  safeVideoAssetError,
  useVideoAssetSource,
  type UseVideoAssetsOptions,
  type VideoAssetListItem,
} from './video-asset-source'
import {
  completePreparedVideoUpload,
  replaceVideoResource,
  uploadVideoResource,
  VideoUploadError,
  type PreparedVideoUpload,
} from './video-upload'

export {
  appendVideoRevision,
  DEFAULT_VIDEO_PAGE_SIZE,
  type UseVideoAssetsOptions,
  type VideoAssetListItem,
} from './video-asset-source'

export interface VideoAssetsController {
  loading: boolean
  error: string | null
  items: VideoAssetListItem[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  uploadProgress: number | null
  uploadError: string | null
  canRetryComplete: boolean
  uploading: boolean
  mutating: boolean
  refresh: () => Promise<void>
  loadPage: (page: number) => Promise<void>
  loadMore: () => Promise<void>
  upload: (file: File) => Promise<KinoResourceDTO | undefined>
  importExternal: (source: KinoResourceDTO, name: string) => Promise<KinoResourceDTO | undefined>
  replaceResource: (resourceId: string, file: File) => Promise<KinoResourceDTO | undefined>
  renameResource: (resourceId: string, name: string) => Promise<KinoResourceDTO | undefined>
  retryComplete: () => Promise<KinoResourceDTO | undefined>
  deleteResource: (resourceId: string) => Promise<void>
  deleteResources: (resourceIds: readonly string[]) => Promise<{ completed: number, failedId?: string }>
}

export function useVideoAssets(
  gameId: string,
  options: UseVideoAssetsOptions = {},
): VideoAssetsController {
  const source = useVideoAssetSource(gameId, options)
  const { client, lifecycle } = source
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [retryPrepared, setRetryPrepared] = useState<PreparedVideoUpload | null>(null)
  const [uploading, setUploading] = useState(false)
  const [mutating, setMutating] = useState(false)
  const uploadGeneration = useRef(0)
  const crudGeneration = useRef(0)

  const runUpload = useCallback(async (
    file: File,
    replacementResourceId?: string,
  ): Promise<KinoResourceDTO | undefined> => {
    const generation = ++uploadGeneration.current
    setUploading(true)
    setUploadError(null)
    setUploadProgress(0)
    setRetryPrepared(null)
    try {
      const sharedOptions = {
        client,
        gameId,
        file,
        onProgress: (value: number) => {
          if (lifecycle.mountedRef.current && generation === uploadGeneration.current) {
            setUploadProgress(value)
          }
        },
        signal: lifecycle.abortRef.current?.signal,
      }
      const resource = replacementResourceId
        ? await replaceVideoResource({ ...sharedOptions, resourceId: replacementResourceId })
        : await uploadVideoResource(sharedOptions)
      if (!lifecycle.mountedRef.current || generation !== uploadGeneration.current) return undefined
      if (replacementResourceId) source.replaceLocal(replacementResourceId, resource)
      source.upsertShared(resource, replacementResourceId)
      await source.refresh()
      return resource
    } catch (error) {
      if (!lifecycle.mountedRef.current || generation !== uploadGeneration.current) return undefined
      setUploadError(safeVideoAssetError(error))
      if (error instanceof VideoUploadError && error.code === 'complete_failed' && error.retryState?.uploaded) {
        setRetryPrepared(error.retryState)
      }
      return undefined
    } finally {
      if (lifecycle.mountedRef.current && generation === uploadGeneration.current) {
        setUploading(false)
        setUploadProgress(null)
      }
    }
  }, [client, gameId, lifecycle, source])

  const upload = useCallback(
    (file: File): Promise<KinoResourceDTO | undefined> => runUpload(file),
    [runUpload],
  )

  const replaceResource = useCallback(
    (resourceId: string, file: File): Promise<KinoResourceDTO | undefined> => runUpload(file, resourceId),
    [runUpload],
  )

  const importExternal = useCallback(async (
    external: KinoResourceDTO,
    name: string,
  ): Promise<KinoResourceDTO | undefined> => {
    const generation = ++crudGeneration.current
    setMutating(true)
    source.setError(null)
    try {
      const resource = await client.create(
        createExternalVideoImportInput(gameId, external, name),
        { signal: lifecycle.abortRef.current?.signal },
      )
      if (!lifecycle.mountedRef.current || generation !== crudGeneration.current) return undefined
      source.prependLocal(resource)
      source.upsertShared(resource)
      await source.refresh()
      return resource
    } catch (error) {
      if (!lifecycle.mountedRef.current || generation !== crudGeneration.current) return undefined
      source.setError(safeVideoAssetError(error))
      throw error
    } finally {
      if (lifecycle.mountedRef.current && generation === crudGeneration.current) setMutating(false)
    }
  }, [client, gameId, lifecycle, source])

  const renameResource = useCallback(async (
    resourceId: string,
    name: string,
  ): Promise<KinoResourceDTO | undefined> => {
    const nextName = name.trim()
    if (!nextName) throw new Error(t('videoAssets.emptyName'))
    const generation = ++crudGeneration.current
    setMutating(true)
    source.setError(null)
    try {
      const resource = await renameKinoResource(
        client,
        resourceId,
        gameId,
        nextName,
        { signal: lifecycle.abortRef.current?.signal },
        'video',
      )
      if (!lifecycle.mountedRef.current || generation !== crudGeneration.current) return undefined
      source.replaceLocal(resourceId, resource)
      source.upsertShared(resource)
      if (source.shared) await source.refresh()
      return resource
    } catch (error) {
      if (!lifecycle.mountedRef.current || generation !== crudGeneration.current) return undefined
      source.setError(safeVideoAssetError(error))
      throw error
    } finally {
      if (lifecycle.mountedRef.current && generation === crudGeneration.current) setMutating(false)
    }
  }, [client, gameId, lifecycle, source])

  const retryComplete = useCallback(async (): Promise<KinoResourceDTO | undefined> => {
    if (!retryPrepared) return undefined
    const generation = ++uploadGeneration.current
    setUploading(true)
    setUploadError(null)
    setUploadProgress(99)
    try {
      const resource = await completePreparedVideoUpload({
        client,
        prepared: retryPrepared,
        onProgress: (value) => {
          if (lifecycle.mountedRef.current && generation === uploadGeneration.current) {
            setUploadProgress(value)
          }
        },
        signal: lifecycle.abortRef.current?.signal,
      })
      if (!lifecycle.mountedRef.current || generation !== uploadGeneration.current) return undefined
      if (retryPrepared.replacementResourceId) {
        source.replaceLocal(retryPrepared.replacementResourceId, resource)
      }
      source.upsertShared(resource, retryPrepared.replacementResourceId)
      setRetryPrepared(null)
      await source.refresh()
      return resource
    } catch (error) {
      if (!lifecycle.mountedRef.current || generation !== uploadGeneration.current) return undefined
      setUploadError(safeVideoAssetError(error))
      if (error instanceof VideoUploadError && error.code === 'complete_failed' && error.retryState?.uploaded) {
        setRetryPrepared(error.retryState)
      }
      return undefined
    } finally {
      if (lifecycle.mountedRef.current && generation === uploadGeneration.current) {
        setUploading(false)
        setUploadProgress(null)
      }
    }
  }, [client, lifecycle, retryPrepared, source])

  const deleteResource = useCallback(async (resourceId: string): Promise<void> => {
    const generation = ++crudGeneration.current
    setMutating(true)
    source.setError(null)
    try {
      await client.delete(resourceId, gameId, { signal: lifecycle.abortRef.current?.signal })
      if (!lifecycle.mountedRef.current || generation !== crudGeneration.current) return
      source.removeLocal([resourceId])
      source.removeShared(resourceId)
      await source.refresh()
    } catch (error) {
      if (!lifecycle.mountedRef.current || generation !== crudGeneration.current) return
      source.setError(safeVideoAssetError(error))
      throw error
    } finally {
      if (lifecycle.mountedRef.current && generation === crudGeneration.current) setMutating(false)
    }
  }, [client, gameId, lifecycle, source])

  const deleteResources = useCallback(async (resourceIds: readonly string[]) => {
    if (resourceIds.length === 0) return { completed: 0 }
    const generation = ++crudGeneration.current
    setMutating(true)
    source.setError(null)
    const result = await deleteSequentially(resourceIds, async (resourceId) => {
      await client.delete(resourceId, gameId, { signal: lifecycle.abortRef.current?.signal })
      source.removeShared(resourceId)
    })
    if (lifecycle.mountedRef.current && generation === crudGeneration.current) {
      if (result.error) source.setError(safeVideoAssetError(result.error))
      source.removeLocal(resourceIds.slice(0, result.completed))
      setMutating(false)
      await source.refresh()
    }
    return { completed: result.completed, failedId: result.failedId }
  }, [client, gameId, lifecycle, source])

  return {
    loading: source.loading,
    error: source.error,
    items: source.items,
    total: source.total,
    page: source.page,
    pageSize: source.pageSize,
    hasMore: source.items.length < source.total,
    uploadProgress,
    uploadError,
    canRetryComplete: retryPrepared != null,
    uploading,
    mutating,
    refresh: source.refresh,
    loadPage: source.loadPage,
    loadMore: source.loadMore,
    upload,
    importExternal,
    replaceResource,
    renameResource,
    retryComplete,
    deleteResource,
    deleteResources,
  }
}
