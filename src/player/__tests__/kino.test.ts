import { describe, expect, it, vi } from 'vitest'
import { ARRIVAL_KINO_BASE, loadKinoAssetLocators } from '../kino'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data: body, message: 'ok' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Kino resource locators', () => {
  it('loads video, audio, and image locators through one resource-list contract', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const kind = url.searchParams.get('media_type')
      return jsonResponse({
        items: [{
          resource_id: `${kind}-1`,
          media_type: kind,
          url: `https://cdn.test/${kind}-1`,
        }],
        page: 1,
        page_size: 100,
        total: 1,
      })
    })

    await expect(loadKinoAssetLocators(
      'arrival-game',
      fetchMock as unknown as typeof fetch,
    )).resolves.toEqual([
      { id: 'video-1', kind: 'video', url: 'https://cdn.test/video-1' },
      { id: 'audio-1', kind: 'audio', url: 'https://cdn.test/audio-1' },
      { id: 'image-1', kind: 'image', url: 'https://cdn.test/image-1' },
    ])

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const kind of ['video', 'audio', 'image']) {
      expect(fetchMock).toHaveBeenCalledWith(
        `${ARRIVAL_KINO_BASE}/resources?game_id=arrival-game&media_type=${kind}&page=1&page_size=100`,
        expect.objectContaining({ cache: 'no-store' }),
      )
    }
  })

  it('ignores Kino records without a playable URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      items: [{ resource_id: 'pending-1', media_type: 'video' }],
      page: 1,
      page_size: 100,
      total: 1,
    }))

    await expect(loadKinoAssetLocators(
      'arrival-game',
      fetchMock as unknown as typeof fetch,
    )).resolves.toEqual([])
  })
})
