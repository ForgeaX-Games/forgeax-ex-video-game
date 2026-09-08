import { describe, expect, it } from 'vitest'
import { evaluateCondition } from '../core/engine/condition'
import type { MutableState } from '../core/engine/apply-effects'
import type { GraphCondition } from '../core/schema/graph-schema'

const state = (): MutableState => ({
  vars: { qi: 3 },
  entities: {
    'ent-player': { attrs: { hp: 300, speed: 30 }, attrMeta: { hp: { max: 300 } } },
    'ent-boss': { attrs: { hp: 0, speed: 25 }, attrMeta: { hp: { max: 700 } } },
  },
  flags: { lotusClue: 1 },
  score: 120,
})

const cond = (c: GraphCondition) => evaluateCondition(c, { state: state(), visited: new Set(['open']) })

describe('evaluateCondition', () => {
  it('empty all → true', () => {
    expect(cond({ all: [] })).toBe(true)
  })
  it('var compare', () => {
    expect(cond({ all: [{ type: 'var', varId: 'qi', op: 'gte', value: 3 }] })).toBe(true)
    expect(cond({ all: [{ type: 'var', varId: 'qi', op: 'gt', value: 3 }] })).toBe(false)
  })
  it('compares text variables with equality operators only', () => {
    const st = state()
    st.textVars = { chapter: '序章', expected: '序章' }
    expect(evaluateCondition(
      { all: [{ type: 'var', varId: 'chapter', valueType: 'text', op: 'eq', value: { ref: 'var.expected' } }] },
      { state: st, visited: new Set() },
    )).toBe(true)
    expect(evaluateCondition(
      { all: [{ type: 'var', varId: 'chapter', valueType: 'text', op: 'neq', value: '终章' }] },
      { state: st, visited: new Set() },
    )).toBe(true)
  })
  it('flag & visited(nodeId)', () => {
    expect(cond({ all: [{ type: 'flag', varId: 'lotusClue', equals: true }] })).toBe(true)
    expect(cond({ all: [{ type: 'visited', nodeId: 'open' }] })).toBe(true)
    expect(cond({ all: [{ type: 'visited', nodeId: 'nope' }] })).toBe(false)
  })
  it('attrRatio (boss dead) & attr direct', () => {
    expect(cond({ all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] })).toBe(true)
    expect(cond({ all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'gt', value: 0 }] })).toBe(true)
  })
  it('score & attrCompare(speed)', () => {
    expect(cond({ all: [{ type: 'score', op: 'gte', value: 100 }] })).toBe(true)
    expect(cond({ all: [{ type: 'attrCompare', left: 'ent-player', attr: 'speed', op: 'gte', right: 'ent-boss' }] })).toBe(true)
  })
  it('all clauses AND', () => {
    expect(
      cond({
        all: [
          { type: 'attrRatio', entityId: 'ent-player', attr: 'hp', op: 'gt', value: 0 },
          { type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'gt', value: 0 },
        ],
      }),
    ).toBe(false)
  })
  // 脏 blueprint：condition 存在但没有 all（例如 AI 写成 { any: [...] } 或空对象）。
  // 语义与「没有 condition」一致（无子句 = 不约束），关键是不能抛 TypeError 崩掉调用方。
  it('condition without an all array behaves like no condition', () => {
    expect(cond({} as GraphCondition)).toBe(true)
    expect(cond({ any: [] } as unknown as GraphCondition)).toBe(true)
  })
})
