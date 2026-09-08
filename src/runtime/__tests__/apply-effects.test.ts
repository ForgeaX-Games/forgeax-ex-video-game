import { describe, expect, it } from 'vitest'
import { applyEffects, type MutableState } from '../core/engine/apply-effects'
import type { GraphEffect } from '../core/schema/graph-schema'
import { createRng } from '../core/engine/rng'

const state = (): MutableState => ({
  vars: { qi: 1 },
  varMeta: { qi: { min: 0, max: 5 } },
  entities: {
    'ent-player': { attrs: { attack: 80, defense: 40, hp: 300 }, attrMeta: { hp: { min: 0, max: 300 } } },
    'ent-boss': { attrs: { attack: 75, defense: 50, hp: 700 }, attrMeta: { hp: { min: 0, max: 700 } } },
  },
  flags: {},
  score: 0,
  rng: createRng(1),
  appliedOnce: new Set<string>(),
})

describe('applyEffects', () => {
  it('applies constant hp damage to an attr', () => {
    const st = state()
    applyEffects(st, [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -100 }])
    expect(st.entities['ent-boss']!.attrs.hp).toBe(600)
  })

  it('applies formula (expr) attr damage', () => {
    const st = state()
    const eff: GraphEffect = {
      id: 'f',
      kind: 'attr',
      entityId: 'ent-boss',
      attr: 'hp',
      op: 'add',
      value: { expr: '-(entity.ent-player.attr.attack * 2 - entity.ent-boss.attr.defense)' },
    }
    applyEffects(st, [eff])
    expect(st.entities['ent-boss']!.attrs.hp).toBe(700 - 110)
  })

  it('clamps attr to attrMeta min (hp not below 0)', () => {
    const st = state()
    applyEffects(st, [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -9999 }])
    expect(st.entities['ent-boss']!.attrs.hp).toBe(0)
  })

  it('clamps var to its varMeta min/max', () => {
    const st = state()
    applyEffects(st, [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 10 }])
    expect(st.vars.qi).toBe(5)
  })

  it('sets a text variable from a literal or another text variable', () => {
    const st = state()
    st.textVars = { title: '序章' }
    applyEffects(st, [
      { kind: 'var', varId: 'subtitle', valueType: 'text', op: 'set', value: { ref: 'var.title' } },
      { kind: 'var', varId: 'title', valueType: 'text', op: 'set', value: '终章' },
    ])
    expect(st.textVars).toEqual({ title: '终章', subtitle: '序章' })
  })

  it('once: applied only the first time', () => {
    const st = state()
    const eff: GraphEffect = { id: 'once1', kind: 'var', varId: 'qi', op: 'add', value: 1, once: true }
    applyEffects(st, [eff])
    applyEffects(st, [eff])
    expect(st.vars.qi).toBe(2)
  })

  it('flag set', () => {
    const st = state()
    applyEffects(st, [{ id: 'fl', kind: 'flag', varId: 'lotusClue', value: true }])
    expect(st.flags.lotusClue).toBe(1)
  })

  it('attr set writes an arbitrary attr', () => {
    const st = state()
    applyEffects(st, [{ id: 's', kind: 'attr', entityId: 'ent-boss', attr: 'speed', op: 'set', value: 35 }])
    expect(st.entities['ent-boss']!.attrs.speed).toBe(35)
  })

  it('mul / set / negative add on attr and var', () => {
    const st = state()
    applyEffects(st, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'mul', value: 0.5 },
      { kind: 'var', varId: 'qi', op: 'set', value: 2.5 },
      { kind: 'var', varId: 'qi', op: 'add', value: -1.5 },
    ])
    // 700 × 0.5 = 350
    expect(st.entities['ent-boss']!.attrs.hp).toBe(350)
    // set 2.5 then add -1.5 → 1；再被 varMeta.min=0 夹住仍为 1
    expect(st.vars.qi).toBe(1)
  })

  it('skips an effect whose expr references a missing formula and still applies later effects', () => {
    const st = state()
    expect(() => {
      applyEffects(st, [
        {
          kind: 'attr',
          entityId: 'ent-boss',
          attr: 'hp',
          op: 'add',
          value: { expr: '-formula.dmg_boss_special' },
        },
        { kind: 'var', varId: 'qi', op: 'add', value: 1 },
      ])
    }).not.toThrow()
    expect(st.entities['ent-boss']!.attrs.hp).toBe(700)
    expect(st.vars.qi).toBe(2)
  })
})
