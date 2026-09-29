import { describe, expect, it } from 'vitest'
import type { GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import { addNode, connect } from '@/authoring/graph/graph-edit'
import {
  executeBlueprintGraphCommand,
  executeBlueprintGraphCommands,
  type BlueprintGraphCommand,
} from '../blueprint-graph-command'

function node(id: string): GameNode {
  return {
    id,
    type: 'perf',
    position: { x: 80, y: 80 },
    inputs: [],
    outputs: [],
    data: { name: id },
  }
}

describe('BlueprintGraphCommand', () => {
  it('makes a batched Agent plan produce the same graph as frontend domain gestures', () => {
    const empty: GameGraph = { nodes: [], edges: [] }
    const commands: BlueprintGraphCommand[] = [
      { op: 'add-node', node: node('a') },
      { op: 'add-node', node: node('b') },
      { op: 'connect', spec: { id: 'e-ab', source: 'a', sourceHandle: 'choice', target: 'b' } },
    ]
    const result = executeBlueprintGraphCommands(empty, commands, { requireMutation: true })
    const frontend = connect(
      addNode(addNode(empty, node('a')), node('b')),
      { id: 'e-ab', source: 'a', sourceHandle: 'choice', target: 'b' },
    )

    expect(result).toMatchObject({ ok: true, applied: 3, noops: 0 })
    if (result.ok) expect(result.graph).toEqual(frontend)
  })

  it('returns no intermediate graph when a batched command fails', () => {
    const original: GameGraph = { nodes: [node('existing')], edges: [] }
    const result = executeBlueprintGraphCommands(original, [
      { op: 'add-node', node: node('created') },
      { op: 'connect', spec: { id: 'broken', source: 'created', target: 'missing' } },
    ])

    expect(result).toMatchObject({
      ok: false,
      errors: ['node not found: missing'],
      failedCommandIndex: 1,
    })
    expect(original).toEqual({ nodes: [node('existing')], edges: [] })
    expect('graph' in result).toBe(false)
  })

  it('keeps duplicate frontend connect gestures idempotent while strict batches reject no-ops', () => {
    const graph = connect(
      { nodes: [node('a'), node('b')], edges: [] },
      { id: 'e-ab', source: 'a', target: 'b' },
    )
    const command = { op: 'connect', spec: { source: 'a', target: 'b' } } as const

    expect(executeBlueprintGraphCommand(graph, command)).toBe(graph)
    expect(executeBlueprintGraphCommands(graph, [command], { requireMutation: true })).toMatchObject({
      ok: false,
      errors: ['command did not mutate graph: connect'],
      failedCommandIndex: 0,
    })
  })
})
