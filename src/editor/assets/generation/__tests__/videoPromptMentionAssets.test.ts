import { describe, expect, it } from 'vitest'
import type { AssetCatalog } from '../../asset-catalog'
import { catalogPromptMentionAssets } from '../catalogPromptMentionAssets'

describe('shared project-asset mentions', () => {
  it('derives business categories, prompt metadata, and selectable Kino resource ids from assetCatalog', () => {
    const catalog: AssetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: {
        character: {
          hero: {
            id: 'hero',
            name: '主角',
            current: { assetId: 'hero-image' },
            history: [],
            createdAt: 1,
            updatedAt: 2,
          },
          pending: {
            id: 'pending',
            name: '待生成角色',
            prompt: '尚未生成参考图',
            history: [],
            createdAt: 1,
            updatedAt: 2,
          },
        },
        scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {},
      },
      assets: {
        'hero-image': {
          id: 'hero-image',
          kind: 'image',
          name: 'hero-v2',
          url: 'https://cdn.test/hero.png',
          prompt: '银发剑士，雨夜霓虹街道',
          resourceId: 'kino-hero',
          status: 'ready',
          updatedAt: 2,
        },
        generating: {
          id: 'generating',
          kind: 'video',
          name: '生成中的视频',
          resourceId: 'kino-pending',
          status: 'generating',
          updatedAt: 3,
        },
      },
    }

    const assets = catalogPromptMentionAssets(catalog)
    expect(assets).toEqual([
      expect.objectContaining({ id: 'generating', category: 'video' }),
      expect.objectContaining({ id: 'hero-image', label: '主角', category: 'character', resourceId: 'kino-hero', prompt: '银发剑士，雨夜霓虹街道' }),
    ])
    expect(assets[0]).not.toHaveProperty('resourceId')
  })
})
