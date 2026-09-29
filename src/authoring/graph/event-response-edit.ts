import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import type { NodeAction, OverlayEventRef, Reaction } from '@/runtime/core/schema/node-config-schema'
import { overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { disconnect, patchNodeData, upsertBranchEdge } from './graph-edit'

function eventKeySet(event: OverlayEventRef): Set<string> {
  return new Set([
    event.localEventId,
    event.eventId,
    `${event.childId}:${event.localEventId}`,
    `${event.mountId}:${event.localEventId}`,
    `${event.mountId}:${event.childId}:${event.localEventId}`,
  ])
}

/** Replace one mounted component event response while removing historical aliases. */
export function upsertEventReaction(
  reactions: Reaction[] | undefined,
  event: OverlayEventRef,
  actions: NodeAction[],
): Reaction[] | undefined {
  const keys = eventKeySet(event)
  const rest = (reactions ?? []).filter(
    (reaction) => !(reaction.when.type === 'event' && keys.has(reaction.when.id)),
  )
  if (actions.length > 0) {
    rest.push({ when: { type: 'event', id: event.eventId }, do: actions })
  }
  return rest.length > 0 ? rest : undefined
}

/** Write an event response to one explicit mount instance. */
export function setMountEventActions(
  graph: GameGraph,
  nodeId: string,
  mountId: string,
  event: OverlayEventRef,
  actions: NodeAction[],
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return graph
  const mounts = node.data.overlayNodes ?? []
  const index = mounts.findIndex((mount) => overlayMountId(mount) === mountId)
  if (index < 0) return graph
  return patchNodeData(graph, nodeId, {
    overlayNodes: mounts.map((mount, candidateIndex) => candidateIndex === index
      ? { ...mount, reactions: upsertEventReaction(mount.reactions, event, actions) }
      : mount),
  })
}

export type EventResponseRemovalScope = 'actions' | 'route' | 'all'

function mountEventActions(
  graph: GameGraph,
  nodeId: string,
  mountId: string,
  event: OverlayEventRef,
): NodeAction[] | undefined {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const mount = node?.data.overlayNodes?.find((candidate) => overlayMountId(candidate) === mountId)
  const keys = eventKeySet(event)
  return mount?.reactions?.find(
    (reaction) => reaction.when.type === 'event' && keys.has(reaction.when.id),
  )?.do
}

/** Remove all non-routing actions, the route, or the complete mounted event response. */
export function removeMountEventResponse(
  graph: GameGraph,
  nodeId: string,
  mountId: string,
  event: OverlayEventRef,
  scope: EventResponseRemovalScope = 'all',
): GameGraph {
  let next = graph
  if (scope === 'route' || scope === 'all') {
    next = routeMountEventToNode(next, nodeId, mountId, event, '')
  }
  if (scope === 'actions' || scope === 'all') {
    const preserved = scope === 'actions'
      ? (mountEventActions(next, nodeId, mountId, event) ?? []).filter((action) => action.kind === 'advance')
      : []
    next = setMountEventActions(next, nodeId, mountId, event, preserved)
  }
  return next
}

/** Remove one action exactly as the node action editor does; advance removal also disconnects its edge. */
export function removeMountEventAction(
  graph: GameGraph,
  nodeId: string,
  mountId: string,
  event: OverlayEventRef,
  actionIndex: number,
): GameGraph {
  const actions = mountEventActions(graph, nodeId, mountId, event)
  const action = actions?.[actionIndex]
  if (!actions || !action) return graph
  if (action.kind === 'advance') return disconnect(graph, action.edgeId)
  return setMountEventActions(
    graph,
    nodeId,
    mountId,
    event,
    actions.filter((_, index) => index !== actionIndex),
  )
}

export function eventHandleEdges(graph: GameGraph, nodeId: string, handle: string) {
  return graph.edges.filter(
    (edge) => edge.source === nodeId && (edge.sourceHandle ?? 'default') === handle,
  )
}

/** Route one mounted component event to a node while preserving non-advance actions. */
export function routeMountEventToNode(
  graph: GameGraph,
  nodeId: string,
  mountId: string,
  event: OverlayEventRef,
  targetId: string,
): GameGraph {
  const handle = event.eventId
  const pool = eventHandleEdges(graph, nodeId, handle)
  if (!targetId) {
    let next = graph
    for (const edge of pool) next = disconnect(next, edge.id)
    return next
  }
  if (pool.length > 1) return graph

  let next = upsertBranchEdge(graph, { source: nodeId, sourceHandle: handle, target: targetId })
  const edge = eventHandleEdges(next, nodeId, handle).find((candidate) => candidate.target === targetId)
    ?? eventHandleEdges(next, nodeId, handle)[0]
  if (!edge) return next

  const node = next.nodes.find((candidate) => candidate.id === nodeId)
  const mounts = node?.data.overlayNodes ?? []
  const mountIndex = mounts.findIndex((mount) => overlayMountId(mount) === mountId)
  if (!node || mountIndex < 0) return next

  const keys = eventKeySet(event)
  // 只从目标挂载读取需要保留的非 advance action，避免跨挂载偷走其它实例的 effect。
  const targetMount = mounts[mountIndex]!
  const existing = targetMount.reactions?.find(
    (candidate) => candidate.when.type === 'event' && keys.has(candidate.when.id),
  )
  const preserved: NodeAction[] = existing
    ? existing.do.filter((action) => action.kind !== 'advance')
    : []
  const strip = (reactions: Reaction[] | undefined): Reaction[] | undefined => {
    const filtered = (reactions ?? []).filter(
      (reaction) => !(reaction.when.type === 'event' && keys.has(reaction.when.id)),
    )
    return filtered.length > 0 ? filtered : undefined
  }
  const overlayNodes = mounts.map((mount, index) => {
    // 只重写目标挂载；其它挂载（含同 overlay 的兄弟实例）原样保留，不做全量 strip。
    if (index !== mountIndex) return mount
    const reactions = strip(mount.reactions)
    return {
      ...mount,
      reactions: [
        ...(reactions ?? []),
        {
          when: { type: 'event' as const, id: handle },
          do: [...preserved, { kind: 'advance' as const, edgeId: edge.id }],
        },
      ],
    }
  })
  return patchNodeData(next, nodeId, {
    overlayNodes,
    reactions: strip(node.data.reactions),
  })
}
