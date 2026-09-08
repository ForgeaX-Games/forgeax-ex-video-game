import type { RuntimeAsset } from './package'

export const ARRIVAL_KINO_BASE = 'http://localhost:10005/api/v1/kino'

const MEDIA_TYPES = ['video', 'audio', 'image'] as const
const PAGE_SIZE = 100
const PLAYABLE_LOCATOR = /^(?:https?:|blob:|data:|\/)/

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePage(value: unknown): RuntimeAsset[] {
  if (!isObject(value) || !isObject(value.data) || !Array.isArray(value.data.items)) return []
  return value.data.items.flatMap((item) => {
    if (
      !isObject(item)
      || typeof item.resource_id !== 'string'
      || typeof item.media_type !== 'string'
      || typeof item.url !== 'string'
      || !PLAYABLE_LOCATOR.test(item.url)
    ) {
      return []
    }
    return [{ id: item.resource_id, kind: item.media_type, url: item.url }]
  })
}

async function loadMediaType(
  gameId: string,
  mediaType: typeof MEDIA_TYPES[number],
  request: typeof fetch,
  signal?: AbortSignal,
): Promise<RuntimeAsset[]> {
  const query = new URLSearchParams({
    game_id: gameId,
    media_type: mediaType,
    page: '1',
    page_size: String(PAGE_SIZE),
  })
  try {
    const response = await request(`${ARRIVAL_KINO_BASE}/resources?${query}`, {
      cache: 'no-store',
      signal,
    })
    if (!response.ok) return []
    return parsePage(await response.json())
  } catch (error) {
    if (signal?.aborted) throw error
    return []
  }
}

/** Loads playable Kino URLs before the synchronous player resolver is built. */
export async function loadKinoAssetLocators(
  gameId: string,
  request: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<RuntimeAsset[]> {
  return (await Promise.all(
    MEDIA_TYPES.map((mediaType) => loadMediaType(gameId, mediaType, request, signal)),
  )).flat()
}
