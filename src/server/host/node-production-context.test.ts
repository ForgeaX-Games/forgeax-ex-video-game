import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { getNodeProductionContext } from './node-production-context'
import { scenePreviewSourceHash } from '../generation/scene-previews'
import { characterPreviewSourceHash } from '../generation/character-previews'
import { KINO_DEFAULT_GENERATION } from '@/runtime/core/schema/kino-schema'

const encoder = new TextEncoder()

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/**
 * 节点生产上下文里的场景（设计 §7.4）。
 *
 * 场景存在的意义就是给节点成片当参考图，和角色图完全对称。上下文里少了场景，
 * 场景线就只是产出了一批没人消费的图片，所以这里钉住三件事：
 * 场景定义随节点带出、场景图进参考图集合、缺图或过期算未就绪。
 */

const scenePrompt = '山林，夜色，虎啸'
const sceneDescription = '景阳冈山道'
const characterPrompt = '布衣壮汉'
const characterDescription = '武松'

interface ContextOverrides {
  scenePreviewReady?: boolean
  useAsVideoReference?: boolean
  missingSceneDefinition?: boolean
  legacyVideoNode?: boolean
  invalidGeneration?: boolean
  videoRef?: string
  videoStatus?: 'placeholder' | 'generating' | 'ready' | 'failed'
  videoOrigin?: 'upload' | 'generation' | 'import'
  supersededCharacterRef?: boolean
}

function project(overrides: ContextOverrides = {}) {
  return {
    revision: 1,
    manifest: {
      mainPackId: 'main',
      packs: {
        main: {
          id: 'main',
          title: '主线',
          entry: 'n1',
          graph: {
            nodes: [{
              id: 'n1',
              type: 'scene',
              position: { x: 0, y: 0 },
              data: {
                name: '武松打虎',
                chapterSummary: '武松在景阳冈遇虎',
                ...(overrides.legacyVideoNode ? {} : { storyText: '三碗不过冈' }),
                cast: [{ characterId: 'c1' }],
                scenes: [{
                  sceneId: 's1',
                  role: 'primary',
                  ...(overrides.useAsVideoReference === false ? { useAsVideoReference: false } : {}),
                }],
                media: {
                  kind: 'video',
                  prompt: '武松挥拳',
                  ...(overrides.videoRef ? { ref: overrides.videoRef } : {}),
                  ...(overrides.legacyVideoNode ? {} : {
                    generation: overrides.invalidGeneration
                      ? { mode: 't2v', durationSeconds: 5, generateAudio: false }
                      : {
                        schemaVersion: 1,
                        mode: overrides.supersededCharacterRef ? 'ref' : 't2v',
                        durationSeconds: 5,
                        generateAudio: false,
                        ...(overrides.supersededCharacterRef ? { references: { extraImageAssetIds: ['asset-character-old'] } } : {}),
                      },
                  }),
                },
              },
            }],
            edges: [],
          },
        },
      },
    },
    graph: { nodes: [], edges: [] },
  }
}

function createContext(overrides: ContextOverrides = {}): ExtensionContext {
  const assets = [
    {
      id: 'asset-character',
      kind: 'image',
      status: 'ready',
      productionType: 'character_ref',
      prompt: characterPrompt,
      meta: {
        characterPreview: {
          characterId: 'c1',
          sourcePromptHash: characterPreviewSourceHash(characterDescription, characterPrompt),
        },
        kinoResourceId: 'kino-character',
      },
    },
    {
      id: 'asset-scene',
      kind: 'image',
      status: 'ready',
      productionType: 'scene_ref',
      prompt: scenePrompt,
      meta: {
        scenePreview: {
          sceneId: 's1',
          sourcePromptHash: scenePreviewSourceHash(sceneDescription, scenePrompt),
        },
        kinoResourceId: 'kino-scene',
      },
    },
    ...(overrides.supersededCharacterRef ? [{
      id: 'asset-character-old',
      kind: 'image',
      status: 'ready',
      productionType: 'character_ref',
      meta: {
        characterPreview: { characterId: 'c1', sourcePromptHash: 'old' },
        kinoResourceId: 'kino-character-old',
      },
    }] : []),
    ...(overrides.videoStatus ? [{
      id: 'asset-video',
      kind: 'video',
      status: overrides.videoStatus,
      productionType: 'video_clip',
      url: overrides.videoStatus === 'ready' ? 'https://example.test/wusong.mp4' : undefined,
      provenance: { origin: overrides.videoOrigin ?? 'generation', recipe: { version: 1, parameters: {} } },
    }] : []),
  ]
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', json(project(overrides))],
    ['assets/manifest.json', json({
      version: 2,
      assets,
      assetCatalog: {
        version: 1,
        folders: [],
        placements: {
          'character:c1': { folderId: 'root:character', sortKey: '武松', createdAt: 1, updatedAt: 1 },
          'scene:s1': { folderId: 'root:scene', sortKey: '景阳冈', createdAt: 1, updatedAt: 1 },
        },
        entities: {
          character: {
            c1: {
              id: 'c1', name: '武松', description: characterDescription, prompt: characterPrompt,
              current: { assetId: 'asset-character' }, history: [], createdAt: 1, updatedAt: 1,
            },
          },
          scene: overrides.missingSceneDefinition ? {} : {
            s1: {
              id: 's1', name: '景阳冈', description: sceneDescription, prompt: scenePrompt,
              ...(overrides.scenePreviewReady === false ? {} : { current: { assetId: 'asset-scene' } }),
              history: [], createdAt: 1, updatedAt: 1,
            },
          },
          video: {}, icon: {}, control: {}, audio: {}, font: {},
        },
      },
    })],
  ])
  return {
    gameId: 'g',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

type Context = {
  node: { scenes: Array<{ sceneId: string, scene: { id: string } | null }> }
  video: {
    submission: { mode: string, referenceImageResourceIds?: string[] } | null
    assetRefs?: Array<{ id: string }>
    binding: { state: string, bound: boolean, ready: boolean, assetId?: string, source?: string }
  }
  readiness: { readyToSubmit: boolean, issues: string[] }
}

describe('节点生产上下文里的场景', () => {
  it('把节点声明的场景连同定义一起带出', async () => {
    const result = await getNodeProductionContext(createContext(), {
      blueprintId: 'main',
      nodeId: 'n1',
    }) as Context

    expect(result.node.scenes).toHaveLength(1)
    expect(result.node.scenes[0]!.scene?.id).toBe('s1')
  })

  it('场景图和角色图一样进入成片参考图，并让提交转为参考模式', async () => {
    const result = await getNodeProductionContext(createContext(), {
      blueprintId: 'main',
      nodeId: 'n1',
    }) as Context

    expect(result.video.submission?.mode).toBe('ref')
    expect(result.video.submission?.referenceImageResourceIds).toEqual(
      expect.arrayContaining(['kino-character', 'kino-scene']),
    )
    expect(result.readiness.issues.filter((issue) => issue.includes('scene'))).toEqual([])
  })

  it('显式预设里的旧角色图已被 current 替代时不再重复注入', async () => {
    const result = await getNodeProductionContext(createContext({ supersededCharacterRef: true }), {
      blueprintId: 'main', nodeId: 'n1',
    }) as Context

    expect(result.video.submission?.referenceImageResourceIds).toContain('kino-character')
    expect(result.video.submission?.referenceImageResourceIds).not.toContain('kino-character-old')
    expect(result.video.assetRefs?.map((item) => item.id)).not.toContain('asset-character-old')
  })

  it('旧节点缺少 storyText 和显式 generation 时仍可使用已解析的默认预设提交', async () => {
    const result = await getNodeProductionContext(createContext({ legacyVideoNode: true }), {
      blueprintId: 'main',
      nodeId: 'n1',
    }) as Context & { video: Context['video'] & { presetSource: string } }

    expect(result.video.presetSource).toBe('legacy-default')
    expect(result.video.submission).toMatchObject({
      mode: 'ref',
      durationSeconds: KINO_DEFAULT_GENERATION.durationSeconds,
      generateAudio: KINO_DEFAULT_GENERATION.generateAudio,
    })
    expect(result.readiness).toEqual({ readyToSubmit: true, issues: [] })
  })

  it('显式写入但不完整的 generation 仍然阻止提交', async () => {
    const result = await getNodeProductionContext(createContext({ invalidGeneration: true }), {
      blueprintId: 'main',
      nodeId: 'n1',
    }) as Context

    expect(result.readiness.readyToSubmit).toBe(false)
    expect(result.readiness.issues).toContain('generation.schemaVersion 必须为 1')
  })

  it('场景缺图时算未就绪，且指名是哪个场景', async () => {
    const result = await getNodeProductionContext(createContext({ scenePreviewReady: false }), {
      blueprintId: 'main',
      nodeId: 'n1',
    }) as Context

    expect(result.readiness.readyToSubmit).toBe(false)
    expect(result.readiness.issues).toContain('scene s1 preview is missing or stale')
  })

  it('显式声明不作为视频参考的场景不进参考图，也不因缺图拦住提交', async () => {
    const result = await getNodeProductionContext(
      createContext({ useAsVideoReference: false, scenePreviewReady: false }),
      { blueprintId: 'main', nodeId: 'n1' },
    ) as Context

    expect(result.video.submission?.referenceImageResourceIds).not.toContain('kino-scene')
    expect(result.readiness.issues).not.toContain('scene s1 preview is missing or stale')
  })

  it('节点引用了目录里不存在的场景时明确报出来', async () => {
    const context = createContext({ missingSceneDefinition: true })

    const result = await getNodeProductionContext(context, {
      blueprintId: 'main',
      nodeId: 'n1',
    }) as Context

    expect(result.readiness.issues).toContain(
      'scene s1 is declared on the node but missing from the catalog',
    )
  })

  it('统一派生上传视频与生成视频的节点绑定状态', async () => {
    const unconfigured = await getNodeProductionContext(createContext(), {
      blueprintId: 'main', nodeId: 'n1',
    }) as Context
    const uploaded = await getNodeProductionContext(createContext({
      videoRef: 'asset-video', videoStatus: 'ready', videoOrigin: 'upload',
    }), { blueprintId: 'main', nodeId: 'n1' }) as Context
    const generating = await getNodeProductionContext(createContext({
      videoRef: 'asset-video', videoStatus: 'generating', videoOrigin: 'generation',
    }), { blueprintId: 'main', nodeId: 'n1' }) as Context

    expect(unconfigured.video.binding).toMatchObject({ state: 'unconfigured', bound: false, ready: false })
    expect(uploaded.video.binding).toMatchObject({
      state: 'ready', bound: true, ready: true, assetId: 'asset-video', source: 'upload',
    })
    expect(generating.video.binding).toMatchObject({
      state: 'processing', bound: true, ready: false, source: 'generation',
    })
  })

  it('区分节点引用失效与视频生成失败', async () => {
    const missing = await getNodeProductionContext(createContext({ videoRef: 'missing-video' }), {
      blueprintId: 'main', nodeId: 'n1',
    }) as Context
    const failed = await getNodeProductionContext(createContext({
      videoRef: 'asset-video', videoStatus: 'failed',
    }), { blueprintId: 'main', nodeId: 'n1' }) as Context

    expect(missing.video.binding).toMatchObject({ state: 'missing', bound: true, ready: false })
    expect(failed.video.binding).toMatchObject({ state: 'failed', bound: true, ready: false })
  })
})
