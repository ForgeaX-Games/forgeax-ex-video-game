import { describe, expect, test } from 'vitest'
import {
  duplicateNodes,
  insertNodeAfter,
  insertNodeBefore,
  reconnect,
  setNodePosition,
} from '@/authoring/graph/graph-edit'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import { EMPTY_LIBRARY_DOCUMENT } from '@/authoring/blueprint/empty-library'
import type { GameGraph, GameNode, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { validateServiceInput } from './service-validation'
import { applyPatchGraphOps } from './patch-graph-ops'

const node = (id: string, x: number): GameNode => ({
  id,
  type: 'perf',
  position: { x, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id },
})

function documentWithGraph(graph: GameGraph): GraphLibraryDocument {
  const base = normalizeDocument(structuredClone(EMPTY_LIBRARY_DOCUMENT))
  const mainId = base.manifest.mainPackId
  return normalizeDocument({
    ...base,
    graph,
    manifest: {
      ...base.manifest,
      packs: {
        ...base.manifest.packs,
        [mainId]: { ...base.manifest.packs[mainId]!, graph },
      },
    },
  })
}

function canonicalGraph(graph: GameGraph): unknown {
  const edgeIds = new Map(graph.edges.map((edge) => [
    edge.id,
    `${edge.source}:${edge.sourceHandle ?? 'default'}->${edge.target}:${edge.targetHandle ?? 'in'}`,
  ]))
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite)
    if (!value || typeof value !== 'object') return value
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = (key === 'id' || key === 'edgeId') && typeof item === 'string' && edgeIds.has(item)
        ? edgeIds.get(item)
        : rewrite(item)
    }
    return result
  }
  const canonical = rewrite(graph) as GameGraph
  return {
    ...canonical,
    edges: [...canonical.edges].sort((left, right) => left.id.localeCompare(right.id)),
  }
}

describe('前端与 Agent 拓扑编辑语义对齐', () => {
  test('公开 schema 接受持久化拓扑操作，并拒绝空 reconnect', () => {
    const inserted = node('inserted', 120)
    expect(validateServiceInput('patchGraph', {
      ops: [
        { op: 'insert-node-before', beforeId: 'b', node: inserted },
        {
          op: 'duplicate-nodes',
          copies: [{ sourceId: 'a', targetId: 'a-copy' }],
          offset: { x: 40, y: 60 },
        },
        { op: 'reconnect', edgeId: 'e-ab', target: 'c' },
      ],
    })).toEqual([])
    expect(validateServiceInput('patchGraph', {
      ops: [{ op: 'reconnect', edgeId: 'e-ab' }],
    })).not.toEqual([])
  })

  test('移动节点与 setNodePosition 结果完全一致', () => {
    const graph: GameGraph = { nodes: [node('a', 0), node('b', 240)], edges: [] }
    const doc = documentWithGraph(graph)
    const agent = applyPatchGraphOps(doc, {
      ops: [{ op: 'set-node-field', nodeId: 'a', field: 'position', value: { x: 80, y: 120 } }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.document.graph).toEqual(setNodePosition(graph, 'a', { x: 80, y: 120 }))
  })

  test('修改连线目标与 reconnect 结果完全一致并保留 edgeId', () => {
    const graph: GameGraph = {
      nodes: [node('a', 0), node('b', 240), node('c', 480)],
      edges: [{ id: 'e-ab', source: 'a', sourceHandle: 'default', target: 'b', targetHandle: 'in' }],
    }
    const doc = documentWithGraph(graph)
    const agent = applyPatchGraphOps(doc, {
      ops: [{ op: 'reconnect', edgeId: 'e-ab', target: 'c' }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.document.graph).toEqual(reconnect(graph, 'e-ab', { target: 'c' }))
    expect(agent.document.graph.edges[0]).toMatchObject({ id: 'e-ab', target: 'c' })
  })

  test('向前插入节点与 insertNodeBefore 的节点、重接边和引用语义一致', () => {
    const graph: GameGraph = {
      nodes: [
        {
          ...node('a', 0),
          data: {
            name: 'a',
            reactions: [{ when: { type: 'complete' }, do: [{ kind: 'advance', edgeId: 'e-ab' }] }],
          },
        },
        node('b', 240),
      ],
      edges: [{ id: 'e-ab', source: 'a', sourceHandle: 'default', target: 'b', targetHandle: 'in' }],
    }
    const inserted = node('inserted', 120)
    const direct = insertNodeBefore(graph, 'b', { node: inserted }).graph
    const agent = applyPatchGraphOps(documentWithGraph(graph), {
      ops: [{ op: 'insert-node-before', beforeId: 'b', node: inserted }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(canonicalGraph(agent.document.graph)).toEqual(canonicalGraph(direct))
  })

  test('从非默认出口向后插入节点与 insertNodeAfter 语义一致', () => {
    const graph: GameGraph = {
      nodes: [node('choice', 0), node('ending-a', 240), node('ending-b', 240)],
      edges: [
        { id: 'e-a', source: 'choice', sourceHandle: 'option-a', target: 'ending-a', targetHandle: 'in' },
        { id: 'e-b', source: 'choice', sourceHandle: 'option-b', target: 'ending-b', targetHandle: 'in' },
      ],
    }
    const inserted = node('option-a-result', 120)
    const direct = insertNodeAfter(graph, 'choice', {
      sourceHandle: 'option-a',
      position: { x: 100, y: 80 },
      node: inserted,
    }).graph
    const agent = applyPatchGraphOps(documentWithGraph(graph), {
      ops: [{
        op: 'insert-node-after',
        afterId: 'choice',
        sourceHandle: 'option-a',
        position: { x: 100, y: 80 },
        node: inserted,
      }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(canonicalGraph(agent.document.graph)).toEqual(canonicalGraph(direct))
    expect(agent.document.graph.edges.some((edge) => (
      edge.source === 'choice' && edge.sourceHandle === 'option-b' && edge.target === 'ending-b'
    ))).toBe(true)
  })

  test('复制节点与 duplicateNodes 一致，并重写复制边的 advance 引用', () => {
    const graph: GameGraph = {
      nodes: [
        {
          ...node('a', 0),
          data: {
            name: 'a',
            reactions: [{ when: { type: 'complete' }, do: [{ kind: 'advance', edgeId: 'e-ab' }] }],
          },
        },
        node('b', 240),
      ],
      edges: [{ id: 'e-ab', source: 'a', sourceHandle: 'default', target: 'b', targetHandle: 'in' }],
    }
    const direct = duplicateNodes(graph, ['a', 'b'], {
      nodeIdForSource: { a: 'a-copy', b: 'b-copy' },
    }).graph
    const agent = applyPatchGraphOps(documentWithGraph(graph), {
      ops: [{
        op: 'duplicate-nodes',
        copies: [
          { sourceId: 'a', targetId: 'a-copy' },
          { sourceId: 'b', targetId: 'b-copy' },
        ],
      }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(canonicalGraph(agent.document.graph)).toEqual(canonicalGraph(direct))
    const copiedEdge = agent.document.graph.edges.find((edge) => edge.source === 'a-copy')!
    expect(agent.document.graph.nodes.find((candidate) => candidate.id === 'a-copy')!.data.reactions![0]!.do[0])
      .toEqual({ kind: 'advance', edgeId: copiedEdge.id })
  })
})
