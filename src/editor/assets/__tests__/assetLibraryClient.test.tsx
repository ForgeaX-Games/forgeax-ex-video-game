import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AssetLibraryUploadError,
  createKinoAssetLibraryClient,
  type AssetLibraryClient,
  type ManagedAsset,
  useAssetLibrary,
} from '../assetLibraryClient'
import type { KinoProviderCapabilities, KinoResourceDTO, KinoVideoClient } from '../kino-api'
import type { UploadTransport } from '../video-upload'
import { useProjectAssetCache } from '../projectAssetCacheStore'

const KINO_CAPABILITIES: KinoProviderCapabilities = {
  provider: 'kino',
  media_types: ['video', 'image', 'audio'],
  upload_mimes: ['video/mp4', 'image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/wav'],
}

const LOCAL_CAPABILITIES: KinoProviderCapabilities = {
  provider: 'local',
  media_types: ['video', 'image', 'audio', 'font'],
  upload_mimes: [
    'video/mp4',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'audio/aac',
    'font/woff2',
    'font/woff',
    'font/ttf',
    'font/otf',
  ],
}

function client(capabilities: KinoProviderCapabilities = KINO_CAPABILITIES): AssetLibraryClient {
  return {
    capabilities: vi.fn(async () => ({
      provider: capabilities.provider,
      media_types: [...capabilities.media_types],
      upload_mimes: [...capabilities.upload_mimes],
    })),
    list: vi.fn(async (_game, kind): Promise<ManagedAsset[]> => {
      if (kind === 'image') return [{ id: 'image-1', kind, name: '封面', mime: 'image/png' }]
      if (kind === 'audio') return [{ id: 'bgm-1', kind, name: '主题曲', mime: 'audio/mpeg' }]
      return [{ id: 'title.woff2', kind, name: '标题字体', mime: 'font/woff2' }]
    }),
    upload: vi.fn(async (_game, kind, file): Promise<ManagedAsset> => ({ id: `${kind}-new`, kind, name: file.name })),
    rename: vi.fn(async (_game, id, name): Promise<ManagedAsset> => ({
      id,
      kind: id.startsWith('bgm') || id.startsWith('audio') ? 'audio' : 'image',
      name,
    })),
    remove: vi.fn(async () => {}),
  }
}

describe('useAssetLibrary', () => {
  beforeEach(() => {
    useProjectAssetCache.setState({ byGame: {} })
  })

  it('reports the missing API rather than pretending the manifest is empty', async () => {
    const { result } = renderHook(() => useAssetLibrary('demo'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toBe(false)
    expect(result.current.error).toMatch(/尚未启用/)
  })

  it('loads Kino-supported image and audio groups from an injected client', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary('demo', api))

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(api.list).toHaveBeenCalledWith('demo', 'image')
    expect(api.list).toHaveBeenCalledWith('demo', 'audio')
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(result.current.items.map((item) => item.kind)).toEqual(['image', 'audio'])
    expect(result.current.provider).toBe('kino')
    expect(result.current.supportedKinds).toEqual(['image', 'audio'])
    expect(result.current.accept).toEqual({
      image: '.png,.jpg,.jpeg,.webp',
      audio: '.mp3,.wav',
    })
  })

  it('does not query capabilities or media with an empty game id', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary('', api))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(api.capabilities).not.toHaveBeenCalled()
    expect(api.list).not.toHaveBeenCalled()
  })

  it('shows font capability and broader formats for Local provider', async () => {
    const api = client(LOCAL_CAPABILITIES)
    const { result } = renderHook(() => useAssetLibrary('demo', api))

    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(api.list).toHaveBeenCalledWith('demo', 'font')
    expect(result.current.provider).toBe('local')
    expect(result.current.supportedKinds).toEqual(['image', 'audio', 'font'])
    expect(result.current.accept).toEqual({
      image: '.png,.jpg,.jpeg,.webp,.gif',
      audio: '.mp3,.wav,.ogg,.m4a,.aac',
      font: '.woff2,.woff,.ttf,.otf',
    })
  })

  it('updates local state after uploading, renaming, and deleting', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary('demo', api))
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => {
      await result.current.upload('image', new File(['x'], 'new.png', { type: 'image/png' }))
      await result.current.rename('image-new', '新封面')
      await result.current.remove('image-new')
    })

    expect(api.upload).toHaveBeenCalledWith('demo', 'image', expect.any(File))
    expect(api.rename).toHaveBeenCalledWith('demo', 'image-new', '新封面')
    expect(api.remove).toHaveBeenCalledWith('demo', 'image-new')
    expect(result.current.items.find((item) => item.id === 'image-new')).toBeUndefined()
  })

  it('syncs mutations into the shared project asset cache', async () => {
    const api = client()
    const { result } = renderHook(() => useAssetLibrary('demo', api))
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => {
      await result.current.upload('audio', new File(['music'], 'battle.mp3', { type: 'audio/mpeg' }))
    })
    expect(useProjectAssetCache.getState().byGame.demo?.audio?.items.map((item) => item.id))
      .toContain('audio-new')

    await act(async () => {
      await result.current.rename('audio-new', '新战斗曲')
    })
    expect(useProjectAssetCache.getState().byGame.demo?.audio?.items.find((item) => item.id === 'audio-new')?.name)
      .toBe('新战斗曲')

    await act(async () => {
      await result.current.remove('audio-new')
    })
    expect(useProjectAssetCache.getState().byGame.demo?.audio?.items.some((item) => item.id === 'audio-new'))
      .toBe(false)
  })
})

function resource(overrides: Partial<KinoResourceDTO> = {}): KinoResourceDTO {
  return {
    resource_id: 'audio-1',
    game_id: 'demo',
    media_type: 'audio',
    name: '主题曲',
    url: 'https://storage.example/theme.mp3',
    source: 'game-video',
    source_meta: { mime_type: 'audio/mpeg', extra: { bytes: 12 } },
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

function kino(): KinoVideoClient {
  return {
    capabilities: vi.fn(async () => ({
      provider: KINO_CAPABILITIES.provider,
      media_types: [...KINO_CAPABILITIES.media_types],
      upload_mimes: [...KINO_CAPABILITIES.upload_mimes],
    })),
    prepareUpload: vi.fn(async () => ({
      tmp_secret_id: 'test-secret-id',
      tmp_secret_key: 'test-secret-key',
      session_token: 'test-session-token',
      expiration: '2099-01-01T00:00:00Z',
      bucket: 'kino-test-1250000000',
      bucket_url: 'https://storage.example',
      region: 'ap-guangzhou',
      prefix: 'kino/demo/',
      object_key: 'kino/demo/object',
      allowed_extensions: ['mp3'],
      allowed_content_types: ['audio/mpeg'],
      max_file_size_bytes: 104857600,
      required_headers: { 'Content-Type': 'audio/mpeg' },
    })),
    list: vi.fn(async () => ({ items: [resource()], total: 1, page: 1, page_size: 100 })),
    get: vi.fn(async () => resource()),
    create: vi.fn(async () => resource()),
    batch: vi.fn(),
    update: vi.fn(async () => resource({ name: '新主题曲' })),
    delete: vi.fn(async () => {}),
    playbackUrl: vi.fn((id, game) => `/api/v1/kino/resources/${id}/content?game_id=${game}`),
  }
}

describe('createKinoAssetLibraryClient', () => {
  it('maps audio list, upload, rename and deletion to provider-backed resource operations', async () => {
    const kinoClient = kino()
    const transport: UploadTransport = { put: vi.fn(async () => {}) }
    const client = createKinoAssetLibraryClient({ client: kinoClient, transport })

    await expect(client.list('demo', 'audio')).resolves.toEqual([{
      id: 'audio-1',
      kind: 'audio',
      name: '主题曲',
      url: 'https://storage.example/theme.mp3',
      mime: 'audio/mpeg',
      bytes: 12,
      updatedAt: 2,
      source: 'game-video',
    }])

    const file = new File(['music'], 'theme.mp3', { type: 'audio/mpeg' })
    await client.upload('demo', 'audio', file)
    await client.rename('demo', 'audio-1', '新主题曲')
    await client.remove('demo', 'audio-1')

    expect(kinoClient.prepareUpload).toHaveBeenCalledWith({
      game_id: 'demo',
      file_name: 'theme.mp3',
      mime_type: 'audio/mpeg',
      bytes: file.size,
      extension: 'mp3',
    }, undefined)
    expect(transport.put).toHaveBeenCalledWith(file, expect.anything(), undefined, undefined)
    expect(kinoClient.create).toHaveBeenCalledWith(expect.objectContaining({
      game_id: 'demo',
      media_type: 'audio',
      name: 'theme',
      source_meta: { mime_type: 'audio/mpeg', extra: { bytes: file.size } },
    }), undefined)
    expect(kinoClient.get).toHaveBeenCalledWith('audio-1', 'demo', undefined)
    expect(kinoClient.update).toHaveBeenCalledWith('audio-1', expect.objectContaining({
      game_id: 'demo',
      media_type: 'audio',
      name: '新主题曲',
    }), undefined)
    expect(kinoClient.delete).toHaveBeenCalledWith('audio-1', 'demo', undefined)
    expect(kinoClient.capabilities).toHaveBeenCalledWith(undefined)
  })

  it('maps image list, upload, rename and deletion to provider-backed resource operations', async () => {
    const imageResource = resource({
      resource_id: 'image-1',
      media_type: 'image',
      name: '封面',
      url: 'https://storage.example/cover.webp',
      source_meta: { mime_type: 'image/webp', extra: { bytes: 15 } },
    })
    const kinoClient = kino()
    vi.mocked(kinoClient.list).mockResolvedValue({ items: [imageResource], total: 1, page: 1, page_size: 100 })
    vi.mocked(kinoClient.get).mockResolvedValue(imageResource)
    vi.mocked(kinoClient.create).mockResolvedValue(imageResource)
    vi.mocked(kinoClient.update).mockResolvedValue({ ...imageResource, name: '新封面' })
    const transport: UploadTransport = { put: vi.fn(async () => {}) }
    const client = createKinoAssetLibraryClient({ client: kinoClient, transport })

    await expect(client.list('demo', 'image')).resolves.toEqual([{
      id: 'image-1',
      kind: 'image',
      name: '封面',
      url: 'https://storage.example/cover.webp',
      mime: 'image/webp',
      bytes: 15,
      updatedAt: 2,
      source: 'game-video',
    }])

    const file = new File(['image'], 'cover.webp', { type: 'image/webp' })
    await client.upload('demo', 'image', file)
    await client.rename('demo', 'image-1', '新封面')
    await client.remove('demo', 'image-1')

    expect(kinoClient.prepareUpload).toHaveBeenCalledWith(expect.objectContaining({
      game_id: 'demo',
      file_name: 'cover.webp',
      mime_type: 'image/webp',
      extension: 'webp',
    }), undefined)
    expect(kinoClient.create).toHaveBeenCalledWith(expect.objectContaining({
      game_id: 'demo',
      media_type: 'image',
      name: 'cover',
    }), undefined)
    expect(kinoClient.update).toHaveBeenCalledWith('image-1', expect.objectContaining({
      media_type: 'image',
      name: '新封面',
    }), undefined)
    expect(kinoClient.delete).toHaveBeenCalledWith('image-1', 'demo', undefined)
  })

  it('allows font upload when the active provider advertises the capability', async () => {
    const kinoClient = kino()
    vi.mocked(kinoClient.capabilities).mockResolvedValue(LOCAL_CAPABILITIES)
    const transport: UploadTransport = { put: vi.fn(async () => {}) }
    const client = createKinoAssetLibraryClient({ client: kinoClient, transport })
    const file = new File(['font'], 'title.woff2', { type: 'font/woff2' })

    await client.upload('demo', 'font', file)

    expect(kinoClient.prepareUpload).toHaveBeenCalledWith({
      game_id: 'demo',
      file_name: 'title.woff2',
      mime_type: 'font/woff2',
      bytes: file.size,
      extension: 'woff2',
    }, undefined)
    expect(kinoClient.create).toHaveBeenCalledWith(expect.objectContaining({
      game_id: 'demo',
      media_type: 'font',
      name: 'title',
    }), undefined)
  })

  it('rejects font upload when the active provider does not advertise the capability', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })

    await expect(
      client.upload('demo', 'font', new File(['font'], 'title.woff2', { type: 'font/woff2' })),
    ).rejects.toEqual(new AssetLibraryUploadError('当前 kino provider 不支持字体资产'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('rejects unsupported audio formats before requesting an upload', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })

    await expect(
      client.upload('demo', 'audio', new File(['x'], 'theme.flac', { type: 'audio/flac' })),
    ).rejects.toEqual(new AssetLibraryUploadError('不支持的音频格式；仅支持MP3 或 WAV 音频'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('rejects image formats not accepted by the Kino STS API before requesting an upload', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })

    await expect(
      client.upload('demo', 'image', new File(['x'], 'cover.gif', { type: 'image/gif' })),
    ).rejects.toEqual(new AssetLibraryUploadError('不支持的图片格式；仅支持PNG、JPEG 或 WebP 图片'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('rejects images larger than the provider limit before preparing an upload', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })
    const oversized = new File(['x'], 'cover.png', { type: 'image/png' })
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })

    await expect(client.upload('demo', 'image', oversized)).rejects.toEqual(
      new AssetLibraryUploadError('文件大小必须在 20 MB 以内'),
    )
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })

  it('rejects audio formats not accepted by the Kino STS API', async () => {
    const kinoClient = kino()
    const client = createKinoAssetLibraryClient({ client: kinoClient })

    await expect(
      client.upload('demo', 'audio', new File(['x'], 'theme.m4a', { type: 'audio/mp4' })),
    ).rejects.toEqual(new AssetLibraryUploadError('不支持的音频格式；仅支持MP3 或 WAV 音频'))
    expect(kinoClient.prepareUpload).not.toHaveBeenCalled()
  })
})
