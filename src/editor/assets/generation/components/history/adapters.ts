import type {
  KinoPromptContentItem,
  KinoVideoGenerationMode,
  KinoVideoResolution,
  KinoVideoSize,
} from '../../generation-api'
import type { KinoImageSize } from '@/runtime/core/schema/kino-image-schema'
import type { GeneratedImageAsset, GeneratedVideoAsset, ImageGenerationAssetKind } from '../types'
import type {
  GenerationHistoryItemData,
  GenerationHistoryRestorePayload,
  GenerationTaskParamsCarrier,
  ImageGenerationAssetLike,
  ImageKinoHistoryTask,
  VideoGenerationAssetLike,
  VideoKinoHistoryTask,
} from './types'

/** Normalize one image Kino task without inventing missing prompt/parameter values. */
export function adaptImageKinoTask(
  task: ImageKinoHistoryTask,
  assetKind: ImageGenerationAssetKind = 'image',
): GenerationHistoryItemData {
  const prompt = cleanString(task.prompt)
  const result = task.resultUrl || task.resourceId
    ? imageResult(task, assetKind)
    : undefined
  return {
    generationId: task.generationId,
    ...(task.resourceId ? { id: task.resourceId } : {}),
    source: 'image-task',
    media: 'image',
    assetKind,
    status: task.status,
    ...(prompt ? { prompt } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.resultUrl ? { resultUrl: task.resultUrl } : {}),
    ...(task.resourceId ? { resourceId: task.resourceId } : {}),
    ...(task.createdAt !== undefined ? { createdAt: task.createdAt } : {}),
    ...(result ? { result } : {}),
    ...restoreEntry(imageRestorePayload(task)),
  }
}

/** Normalize one manifest image so history and references share manifest.json as their source. */
export function adaptImageAsset(
  asset: ImageGenerationAssetLike,
  assetKind: ImageGenerationAssetKind = 'image',
): GenerationHistoryItemData {
  const prompt = cleanString(asset.prompt)
  const resourceId = cleanString(asset.resourceId)
  const resultUrl = cleanString(asset.url)
  const createdAt = asset.createdAt ?? asset.updatedAt
  const result: GeneratedImageAsset = {
    id: asset.id,
    assetKind,
    media: 'image',
    ...(resourceId ? { resourceId } : {}),
    ...(asset.label ?? asset.name ? { label: asset.label ?? asset.name } : {}),
    ...(resultUrl ? { url: resultUrl } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
  }
  return {
    generationId: asset.generationId ?? `asset:${asset.id}`,
    id: asset.id,
    source: 'image-asset',
    media: 'image',
    assetKind,
    status: asset.status ?? 'succeeded',
    ...(prompt ? { prompt } : {}),
    ...(asset.model ? { model: asset.model } : {}),
    ...(resultUrl ? { resultUrl } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(asset.label ?? asset.name ? { label: asset.label ?? asset.name } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    result,
    ...restoreEntry(imageRestorePayload(asset)),
  }
}

/** Normalize one video Kino task, preserving only parameters present in the response. */
export function adaptVideoKinoTask(
  task: VideoKinoHistoryTask,
  registryAssetId?: string,
): GenerationHistoryItemData {
  const prompt = cleanString(task.prompt)
  const result = task.resultUrl || task.resourceId
    ? videoResult(task)
    : undefined
  return {
    generationId: task.generationId,
    ...(registryAssetId ? { id: registryAssetId } : {}),
    source: 'video-task',
    media: 'video',
    assetKind: 'video',
    status: task.status,
    ...(prompt ? { prompt } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.resultUrl ? { resultUrl: task.resultUrl } : {}),
    ...(task.resourceId ? { resourceId: task.resourceId } : {}),
    ...(task.createdAt !== undefined ? { createdAt: task.createdAt } : {}),
    ...(result ? { result } : {}),
    ...restoreEntry(videoRestorePayload(task)),
  }
}

/** Normalize an existing video asset into the same controlled history shape. */
export function adaptVideoAsset(asset: VideoGenerationAssetLike): GenerationHistoryItemData {
  const prompt = cleanString(asset.prompt)
  // `id` is the host registry identity and is not interchangeable with a
  // Kino resource id.  Keep the provider identity absent when the asset did
  // not carry one; callers that build mention menus must then omit it.
  const resourceId = cleanString(asset.resourceId)
  const resultUrl = cleanString(asset.playbackUrl) ?? cleanString(asset.url)
  const createdAt = asset.createdAt ?? asset.updatedAt
  const durationSeconds = validDuration(asset.durationSeconds)
    ?? validDuration(asset.durMs === undefined ? undefined : asset.durMs / 1000)
  const result: GeneratedVideoAsset = {
    id: asset.id,
    assetKind: 'video',
    media: 'video',
    ...(resourceId ? { resourceId } : {}),
    ...(asset.label ?? asset.name ? { label: asset.label ?? asset.name } : {}),
    ...(resultUrl ? { url: resultUrl } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
  }
  return {
    generationId: asset.generationId ?? asset.id,
    id: asset.id,
    source: 'video-asset',
    media: 'video',
    assetKind: 'video',
    status: asset.status ?? 'succeeded',
    ...(prompt ? { prompt } : {}),
    ...(asset.model ? { model: asset.model } : {}),
    ...(resultUrl ? { resultUrl } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
    ...(asset.label ?? asset.name ? { label: asset.label ?? asset.name } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    result,
    ...restoreEntry(videoRestorePayload(asset, durationSeconds)),
  }
}

export const adaptImageGenerationTask = adaptImageKinoTask
export const adaptVideoGenerationTask = adaptVideoKinoTask
export const adaptVideoGenerationAsset = adaptVideoAsset

function imageResult(
  task: ImageKinoHistoryTask,
  assetKind: ImageGenerationAssetKind,
): GeneratedImageAsset {
  return {
    id: task.resourceId ?? task.generationId,
    assetKind,
    media: 'image',
    ...(task.resourceId ? { resourceId: task.resourceId } : {}),
    ...(task.resultUrl ? { url: task.resultUrl } : {}),
    ...(task.prompt ? { label: task.prompt } : {}),
    ...(task.createdAt !== undefined ? { createdAt: task.createdAt } : {}),
  }
}

function videoResult(task: VideoKinoHistoryTask): GeneratedVideoAsset {
  return {
    id: task.resourceId ?? task.generationId,
    assetKind: 'video',
    media: 'video',
    ...(task.resourceId ? { resourceId: task.resourceId } : {}),
    ...(task.resultUrl ? { url: task.resultUrl } : {}),
    ...(task.prompt ? { label: task.prompt } : {}),
    ...(task.createdAt !== undefined ? { createdAt: task.createdAt } : {}),
  }
}

function imageRestorePayload(
  task: ImageKinoHistoryTask | ImageGenerationAssetLike,
): GenerationHistoryRestorePayload | undefined {
  const params = taskParams(task)
  const prompt = cleanString(task.prompt) ?? readString(params, 'prompt')
  if (!prompt) return undefined
  return compactPayload({
    prompt,
    promptContent: readPromptContent(params),
    model: cleanString(task.model) ?? readString(params, 'model'),
    size: knownImageSize(task.imageSize) ?? knownImageSize(readUnknown(params, 'size')),
    visualStyleKey: cleanString(task.visualStyleKey) ?? readString(params, 'visualStyleKey'),
    referenceImageResourceIds: readStringArray(readUnknown(params, 'referenceImageResourceIds')),
  })
}

function videoRestorePayload(
  task: VideoKinoHistoryTask | VideoGenerationAssetLike,
  durationSeconds?: number,
): GenerationHistoryRestorePayload | undefined {
  const params = taskParams(task)
  const prompt = cleanString(task.prompt) ?? readString(params, 'prompt')
  if (!prompt) return undefined
  return compactPayload({
    prompt,
    promptContent: readPromptContent(params),
    model: cleanString(task.model) ?? readString(params, 'model'),
    size: knownVideoSize(
      'imageSize' in task ? task.imageSize : undefined,
    ) ?? knownVideoSize(readUnknown(params, 'size')),
    visualStyleKey: cleanString(task.visualStyleKey) ?? readString(params, 'visualStyleKey'),
    durationSeconds: durationSeconds
      ?? validDuration(readUnknown(task, 'durationSeconds'))
      ?? validDuration(readUnknown(task, 'duration_sec'))
      ?? validDuration(readUnknown(params, 'durationSeconds'))
      ?? validDuration(readUnknown(params, 'duration_sec')),
    resolution: knownResolution(
      readUnknown(task, 'resolution') ?? readUnknown(params, 'resolution'),
    ),
    generateAudio: readBoolean(
      readUnknown(task, 'generateAudio')
        ?? readUnknown(task, 'generate_audio')
        ?? readUnknown(params, 'generateAudio')
        ?? readUnknown(params, 'generate_audio'),
    ),
    mode: knownMode(readUnknown(task, 'mode') ?? readUnknown(params, 'mode')),
    firstFrameResourceId: cleanString(
      readUnknown(task, 'firstFrameResourceId')
        ?? readUnknown(params, 'firstFrameResourceId'),
    ),
    lastFrameResourceId: cleanString(
      readUnknown(task, 'lastFrameResourceId')
        ?? readUnknown(params, 'lastFrameResourceId'),
    ),
    referenceImageResourceIds: readStringArray(
      readUnknown(task, 'referenceImageResourceIds')
        ?? readUnknown(params, 'referenceImageResourceIds'),
    ),
  })
}

function restoreEntry(payload: GenerationHistoryRestorePayload | undefined): {
  restorePayload?: GenerationHistoryRestorePayload
} {
  return payload ? { restorePayload: payload } : {}
}

function compactPayload(
  payload: GenerationHistoryRestorePayload,
): GenerationHistoryRestorePayload {
  const result = { prompt: payload.prompt } as MutableRestorePayload
  if (payload.promptContent?.length) result.promptContent = payload.promptContent
  if (payload.model) result.model = payload.model
  if (payload.size) result.size = payload.size
  if (payload.visualStyleKey) result.visualStyleKey = payload.visualStyleKey
  if (payload.durationSeconds !== undefined) result.durationSeconds = payload.durationSeconds
  if (payload.resolution) result.resolution = payload.resolution
  if (payload.generateAudio !== undefined) result.generateAudio = payload.generateAudio
  if (payload.mode) result.mode = payload.mode
  if (payload.firstFrameResourceId) result.firstFrameResourceId = payload.firstFrameResourceId
  if (payload.lastFrameResourceId) result.lastFrameResourceId = payload.lastFrameResourceId
  if (payload.referenceImageResourceIds?.length) {
    result.referenceImageResourceIds = payload.referenceImageResourceIds
  }
  return result
}

type MutableRestorePayload = {
  -readonly [Key in keyof GenerationHistoryRestorePayload]: GenerationHistoryRestorePayload[Key]
}

function readPromptContent(source: unknown): KinoPromptContentItem[] | undefined {
  const value = readUnknown(source, 'promptContent')
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((item): KinoPromptContentItem[] => {
    if (!isRecord(item) || (item.type !== 'text' && item.type !== 'resource')) return []
    if (item.type === 'text') {
      const text = cleanString(item.text)
      return text ? [{ type: 'text', text }] : []
    }
    const resourceId = cleanString(item.resourceId)
    return resourceId ? [{ type: 'resource', resourceId }] : []
  })
  return items.length ? items : undefined
}

function taskParams(source: GenerationTaskParamsCarrier): Record<string, unknown> {
  const candidates = [source.params, source.generationParams, source.generation]
  for (const candidate of candidates) {
    if (isRecord(candidate)) return candidate
  }
  return {}
}

function readUnknown(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : undefined
}

function readString(source: unknown, key: string): string | undefined {
  return cleanString(readUnknown(source, key))
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.map(cleanString).filter((item): item is string => item !== undefined)
  return values.length ? values : undefined
}

function validDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function knownImageSize(value: unknown): KinoImageSize | undefined {
  return value === '2560x1440' || value === '1440x2560' || value === '2496x1664' || value === '1664x2496'
    ? value
    : undefined
}

function knownVideoSize(value: unknown): KinoVideoSize | undefined {
  return knownImageSize(value)
}

function knownResolution(value: unknown): KinoVideoResolution | undefined {
  return value === '720p' || value === '1080p' ? value : undefined
}

function knownMode(value: unknown): KinoVideoGenerationMode | undefined {
  return value === 'strict' || value === 'firstref' || value === 'ref' || value === 't2v'
    ? value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
