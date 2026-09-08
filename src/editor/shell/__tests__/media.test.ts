import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZHANDOU_VIDEOS } from '../../assets/catalog'
import { EMPTY_ASSET_CATALOG } from '../../assets/asset-catalog'
import { useKinoVideoCache } from '../../assets/kinoVideoCacheStore'
import { requestGenerateVideo, resolveCatalogMediaSrc, resolveMediaSrc } from '../media'

const client = {
  context: {
    gameId: 'demo-game',
    endpoints: { gamePackage: 'https://host.test/__extension__/v1/games/demo-game/package' },
  },
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => client,
}))

afterEach(() => {
  client.extension.fetch.mockReset()
  client.extension.url.mockClear()
  client.tool.call.mockReset()
  useKinoVideoCache.setState({ byGame: {} })
})

describe('resolveMediaSrc', () => {
  it('keeps bundled videos ahead of remote resolvers, including m- refs', () => {
    expect(resolveMediaSrc('idle01', 'demo')).toBe(ZHANDOU_VIDEOS.idle01)
    expect(resolveMediaSrc('m-idle01', 'demo')).toBe(ZHANDOU_VIDEOS.idle01)
  })

  it('does not fabricate a Kino content route before a video URL is hydrated', () => {
    expect(resolveMediaSrc('a-vid-generated', 'demo game')).toBeUndefined()
    expect(resolveMediaSrc('res/123', 'demo game')).toBeUndefined()
  })

  it('resolves a blueprint manifest asset id to its catalog URL', () => {
    expect(resolveCatalogMediaSrc('asset-video-1', {
      ...EMPTY_ASSET_CATALOG,
      assets: {
        'asset-video-1': {
          id: 'asset-video-1', kind: 'video', name: '成片',
          url: 'https://cdn.example/video.mp4',
        },
      },
    }, 'demo')).toBe('https://cdn.example/video.mp4')
  })

  it('resolves a BGM entity id through its current audio asset', () => {
    expect(resolveCatalogMediaSrc('audio-battle', {
      ...EMPTY_ASSET_CATALOG,
      assets: {
        'audio-v2': {
          id: 'audio-v2', kind: 'audio', name: '战斗床轨 v2',
          url: 'https://cdn.example/battle-v2.mp3',
        },
      },
      entities: {
        ...EMPTY_ASSET_CATALOG.entities,
        audio: {
          'audio-battle': {
            id: 'audio-battle',
            name: '战斗床轨',
            current: { assetId: 'audio-v2' },
            history: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    }, 'demo')).toBe('https://cdn.example/battle-v2.mp3')
  })

  it('does not treat a raw audio asset id as a node BGM entity id', () => {
    expect(resolveCatalogMediaSrc('audio-v2', {
      ...EMPTY_ASSET_CATALOG,
      assets: {
        'audio-v2': {
          id: 'audio-v2', kind: 'audio', name: '旧资源引用',
          url: 'https://cdn.example/battle-v2.mp3',
        },
      },
    }, 'demo')).toBeUndefined()
  })

  it('routes registry audio ids through the same media endpoint as video (BGM 决策 A)', () => {
    // 媒体二进制归 Kino；资产类型只保留在 game-video 的 manifest 记录中。
    expect(resolveMediaSrc('a-aud-bgm-battle', 'demo game')).toBe(
      '/api/v1/kino/resources/a-aud-bgm-battle/content?game_id=demo%20game',
    )
  })

  it('uses the native Kino CDN URL once the resource cache is hydrated', () => {
    useKinoVideoCache.setState({
      byGame: {
        'demo game': {
          items: [{
            resource_id: 'res/123',
            game_id: 'demo game',
            media_type: 'video',
            name: 'video.mp4',
            url: 'https://cdn.example/video.mp4',
            created_at: 1,
            updated_at: 2,
          }],
          total: 1,
          loading: false,
          error: null,
          generation: 1,
        },
      },
    })
    expect(resolveMediaSrc('res/123', 'demo game')).toBe(
      'https://cdn.example/video.mp4',
    )
  })

  it('delegates generation to the host tool instead of constructing an API request', async () => {
    client.tool.call.mockResolvedValue({ asset: { id: 'generated-1' } })

    await expect(requestGenerateVideo('query-game', {
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })).resolves.toEqual({ asset: { id: 'generated-1' } })

    expect(client.tool.call).toHaveBeenCalledWith('game-video:generate-video', expect.objectContaining({
      sceneNodeId: 'node-1',
    }))
    expect(client.extension.fetch).not.toHaveBeenCalled()
  })
})
