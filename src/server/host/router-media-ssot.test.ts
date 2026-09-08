import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoRouter } from './router'

afterEach(() => vi.unstubAllGlobals())

describe('game-video media routing', () => {
  it('advertises the exact media surface backed by the product Kino provider', async () => {
    const response = await createGameVideoRouter({} as ExtensionContext).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/capabilities',
      headers: {},
      query: {},
      body: new Uint8Array(),
    })

    expect(JSON.parse(new TextDecoder().decode(response.body))).toEqual({
      code: 0,
      message: 'ok',
      data: {
        provider: 'kino',
        media_types: ['image', 'video', 'audio'],
        upload_mimes: [
          'video/mp4', 'image/png', 'image/jpeg', 'image/webp',
          'audio/mpeg', 'audio/wav',
        ],
      },
    })
  })

  it('proxies only allowlisted Kino CDN audio for waveform decoding', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'audio/wav', 'content-length': '3' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const router = createGameVideoRouter({} as ExtensionContext)

    const allowed = await router.handle({
      gameId: 'game-1', runtimeId: 'runtime-1', method: 'GET', path: 'media/audio-waveform', headers: {},
      query: { url: ['https://www.zaohuacdn.cn/kino/assets/openid/theme.wav'] }, body: new Uint8Array(),
    })
    const blocked = await router.handle({
      gameId: 'game-1', runtimeId: 'runtime-1', method: 'GET', path: 'media/audio-waveform', headers: {},
      query: { url: ['https://evil.invalid/kino/assets/theme.wav'] }, body: new Uint8Array(),
    })

    expect(allowed.status).toBe(200)
    expect(allowed.headers?.['content-type']).toBe('audio/wav')
    expect(allowed.body).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(blocked.status).toBe(400)
  })

  it('projects host media without accepting a caller-selected game', async () => {
    const context = {
      gameId: 'game-1',
      media: {
        list: async () => [{
          id: 'video-1',
          filename: 'clip.mp4',
          type: 'video',
          url: '/host/video-1',
          contentType: 'video/mp4',
        }],
      },
    } as unknown as ExtensionContext
    const router = createGameVideoRouter(context)

    const response = await router.handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/resources',
      headers: {},
      query: { game_id: ['game-1'], media_type: ['video'], page: ['1'], page_size: ['100'] },
      body: new Uint8Array(),
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(new TextDecoder().decode(response.body))).toMatchObject({
      code: 0,
      data: {
        total: 1,
        items: [{ resource_id: 'video-1', game_id: 'game-1' }],
      },
    })
  })

  it('serves the host media URL projected into registry image assets', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const context = {
      gameId: 'game-1',
      media: {
        read: async (gameId: string, assetId: string) => (
          gameId === 'game-1' && assetId === 'image-1'
            ? { contentType: 'image/jpeg', bytes }
            : null
        ),
      },
    } as unknown as ExtensionContext

    const response = await createGameVideoRouter(context).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/assets/image-1',
      headers: {},
      query: { gameId: ['game-1'] },
      body: new Uint8Array(),
    })

    expect(response.status).toBe(200)
    expect(response.headers?.['content-type']).toBe('image/jpeg')
    expect(response.body).toEqual(bytes)
  })

  it('rejects a game_id that differs from the host context', async () => {
    const context = {
      gameId: 'game-1',
      media: { list: async () => [] },
    } as unknown as ExtensionContext
    const response = await createGameVideoRouter(context).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET',
      path: 'media/resources',
      headers: {},
      query: { game_id: ['game-2'] },
      body: new Uint8Array(),
    })

    expect(response.status).toBe(400)
  })

  it('keeps resumable chunks within the Extension Host request-body limit', async () => {
    const context = {
      gameId: 'game-1',
      media: {
        createUpload: async () => ({
          id: 'upload-1',
          filename: 'large.mp4',
          contentType: 'video/mp4',
          sizeBytes: 5 * 1024 * 1024,
          offset: 0,
          state: 'uploading',
        }),
        getUpload: async () => null,
        writeUploadChunk: async () => null,
        completeUpload: async () => { throw new Error('unused') },
        update: async () => null,
      },
    } as unknown as ExtensionContext

    const response = await createGameVideoRouter(context).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'POST',
      path: 'media/image-assets/upload',
      headers: { 'content-type': ['application/json'] },
      query: {},
      body: new TextEncoder().encode(JSON.stringify({
        game_id: 'game-1',
        file_name: 'large.mp4',
        mime_type: 'video/mp4',
        bytes: 5 * 1024 * 1024,
      })),
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(new TextDecoder().decode(response.body))).toMatchObject({
      data: {
        upload: {
          chunk_size: 1024 * 1024,
          chunk_count: 5,
        },
      },
    })
  })

  it('completes batch resources through resumable Host media without caller-selected games', async () => {
    const completed: string[] = []
    const context = {
      gameId: 'game-1',
      media: {
        createUpload: async () => { throw new Error('unused') },
        getUpload: async () => null,
        writeUploadChunk: async () => null,
        completeUpload: async (gameId: string, uploadId: string) => {
          completed.push(`${gameId}:${uploadId}`)
          return {
            id: `asset-${uploadId}`,
            filename: `${uploadId}.mp4`,
            type: 'video',
            url: `/host/${uploadId}`,
            contentType: 'video/mp4',
          }
        },
        update: async (_gameId: string, _assetId: string, input: { filename?: string }) => ({
          id: _assetId,
          filename: input.filename,
          type: 'video',
          url: `/host/${_assetId}`,
          contentType: 'video/mp4',
        }),
      },
    } as unknown as ExtensionContext
    const response = await createGameVideoRouter(context).handle({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'POST',
      path: 'media/resources/batch',
      headers: { 'content-type': ['application/json'] },
      query: {},
      body: new TextEncoder().encode(JSON.stringify({
        game_id: 'game-1',
        resources: [
          { url: 'extension-upload:upload-1', name: 'one.mp4' },
          { url: 'extension-upload:upload-2', name: 'two.mp4' },
        ],
      })),
    })

    expect(response.status).toBe(200)
    expect(completed).toEqual(['game-1:upload-1', 'game-1:upload-2'])
    expect(JSON.parse(new TextDecoder().decode(response.body))).toMatchObject({
      data: {
        created_count: 2,
        skipped_count: 0,
        items: [
          { resource_id: 'asset-upload-1', game_id: 'game-1' },
          { resource_id: 'asset-upload-2', game_id: 'game-1' },
        ],
      },
    })
  })

  it('does not expose the product Kino route through the extension router', async () => {
    const response = await createGameVideoRouter({} as ExtensionContext).handle({
      gameId: 'game-1', runtimeId: 'runtime-1', method: 'GET', path: 'api/v1/kino/resources', headers: {}, query: {}, body: new Uint8Array(),
    })

    expect(response.status).toBe(404)
  })

  it('可选排除已语义登记的资源：角色图不再从通用图片池重复冒出来', async () => {
    const encoder = new TextEncoder()
    const files = new Map<string, Uint8Array>([
      ['assets/manifest.json', encoder.encode(JSON.stringify({
        version: 2,
        assets: [{
          id: 'a-charref-c1',
          kind: 'image',
          productionType: 'character_ref',
          status: 'ready',
          name: '武松参考图',
          mimeType: 'image/png',
          provider: { kind: 'kino', upstreamResourceId: 'image-1' },
          createdAt: 1,
          updatedAt: 1,
        }],
      }))],
    ])
    const context = {
      gameId: 'game-1',
      files: {
        async read(path: string) { return files.get(path) ?? null },
        async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
        async list() { return [...files.keys()] },
        async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
      },
      media: {
        async list() {
          return [
            { id: 'image-1', filename: 'wusong.png', type: 'image', url: '/host/image-1', contentType: 'image/png' },
            { id: 'image-2', filename: 'upload.png', type: 'image', url: '/host/image-2', contentType: 'image/png' },
          ]
        },
        async read() { return null },
      },
    } as unknown as ExtensionContext
    const router = createGameVideoRouter(context)

    const query = (exclude: boolean) => ({
      gameId: 'game-1',
      runtimeId: 'runtime-1',
      method: 'GET' as const,
      path: 'media/resources',
      headers: {},
      query: {
        game_id: ['game-1'],
        media_type: ['image'],
        ...(exclude ? { exclude_registered: ['true'] } : {}),
      },
      body: new Uint8Array(),
    })

    const all = JSON.parse(new TextDecoder().decode((await router.handle(query(false))).body))
    const filtered = JSON.parse(new TextDecoder().decode((await router.handle(query(true))).body))

    expect(all.data.items.map((item: { resource_id: string }) => item.resource_id))
      .toEqual(['image-1', 'image-2'])
    // 手动上传的普通图片必须留下：判定依据是参考图指向哪个资源，不是名称。
    expect(filtered.data.items.map((item: { resource_id: string }) => item.resource_id))
      .toEqual(['image-2'])
    expect(filtered.data.total).toBe(1)
  })
})
