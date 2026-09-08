import { describe, expect, it } from 'vitest'
import { getSubProcess, isGameGraph, type GameGraph, type GameNode } from '../core/schema/graph-schema'

const minimal: GameGraph = {
  nodes: [
    {
      id: 'n1',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '开场' },
    },
  ],
  edges: [],
}

describe('graph-schema', () => {
  it('accepts a minimal valid GameGraph', () => {
    expect(isGameGraph(minimal)).toBe(true)
  })

  it('rejects non-graph shapes', () => {
    expect(isGameGraph(null)).toBe(false)
    expect(isGameGraph({})).toBe(false)
    expect(isGameGraph({ nodes: [], edges: {} })).toBe(false)
  })

  it('rejects node with missing/empty type (浅守卫只认非空字符串)', () => {
    expect(
      isGameGraph({
        nodes: [{ id: 'x', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'a' } }],
        edges: [],
      }),
    ).toBe(false)
    expect(
      isGameGraph({
        nodes: [{ id: 'x', type: '', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'a' } }],
        edges: [],
      }),
    ).toBe(false)
  })

  it('accepts 非 perf 的字符串 type（合法集合由 NodeKindRegistry/validate 判定，非浅守卫职责）', () => {
    expect(
      isGameGraph({
        nodes: [{ id: 'x', type: 'skill', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'a' } }],
        edges: [],
      }),
    ).toBe(true)
  })

  it('getSubProcess reads an embedded graph', () => {
    const process = { entry: 'n1', graph: minimal }
    expect(getSubProcess({ name: 'a', subProcess: process })).toBe(process)
    expect(getSubProcess({ name: 'a' } as GameNode['data'])).toBeUndefined()
  })
})
