import { describe, expect, it } from 'vitest'
import { workScaleBudgetFromValue } from '../work-scale-budget'

describe('work scale budget', () => {
  it.each([
    ['极短（3个蓝图节点、2个角色、1个场景）', 'micro', 3, 2, 1],
    ['极短（3个章节、2个角色、1个场景）', 'micro', 3, 2, 1],
    ['短篇（10个蓝图节点）', 'short', 10, undefined, undefined],
    ['短篇（10个章节）', 'short', 10, undefined, undefined],
    ['中篇（15个蓝图节点）', 'medium', 15, undefined, undefined],
    ['中篇（15个章节）', 'medium', 15, undefined, undefined],
    ['长篇（20个蓝图节点）', 'long', 20, undefined, undefined],
    ['长篇（20个章节）', 'long', 20, undefined, undefined],
  ] as const)('maps %s to its production budget', (value, id, nodes, characters, scenes) => {
    expect(workScaleBudgetFromValue(value)).toMatchObject({
      id,
      nodeCount: nodes,
      ...(characters === undefined ? {} : { characterCount: characters }),
      ...(scenes === undefined ? {} : { sceneCount: scenes }),
    })
  })

  it('keeps legacy short labels readable and rejects an unknown scale', () => {
    expect(workScaleBudgetFromValue('短篇')?.nodeCount).toBe(10)
    expect(workScaleBudgetFromValue('自定义篇幅')).toBeNull()
  })

  it('caps short designs at 15 nodes while requiring combat', () => {
    expect(workScaleBudgetFromValue('短篇')?.maxNodeCount).toBe(15)
    expect(workScaleBudgetFromValue('短篇')?.minCombatCount).toBe(1)
    expect(workScaleBudgetFromValue('短篇')?.maxCombatCount).toBeUndefined()
  })
})
