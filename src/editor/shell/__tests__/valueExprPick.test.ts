import { describe, expect, it } from 'vitest'
import type { Entity, NumOrExpr, Variable } from '@/runtime/core/schema/graph-schema'
import {
  compileValuePick,
  decodeEffectOperation,
  emptyPickTerm,
  encodeEffectOperation,
  listAttrOptions,
  listEntityOptions,
  normalizeTerms,
  resolveValuePick,
} from '../valueExprPick'

const entities: Record<string, Entity> = {
  'ent-player': {
    id: 'ent-player',
    name: '玩家',
    kind: 'player',
    attrs: { attack: 40, defense: 10 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' }, hp: { label: '生命' } },
  },
  'ent-boss': {
    id: 'ent-boss',
    name: 'Boss',
    kind: 'boss',
    attrs: { attack: 55, defense: 20 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' } },
  },
}
const variables: Record<string, Variable> = {
  qi: { id: 'qi', name: '气力', initial: 0 },
}

describe('valueExprPick', () => {
  it('lists entities and attrs from project meta', () => {
    expect(listEntityOptions(entities).map((e) => e.id)).toEqual(['ent-player', 'ent-boss'])
    expect(listAttrOptions(entities['ent-player']).map((a) => a.id).sort()).toEqual([
      'attack',
      'defense',
      'hp',
    ])
  })

  it('compiles add/sub chain', () => {
    const pick = {
      mode: 'pick' as const,
      terms: [
        { op: '-' as const, source: 'entity' as const, refId: 'ent-player', attr: 'attack' },
        { op: '+' as const, source: 'entity' as const, refId: 'ent-boss', attr: 'defense' },
      ],
    }
    expect(compileValuePick(pick)).toMatchObject({
      expr: '(-entity.ent-player.attr.attack+entity.ent-boss.attr.defense)',
    })
  })

  it('compiles attr * attr', () => {
    const pick = {
      mode: 'pick' as const,
      terms: [
        { op: '+' as const, source: 'entity' as const, refId: 'ent-player', attr: 'attack' },
        { op: '*' as const, source: 'entity' as const, refId: 'ent-boss', attr: 'defense' },
      ],
    }
    expect(compileValuePick(pick)).toMatchObject({
      expr: '(entity.ent-player.attr.attack*entity.ent-boss.attr.defense)',
    })
  })

  it('compiles division and const factor', () => {
    expect(
      compileValuePick({
        mode: 'pick',
        terms: [
          { op: '+', source: 'var', refId: 'qi' },
          { op: '/', source: 'const', refId: '', constValue: 2 },
        ],
      }),
    ).toMatchObject({ expr: '(var.qi/2)' })
  })

  it('normalizes: keeps op as-is (incl. first term ×÷), clears cross-source fields', () => {
    expect(
      normalizeTerms([
        { op: '*', source: 'var', refId: 'qi' },
        { op: '-', source: 'const', refId: 'stray', constValue: 2 },
      ]),
    ).toEqual([
      { op: '*', source: 'var', refId: 'qi', attr: undefined, constValue: undefined },
      { op: '-', source: 'const', refId: '', attr: undefined, constValue: 2 },
    ])
  })

  it('compiles first-term × as identity, ÷ as reciprocal (no left operand to combine with)', () => {
    expect(
      compileValuePick({
        mode: 'pick',
        terms: [{ op: '*', source: 'entity', refId: 'ent-player', attr: 'attack' }],
      }),
    ).toMatchObject({ expr: 'entity.ent-player.attr.attack' })
    expect(
      compileValuePick({
        mode: 'pick',
        terms: [{ op: '/', source: 'entity', refId: 'ent-player', attr: 'attack' }],
      }),
    ).toMatchObject({ expr: '1/(entity.ent-player.attr.attack)' })
  })

  it('compiles const mode', () => {
    expect(compileValuePick({ mode: 'const', const: 100 })).toBe(100)
    expect(compileValuePick({ mode: 'const', const: -30 })).toBe(-30)
  })

  it('resolve 常量保留负号（结算扣血可直接填 -10）', () => {
    expect(resolveValuePick(-10, entities, variables)).toEqual({ mode: 'const', const: -10 })
    expect(resolveValuePick(0, entities, variables)).toEqual({ mode: 'const', const: 0 })
  })

  it('resolve prefers stored sidecar pick', () => {
    const pick = resolveValuePick(
      { expr: 'old' },
      entities,
      variables,
      { mode: 'pick', terms: [{ op: '+', source: 'entity', refId: 'ent-player', attr: 'attack' }] },
    )
    expect(pick.mode).toBe('pick')
    if (pick.mode === 'pick') expect(pick.terms[0]?.attr).toBe('attack')
  })

  it('infers simple entity and variable references without writing a sidecar', () => {
    expect(resolveValuePick({ expr: 'entity.ent-player.attr.attack' }, entities, variables)).toEqual({
      mode: 'pick',
      terms: [{ op: '+', source: 'entity', refId: 'ent-player', attr: 'attack' }],
    })
    expect(resolveValuePick('var.qi', entities, variables)).toEqual({
      mode: 'pick',
      terms: [{ op: '+', source: 'var', refId: 'qi' }],
    })
  })

  it('keeps complex expressions without a sidecar in the read-only compatibility state', () => {
    expect(resolveValuePick(
      { expr: 'entity.ent-player.attr.attack * 2' },
      entities,
      variables,
    )).toEqual({ mode: 'pick', terms: [] })
    expect(resolveValuePick('max(var.qi, 1)', entities, variables)).toEqual({
      mode: 'pick',
      terms: [],
    })
  })

  it('round-trips compile → resolve via embedded pick', () => {
    const source = {
      mode: 'pick' as const,
      terms: [
        { op: '-' as const, source: 'entity' as const, refId: 'ent-player', attr: 'attack' },
        { op: '*' as const, source: 'const' as const, refId: '', constValue: 2 },
      ],
    }
    const compiled = compileValuePick(source)
    const back = resolveValuePick(compiled, entities, variables)
    expect(back).toEqual(source)
  })

  it('Effect 层减/除使用可逆包装，切换运算时保留原始操作数', () => {
    expect(encodeEffectOperation('sub', 10)).toEqual({ op: 'add', value: { expr: '-(10)' } })
    expect(decodeEffectOperation('add', { expr: '-(10)' })).toEqual({ op: 'sub', value: 10 })
    expect(encodeEffectOperation('div', 2)).toEqual({ op: 'mul', value: { expr: '1/(2)' } })
    expect(decodeEffectOperation('mul', { expr: '1/(2)' })).toEqual({ op: 'div', value: 2 })
    expect(decodeEffectOperation('add', -10)).toEqual({ op: 'add', value: -10 })
    expect(decodeEffectOperation('add', { expr: '-(0)' })).toEqual({ op: 'sub', value: 0 })
    expect(decodeEffectOperation('mul', { expr: '1/(0)' })).toEqual({ op: 'div', value: 0 })
  })

  it('Effect 层减/除包装保留公式 pick，编辑公式后仍能维持当前运算', () => {
    const formulaValue = {
      expr: 'var.qi',
      pick: { mode: 'formula' as const, formulaId: 'f1', holeBindings: {} },
    }
    const encoded = encodeEffectOperation('div', formulaValue as unknown as NumOrExpr)
    expect(encoded).toEqual({
      op: 'mul',
      value: {
        expr: '1/(var.qi)',
        pick: formulaValue.pick,
      },
    })
    expect(decodeEffectOperation(encoded.op, encoded.value)).toEqual({ op: 'div', value: formulaValue })

    const damage = encodeEffectOperation('sub', formulaValue as unknown as NumOrExpr)
    expect(damage).toEqual({
      op: 'add',
      value: {
        expr: '-(var.qi)',
        pick: formulaValue.pick,
      },
    })
    expect(decodeEffectOperation(damage.op, damage.value)).toEqual({ op: 'sub', value: formulaValue })
  })

  it('emptyPickTerm seeds from catalog', () => {
    const t = emptyPickTerm(entities, variables)
    expect(t.source).toBe('entity')
    expect(t.refId).toBe('ent-player')
    expect(t.attr).toBeTruthy()
  })
})
