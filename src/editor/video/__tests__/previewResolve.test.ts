import { describe, expect, it } from 'vitest'
import type { Entity, GraphEffect, Variable } from '@/runtime/core/schema/graph-schema'
import { initState } from '@/runtime/core/engine/engine-init'
import {
  resolveChoicePreviewDetail,
  resolveFloatTextPreviewLabel,
  resolveQteOutcomesPreviewDetail,
  summarizeEffects,
  type PreviewEvalContext,
} from '../previewResolve'

const entities: Record<string, Entity> = {
  'ent-boss': { id: 'ent-boss', kind: 'boss', name: '影魔', attrs: { hp: 1000, defense: 50 } },
  'ent-player': { id: 'ent-player', kind: 'player', name: '主角', attrs: { hp: 500, attack: 40 } },
}
const variables: Record<string, Variable> = {
  qi: { id: 'qi', name: '气力', initial: 3 },
}

function scenarioOf() {
  return { version: 't', variables, entities, graph: { nodes: [], edges: [] } }
}

function ctx(): PreviewEvalContext {
  const evalState = initState(scenarioOf())
  return {
    evalCtx: {
      vars: evalState.vars,
      entities: evalState.entities,
      flags: evalState.flags,
      score: evalState.score,
    },
    entities,
    variables,
  }
}

describe('previewResolve', () => {
  it('飘字：expr 按当前实体属性求值（signed）', () => {
    const label = resolveFloatTextPreviewLabel(
      { text: '伤害 {v}', expr: 'entity.ent-player.attr.attack' },
      ctx(),
    )
    expect(label).toBe('伤害 +40')
  })

  it('飘字：纯 expr 无文案时直接显示数值', () => {
    expect(resolveFloatTextPreviewLabel({ expr: 'entity.ent-boss.attr.hp' }, ctx())).toBe('+1000')
  })

  it('选项：展示每条选项与求值后的效果', () => {
    const state = initState(scenarioOf())
    const detail = resolveChoicePreviewDetail(
      [
        { label: '轻击', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -20 }] },
        { label: '吸气', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 1 }] },
      ],
      ctx(),
      state,
    )
    expect(detail).toContain('轻击')
    expect(detail).toContain('影魔.hp -20')
    expect(detail).toContain('气力 +1')
  })

  it('选项：条件不成立标注锁定', () => {
    const state = initState(scenarioOf())
    const detail = resolveChoicePreviewDetail(
      [{ label: '灭世', condition: { all: [{ type: 'var', varId: 'qi', op: 'gte', value: 5 }] } }],
      ctx(),
      state,
    )
    expect(detail).toContain('灭世（锁定）')
  })

  it('QTE 结算：各档求值后的改数值摘要', () => {
    const state = initState(scenarioOf())
    const detail = resolveQteOutcomesPreviewDetail(
      [
        { handle: 'pass', label: '完美', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -80 }] },
        { handle: 'fail', label: '失败', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -50 }] },
      ],
      state,
      ctx(),
    )
    expect(detail).toContain('完美：影魔.hp -80')
    expect(detail).toContain('失败：主角.hp -50')
  })

  it('summarizeEffects 支持表达式数值', () => {
    const state = initState(scenarioOf())
    const fx: GraphEffect[] = [{
      kind: 'attr',
      entityId: 'ent-boss',
      attr: 'hp',
      op: 'add',
      value: { expr: '-(entity.ent-player.attr.attack)' },
    }]
    expect(summarizeEffects(fx, state, entities, variables)).toBe('影魔.hp -40')
  })

  it('无效表达式不抛错，预览显示无法求值 / ?', () => {
    const state = initState(scenarioOf())
    const fx: GraphEffect[] = [{
      kind: 'attr',
      entityId: 'ent-player',
      attr: 'attack',
      op: 'add',
      value: { expr: 'entity.ent-player.attr.attack-var' },
    }]
    expect(summarizeEffects(fx, state, entities, variables)).toContain('无法求值')
    expect(
      resolveFloatTextPreviewLabel({ text: '伤害 {v}', expr: 'entity.ent-player.attr.attack-var' }, ctx()),
    ).toBe('伤害 ?')
  })
})
