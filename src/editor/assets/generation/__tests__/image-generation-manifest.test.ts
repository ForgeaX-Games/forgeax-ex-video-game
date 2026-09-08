import { describe, expect, it } from 'vitest'
import type { AssetCatalog, CatalogAsset } from '../../asset-catalog'
import { imageGenerationAssetsFromManifest } from '../image-generation-manifest'

function image(id: string, resourceId: string, overrides: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id,
    kind: 'image',
    name: id,
    resourceId,
    url: `https://cdn.test/${id}.png`,
    status: 'ready',
    ...overrides,
  }
}

describe('manifest-backed image generation scope', () => {
  it('uses entity current/history for history', () => {
    const assets = {
      'scene-current': image('scene-current', 'kino-scene-current', {
        provenance: { recipe: { parameters: { referenceImageResourceIds: ['kino-reference'] } } },
      }),
      'scene-old': image('scene-old', 'kino-scene-old'),
      reference: image('reference', 'kino-reference'),
      unrelated: image('unrelated', 'kino-unrelated'),
    }
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: {
        character: {},
        scene: {
          forest: {
            id: 'forest',
            name: 'Forest',
            current: { assetId: 'scene-current' },
            history: [{ assetId: 'scene-old', appliedAt: 1 }],
            createdAt: 1,
            updatedAt: 2,
          },
        },
        video: {}, icon: {}, control: {}, audio: {}, font: {},
      },
      assets,
    }

    const scoped = imageGenerationAssetsFromManifest(catalog, 'scene', 'forest', 'scene-current')
    expect(scoped.historyAssets.map((asset) => asset.id).sort()).toEqual(['scene-current', 'scene-old'])
  })

  it('renders a projected pending entity generation as polling history', () => {
    const pending = image('scene-pending', 'kino-scene-pending', { status: 'generating' })
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: {
        character: {},
        scene: {
          forest: {
            id: 'forest', name: 'Forest', history: [{ assetId: pending.id, appliedAt: 2 }],
            createdAt: 1, updatedAt: 2,
          },
        },
        video: {}, icon: {}, control: {}, audio: {}, font: {},
      },
      assets: { [pending.id]: pending },
    }

    expect(imageGenerationAssetsFromManifest(catalog, 'scene', 'forest').historyAssets)
      .toEqual([expect.objectContaining({ id: pending.id, status: 'polling' })])
  })

  it('keeps a generic image root empty but scopes a directly opened image to itself', () => {
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
      assets: {
        one: image('one', 'kino-one'),
        two: image('two', 'kino-two'),
      },
    }

    expect(imageGenerationAssetsFromManifest(catalog, 'image').historyAssets).toEqual([])
    expect(imageGenerationAssetsFromManifest(catalog, 'image', undefined, 'one').historyAssets.map((asset) => asset.id)).toEqual(['one'])
  })
})
