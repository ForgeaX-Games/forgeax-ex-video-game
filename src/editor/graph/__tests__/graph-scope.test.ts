import { describe, expect, it } from 'vitest'
import type { GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import { addNode, disconnect } from '@/authoring/graph/graph-edit'
import {
  resolveEntryAfterGraphChange, resolveGraphAtPath, resolveGraphEntryAtPath, updateGraphAtPath,
} from '@/authoring/graph/graph-scope'

const node = (id: string, child?: GameGraph): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: child ? { name: id, subProcess: { entry: child.nodes[0]!.id, graph: child } } : { name: id },
})

describe('nested graph scope', () => {
  const leaf: GameGraph = {
    nodes: [node('entry'), node('after')],
    edges: [{ id: 'inner-edge', source: 'entry', target: 'after', sourceHandle: 'default', targetHandle: 'in' }],
  }
  const middle: GameGraph = { nodes: [node('turn', leaf)], edges: [] }
  const root: GameGraph = { nodes: [node('combat', middle), node('outside')], edges: [] }

  it('resolves one and two nested levels', () => {
    expect(resolveGraphAtPath(root, ['combat'])).toBe(middle)
    expect(resolveGraphAtPath(root, ['combat', 'turn'])).toBe(leaf)
    expect(resolveGraphAtPath(root, ['missing'])).toBeUndefined()
  })

  it('adds a node only to the drilled graph', () => {
    const next = updateGraphAtPath(root, ['combat', 'turn'], (graph) => addNode(graph, node('created')))
    expect(next.nodes.map((item) => item.id)).toEqual(['combat', 'outside'])
    expect(resolveGraphAtPath(next, ['combat'])?.nodes.map((item) => item.id)).toEqual(['turn'])
    expect(resolveGraphAtPath(next, ['combat', 'turn'])?.nodes.map((item) => item.id)).toEqual(['entry', 'after', 'created'])
  })

  it('deleting an edge keeps both child nodes in the subProcess', () => {
    const next = updateGraphAtPath(root, ['combat', 'turn'], (graph) => disconnect(graph, 'inner-edge'))
    const child = resolveGraphAtPath(next, ['combat', 'turn'])!
    expect(child.edges).toEqual([])
    expect(child.nodes.map((item) => item.id)).toEqual(['entry', 'after'])
  })

  it('moves a deleted entry to the first surviving successor', () => {
    const branched: GameGraph = {
      nodes: [node('entry'), node('removed-next'), node('survivor'), node('fallback')],
      edges: [
        { id: 'e1', source: 'entry', target: 'removed-next', sourceHandle: 'default', targetHandle: 'in' },
        { id: 'e2', source: 'removed-next', target: 'survivor', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const after: GameGraph = {
      nodes: branched.nodes.filter((item) => item.id !== 'entry' && item.id !== 'removed-next'),
      edges: [],
    }
    expect(resolveEntryAfterGraphChange(branched, after, 'entry')).toBe('survivor')
  })

  it('prefers the default route when a deleted entry has multiple successors', () => {
    const branched: GameGraph = {
      nodes: [node('entry'), node('choice-target'), node('default-target')],
      edges: [
        { id: 'choice', source: 'entry', target: 'choice-target', sourceHandle: 'win', targetHandle: 'in' },
        { id: 'default', source: 'entry', target: 'default-target', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const after: GameGraph = { nodes: branched.nodes.slice(1), edges: [] }
    expect(resolveEntryAfterGraphChange(branched, after, 'entry')).toBe('default-target')
  })

  it('promotes entry upstream when a predecessor is connected', () => {
    const before: GameGraph = {
      nodes: [node('a'), node('b')],
      edges: [],
    }
    const after: GameGraph = {
      nodes: before.nodes,
      edges: [{ id: 'ba', source: 'b', target: 'a', sourceHandle: 'default', targetHandle: 'in' }],
    }
    expect(resolveEntryAfterGraphChange(before, after, 'a')).toBe('b')
  })

  it('walks a predecessor chain to the root', () => {
    const after: GameGraph = {
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { id: 'ba', source: 'b', target: 'a', sourceHandle: 'default', targetHandle: 'in' },
        { id: 'cb', source: 'c', target: 'b', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    expect(resolveEntryAfterGraphChange(after, after, 'a')).toBe('c')
  })

  it('keeps the original entry when upstream walk hits a cycle', () => {
    const after: GameGraph = {
      nodes: [node('a'), node('b')],
      edges: [
        { id: 'ba', source: 'b', target: 'a', sourceHandle: 'default', targetHandle: 'in' },
        { id: 'ab', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    expect(resolveEntryAfterGraphChange(after, after, 'a')).toBe('a')
  })

  it('picks the leftmost predecessor when the entry has multiple in-edges', () => {
    const after: GameGraph = {
      nodes: [
        { ...node('a'), position: { x: 200, y: 0 } },
        { ...node('b'), position: { x: 100, y: 0 } },
        { ...node('c'), position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: 'ba', source: 'b', target: 'a', sourceHandle: 'default', targetHandle: 'in' },
        { id: 'ca', source: 'c', target: 'a', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    expect(resolveEntryAfterGraphChange(after, after, 'a')).toBe('c')
  })

  it('does not move entry back when a predecessor edge is removed', () => {
    const before: GameGraph = {
      nodes: [node('a'), node('b')],
      edges: [{ id: 'ba', source: 'b', target: 'a', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const after: GameGraph = { nodes: before.nodes, edges: [] }
    expect(resolveEntryAfterGraphChange(before, after, 'b')).toBe('b')
  })

  it('updates and resolves a nested subProcess entry when its entry node is deleted', () => {
    const next = updateGraphAtPath(root, ['combat', 'turn'], (graph) => ({
      nodes: graph.nodes.filter((item) => item.id !== 'entry'),
      edges: [],
    }))
    const nested = getSubProcess(next.nodes[0]!.data)!
    const leafProcess = getSubProcess(nested.graph.nodes[0]!.data)!
    expect(leafProcess.entry).toBe('after')
    expect(resolveGraphEntryAtPath(next, 'combat', ['combat', 'turn'])).toBe('after')
  })
})
