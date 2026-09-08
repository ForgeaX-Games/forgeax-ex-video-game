import { describe, expect, it } from 'vitest'
import { initState } from '../core/engine/engine-init'
import { createRng } from '../core/engine/rng'
import type { GameScenario } from '../core/schema/graph-schema'

const scn = (): GameScenario => ({
  version: 'test',
  variables: {
    qi: { id: 'qi', name: '气力', initial: 1, min: 0, max: 5 },
    lotusClue: { id: 'lotusClue', name: '线索', initial: 0 },
    chapterTitle: { id: 'chapterTitle', name: '章节标题', initial: '序章' },
  },
  entities: {
    'ent-player': { id: 'ent-player', kind: 'player', attrs: { speed: 30, hp: 300 }, attrMeta: { hp: { max: 300, initial: 300 } } },
    'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { attack: 75 }, attrMeta: { hp: { max: 700, initial: 700 } } },
  },
  graph: { nodes: [], edges: [] },
})

describe('initState', () => {
  it('seeds vars, varMeta, entities(attrs), rng', () => {
    const st = initState(scn())
    expect(st.vars.qi).toBe(1)
    expect(st.varMeta?.qi).toEqual({ min: 0, max: 5 })
    // 声明变量一律进 vars（flag 桶仅运行时 flag effect 填充）
    expect(st.vars.lotusClue).toBe(0)
    expect(st.textVars).toEqual({ chapterTitle: '序章' })
    expect(st.entities['ent-player']!.attrs.hp).toBe(300)
    expect(st.entities['ent-player']!.attrs.speed).toBe(30)
    expect(st.entities['ent-player']!.attrMeta?.hp?.max).toBe(300)
    // ent-boss 未给 attrs.hp，但 attrMeta.hp.initial=700 → 补上初值
    expect(st.entities['ent-boss']!.attrs.hp).toBe(700)
    expect(st.entities['ent-boss']!.attrs.attack).toBe(75)
    expect(st.score).toBe(0)
  })

  it('defaults rng to seed 0', () => {
    const st = initState(scn())
    expect(st.rng!.next()).toBe(createRng(0).next())
  })

  it('accepts a session rng seed', () => {
    const st = initState(scn(), 42)
    expect(st.rng!.next()).toBe(createRng(42).next())
  })
})
