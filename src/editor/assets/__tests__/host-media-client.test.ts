import { describe, expect, it, vi } from 'vitest'
import { createHostMediaClient } from '../host-media-client'

describe('createHostMediaClient', () => {
  it('uses the handshake-bound package endpoint for resumable media uploads', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/uploads')) {
        return new Response(JSON.stringify({
          id: 'upload-1', filename: 'clip.mp4', contentType: 'video/mp4',
          sizeBytes: 2, offset: 0, state: 'uploading',
        }), { headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/uploads/upload-1')) {
        return new Response(JSON.stringify({
          id: 'upload-1', filename: 'clip.mp4', contentType: 'video/mp4',
          sizeBytes: 2, offset: 2, state: 'uploading',
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        id: 'asset-1', filename: 'clip.mp4', type: 'video',
        url: 'https://media.invalid/asset-1', contentType: 'video/mp4', sizeBytes: 2,
      }), { headers: { 'content-type': 'application/json' } })
    })
    const client = createHostMediaClient({
      ready: async () => ({
        gameId: 'game-1',
        endpoints: { gamePackage: 'https://host.test/__extension__/v1/games/game-1/package' },
      }),
      fetch,
    })

    const upload = await client.createUpload({
      filename: 'clip.mp4', contentType: 'video/mp4', sizeBytes: 2,
    })
    await client.writeUploadChunk(upload.id, 0, new Uint8Array([1, 2]))
    await client.completeUpload(upload.id)

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://host.test/__extension__/v1/games/game-1/media/uploads',
      'https://host.test/__extension__/v1/games/game-1/media/uploads/upload-1',
      'https://host.test/__extension__/v1/games/game-1/media/uploads/upload-1/complete',
    ])
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT', headers: {
        'content-type': 'application/octet-stream', 'upload-offset': '0',
      }, body: new Uint8Array([1, 2]),
    })
  })

  it('lists, updates, deletes, and resolves content through the Host media route', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify([]), {
      headers: { 'content-type': 'application/json' }, status: String(input).includes('asset-1') ? 204 : 200,
    }))
    const client = createHostMediaClient({
      ready: async () => ({
        gameId: 'game-1', endpoints: { gamePackage: '/__extension__/v1/games/game-1/package' },
      }),
      fetch,
    })

    await client.list('image')
    await client.update('asset-1', { filename: 'hero.png' })
    await client.delete('asset-1')
    expect(await client.contentUrl('asset-1')).toBe('/__extension__/v1/games/game-1/media/asset-1')

    expect(fetch.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ['/__extension__/v1/games/game-1/media?type=image', undefined],
      ['/__extension__/v1/games/game-1/media/asset-1', 'PATCH'],
      ['/__extension__/v1/games/game-1/media/asset-1', 'DELETE'],
    ])
  })
})
