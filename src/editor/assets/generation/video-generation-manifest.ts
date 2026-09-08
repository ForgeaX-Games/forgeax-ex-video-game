import type { CatalogAsset } from '../asset-catalog'
import type { KinoVideoGenerationParams } from '@/runtime/core/schema/kino-schema'
import {
  KINO_VIDEO_GENERATION_MODES,
  KINO_VIDEO_RESOLUTIONS,
  KINO_VIDEO_SIZES,
} from '@/runtime/core/schema/kino-schema'

/** Restore only generation inputs durably recorded in assets/manifest.json. */
export function videoGenerationInitialValuesFromAsset(
  asset: CatalogAsset,
): Partial<KinoVideoGenerationParams> {
  const parameters = asset.provenance?.recipe?.parameters
  const prompt = asset.prompt?.trim() || stringParameter(parameters, 'prompt')
  const mode = enumParameter(parameters, 'mode', KINO_VIDEO_GENERATION_MODES)
  const size = enumParameter(parameters, 'size', KINO_VIDEO_SIZES)
  const resolution = enumParameter(parameters, 'resolution', KINO_VIDEO_RESOLUTIONS)
  const durationSeconds = numberParameter(parameters, 'durationSeconds')
  const generateAudio = booleanParameter(parameters, 'generateAudio')
  const model = stringParameter(parameters, 'model')
  const visualStyleKey = stringParameter(parameters, 'visualStyleKey')
  const firstFrameResourceId = stringParameter(parameters, 'firstFrameResourceId')
  const lastFrameResourceId = stringParameter(parameters, 'lastFrameResourceId')
  const referenceImageResourceIds = stringArrayParameter(parameters, 'referenceImageResourceIds')
  return {
    ...(prompt ? { prompt } : {}),
    ...(mode ? { mode } : {}),
    ...(size ? { size } : {}),
    ...(resolution ? { resolution } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(generateAudio !== undefined ? { generateAudio } : {}),
    ...(model ? { model } : {}),
    ...(visualStyleKey ? { visualStyleKey } : {}),
    ...(firstFrameResourceId ? { firstFrameResourceId } : {}),
    ...(lastFrameResourceId ? { lastFrameResourceId } : {}),
    ...(referenceImageResourceIds ? { referenceImageResourceIds } : {}),
  }
}

function stringParameter(parameters: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = parameters?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberParameter(parameters: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = parameters?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanParameter(parameters: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = parameters?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function stringArrayParameter(parameters: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = parameters?.[key]
  if (!Array.isArray(value)) return undefined
  const items = value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
  return items.length ? items : undefined
}

function enumParameter<const Value extends string>(
  parameters: Record<string, unknown> | undefined,
  key: string,
  values: readonly Value[],
): Value | undefined {
  const value = parameters?.[key]
  return typeof value === 'string' && values.includes(value as Value) ? value as Value : undefined
}
