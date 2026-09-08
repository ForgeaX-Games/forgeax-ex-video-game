import { pluginFetch } from '../../../lib/plugin-http'
import { emitAssetCatalogInvalidation } from '../asset-catalog-events'
import type { KinoGenerationTask } from './generation-api'
import type { ImageGenerationScope } from './catalogGenerationRecovery'

export interface ImageGenerationLifecycleIntent {
  task: KinoGenerationTask
  status: 'generating' | 'ready' | 'failed'
  scope: ImageGenerationScope
  characterId?: string
  displayName: string
  placementTarget: string
  parameters: Record<string, unknown>
}

/** Sends generation facts and target intent; the Host owns Catalog mutation and Apply decisions. */
export async function reportImageGenerationLifecycle(input: ImageGenerationLifecycleIntent): Promise<string> {
  const response = await pluginFetch('generation/image/lifecycle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generationId: input.task.generationId,
      status: input.status,
      targetRoot: input.scope.targetRoot,
      ...(input.scope.entityId ? { entityId: input.scope.entityId } : {}),
      ...(input.characterId ? { characterId: input.characterId } : {}),
      displayName: input.displayName,
      placementTarget: input.placementTarget,
      prompt: input.task.prompt?.trim() || String(input.parameters.prompt ?? '').trim(),
      ...(input.task.resourceId ? { resourceId: input.task.resourceId } : {}),
      ...(input.task.resultUrl ? { resultUrl: input.task.resultUrl } : {}),
      ...(input.task.createdAt !== undefined ? { createdAt: input.task.createdAt } : {}),
      ...(input.task.model ? { model: input.task.model } : {}),
      ...(input.task.imageSize ? { size: input.task.imageSize } : {}),
      ...(input.task.visualStyleKey ? { visualStyleKey: input.task.visualStyleKey } : {}),
      ...(input.task.errorMessage || input.task.errorCode
        ? { error: input.task.errorMessage ?? input.task.errorCode }
        : {}),
      parameters: input.parameters,
    }),
  })
  if (!response.ok) {
    let message = `图片生成状态登记失败（HTTP ${response.status}）`
    try {
      const body = await response.json() as { error?: { message?: unknown } }
      if (typeof body.error?.message === 'string') message = body.error.message
    } catch { /* transport may return an empty body */ }
    throw new Error(message)
  }
  emitAssetCatalogInvalidation()
  return `asset_kino_${encodeURIComponent(input.task.generationId.trim())}`
}
