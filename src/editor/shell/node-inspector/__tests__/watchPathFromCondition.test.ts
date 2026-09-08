import { describe, expect, it } from 'vitest'
import type { GraphCondition } from '@/runtime/core/schema/graph-schema'
import { watchPathFromCondition } from '../SettlementSection'

describe('watchPathFromCondition', () => {
  it('derives a watch path from a single clause', () => {
    expect(watchPathFromCondition({
      all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'lte', value: 0 }],
    })).toBe('entity.ent-player.attr.hp')
    expect(watchPathFromCondition({ all: [{ type: 'var', varId: 'qi', op: 'gte', value: 3 }] })).toBe('var.qi')
  })

  // 脏 blueprint 里 state 触发器可能没有 condition，或 condition 没有 all；
  // 切换条件类型时不能因此抛错崩掉整个检查器。
  it('returns an empty path for malformed conditions instead of throwing', () => {
    expect(watchPathFromCondition(undefined)).toBe('')
    expect(watchPathFromCondition({} as GraphCondition)).toBe('')
    expect(watchPathFromCondition({ any: [] } as unknown as GraphCondition)).toBe('')
  })
})
