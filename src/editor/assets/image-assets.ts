import { makeAssetId, type MediaAsset } from '@/authoring/assets/registry-types'
import { createKinoVideoClient, KinoClientError, type KinoResourceDTO } from './kino-api'
import { buildCosObjectUrl, createDefaultCosUploadTransport } from './video-upload'

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export type ImageReferenceType = 'character' | 'scene'

export class ImageUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageUploadError'
  }
}

function assertImageFile(file: File): void {
  if (!IMAGE_MIME_TYPES.has(file.type)) {
    throw new ImageUploadError('仅支持 PNG、JPEG、WebP 或 GIF 图片')
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new ImageUploadError('图片大小必须在 20 MB 以内')
  }
}

function kinoClient() {
  return createKinoVideoClient()
}

function toMediaAsset(resource: KinoResourceDTO, referenceType: ImageReferenceType, file: File): MediaAsset {
  return {
    id: makeAssetId(),
    kind: 'image',
    productionType: referenceType === 'character' ? 'character_ref' : 'scene_ref',
    status: 'ready',
    label: resource.name,
    url: resource.url,
    sourceModule: 'game-video',
    provider: {
      kind: 'kino',
      ref: resource.url,
      upstreamResourceId: resource.resource_id,
    },
    mime: file.type,
    bytes: file.size,
    createdAt: resource.created_at,
    updatedAt: resource.updated_at,
    meta: { upload: true },
    provenance: {
      origin: 'upload',
      source: { module: 'game-video', assetId: resource.resource_id },
    },
  }
}

export async function uploadReferenceImage(
  game: string,
  file: File,
  referenceType: ImageReferenceType,
  onProgress?: (percent: number) => void,
): Promise<MediaAsset> {
  assertImageFile(file)
  try {
    const client = kinoClient()
    const prepared = await client.prepareUpload({
      game_id: game,
      file_name: file.name,
      mime_type: file.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
      bytes: file.size,
    })
    await createDefaultCosUploadTransport().put(
      file,
      prepared,
      (percent) => onProgress?.(Math.min(99, percent)),
    )
    const resource = await client.create({
      game_id: game,
      media_type: 'image',
      url: buildCosObjectUrl(prepared.bucket_url, prepared.object_key),
      name: file.name.replace(/\.[^.]+$/, ''),
      type: referenceType === 'character' ? 'CHARACTER_IMAGE' : 'LOCATION_IMAGE',
      source: 'game-video',
      source_meta: { mime_type: file.type },
    })
    onProgress?.(100)
    return toMediaAsset(resource, referenceType, file)
  } catch (error) {
    if (error instanceof ImageUploadError) throw error
    const message = error instanceof KinoClientError ? error.message : '图片上传网络错误'
    throw new ImageUploadError(message)
  }
}

export async function deleteReferenceImage(game: string, assetId: string): Promise<void> {
  try {
    await kinoClient().delete(assetId, game)
  } catch (error) {
    throw new ImageUploadError(error instanceof Error ? error.message : '图片删除失败')
  }
}

export function gvaImageUrl(assetId: string, game: string, updatedAt?: number): string {
  const url = kinoClient().playbackUrl(assetId, game)
  if (updatedAt === undefined) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${encodeURIComponent(String(updatedAt))}`
}
