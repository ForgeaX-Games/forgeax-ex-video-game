import { describe, it, expect } from 'vitest'
import { isBlueprintDoc, resolveGraphEntry, type GraphLibraryDocument, type GameGraph } from '../core/schema/graph-schema'

const node = (id: string, x = 0, y = 0) =>
  ({ id, type: 'perf' as const, position: { x, y }, inputs: [], outputs: [], data: { name: id } })

describe('blueprint types', () => {
  it('isBlueprintDoc rejects non-doc', () => {
    expect(isBlueprintDoc(null)).toBe(false)
    expect(isBlueprintDoc({ id: 'x' })).toBe(false)
  })
  it('isBlueprintDoc accepts a minimal doc', () => {
    expect(isBlueprintDoc({ id: 'bp-main', title: 'M', entry: 'n1',
      graph: { nodes: [], edges: [] },
    })).toBe(true)
  })
  it('GraphLibraryDocument shape compiles', () => {
    const p: GraphLibraryDocument = {
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      manifest: { version: 'game-video.blueprint-manifest.v1', mainPackId: 'bp-main', packs: {} },
    }
    expect(p.manifest.mainPackId).toBe('bp-main')
  })
})

describe('resolveGraphEntry', () => {
  it('keeps preferred when the node still exists', () => {
    const g: GameGraph = { nodes: [node('a', 0), node('b', 100)], edges: [] }
    expect(resolveGraphEntry(g, 'b')).toBe('b')
  })
  it('falls back to leftmost root when preferred is missing', () => {
    const g: GameGraph = {
      nodes: [node('n2', 100, 0), node('n1', 40, 0), node('n3', 200, 0)],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'default', targetHandle: 'in' },
        { id: 'e2', source: 'n2', target: 'n3', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    expect(resolveGraphEntry(g, 'entry')).toBe('n1')
  })
  it('empty graph → undefined', () => {
    expect(resolveGraphEntry({ nodes: [], edges: [] }, 'entry')).toBeUndefined()
  })
})
