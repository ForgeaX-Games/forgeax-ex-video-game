import { describe, expect, it } from 'vitest'
import { isCurrentScenePreview, scenePreviewSourceHash } from '../generation/scene-previews'
import type { MediaAsset } from '@/authoring/assets/registry-types'

/**
 * 作者手动重出的场景图必须被认作该场景的当前参考图。
 *
 * 角色那条路上 `registerKinoReference` 会写 `meta.characterPreview`
 * （含 sourcePromptHash），所以手动出的角色图不会被 Agent 判成过期再覆盖。
 * 场景此前没有对应的 `scenePreview` 快照：作者刚修好的图会被判为不当前，
 * 下一轮出图直接盖掉——出图失败过的场景恰恰最需要人手动修。
 */
describe('手动场景参考图的身份', () => {
  const description = '幽深岩穴，湿滑石壁'
  const prompt = '月夜岩穴，冷光'

  function asset(meta: Record<string, unknown>): MediaAsset {
    return {
      id: 'a-sceneref-manual',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      label: '岩穴',
      prompt,
      sourceModule: 'game-video',
      mime: 'image/png',
      provider: { kind: 'local', ref: 'm1' },
      createdAt: 1,
      updatedAt: 1,
      meta,
    } as unknown as MediaAsset
  }

  it('带 scenePreview 快照时判为当前', () => {
    const current = asset({
      scenePreview: {
        sceneId: 'scene_cave',
        sourcePrompt: prompt,
        sourcePromptHash: scenePreviewSourceHash(description, prompt),
        mode: 'manual',
      },
    })

    expect(isCurrentScenePreview(current, prompt, description)).toBe(true)
  })

  it('场景设定改过之后，旧的手动图判为过期', () => {
    const stale = asset({
      scenePreview: {
        sceneId: 'scene_cave',
        sourcePrompt: prompt,
        sourcePromptHash: scenePreviewSourceHash('旧的岩穴描述', prompt),
        mode: 'manual',
      },
    })

    expect(isCurrentScenePreview(stale, prompt, description)).toBe(false)
  })
})
