import { describe, expect, it } from 'vitest'
import type { AssetCatalog, CatalogAsset } from '../../asset-catalog'
import { videoGenerationInitialValuesFromAsset } from '../video-generation-manifest'
import { toManifestVideoHistory } from '../useVideoGenerationWorkspace'
import type { VideoGenerationScope } from '../catalogGenerationRecovery'

function catalogAsset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: 'video-1',
    kind: 'video',
    name: '雨夜追逐',
    ...overrides,
  }
}

function trackedVideo(asset: CatalogAsset, scope: VideoGenerationScope, generationId: string): CatalogAsset {
  return {
    ...asset,
    meta: {
      ...(asset.meta ?? {}),
      catalogGeneration: {
        version: 3,
        generationId,
        mediaType: 'video',
        scope,
        placement: { placementKey: `video:${asset.id}`, folderId: 'root:video', sortKey: '1' },
        parameters: {},
      },
    },
  }
}

describe('manifest-backed video generation', () => {
  it('restores the clicked video prompt and recorded recipe from manifest.json', () => {
    expect(videoGenerationInitialValuesFromAsset(catalogAsset({
      prompt: '  红衣角色在雨夜奔跑  ',
      provenance: { recipe: { parameters: {
        prompt: 'stale prompt',
        mode: 'strict',
        durationSeconds: 9,
        generateAudio: false,
        size: '2560x1440',
        resolution: '1080p',
        visualStyleKey: 'cinematic',
        firstFrameResourceId: 'first-1',
        lastFrameResourceId: 'last-1',
        referenceImageResourceIds: ['character-1', 'scene-1'],
      } } },
    }))).toEqual({
      prompt: '红衣角色在雨夜奔跑',
      mode: 'strict',
      durationSeconds: 9,
      generateAudio: false,
      size: '2560x1440',
      resolution: '1080p',
      visualStyleKey: 'cinematic',
      firstFrameResourceId: 'first-1',
      lastFrameResourceId: 'last-1',
      referenceImageResourceIds: ['character-1', 'scene-1'],
    })
  })

  it('keeps a root generation entry empty instead of mixing histories from every video asset', () => {
    const assets = Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
      const id = `video-${index}`
      return [id, catalogAsset({ id, createdAt: index, prompt: `prompt-${index}`, status: 'ready' })]
    }))
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
      assets,
    }

    const rootScope: VideoGenerationScope = { mediaType: 'video', owner: 'root' }
    expect(toManifestVideoHistory(catalog, rootScope)).toEqual([])
  })

  it('scopes history to the selected video entity', () => {
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: {
        character: {}, scene: {}, icon: {}, control: {}, audio: {}, font: {},
        video: {
          selected: {
            id: 'selected',
            name: '选中视频',
            current: { assetId: 'selected-v2' },
            history: [
              { assetId: 'selected-v1', appliedAt: 1 },
              { assetId: 'selected-v2', appliedAt: 2 },
            ],
            createdAt: 1,
            updatedAt: 2,
          },
        },
      },
      assets: {
        'selected-v1': catalogAsset({ id: 'selected-v1' }),
        'selected-v2': catalogAsset({ id: 'selected-v2' }),
        'another-video': catalogAsset({ id: 'another-video' }),
      },
    }

    expect(toManifestVideoHistory(catalog, { mediaType: 'video', owner: 'entity', entityId: 'selected' }).map((item) => item.id))
      .toEqual(['selected-v1', 'selected-v2'])
  })

  it('uses the first-frame manifest image as a video history cover when no poster is stored', () => {
    const video = catalogAsset({
      id: 'video-with-frame',
      provenance: { recipe: { parameters: { firstFrameResourceId: 'kino-first-frame' } } },
    })
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
      assets: {
        [video.id]: video,
        'first-frame': {
          id: 'first-frame',
          kind: 'image',
          name: 'First frame',
          resourceId: 'kino-first-frame',
          url: 'https://cdn.test/first-frame.png',
        },
      },
    }

    expect(toManifestVideoHistory(catalog, { mediaType: 'video', owner: 'entity', assetId: video.id })[0]?.posterUrl).toBe('https://cdn.test/first-frame.png')
  })

  it('limits node history to the matching blueprint node tracking scope', () => {
    const nodeScope: VideoGenerationScope = { mediaType: 'video', owner: 'node', blueprintId: 'bp-a', nodeId: 'node-a' }
    const catalog: AssetCatalog = {
      version: 1, folders: [], placements: {},
      entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
      assets: {
        a: trackedVideo(catalogAsset({ id: 'a', createdAt: 2 }), nodeScope, 'gen-a'),
        b: trackedVideo(catalogAsset({ id: 'b', createdAt: 1 }), { mediaType: 'video', owner: 'node', blueprintId: 'bp-b', nodeId: 'node-b' }, 'gen-b'),
        c: catalogAsset({ id: 'c', createdAt: 3 }),
      },
    }

    expect(toManifestVideoHistory(catalog, nodeScope).map((item) => item.id)).toEqual(['a'])
  })

  it('keeps the initial asset and matching generated history for an asset scope', () => {
    const scope: VideoGenerationScope = { mediaType: 'video', owner: 'entity', assetId: 'initial' }
    const catalog: AssetCatalog = {
      version: 1, folders: [], placements: {},
      entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
      assets: {
        initial: catalogAsset({ id: 'initial', createdAt: 3 }),
        generated: trackedVideo(catalogAsset({ id: 'generated', createdAt: 2 }), scope, 'gen-initial'),
        other: trackedVideo(catalogAsset({ id: 'other', createdAt: 1 }), { mediaType: 'video', owner: 'entity', assetId: 'other' }, 'gen-other'),
      },
    }

    expect(toManifestVideoHistory(catalog, scope).map((item) => item.id)).toEqual(['initial', 'generated'])
  })
})
