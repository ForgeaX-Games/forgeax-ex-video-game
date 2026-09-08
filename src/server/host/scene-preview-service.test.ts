import { describe, expect, it } from 'vitest'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import type { SceneDefinition } from '@/authoring/assets/registry-types'
import {
  isCurrentScenePreview,
  referencedSceneIds,
  requiredScenePreviewTargets,
  scenePreviewAssetId,
  scenePreviewSourceHash,
} from '../generation/scene-previews'
import type { MediaAsset } from '@/authoring/assets/registry-types'

function scene(id: string, name: string, prompt = `${name}，电影质感`): SceneDefinition {
  return { id, name, visual: { description: `${name}的画面`, previewPrompt: prompt } }
}

function project(input: {
  nodeScenes?: string[][]
}): GraphLibraryDocument {
  const nodes = (input.nodeScenes ?? []).map((sceneIds, index) => ({
    id: `node-${index + 1}`,
    type: 'scene' as const,
    position: { x: 0, y: 0 },
    data: { name: `节点${index + 1}`, scenes: sceneIds.map((sceneId) => ({ sceneId })) },
  }))
  return {
    manifest: { mainPackId: 'main', packs: { main: { graph: { nodes, edges: [] } } } },
    graph: { nodes, edges: [] },
  } as unknown as GraphLibraryDocument
}

describe('场景出图目标由 Host 推导', () => {
  it('只取节点已引用的场景，忽略目录里的未使用条目', () => {
    const scenes = { scene_a: scene('scene_a', '山林'), scene_later: scene('scene_later', '还没绑到节点') }
    const doc = project({ nodeScenes: [['scene_a']] })
    expect([...referencedSceneIds(doc, scenes)].sort()).toEqual(['scene_a'])
    expect(requiredScenePreviewTargets(doc, scenes).map((target) => target.sceneId))
      .toEqual(['scene_a'])
  })

  it('跨节点去重且顺序稳定', () => {
    const scenes = { scene_b: scene('scene_b', '天宫'), scene_a: scene('scene_a', '山林') }
    const doc = project({ nodeScenes: [['scene_b', 'scene_a'], ['scene_a']] })
    expect(requiredScenePreviewTargets(doc, scenes).map((target) => target.sceneId)).toEqual(['scene_a', 'scene_b'])
  })

  it('Agent 不能把目标扩大到目录外的场景', () => {
    const scenes = { scene_a: scene('scene_a', '山林') }
    const doc = project({ nodeScenes: [['scene_a']] })
    expect(() => requiredScenePreviewTargets(doc, scenes, ['scene_ghost']))
      .toThrow(/Unknown scene/)
  })

  it('引用了未定义的场景时报错，而不是静默跳过', () => {
    const doc = project({ nodeScenes: [['scene_ghost']] })
    expect(() => requiredScenePreviewTargets(doc, {})).toThrow(/unknown scene/)
  })
})

describe('场景参考图新鲜度', () => {
  const target = () => requiredScenePreviewTargets(
    project({ nodeScenes: [['scene_a']] }),
    { scene_a: scene('scene_a', '山林') },
  )[0]!

  function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
    const current = target()
    return {
      id: 'a-sceneref-a',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      meta: { scenePreview: { sceneId: 'scene_a', sourcePromptHash: current.sourcePromptHash } },
      ...overrides,
    } as MediaAsset
  }

  it('哈希一致时视为当前有效', () => {
    const current = target()
    expect(isCurrentScenePreview(asset(), current.sourcePrompt, current.description)).toBe(true)
  })

  it('场景描述或 Prompt 改过之后旧图判为过期', () => {
    const current = target()
    const stale = asset({
      meta: { scenePreview: { sceneId: 'scene_a', sourcePromptHash: scenePreviewSourceHash('改过的描述', '改过的 Prompt') } },
    })
    expect(isCurrentScenePreview(stale, current.sourcePrompt, current.description)).toBe(false)
  })

  it('还在生成或已失败的资产不算有效', () => {
    const current = target()
    expect(isCurrentScenePreview(asset({ status: 'generating' }), current.sourcePrompt, current.description)).toBe(false)
    expect(isCurrentScenePreview(asset({ status: 'failed' }), current.sourcePrompt, current.description)).toBe(false)
  })

  it('角色参考图不会被当成场景参考图', () => {
    const current = target()
    expect(isCurrentScenePreview(
      asset({ productionType: 'character_ref' }),
      current.sourcePrompt,
      current.description,
    )).toBe(false)
  })

  it('要多机位图时，已有的单幅图判为不满足：否则 skipReady 会把它当成已就绪', () => {
    const current = target()
    expect(isCurrentScenePreview(
      asset(),
      current.sourcePrompt,
      current.description,
      { mode: 'multiview' },
    )).toBe(false)
  })

  it('存量资产没有形态字段，按单幅图解释，不会被误判成缺图重出', () => {
    const current = target()
    expect(isCurrentScenePreview(
      asset(),
      current.sourcePrompt,
      current.description,
      { mode: 'establishing' },
    )).toBe(true)
  })

  it('机位数不同的多机位图互不通用', () => {
    const current = target()
    const fourPanels = asset({
      meta: {
        scenePreview: {
          sceneId: 'scene_a',
          sourcePromptHash: current.sourcePromptHash,
          mode: 'multiview',
          angleCount: 4,
        },
      },
    })
    expect(isCurrentScenePreview(fourPanels, current.sourcePrompt, current.description, {
      mode: 'multiview',
      angleCount: 4,
    })).toBe(true)
    expect(isCurrentScenePreview(fourPanels, current.sourcePrompt, current.description, {
      mode: 'multiview',
      angleCount: 2,
    })).toBe(false)
  })
})

describe('场景参考图的素材身份', () => {
  const target = () => requiredScenePreviewTargets(
    project({ nodeScenes: [['scene_a']] }),
    { scene_a: scene('scene_a', '山林') },
  )[0]!

  it('两种形态落在不同资产 id 上，不会互相覆盖', () => {
    const current = target()
    const single = scenePreviewAssetId(current, { mode: 'establishing' })
    const sheet = scenePreviewAssetId(current, { mode: 'multiview' })

    expect(single).not.toBe(sheet)
    expect(single).toContain('establishing')
    expect(sheet).toContain('multiview4')
    // 不传形态时走默认多机位，与显式指定同一个 id。
    expect(scenePreviewAssetId(current)).toBe(sheet)
  })
})
