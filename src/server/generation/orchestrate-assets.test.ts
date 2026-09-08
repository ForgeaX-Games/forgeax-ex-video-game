import { describe, expect, test, vi } from 'vitest'
import { createHostGenerationOrchestrator } from './orchestrate'
import type { HostAssetRegistry } from '../asset-registry'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import type { ExtensionContext } from '@forgeax/extension-host/node'

function createRegistry(): HostAssetRegistry {
  const generated: MediaAsset = {
    id: 'video-asset',
    kind: 'video',
    productionType: 'video_clip',
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    upsert: vi.fn(async (asset) => asset),
    update: vi.fn(async () => null),
    remove: vi.fn(async () => ({ asset: null, clearedReferences: [] })),
    getStyleAxes: vi.fn(async () => undefined),
    setStyleAxes: vi.fn(async (axes) => axes),
    importGameFile: vi.fn(async () => generated),
    mediaReference: vi.fn(async (id) => ({ assetId: `host:${id}` })),
    registerGenerated: vi.fn(async () => generated),
    persistGenerated: vi.fn(async () => generated),
  }
}

describe('host-backed generation references', () => {
  test('preserves dialogueLine and voiceover fields from generated shot scripts', async () => {
    const generateText = vi.fn(async () => ({
      text: JSON.stringify({
        shots: [{
          shotNumber: 2,
          durationSeconds: 3,
          seedancePrompt: '  slow push-in  ',
          dialogueLine: '  你来了。 ',
          voiceover: ' 旁白进入。 ',
        }],
      }),
    }))
    const context = { models: { generateText } } as unknown as ExtensionContext
    const orchestrator = createHostGenerationOrchestrator(context, createRegistry())

    await expect(orchestrator.generateShotScript({
      nodeName: '开场',
      storyText: '主角走进房间',
      durationSeconds: 4,
    })).resolves.toEqual([{
      shotNumber: 2,
      durationSeconds: 3,
      seedancePrompt: 'slow push-in',
      dialogueLine: '你来了。',
      voiceover: '旁白进入。',
    }])
  })

  test('omits blank optional shot text while accepting direct shot arrays', async () => {
    const generateText = vi.fn(async () => ({
      text: JSON.stringify([{
        seedancePrompt: 'wide shot',
        dialogueLine: '   ',
        voiceover: null,
      }]),
    }))
    const context = { models: { generateText } } as unknown as ExtensionContext
    const orchestrator = createHostGenerationOrchestrator(context, createRegistry())

    await expect(orchestrator.generateShotScript({
      nodeName: '空镜',
      storyText: '风吹过树林',
      durationSeconds: 5,
    })).resolves.toEqual([{
      shotNumber: 1,
      durationSeconds: 5,
      seedancePrompt: 'wide shot',
    }])
  })

  test('materializes uploaded references through media.video.generate@1', async () => {
    const registry = createRegistry()
    const invoke = vi.fn(async () => ({
      video: {
        bytes: new Uint8Array([1, 2, 3]),
        mime: 'video/mp4',
        sourceUrl: 'https://kino.example/generated-video.mp4',
        provider: {
          kind: 'kino',
          ref: 'https://kino.example/generated-video.mp4',
          upstreamResourceId: 'generated-video',
        },
      },
    }))
    const context = {
      gameId: 'game-1',
      media: {
        read: vi.fn(async (_gameId: string, assetId: string) => ({
          contentType: 'image/png',
          bytes: new TextEncoder().encode(assetId),
        })),
      },
      capabilities: { invoke },
    } as unknown as ExtensionContext
    const orchestrator = createHostGenerationOrchestrator(context, registry)

    await expect(orchestrator.generateVideo({
      sceneNodeId: 'shot-1',
      nodeName: '开场',
      durationSeconds: 4,
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })).resolves.toEqual(expect.objectContaining({ id: 'video-asset' }))

    expect(registry.mediaReference).toHaveBeenNthCalledWith(1, 'character-1')
    expect(registry.mediaReference).toHaveBeenNthCalledWith(2, 'scene-1')
    expect(invoke).toHaveBeenCalledWith(
      'media.video.generate',
      1,
      expect.objectContaining({
        references: [
          expect.objectContaining({ assetId: 'host:character-1', mime: 'image/png' }),
          expect.objectContaining({ assetId: 'host:scene-1', mime: 'image/png' }),
        ],
        durationSeconds: 4,
        metadata: { sceneNodeId: 'shot-1', nodeName: '开场' },
      }),
      undefined,
    )
  })

  test('fails before calling the host when references are missing', async () => {
    const registry = createRegistry()
    const invoke = vi.fn()
    const context = { capabilities: { invoke } } as unknown as ExtensionContext
    const orchestrator = createHostGenerationOrchestrator(context, registry)

    await expect(orchestrator.generateVideo({
      sceneNodeId: 'shot-1',
      nodeName: '开场',
      durationSeconds: 4,
      characterRefIds: [],
      sceneRefIds: ['scene-1'],
    })).rejects.toThrow('视频生成缺必传参考图')
    expect(invoke).not.toHaveBeenCalled()
  })
})
