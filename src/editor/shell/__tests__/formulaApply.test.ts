import { describe, expect, it } from 'vitest'
import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import {
  compileFormula,
  formulaHoleBindingIssues,
  formulaHoles,
  formulaPreview,
  missingFormulaHoles,
  missingFormulaVariables,
  recompileFormulaUsages,
} from '@/authoring/formulas/formula-apply'

const entities: Record<string, Entity> = {
  'ent-player': {
    id: 'ent-player',
    name: '玩家',
    attrs: { attack: 40, defense: 10 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' } },
  },
  'ent-boss': {
    id: 'ent-boss',
    name: 'Boss',
    attrs: { attack: 55, defense: 20 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' } },
  },
}

// 伤害 = ❓(约定属性 attack) − ent-boss.防御
const damageFormula: Formula = {
  id: 'formula-dmg',
  name: '伤害',
  ast: {
    t: 'bin',
    id: 'b0',
    op: '-',
    a: { t: 'hole', id: 'h0', holeId: 'atk', kind: 'entityAttr', label: '攻击方', suggestAttr: 'attack' },
    b: { t: 'ref', id: 'r0', ref: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'defense' } },
  },
}

describe('formulaApply', () => {
  it('formulaHoles 找出留空位并带上 kind / 约定属性名', () => {
    expect(formulaHoles(damageFormula)).toEqual([
      { holeId: 'atk', kind: 'entityAttr', label: '攻击方', suggestAttr: 'attack' },
    ])
  })

  it('missingFormulaHoles 报告尚未填全的留空位', () => {
    expect(missingFormulaHoles(damageFormula, {})).toHaveLength(1)
    // 绑定实体后，属性由 suggestAttr 兜底 → 视为填全
    expect(missingFormulaHoles(damageFormula, { atk: { kind: 'entityAttr', entityId: 'ent-player' } })).toEqual([])
  })

  it('formulaPreview 把未填空位标成 ?名字', () => {
    expect(formulaPreview(damageFormula)).toContain('?')
  })

  it('missingFormulaVariables 同时检查公式直接引用和变量空位绑定', () => {
    const formula: Formula = {
      id: 'formula-vars',
      ast: {
        t: 'bin',
        id: 'b0',
        op: '+',
        a: { t: 'ref', id: 'r0', ref: { kind: 'var', varId: 'rage' } },
        b: { t: 'hole', id: 'h0', holeId: 'bonus', kind: 'var', label: '加成' },
      },
    }
    const variables: Record<string, Variable> = {
      rage: { id: 'rage', name: '怒气', initial: 0 },
    }
    expect(missingFormulaVariables(
      formula,
      { bonus: { kind: 'var', varId: 'combo' } },
      variables,
    )).toEqual(['combo'])
  })

  it('compileFormula 用 holeBindings 套回留空位，编译出具体 expr（并归一 attr）', () => {
    const result = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    expect(result).toMatchObject({
      expr: 'entity.ent-player.attr.attack - entity.ent-boss.attr.defense',
      pick: {
        mode: 'formula',
        formulaId: 'formula-dmg',
        holeBindings: { atk: { kind: 'entityAttr', entityId: 'ent-player', attr: 'attack' } },
      },
    })
  })

  it('compileFormula 未填满留空位 → expr 兜底为 "0"（不完整不外泄半成品）', () => {
    expect(compileFormula(damageFormula, {}, entities)).toMatchObject({ expr: '0' })
  })

  it('普通数值参数可在每次应用时绑定不同敌我实体属性', () => {
    const reusableFormula: Formula = {
      id: 'formula-reusable-dmg',
      name: '通用伤害',
      ast: {
        t: 'bin',
        id: 'damage',
        op: '-',
        a: { t: 'hole', id: 'attacker', holeId: 'attacker', kind: 'number', label: '攻击方属性' },
        b: { t: 'hole', id: 'defender', holeId: 'defender', kind: 'number', label: '防御方属性' },
      },
    }
    const playerVsBoss = compileFormula(reusableFormula, {
      attacker: { kind: 'entityAttr', entityId: 'ent-player', attr: 'attack' },
      defender: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'defense' },
    }, entities)
    const bossVsPlayer = compileFormula(reusableFormula, {
      attacker: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'attack' },
      defender: { kind: 'entityAttr', entityId: 'ent-player', attr: 'defense' },
    }, entities)

    expect(playerVsBoss).toMatchObject({
      expr: 'entity.ent-player.attr.attack - entity.ent-boss.attr.defense',
    })
    expect(bossVsPlayer).toMatchObject({
      expr: 'entity.ent-boss.attr.attack - entity.ent-player.attr.defense',
    })
  })

  it('报告已删除的实体或属性绑定，并阻止继续编译失效引用', () => {
    const issues = formulaHoleBindingIssues(
      damageFormula,
      { atk: { kind: 'entityAttr', entityId: 'ent-player', attr: 'power' } },
      entities,
    )

    expect(issues).toEqual([
      { holeId: 'atk', label: '攻击方', reason: '属性「power」已不存在' },
    ])
    expect(missingFormulaHoles(
      damageFormula,
      { atk: { kind: 'entityAttr', entityId: 'deleted-enemy', attr: 'attack' } },
      entities,
    )).toHaveLength(1)
    expect(compileFormula(
      damageFormula,
      { atk: { kind: 'entityAttr', entityId: 'deleted-enemy', attr: 'attack' } },
      entities,
    )).toMatchObject({
      expr: '0',
      pick: {
        holeBindings: {
          atk: { kind: 'entityAttr', entityId: 'deleted-enemy', attr: 'attack' },
        },
      },
    })
  })

  it('recompileFormulaUsages 深度遍历命中已应用处并按公式最新定义重编译', () => {
    const applied = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    const tree = {
      graph: { nodes: [{ id: 'n1', data: { effects: [{ kind: 'addAttr', value: applied }] } }], edges: [] },
      meta: { formulas: { 'formula-dmg': damageFormula }, entities },
    }
    // 公式定义改成加法（原本减法）
    const editedFormula: Formula = { ...damageFormula, ast: { ...damageFormula.ast, op: '+' } as Formula['ast'] }
    const next = recompileFormulaUsages(tree, { 'formula-dmg': editedFormula }, entities)
    const nextValue = (next.graph.nodes[0]!.data.effects[0] as { value: unknown }).value
    expect(nextValue).toMatchObject({ expr: 'entity.ent-player.attr.attack + entity.ent-boss.attr.defense' })
  })

  it('recompileFormulaUsages 未变化的分支保持引用不变（避免撤销历史抖动）', () => {
    const applied = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    const untouchedBranch = { kind: 'other', foo: 'bar' }
    const tree = {
      graph: { nodes: [{ id: 'n1', data: { effects: [{ kind: 'addAttr', value: applied }] } }], edges: [] },
      meta: { formulas: { 'formula-dmg': damageFormula }, entities },
      untouched: untouchedBranch,
    }
    const next = recompileFormulaUsages(tree, { 'formula-dmg': damageFormula }, entities)
    expect(next.untouched).toBe(untouchedBranch)
  })

  it('recompileFormulaUsages 公式被删除时原样保留旧 expr（不报错、不清空）', () => {
    const applied = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    const tree = { value: applied }
    const next = recompileFormulaUsages(tree, {}, entities)
    expect(next.value).toEqual(applied)
  })
})
