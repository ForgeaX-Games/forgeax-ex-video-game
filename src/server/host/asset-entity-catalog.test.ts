import { describe, expect, it } from 'vitest'
import type { AssetManifest } from '@/authoring/assets/registry-types'
import {
  assetEntityDefinitions,
  mergeAssetEntityDefinitions,
  normalizeAssetCatalogState,
  syncProjectVideoPresets,
  videoDefinitionsFromProject,
} from './asset-entity-catalog'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

describe('manifest asset entity catalog', () => {
  it('stores modeled characters, scenes, and video presets before any media exists', () => {
    const manifest = mergeAssetEntityDefinitions(
      { version: 2, assets: [] },
      {
        characters: {
          hero: {
            id: 'hero',
            name: '主角',
            entityId: 'entity-hero',
            summary: '守夜人',
            appearance: { description: '黑色长风衣', previewPrompt: '雨夜中的守夜人' },
          },
        },
        scenes: {
          yard: {
            id: 'yard',
            name: '庭院',
            visual: { description: '雨后石板庭院', previewPrompt: '雨后庭院，电影光影' },
          },
        },
        videos: {
          'node:main:intro': {
            id: 'node:main:intro',
            name: '开场演出',
            summary: '主角在雨夜穿过小巷',
            description: '雨水落在青石板上，主角快步奔跑',
            prompt: '雨夜奔跑特写，电影感水花',
          },
        },
      },
    )

    const catalog = normalizeAssetCatalogState(manifest.assetCatalog)
    expect(catalog.entities.character.hero).toMatchObject({
      id: 'hero',
      description: '黑色长风衣',
      prompt: '雨夜中的守夜人',
      entityId: 'entity-hero',
      history: [],
    })
    expect(catalog.entities.character.hero?.current).toBeUndefined()
    expect(catalog.entities.video['node:main:intro']).toMatchObject({
      id: 'node:main:intro',
      name: '开场演出',
      summary: '主角在雨夜穿过小巷',
      description: '雨水落在青石板上，主角快步奔跑',
      prompt: '雨夜奔跑特写，电影感水花',
      history: [],
    })
    expect(catalog.entities.video['node:main:intro']?.current).toBeUndefined()
    expect(catalog.placements['character:hero']).toMatchObject({ folderId: 'root:character' })
    expect(catalog.placements['scene:yard']).toMatchObject({ folderId: 'root:scene' })
    expect(catalog.placements['video:node:main:intro']).toMatchObject({ folderId: 'root:video' })
  })

  it('projects manifest entities for generation without changing blueprint data', () => {
    const manifest: AssetManifest = mergeAssetEntityDefinitions(
      { version: 2, assets: [] },
      {
        characters: {
          hero: {
            id: 'hero', name: '主角', appearance: { description: '黑袍', previewPrompt: '黑袍剑客' },
            currentAssetId: 'asset-hero',
          },
        },
        videos: {
          'node:main:intro': {
            id: 'node:main:intro',
            name: '开场',
            prompt: '黑袍剑客拔剑',
            currentAssetId: 'asset-video-1',
          },
        },
      },
    )

    const entities = assetEntityDefinitions(manifest)
    expect(entities.characters.hero).toMatchObject({
      id: 'hero',
      appearance: { description: '黑袍', previewPrompt: '黑袍剑客' },
      currentAssetId: 'asset-hero',
    })
    expect(entities.videos['node:main:intro']).toMatchObject({
      id: 'node:main:intro',
      name: '开场',
      prompt: '黑袍剑客拔剑',
      currentAssetId: 'asset-video-1',
    })
  })

  it('extracts and syncs video presets from blueprint nodes into assetCatalog.entities.video', () => {
    const project: GraphLibraryDocument = {
      version: 'game-video.graph.v1',
      manifest: {
        version: 'game-video.blueprint-manifest.v1',
        mainPackId: 'main',
        packs: {
          main: {
            id: 'main',
            title: '主蓝图',
            entry: 'entry',
            graph: {
              nodes: [
                {
                  id: 'entry',
                  type: 'scene',
                  position: { x: 0, y: 0 },
                  inputs: [],
                  outputs: [],
                  data: {
                    name: '起步',
                    chapterSummary: '武松初入景阳冈',
                    storyText: '夜色苍茫，山风呼啸',
                    media: {
                      kind: 'video',
                      prompt: '武松手持哨棒走在山道上',
                      generation: {
                        schemaVersion: 1,
                        durationSeconds: 5,
                        generateAudio: false,
                        size: '1440x2560',
                        resolution: '720p',
                        mode: 'strict',
                      },
                    },
                  },
                },
                {
                  id: 'fight',
                  type: 'perf',
                  position: { x: 240, y: 0 },
                  inputs: [],
                  outputs: [],
                  data: {
                    name: '搏斗',
                    chapterSummary: '赤手打虎',
                    media: {
                      kind: 'video',
                      prompt: '猛虎扑来，武松闪身避开',
                    },
                  },
                },
              ],
              edges: [],
            },
          },
        },
      },
      graph: { nodes: [], edges: [] },
    }

    const videos = videoDefinitionsFromProject(project)
    expect(Object.keys(videos)).toEqual(['node:main:entry', 'node:main:fight'])
    expect(videos['node:main:entry']).toMatchObject({
      id: 'node:main:entry',
      name: '起步',
      summary: '武松初入景阳冈',
      description: '夜色苍茫，山风呼啸',
      prompt: '武松手持哨棒走在山道上',
      source: 'outline',
    })
    expect(videos['node:main:fight']).toMatchObject({
      id: 'node:main:fight',
      name: '搏斗',
      summary: '赤手打虎',
      description: '赤手打虎',
      prompt: '猛虎扑来，武松闪身避开',
      source: 'outline',
    })

    const synced = syncProjectVideoPresets({ version: 2, assets: [] }, project)
    const catalog = normalizeAssetCatalogState(synced.assetCatalog)
    expect(catalog.entities.video['node:main:entry']).toBeDefined()
    expect(catalog.entities.video['node:main:fight']).toBeDefined()
    expect(catalog.placements['video:node:main:entry']).toMatchObject({ folderId: 'root:video' })
    expect(catalog.placements['video:node:main:fight']).toMatchObject({ folderId: 'root:video' })
  })

  it('projects nested subprocess videos with their graph path identity', () => {
    const project = {
      manifest: {
        entry: 'main',
        packs: {
          main: {
            id: 'main',
            title: 'Main',
            entry: 'container',
            graph: {
              nodes: [{
                id: 'container',
                type: 'perf',
                position: { x: 0, y: 0 },
                inputs: [],
                outputs: [],
                data: {
                  name: '容器',
                  subProcess: {
                    entry: 'nested',
                    graph: {
                      nodes: [{
                        id: 'nested',
                        type: 'perf',
                        position: { x: 0, y: 0 },
                        inputs: [],
                        outputs: [],
                        data: {
                          name: '内嵌演出',
                          media: { kind: 'video', prompt: '雨夜追逐', ref: 'nested-video' },
                        },
                      }],
                      edges: [],
                    },
                  },
                },
              }],
              edges: [],
            },
          },
        },
      },
      graph: { nodes: [], edges: [] },
    } as unknown as GraphLibraryDocument

    expect(videoDefinitionsFromProject(project)['node:main:container:nested']).toMatchObject({
      name: '内嵌演出',
      prompt: '雨夜追逐',
      currentAssetId: 'nested-video',
    })
  })
})
