import { describe, expect, it } from 'vitest'
import {
  VALIDATION_CHECK_GROUPS,
  expandCheckIds,
  isValidationCheckGroup,
} from '../../workflow/validation-check-groups'

describe('validation-check-groups', () => {
  it('展开组合 id 为叶子并保持顺序', () => {
    expect(expandCheckIds(['blueprint.data.valid', 'playtest.playability.valid'])).toEqual([
      'graph.connected',
      'edge.no-producer',
      'runtime.shape.valid',
      'playtest.paths-not-illegally-stuck',
      'playtest.rules-executable',
      'playtest.numeric-sanity',
    ])
  })

  it('叶子 id 可单独请求且与组合去重', () => {
    expect(expandCheckIds(['edge.no-producer', 'blueprint.data.valid'])).toEqual([
      'edge.no-producer',
      'graph.connected',
      'runtime.shape.valid',
    ])
  })

  it('识别已知组合 id', () => {
    expect(isValidationCheckGroup('blueprint.data.valid')).toBe(true)
    expect(isValidationCheckGroup('graph.connected')).toBe(false)
  })

  it('组合成员非空', () => {
    for (const [groupId, members] of Object.entries(VALIDATION_CHECK_GROUPS)) {
      expect(members.length, groupId).toBeGreaterThan(0)
    }
  })
})
