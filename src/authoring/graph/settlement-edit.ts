import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import type { NodeAction, Reaction, ReactionTrigger } from '@/runtime/core/schema/node-config-schema'
import { isSettlementReaction } from '@/runtime/core/schema/node-config-schema'
import {
  patchNodeData,
  removeOrphanSettlementAdvanceEdge,
  settlementReactionAbsoluteIndex,
} from './graph-edit'

export type SettlementTrigger = Extract<ReactionTrigger, { type: 'at' | 'watch' | 'state' }>

export function createSettlementReaction(
  when: SettlementTrigger,
  actions: NodeAction[] = [],
): Reaction {
  return { when: structuredClone(when), do: structuredClone(actions) }
}

/** Append one settlement and return its index within the settlement subset. */
export function appendSettlementReaction(
  graph: GameGraph,
  nodeId: string,
  reaction: Reaction,
): { graph: GameGraph; settlementIndex?: number } {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !isSettlementReaction(reaction)) return { graph }
  const reactions = node.data.reactions ?? []
  const settlementIndex = reactions.filter(isSettlementReaction).length
  return {
    graph: patchNodeData(graph, nodeId, { reactions: [...reactions, structuredClone(reaction)] }),
    settlementIndex,
  }
}

/** Replace one settlement while preserving the ordering of event reactions around it. */
export function replaceSettlementReaction(
  graph: GameGraph,
  nodeId: string,
  settlementIndex: number,
  reaction: Reaction,
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const reactions = node?.data.reactions
  if (!node || !reactions || !isSettlementReaction(reaction)) return graph
  const absolute = settlementReactionAbsoluteIndex(reactions, settlementIndex)
  const previous = reactions[absolute]
  if (!previous) return graph
  const previousEdgeIds = previous.do.flatMap((action) => action.kind === 'advance' ? [action.edgeId] : [])
  let next = patchNodeData(graph, nodeId, {
    reactions: reactions.map((candidate, index) => index === absolute
      ? structuredClone(reaction)
      : candidate),
  })
  for (const edgeId of previousEdgeIds) next = removeOrphanSettlementAdvanceEdge(next, edgeId)
  return next
}

/** Delete one complete settlement and any now-unreferenced dedicated advance edge. */
export function removeSettlementReaction(
  graph: GameGraph,
  nodeId: string,
  settlementIndex: number,
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const reactions = node?.data.reactions
  if (!node || !reactions) return graph
  const absolute = settlementReactionAbsoluteIndex(reactions, settlementIndex)
  const reaction = reactions[absolute]
  if (!reaction) return graph
  const edgeIds = reaction.do.flatMap((action) => action.kind === 'advance' ? [action.edgeId] : [])
  const remaining = reactions.filter((_, index) => index !== absolute)
  let next = patchNodeData(graph, nodeId, { reactions: remaining.length ? remaining : undefined })
  for (const edgeId of edgeIds) next = removeOrphanSettlementAdvanceEdge(next, edgeId)
  return next
}

/** Delete one settlement action; deleting advance also removes its orphaned dedicated edge. */
export function removeSettlementAction(
  graph: GameGraph,
  nodeId: string,
  settlementIndex: number,
  actionIndex: number,
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const reactions = node?.data.reactions
  if (!node || !reactions) return graph
  const absolute = settlementReactionAbsoluteIndex(reactions, settlementIndex)
  const reaction = reactions[absolute]
  const action = reaction?.do[actionIndex]
  if (!reaction || !action) return graph
  const next = patchNodeData(graph, nodeId, {
    reactions: reactions.map((candidate, index) => index === absolute
      ? { ...candidate, do: candidate.do.filter((_, candidateIndex) => candidateIndex !== actionIndex) }
      : candidate),
  })
  return action.kind === 'advance'
    ? removeOrphanSettlementAdvanceEdge(next, action.edgeId)
    : next
}
