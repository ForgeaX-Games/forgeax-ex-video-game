import { getExtensionHost, readExtensionJson } from '../../../lib/extension-host'
import { KINO_DEFAULT_IMAGE_MODEL, KINO_IMAGE_SIZES, type KinoImageSize } from '@/runtime/core/schema/kino-image-schema'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import type { KinoGenerationTask } from './generation-api'

export interface RegisterKinoReferenceInput {
  gameId: string
  task: KinoGenerationTask
  productionType: 'character_ref' | 'scene_ref'
  characterId?: string
  sceneId?: string
}

export interface RegisteredKinoReference {
  asset: MediaAsset
  revision: number
}

/** Asks the Host to materialize a Kino image server-side, then registers its durable asset identity. */
export async function registerKinoReference(input: RegisterKinoReferenceInput): Promise<RegisteredKinoReference> {
  const resourceId = input.task.resourceId
  const prompt = input.task.prompt?.trim()
  if (!resourceId || !prompt) throw new Error('Kino 图片任务缺少 resource 或 prompt，无法登记资产')
  const registryId = kinoRegistryId(input.task.generationId)
  const size = isKinoImageSize(input.task.imageSize) ? input.task.imageSize : undefined
  const response = await getExtensionHost().extension.fetch('references/kino/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      registryId,
      kinoResourceId: resourceId,
      kinoGenerationId: input.task.generationId,
      productionType: input.productionType,
      ...(input.characterId ? { characterId: input.characterId } : {}),
      ...(input.sceneId ? { sceneId: input.sceneId } : {}),
      prompt,
      model: input.task.model ?? KINO_DEFAULT_IMAGE_MODEL,
      ...(size ? { size } : {}),
      ...(input.task.visualStyleKey ? { visualStyleKey: input.task.visualStyleKey } : {}),
    }),
  })
  if (!response.ok) throw new Error(await readRegistrationError(response))
  const body = await readExtensionJson(response) as Partial<RegisteredKinoReference>
  if (!body.asset || typeof body.revision !== 'number') throw new Error('图片资产登记返回无效')
  return { asset: body.asset, revision: body.revision }
}

async function readRegistrationError(response: Response): Promise<string> {
  const fallback = `图片资产登记失败（${response.status}）`
  try {
    const body = await response.json() as { error?: string | { message?: string }; message?: string }
    if (typeof body.error === 'string' && body.error.trim()) return body.error
    if (
      body.error
      && typeof body.error === 'object'
      && typeof body.error.message === 'string'
      && body.error.message.trim()
    ) return body.error.message
    if (typeof body.message === 'string' && body.message.trim()) return body.message
  } catch {
    // The extension boundary may return an empty body for transport failures.
  }
  return fallback
}

function isKinoImageSize(value: string | undefined): value is KinoImageSize {
  return typeof value === 'string' && (KINO_IMAGE_SIZES as readonly string[]).includes(value)
}

function kinoRegistryId(generationId: string): string {
  const normalized = generationId.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '')
  if (!normalized) throw new Error('Kino generation id 无法映射为资产 id')
  return `asset_kino_${normalized}`
}
