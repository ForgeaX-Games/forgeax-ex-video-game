import { describe, expect, it } from 'vitest'
import tools from '../tool-handlers'
import manifest from '../../../forgeax-extension.json'
import patchScenesArgs from '../../../schemas/patch-scenes.args.json'
import generateScenePreviewsArgs from '../../../schemas/generate-scene-previews.args.json'
import { ACTIVITY_CONTRACTS } from '../../workflow/activity-contracts'

/**
 * 接线契约：活动契约里授权的工具必须真实存在。
 *
 * 这条断言是为了防止「场景逻辑写完了但没有 Agent 入口」再次发生——
 * 那种状态下场景线会拿到一份授权，然后发现工具不存在，只能报 blocker。
 */
describe('场景工具已接线', () => {
  const toolIds = new Set(Object.keys(tools))
  const manifestIds = new Set(manifest.contributes.tools.map((tool) => tool.id))

  it('patch-scenes 与 generate-scene-previews 都注册了 handler 与 manifest 声明', () => {
    for (const id of ['game-video:patch-scenes', 'game-video:generate-scene-previews']) {
      expect(toolIds.has(id), `${id} handler`).toBe(true)
      expect(manifestIds.has(id), `${id} manifest`).toBe(true)
    }
  })

  it('两个场景工具都对 Agent 可见', () => {
    for (const id of ['game-video:patch-scenes', 'game-video:generate-scene-previews']) {
      const tool = manifest.contributes.tools.find((entry) => entry.id === id)
      expect(tool?.exposedToAI, id).toBe(true)
    }
  })

  it('assets.scene 授权 patch_scenes 以便交付后新建仅资产库场景', () => {
    expect(ACTIVITY_CONTRACTS['assets.scene'].allowedToolNames).toContain(
      'mcp__as-mate-tools__extension__game_video__patch_scenes',
    )
  })

  it('活动契约授权的每个扩展工具都真实存在', () => {
    const declared = new Set(
      Object.values(ACTIVITY_CONTRACTS)
        .flatMap((contract) => contract.allowedToolNames)
        .filter((name) => name.includes('game_video__'))
        // MCP 名 `..._game_video__patch_scenes` → 工具 id `game-video:patch-scenes`
        .map((name) => `game-video:${name.split('game_video__')[1]!.replace(/_/g, '-')}`),
    )
    const missing = [...declared].filter((id) => !toolIds.has(id))
    expect(missing).toEqual([])
  })

  it('场景 schema 不接受 gameSlug，游戏身份来自宿主绑定', () => {
    for (const schema of [patchScenesArgs, generateScenePreviewsArgs]) {
      expect(Object.keys(schema.properties)).not.toContain('gameSlug')
    }
  })

  it('出图仍靠文档修订号防重复计费，但幂等键与活动修订号不再让模型填', () => {
    // 防重复出图的真正防线是文档级乐观锁；幂等键由 Host 从
    // (活动, 活动修订号, 目标) 推导，活动修订号也由 Host 取当前值（设计 §9.7.4）。
    expect(generateScenePreviewsArgs.required).toEqual(['expectedRevision'])
    expect(generateScenePreviewsArgs.properties.idempotencyKey.description)
      .toContain('Host')
    expect(generateScenePreviewsArgs.properties.activityRevision.description)
      .toContain('Host')
  })
})
