import { describe, expect, it } from 'vitest'
import {
  COMPILED_VIDEO_GAME_ACTIVITIES,
  DISPATCHABLE_VIDEO_GAME_ACTIVITIES,
  isCompiledActivity,
  VIDEO_GAME_ACTIVITIES,
} from '../contracts'
import { ACTIVITY_CONTRACTS } from '../activity-contracts'

/**
 * 支柱是唯一的创作面，下游全是编译。
 *
 * 总脉络 / 规则 / 界面 / 整装原本是四个 LLM 活动，各自把支柱里的自然语言再解释
 * 一遍。那不是编译而是二次创作，产物又落在支柱期可执行性证明的覆盖范围之外——
 * 「支柱过门 → 下游无解重试」因此反复复发，最后一次在终局节点上空转 76 分钟，
 * 编排者自己打了 194 次节点配置。
 *
 * 它们现在是 Host 拥有的编译阶段：保留在活动表里，因为侧栏进度和问题归因都需要
 * 它们；但没有任何 agent 工具面，也不能被派发。
 */
describe('compiled activities have no agent surface', () => {
  it('lists the six downstream stages as compiler phases', () => {
    expect([...COMPILED_VIDEO_GAME_ACTIVITIES]).toEqual([
      'blueprint.outline',
      'rules.catalog',
      'ui.authoring',
      'rules.binding',
      'game.finalizing',
      'playtest.validating',
    ])
  })

  it('keeps them in the activity table so progress and issue owners still resolve', () => {
    for (const activity of COMPILED_VIDEO_GAME_ACTIVITIES) {
      expect(VIDEO_GAME_ACTIVITIES).toContain(activity)
    }
  })

  // An empty allowedToolNames is the machine-checkable form of "no peer works
  // here". Leaving even the read tools on invites a peer to be dispatched into
  // a stage the compiler already owns.
  it('grants them no tools at all', () => {
    for (const activity of COMPILED_VIDEO_GAME_ACTIVITIES) {
      expect(ACTIVITY_CONTRACTS[activity].allowedToolNames).toEqual([])
    }
  })

  it('excludes them from the dispatchable set', () => {
    for (const activity of COMPILED_VIDEO_GAME_ACTIVITIES) {
      expect(DISPATCHABLE_VIDEO_GAME_ACTIVITIES).not.toContain(activity)
    }
  })

  it('keeps the author-facing stages dispatchable', () => {
    expect(DISPATCHABLE_VIDEO_GAME_ACTIVITIES).toContain('document.pillar')
    expect(DISPATCHABLE_VIDEO_GAME_ACTIVITIES).toContain('characters.modeling')
    expect(DISPATCHABLE_VIDEO_GAME_ACTIVITIES).not.toContain('playtest.validating')
  })

  it('classifies activities through isCompiledActivity', () => {
    expect(isCompiledActivity('blueprint.outline')).toBe(true)
    expect(isCompiledActivity('document.pillar')).toBe(false)
  })
})
