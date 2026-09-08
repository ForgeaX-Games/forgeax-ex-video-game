import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteReferenceImage,
  gvaImageUrl,
  ImageUploadError,
  uploadReferenceImage,
} from '../image-assets'

const extension = vi.hoisted(() => ({
  fetch: vi.fn((path: string, init?: RequestInit) => fetch(path, init)),
  url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\/+/, '')}`),
}))
const cosState = vi.hoisted(() => ({
  options: [] as unknown[],
  puts: [] as unknown[],
}))

vi.mock('cos-js-sdk-v5', () => ({
  default: class MockCOS {
    constructor(options: unknown) { cosState.options.push(options) }
    async putObject(params: unknown) { cosState.puts.push(params) }
    cancelTask = vi.fn()
  },
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => ({ extension, ready: vi.fn(async () => undefined) }),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  cosState.options.length = 0
  cosState.puts.length = 0
})

describe('gvaImageUrl', () => {
  it('builds a same-origin, revisioned image URL', () => {
    expect(gvaImageUrl('a-img-1/2', 'demo game', 42)).toBe(
      '/api/v1/kino/resources/a-img-1%2F2/content?game_id=demo%20game&v=42',
    )
  })
})

describe('deleteReferenceImage', () => {
  it('deletes an uploaded image through the shared resource API', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'ok', data: null }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await deleteReferenceImage('demo game', 'a-img-1')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/kino/resources/a-img-1?game_id=demo%20game',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('surfaces server refusal messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        code: 403,
        message: 'Only uploaded images can be deleted',
        data: null,
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )))

    await expect(deleteReferenceImage('demo', 'a-charref-hero')).rejects.toEqual(
      new ImageUploadError('Only uploaded images can be deleted'),
    )
  })
})

describe('uploadReferenceImage', () => {
  it('preserves the real Kino resource id in provider metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()
      if (url.endsWith('/image-assets/upload')) {
        return new Response(JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            tmp_secret_id: 'test-secret-id',
            tmp_secret_key: 'test-secret-key',
            session_token: 'test-session-token',
            expiration: '2099-01-01T00:00:00Z',
            bucket: 'kino-test-1250000000',
            bucket_url: 'https://media.example',
            region: 'ap-guangzhou',
            prefix: 'kino/demo/',
            object_key: 'kino/demo/reference.png',
            allowed_extensions: ['png'],
            allowed_content_types: ['image/png'],
            max_file_size_bytes: 20 * 1024 * 1024,
            required_headers: { 'Content-Type': 'image/png' },
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        code: 0,
        message: 'ok',
        data: {
          resource_id: 'kino-image-resource',
          game_id: 'demo',
          media_type: 'image',
          name: 'reference',
          url: 'https://media.example/reference.png',
          created_at: 1,
          updated_at: 2,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const uploaded = await uploadReferenceImage(
      'demo',
      new File(['png'], 'reference.png', { type: 'image/png' }),
      'scene',
    )

    expect(uploaded).toMatchObject({
      id: expect.stringMatching(/^asset_[a-z0-9]+_[a-z0-9]+$/),
      provider: {
        kind: 'kino',
        ref: 'https://media.example/reference.png',
        upstreamResourceId: 'kino-image-resource',
      },
    })
    expect(uploaded.id).not.toBe('kino-image-resource')
    expect(cosState.options).toEqual([{
      SecretId: 'test-secret-id',
      SecretKey: 'test-secret-key',
      SecurityToken: 'test-session-token',
    }])
    expect(cosState.puts).toEqual([expect.objectContaining({
      Bucket: 'kino-test-1250000000',
      Region: 'ap-guangzhou',
      Key: 'kino/demo/reference.png',
      ContentType: 'image/png',
      Headers: { 'Content-Type': 'image/png' },
    })])
  })
})
