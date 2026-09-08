import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KinoCosStsUploadResponse, KinoResourceDTO, KinoVideoClient } from '../kino-api'
import {
  buildCosObjectUrl,
  completePreparedVideoUpload,
  uploadVideoResource,
} from '../video-upload'

const cosState = vi.hoisted(() => ({
  options: [] as unknown[],
  puts: [] as unknown[],
  fail: undefined as unknown,
}))

vi.mock('cos-js-sdk-v5', () => ({
  default: class MockCOS {
    constructor(options: unknown) { cosState.options.push(options) }
    async putObject(params: unknown) {
      cosState.puts.push(params)
      if (cosState.fail) throw cosState.fail
    }
    cancelTask = vi.fn()
  },
}))

function stsUpload(): KinoCosStsUploadResponse {
  return {
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
    required_headers: { 'Content-Type': 'video/mp4', 'x-cos-storage-class': 'STANDARD' },
  }
}

function resource(): KinoResourceDTO {
  return {
    resource_id: 'resource-1',
    game_id: 'demo',
    media_type: 'video',
    url: 'https://cdn.example/kino/demo/clip.mp4',
    created_at: 1,
    updated_at: 2,
  }
}

function client(overrides: Partial<KinoVideoClient> = {}): KinoVideoClient {
  return {
    capabilities: vi.fn(),
    prepareUpload: vi.fn(async () => stsUpload()),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(async () => resource()),
    batch: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    playbackUrl: vi.fn(),
    ...overrides,
  }
}

afterEach(() => {
  cosState.options.length = 0
  cosState.puts.length = 0
  cosState.fail = undefined
})

describe('COS STS video upload', () => {
  it('uses the STS response with COS and creates the resource only after transfer succeeds', async () => {
    const kino = client()
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

    await expect(uploadVideoResource({ client: kino, gameId: 'demo', file, durationMs: 1500 }))
      .resolves.toEqual(resource())

    expect(cosState.options).toEqual([{
      SecretId: 'test-secret-id',
      SecretKey: 'test-secret-key',
      SecurityToken: 'test-session-token',
    }])
    expect(cosState.puts).toEqual([expect.objectContaining({
      Bucket: 'kino-test-1250000000',
      Region: 'ap-guangzhou',
      Key: 'kino/demo/clip.mp4',
      Body: file,
      ContentType: 'video/mp4',
      Headers: { 'Content-Type': 'video/mp4', 'x-cos-storage-class': 'STANDARD' },
    })])
    expect(kino.create).toHaveBeenCalledWith({
      game_id: 'demo',
      media_type: 'video',
      name: 'clip',
      type: 'UPLOAD',
      source: 'upload',
      remark: undefined,
      url: 'https://kino-test-1250000000.cos.ap-guangzhou.myqcloud.com/kino/demo/clip.mp4',
      source_meta: { mime_type: 'video/mp4', duration_ms: 1500 },
    }, { signal: undefined })
  })

  it('reports COS transfer failure without attempting resource completion', async () => {
    cosState.fail = new Error('COS PutObject failed')
    const kino = client()

    await expect(uploadVideoResource({
      client: kino,
      gameId: 'demo',
      file: new File(['video'], 'clip.mp4', { type: 'video/mp4' }),
    })).rejects.toMatchObject({ code: 'upload_failed' })
    expect(kino.create).not.toHaveBeenCalled()
  })

  it('only permits completion retry for an already uploaded transfer', async () => {
    const kino = client()
    const prepared = {
      gameId: 'demo',
      fileIdentity: { name: 'clip.mp4', size: 5, type: 'video/mp4', lastModified: 0 },
      response: stsUpload(),
      objectUrl: buildCosObjectUrl(stsUpload().bucket_url, stsUpload().object_key),
      uploaded: false,
      createInput: { name: 'clip' },
    }

    await expect(completePreparedVideoUpload({ client: kino, prepared }))
      .rejects.toEqual(expect.objectContaining({ code: 'invalid_upload_state' }))
    expect(kino.create).not.toHaveBeenCalled()

    vi.mocked(kino.create).mockRejectedValueOnce(new Error('resource create failed'))
    await expect(completePreparedVideoUpload({ client: kino, prepared: { ...prepared, uploaded: true } }))
      .rejects.toEqual(expect.objectContaining({
        code: 'complete_failed',
        retryState: expect.objectContaining({ uploaded: true }),
      }))
  })

  it('constructs an object URL from the raw server key without path traversal', () => {
    expect(buildCosObjectUrl('https://media.example/base/', 'kino/demo/clip name.mp4')).toBe(
      'https://media.example/base/kino/demo/clip%20name.mp4',
    )
    expect(() => buildCosObjectUrl('https://media.example', '../other.mp4')).toThrow('Invalid upload instruction')
  })
})
