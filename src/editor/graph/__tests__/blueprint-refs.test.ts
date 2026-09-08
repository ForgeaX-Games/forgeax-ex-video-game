import { describe, it, expect } from 'vitest'
import { collectPackRefs, blueprintsReferencing, wouldCreateCycle, findReferenceCycle } from '@/authoring/graph/blueprint-refs'
import type { BlueprintDoc } from '@/runtime/core/schema/graph-schema'

const bp = (id: string, refs: string[] = []): BlueprintDoc => ({ id, title: id, entry: 'e',
  graph: {
    nodes: [
      { id: 'e', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'e' } },
      ...refs.map((r, i) => ({
        id: `c${i}`, type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
        data: { name: r, subFlowPack: { id: r } },
      })),
    ],
    edges: [],
  },
})
const map = (docs: BlueprintDoc[]) => Object.fromEntries(docs.map((d) => [d.id, d]))

describe('blueprint-refs', () => {
  it('collectPackRefs finds subFlowPack ids', () => {
    expect([...collectPackRefs(bp('a', ['x', 'y']).graph)].sort()).toEqual(['x', 'y'])
  })
  it('blueprintsReferencing lists referrers', () => {
    const p = map([bp('bp-main', ['a']), bp('a', ['b']), bp('b')])
    expect(blueprintsReferencing(p, 'b')).toEqual(['a'])
  })
  it('wouldCreateCycle: self-ref is a cycle', () => {
    expect(wouldCreateCycle(map([bp('a')]), 'a', 'a')).toBe(true)
  })
  it('wouldCreateCycle: a->b when b->a already', () => {
    const p = map([bp('a'), bp('b', ['a'])])
    expect(wouldCreateCycle(p, 'a', 'b')).toBe(true)
  })
  it('wouldCreateCycle: a->b when acyclic', () => {
    const p = map([bp('a'), bp('b')])
    expect(wouldCreateCycle(p, 'a', 'b')).toBe(false)
  })
  it('wouldCreateCycle: terminates when map already contains a cycle', () => {
    const p = map([bp('a', ['b']), bp('b', ['c']), bp('c', ['a']), bp('x')])
    expect(wouldCreateCycle(p, 'x', 'a')).toBe(false)
  })
  it('findReferenceCycle: acyclic → null', () => {
    const p = map([bp('bp-main', ['a']), bp('a', ['b']), bp('b')])
    expect(findReferenceCycle(p)).toBeNull()
  })
  it('findReferenceCycle: a->b->a → returns the cycle path', () => {
    const p = map([bp('a', ['b']), bp('b', ['a'])])
    const cyc = findReferenceCycle(p)
    expect(cyc).not.toBeNull()
    expect(cyc![0]).toBe(cyc![cyc!.length - 1])
    expect(new Set(cyc)).toEqual(new Set(['a', 'b']))
  })
  it('findReferenceCycle: self-ref → cycle path [id, id]', () => {
    const p = map([bp('a', ['a'])])
    expect(findReferenceCycle(p)).toEqual(['a', 'a'])
  })
})
