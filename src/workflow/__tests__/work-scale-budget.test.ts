import { describe, expect, it } from 'vitest'
import {
  minimumOutlineNodeCount,
  outlineScaleBudgetFailure,
  workScaleBudgetFromValue,
} from '../work-scale-budget'

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

  it('counts one result chapter per beat even when the beat settles two actions', () => {
    expect(minimumOutlineNodeCount({
      beats: [{
        actions: [
          { id: 'early', stateMutationOwner: 'settlement' },
          { id: 'wait', stateMutationOwner: 'settlement' },
        ],
        settlements: [{ sourceActionId: 'early' }, { sourceActionId: 'wait' }],
      }],
    })).toEqual({
      interactiveChapters: 1,
      resultChapters: 1,
      combatActions: 0,
      minNodeCount: 2,
    })
  })

  it('derives the minimum outline from interactive beats plus same-beat result chapters', () => {
    expect(minimumOutlineNodeCount({
      beats: [
        {
          actions: [
            { id: 'hear', stateMutationOwner: 'settlement' },
            { id: 'aside', stateMutationOwner: 'none' },
          ],
          settlements: [{ sourceActionId: 'hear' }],
        },
        {
          actions: [],
          settlements: [],
        },
        {
          actions: [{ id: 'strike', stateMutationOwner: 'settlement', requiredRole: 'combat-command' }],
          settlements: [{ sourceActionId: 'strike' }],
        },
      ],
    })).toEqual({
      interactiveChapters: 2,
      resultChapters: 2,
      combatActions: 1,
      minNodeCount: 4,
    })
  })

  it('rejects a skeleton whose pillar already exceeds the scale cap', () => {
    const budget = workScaleBudgetFromValue('短篇')
    const failure = outlineScaleBudgetFailure({
      beats: Array.from({ length: 16 }, (_, index) => ({
        actions: [{ id: `act-${index + 1}`, stateMutationOwner: 'none' }],
        settlements: [],
      })),
    }, 16, budget)

    expect(failure?.errorCode).toBe('outline.pillar-budget-exceeded')
    expect(failure?.message).toContain('16')
    expect(failure?.message).toContain('15')
  })

  it('rejects a skeleton that adds extra chapters past the scale cap', () => {
    const budget = workScaleBudgetFromValue('短篇')
    const failure = outlineScaleBudgetFailure({
      beats: [{
        actions: [{ id: 'hear', stateMutationOwner: 'settlement' }],
        settlements: [{ sourceActionId: 'hear' }],
      }],
    }, 16, budget)

    expect(failure?.errorCode).toBe('outline.node-count-exceeds-scale')
    expect(failure?.message).toContain('16')
    expect(failure?.message).toContain('15')
  })

  it('does not invent a budget failure when scale is unknown', () => {
    expect(outlineScaleBudgetFailure({
      beats: [{ actions: [{ id: 'hear' }], settlements: [] }],
    }, 16, null)).toBeNull()
  })
})
