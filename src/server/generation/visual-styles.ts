import type { ExtensionContext } from '@forgeax/extension-host/node'

const CAPABILITY_ID = 'media.video.visual-styles.list'
const CAPABILITY_VERSION = 1

interface KinoVisualStyleDTO {
  key: string
  label: string
  cdn_url: string
  tag: string | string[]
  order: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseItem(value: unknown): KinoVisualStyleDTO {
  if (!isRecord(value)) throw new Error('Kino returned an invalid visual style')
  const tags = typeof value.tag === 'string'
    ? value.tag
    : Array.isArray(value.tag) && value.tag.every((tag) => typeof tag === 'string')
      ? value.tag
      : null
  if (
    typeof value.key !== 'string'
    || !/^[A-Za-z0-9_-]{1,80}$/.test(value.key)
    || typeof value.label !== 'string'
    || value.label.trim().length === 0
    || typeof value.cdn_url !== 'string'
    || !value.cdn_url.startsWith('https://')
    || tags === null
    || typeof value.order !== 'number'
    || !Number.isFinite(value.order)
  ) {
    throw new Error('Kino returned an invalid visual style')
  }
  return value as unknown as KinoVisualStyleDTO
}

export async function listVideoVisualStyles(
  context: ExtensionContext,
): Promise<{ items: Array<{ key: string; label: string; cdnUrl: string; tags: string[]; order: number }> }> {
  const raw = await context.capabilities.invoke(CAPABILITY_ID, CAPABILITY_VERSION, {})
  if (!isRecord(raw) || !Array.isArray(raw.items)) {
    throw new Error('Kino returned an invalid visual-style list')
  }
  const items = raw.items.map(parseItem).map((item) => ({
    key: item.key,
    label: item.label,
    cdnUrl: item.cdn_url,
    tags: Array.isArray(item.tag) ? item.tag : [item.tag],
    order: item.order,
  }))
  items.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
  return { items }
}
