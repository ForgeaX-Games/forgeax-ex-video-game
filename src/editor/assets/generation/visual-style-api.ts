import { requestKinoEnvelope, type KinoRequestOptions } from '../kino-api'

export const LIST_VIDEO_VISUAL_STYLES_TOOL_ID = 'game-video:list-video-visual-styles'
export const KINO_VISUAL_STYLE_PRESETS_ROUTE = '/api/v1/kino-visual-style-presets'

export interface KinoVisualStylePreset {
  key: string
  label: string
  cdnUrl: string
  tags: readonly string[]
  order: number
}

export interface VisualStyleApiPort {
  list(options?: KinoRequestOptions): Promise<unknown>
}

const defaultClient: VisualStyleApiPort = {
  list: (options) => requestKinoEnvelope(KINO_VISUAL_STYLE_PRESETS_ROUTE, options),
}

export async function listVideoVisualStyles(
  api: VisualStyleApiPort = defaultClient,
): Promise<readonly KinoVisualStylePreset[]> {
  return parseVisualStyles(await api.list())
}

function parseVisualStyles(value: unknown): readonly KinoVisualStylePreset[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('Visual style tool returned an invalid response')
  }
  return value.items.map((item) => {
    if (
      !isRecord(item)
      || typeof item.key !== 'string'
      || typeof item.label !== 'string'
      || typeof item.cdn_url !== 'string'
      || !(typeof item.tag === 'string'
        || (Array.isArray(item.tag) && item.tag.every((tag) => typeof tag === 'string')))
      || typeof item.order !== 'number'
      || !Number.isFinite(item.order)
    ) {
      throw new Error('Visual style tool returned an invalid response')
    }
    return {
      key: item.key,
      label: item.label,
      cdnUrl: item.cdn_url,
      tags: Array.isArray(item.tag) ? item.tag : [item.tag],
      order: item.order,
    }
  }).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, 'zh-CN'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
