import { describe, expect, it } from 'vitest'
import { routeMountEventToNode, setMountEventActions } from '@/authoring/graph/event-response-edit'
import type { GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import { overlayMountId } from '@/runtime/core/schema/node-config-schema'
import type { NodeAction, OverlayEventRef } from '@/runtime/core/schema/node-config-schema'

const effectAction: NodeAction = {
  kind: 'effect',
  effects: [{ kind: 'var', varId: 'hp', op: 'add', value: 1 }],
}

/** 界面 M 挂载两次：A（首份，mountId 回落 overlay id）、B（显式 M__2）。 */
function eventOf(mountId: string): OverlayEventRef {
  return {
    eventId: `${mountId}:ying`,
    mountId,
    childId: 'inkYingMo',
    localEventId: 'ying',
    componentId: 'InkYingMo',
  }
}

const nodeOf = (id: string, extra: Record<string, unknown> = {}): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id, ...extra },
})

function baseGraph(): GameGraph {
  return {
    nodes: [
      nodeOf('n1', {
        overlayNodes: [
          { overlay: 'M' },
          { id: 'M__2', overlay: 'M' },
        ],
      }),
      nodeOf('n2'),
    ],
    edges: [],
  }
}

function mountsOf(graph: GameGraph) {
  const node = graph.nodes.find((n) => n.id === 'n1')!
  const mounts = node.data.overlayNodes ?? []
  return {
    a: mounts.find((m) => overlayMountId(m) === 'M')!,
    b: mounts.find((m) => overlayMountId(m) === 'M__2')!,
  }
}

describe('event-response-edit 多挂载隔离', () => {
  it('先配 A 的 effect、后配 B 的 route：A 的逻辑不被覆盖或串改', () => {
    let graph = baseGraph()

    graph = setMountEventActions(graph, 'n1', 'M', eventOf('M'), [effectAction])
    graph = routeMountEventToNode(graph, 'n1', 'M__2', eventOf('M__2'), 'n2')

    const { a, b } = mountsOf(graph)

    // A 保留自己的 effect，key 是稳定 key `M:ying`
    expect(a.reactions).toEqual([
      { when: { type: 'event', id: 'M:ying' }, do: [effectAction] },
    ])

    // B 只有 advance（跳转），没有偷走 A 的 effect
    expect(b.reactions).toHaveLength(1)
    const bReaction = b.reactions![0]!
    expect(bReaction.when).toEqual({ type: 'event', id: 'M__2:ying' })
    expect(bReaction.do.map((action) => action.kind)).toEqual(['advance'])
  })

  it('先配 B 的 route、后配 A 的 effect：两者各自独立', () => {
    let graph = baseGraph()

    graph = routeMountEventToNode(graph, 'n1', 'M__2', eventOf('M__2'), 'n2')
    graph = setMountEventActions(graph, 'n1', 'M', eventOf('M'), [effectAction])

    const { a, b } = mountsOf(graph)

    expect(a.reactions).toEqual([
      { when: { type: 'event', id: 'M:ying' }, do: [effectAction] },
    ])
    const bReaction = b.reactions![0]!
    expect(bReaction.when).toEqual({ type: 'event', id: 'M__2:ying' })
    expect(bReaction.do.map((action) => action.kind)).toEqual(['advance'])
  })

  it('A、B 都配 route：出边 handle 按稳定 key 隔离，不串改对方目标', () => {
    let graph = baseGraph()
    graph = nodeOfGraphWithThird(graph)

    graph = routeMountEventToNode(graph, 'n1', 'M', eventOf('M'), 'n2')
    graph = routeMountEventToNode(graph, 'n1', 'M__2', eventOf('M__2'), 'n3')

    const { a, b } = mountsOf(graph)
    const edgeFor = (mountId: string) =>
      graph.edges.find((e) => e.source === 'n1' && e.sourceHandle === `${mountId}:ying`)

    expect(edgeFor('M')?.target).toBe('n2')
    expect(edgeFor('M__2')?.target).toBe('n3')

    const aReaction = a.reactions![0]!
    const bReaction = b.reactions![0]!
    expect(aReaction.when).toEqual({ type: 'event', id: 'M:ying' })
    expect(bReaction.when).toEqual({ type: 'event', id: 'M__2:ying' })
    expect(aReaction.do.find((action) => action.kind === 'advance')).toBeTruthy()
    expect(bReaction.do.find((action) => action.kind === 'advance')).toBeTruthy()
  })
})

/** 追加第三个节点 n3，供 A/B 各自路由到不同目标。 */
function nodeOfGraphWithThird(graph: GameGraph): GameGraph {
  return { ...graph, nodes: [...graph.nodes, nodeOf('n3')] }
}
