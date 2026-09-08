import { describe, expect, it, vi } from 'vitest'
import {
  createKinoVideoClient,
  KinoClientError,
  requestKinoEnvelope,
  type KinoResourceDTO,
} from '../kino-api'

const FIXTURE_BYTES = 6

const STS_UPLOAD = {
  tmp_secret_id: 'test-secret-id',
  tmp_secret_key: 'test-secret-key',
  session_token: 'test-session-token',
  expiration: '2099-01-01T00:00:00Z',
  bucket: 'kino-test-1250000000',
  bucket_url: 'https://kino-test-1250000000.cos.ap-guangzhou.myqcloud.com',
  region: 'ap-guangzhou',
  prefix: 'kino/demo/',
  object_key: 'kino/demo/clip.mp4',
  allowed_extensions: ['mp4'],
  allowed_content_types: ['video/mp4'],
  max_file_size_bytes: 104857600,
  required_headers: { 'Content-Type': 'video/mp4' },
}

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data }
}

function makeFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input, init)),
  ) as typeof fetch
}

describe('createKinoVideoClient', () => {
  it('uses the capabilities documented by the native Kino browser API', async () => {
    const capabilities = {
      provider: 'kino' as const,
      media_types: ['video', 'image', 'audio'] as const,
      upload_mimes: [
        'video/mp4',
        'image/png',
        'image/jpeg',
        'image/webp',
        'audio/mpeg',
        'audio/wav',
      ] as const,
    }
    const fetchImpl = makeFetch(() => new Response())

    const client = createKinoVideoClient({ fetch: fetchImpl })

    await expect(client.capabilities()).resolves.toEqual(capabilities)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('normalizes baseUrl without trailing slash', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(String(input)).toBe('/api/v1/kino/resources?game_id=demo&media_type=video&page=1&page_size=20')
      expect(init?.credentials).toBe('include')
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
      return new Response(JSON.stringify(envelope({ items: [], total: 0, page: 1, page_size: 20 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl, baseUrl: '/api/v1/kino/' })
    await client.list({ game_id: 'demo', page: 1, page_size: 20 })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('list encodes query params including optional type', async () => {
    const fetchImpl = makeFetch((input) => {
      expect(String(input)).toBe(
        '/api/v1/kino/resources?game_id=game%2Fslug&media_type=video&page=2&page_size=10&type=UPLOAD',
      )
      return new Response(JSON.stringify(envelope({ items: [], total: 0, page: 2, page_size: 10 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await client.list({
      game_id: 'game/slug',
      media_type: 'video',
      page: 2,
      page_size: 10,
      type: 'UPLOAD',
    })
  })

  it('passes only the caller signal while preserving credentials and headers', async () => {
    const controller = new AbortController()
    const fetchImpl = makeFetch((_input, init) => {
      expect(init?.signal).toBe(controller.signal)
      expect(init?.credentials).toBe('include')
      expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
      return new Response(
        JSON.stringify(envelope({ items: [], total: 0, page: 1, page_size: 20 })),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.list({ game_id: 'demo' }, { signal: controller.signal })
  })

  it('prepareUpload posts game_id, file_name, mime_type, bytes, optional extension', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(String(input)).toBe('/api/v1/kino/image-assets/upload')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({
        game_id: 'demo',
        file_name: 'clip.mp4',
        mime_type: 'video/mp4',
        bytes: FIXTURE_BYTES,
        extension: 'mp4',
      })
      return new Response(
        JSON.stringify(
          envelope(STS_UPLOAD),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    const prepared = await client.prepareUpload({
      game_id: 'demo',
      file_name: 'clip.mp4',
      mime_type: 'video/mp4',
      bytes: FIXTURE_BYTES,
      extension: 'mp4',
    })
    expect(prepared).toEqual(STS_UPLOAD)
  })

  it('accepts audio resource and upload MIME types', async () => {
    const fetchImpl = makeFetch((input, init) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toMatchObject({ mime_type: 'audio/ogg' })
        return new Response(JSON.stringify(envelope({
          ...STS_UPLOAD,
          object_key: 'kino/demo/theme.ogg',
          allowed_extensions: ['ogg'],
          allowed_content_types: ['audio/ogg'],
          required_headers: { 'Content-Type': 'audio/ogg' },
        })), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      expect(String(input)).toBe('/api/v1/kino/resources?game_id=demo&media_type=audio&page=1&page_size=20')
      return new Response(JSON.stringify(envelope({ items: [], total: 0, page: 1, page_size: 20 })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.prepareUpload({ game_id: 'demo', file_name: 'theme.ogg', mime_type: 'audio/ogg', bytes: FIXTURE_BYTES })
    await client.list({ game_id: 'demo', media_type: 'audio', page: 1, page_size: 20 })
  })

  it('serializes replacement fields when preparing an upload', async () => {
    const fetchImpl = makeFetch((_input, init) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        game_id: 'demo',
        file_name: 'replacement.mp4',
        mime_type: 'video/mp4',
        bytes: FIXTURE_BYTES,
        client_resource_id: 'res-existing',
        replace_existing: true,
      })
      return new Response(
        JSON.stringify(envelope(STS_UPLOAD)),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await client.prepareUpload({
      game_id: 'demo',
      file_name: 'replacement.mp4',
      mime_type: 'video/mp4',
      bytes: FIXTURE_BYTES,
      client_resource_id: 'res-existing',
      replace_existing: true,
    })
  })

  it('get/update/delete/playbackUrl append encoded game_id', async () => {
    const calls: string[] = []
    const fetchImpl = makeFetch((input, init) => {
      calls.push(String(input))
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify(envelope(null)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const dto: KinoResourceDTO = {
        resource_id: 'res-1',
        game_id: 'demo',
        media_type: 'video',
        url: 'http://127.0.0.1/content',
        created_at: 1,
        updated_at: 2,
      }
      return new Response(JSON.stringify(envelope(dto)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await client.get('res/1', 'demo slug')
    await client.update('res/1', {
      game_id: 'demo slug',
      resource_id: 'res/1',
      media_type: 'video',
      url: 'http://127.0.0.1/content',
      name: 'renamed.mp4',
    })
    await client.delete('res/1', 'demo slug')
    expect(client.playbackUrl('res/1', 'demo slug')).toBe(
      '/api/v1/kino/resources/res%2F1/content?game_id=demo%20slug',
    )
    expect(calls[0]).toBe('/api/v1/kino/resources/res%2F1?game_id=demo%20slug')
    expect(calls[1]).toBe('/api/v1/kino/resources/res%2F1?game_id=demo%20slug')
    expect(calls[2]).toBe('/api/v1/kino/resources/res%2F1?game_id=demo%20slug')
  })

  it('create and batch post JSON bodies', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(init?.method).toBe('POST')
      const body = JSON.parse(String(init?.body))
      if (String(input).endsWith('/batch')) {
        expect(body).toEqual({
          game_id: 'demo',
          resources: [{ media_type: 'video', url: 'http://x', name: 'a.mp4' }],
        })
        return new Response(
          JSON.stringify(envelope({ created_count: 1, skipped_count: 0, items: [] })),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      expect(body.url).toBe('http://object')
      return new Response(
        JSON.stringify(
          envelope({
            resource_id: 'new',
            game_id: 'demo',
            media_type: 'video',
            url: 'http://object',
            created_at: 1,
            updated_at: 2,
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await client.create({
      game_id: 'demo',
      media_type: 'video',
      url: 'http://object',
      name: 'clip.mp4',
    })
    await client.batch({
      game_id: 'demo',
      resources: [{ media_type: 'video', url: 'http://x', name: 'a.mp4' }],
    })
  })

  it('throws typed KinoClientError on HTTP and business failures without leaking body', async () => {
    const fetchImpl = makeFetch(() =>
      new Response('{"code":400,"message":"Invalid upload size","data":null,"error_code":"invalid_upload_size","debug":"secret"}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const client = createKinoVideoClient({ fetch: fetchImpl })
    await expect(client.list({ game_id: 'demo' })).rejects.toMatchObject({
      name: 'KinoClientError',
      status: 400,
      errorCode: 'invalid_upload_size',
      message: 'Invalid upload size',
    })
    await expect(client.list({ game_id: 'demo' })).rejects.not.toSatisfy((error: Error) =>
      error.message.includes('secret'),
    )
  })

  it('truncates upstream envelope messages to 512 characters', async () => {
    const fetchImpl = makeFetch(() =>
      new Response(
        JSON.stringify({
          code: 500,
          message: 'x'.repeat(700),
          data: null,
          error_code: 'upstream_unavailable',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    )
    const client = createKinoVideoClient({ fetch: fetchImpl })

    await expect(client.list({ game_id: 'demo' })).rejects.toSatisfy(
      (error: KinoClientError) =>
        error.message.length === 512 &&
        error.status === 500 &&
        error.errorCode === 'upstream_unavailable',
    )
  })

  it('normalizes 401, empty, malformed JSON, and network errors', async () => {
    const unauthorized = createKinoVideoClient({
      fetch: makeFetch(() =>
        new Response('{"code":401,"message":"Unauthorized","data":null,"error_code":"unauthorized"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    })
    await expect(unauthorized.list({ game_id: 'demo' })).rejects.toMatchObject({
      status: 401,
      errorCode: 'unauthorized',
    })

    const empty = createKinoVideoClient({
      fetch: makeFetch(() => new Response('', { status: 200 })),
    })
    await expect(empty.list({ game_id: 'demo' })).rejects.toMatchObject({
      status: 502,
      errorCode: 'upstream_unavailable',
    })

    const malformed = createKinoVideoClient({
      fetch: makeFetch(() => new Response('not-json', { status: 200 })),
    })
    await expect(malformed.list({ game_id: 'demo' })).rejects.toMatchObject({
      status: 502,
      errorCode: 'upstream_unavailable',
    })

    const network = createKinoVideoClient({
      fetch: vi.fn(() => Promise.reject(new Error('offline'))) as typeof fetch,
    })
    await expect(network.list({ game_id: 'demo' })).rejects.toMatchObject({
      status: 502,
      errorCode: 'network_error',
    })
  })

  it('shares envelope transport for private same-origin routes', async () => {
    const fetchImpl = makeFetch((input, init) => {
      expect(String(input)).toBe('/api/private/v1/kino/generations?gameSlug=demo%20game')
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(JSON.parse(String(init?.body))).toEqual({ prompt: 'rain' })
      return new Response(JSON.stringify(envelope({ generation_id: 'gen-1' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    await expect(requestKinoEnvelope<{ generation_id: string }>(
      '/api/private/v1/kino/generations',
      {
        method: 'POST',
        query: { gameSlug: 'demo game' },
        json: { prompt: 'rain' },
        fetch: fetchImpl,
      },
    )).resolves.toEqual({ generation_id: 'gen-1' })
  })

  it('preserves a non-JSON 404 so callers can distinguish an unavailable route', async () => {
    await expect(requestKinoEnvelope('/api/private/v1/kino/generations', {
      fetch: makeFetch(() => new Response('Not Found', { status: 404 })),
    })).rejects.toMatchObject({
      name: 'KinoClientError',
      status: 404,
      errorCode: 'not_found',
    })
  })
})
