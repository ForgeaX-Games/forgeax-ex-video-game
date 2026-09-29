import type { EdgeRouting, GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import {
  addNode,
  connect,
  disconnect,
  reconnect,
  removeNode,
  setNodePosition,
  updateEdgeData,
  type ConnectSpec,
} from '@/authoring/graph/graph-edit'

/**
 * 前端单次画布手势与 Agent 批量事务共享的拓扑命令。
 * 命令可以携带 Host 已物化的完整节点，但公开 AI schema 不暴露该结构。
 */
export type BlueprintGraphCommand =
  | { op: 'add-node'; node: GameNode }
  | { op: 'remove-node'; nodeId: string }
  | { op: 'connect'; spec: ConnectSpec }
  | {
      op: 'reconnect'
      edgeId: string
      patch: { source?: string; target?: string; sourceHandle?: string; targetHandle?: string }
    }
  | { op: 'disconnect'; edgeId: string }
  | { op: 'update-edge-data'; edgeId: string; data: EdgeRouting }
  | { op: 'set-node-position'; nodeId: string; position: { x: number; y: number } }

export type BlueprintGraphCommandResult =
  | { ok: true; graph: GameGraph; applied: number; noops: number }
  | { ok: false; errors: string[]; failedCommandIndex: number; failedCommand: BlueprintGraphCommand }

export interface BlueprintGraphCommandOptions {
  /** 批量编译时每条命令都必须改变目标图；前端重复手势仍保持原有幂等 no-op 语义。 */
  requireMutation?: boolean
}

function missingNode(graph: GameGraph, nodeId: string): string | undefined {
  return graph.nodes.some((node) => node.id === nodeId) ? undefined : `node not found: ${nodeId}`
}

function executeOne(
  graph: GameGraph,
  command: BlueprintGraphCommand,
): { graph: GameGraph; changed: boolean; error?: string } {
  if (command.op === 'add-node') {
    if (graph.nodes.some((node) => node.id === command.node.id)) {
      return { graph, changed: false, error: `node already exists: ${command.node.id}` }
    }
    return { graph: addNode(graph, structuredClone(command.node)), changed: true }
  }
  if (command.op === 'remove-node') {
    const error = missingNode(graph, command.nodeId)
    if (error) return { graph, changed: false, error }
    return { graph: removeNode(graph, command.nodeId), changed: true }
  }
  if (command.op === 'connect') {
    const sourceError = missingNode(graph, command.spec.source)
    if (sourceError) return { graph, changed: false, error: sourceError }
    const targetError = missingNode(graph, command.spec.target)
    if (targetError) return { graph, changed: false, error: targetError }
    if (command.spec.id && graph.edges.some((edge) => edge.id === command.spec.id)) {
      return { graph, changed: false, error: `edge already exists: ${command.spec.id}` }
    }
    const next = connect(graph, structuredClone(command.spec))
    return { graph: next, changed: next !== graph }
  }
  if (command.op === 'reconnect') {
    const edge = graph.edges.find((candidate) => candidate.id === command.edgeId)
    if (!edge) return { graph, changed: false, error: `edge not found: ${command.edgeId}` }
    if (Object.keys(command.patch).length === 0) {
      return { graph, changed: false, error: `reconnect patch is empty: ${command.edgeId}` }
    }
    const sourceError = missingNode(graph, command.patch.source ?? edge.source)
    if (sourceError) return { graph, changed: false, error: sourceError }
    const targetError = missingNode(graph, command.patch.target ?? edge.target)
    if (targetError) return { graph, changed: false, error: targetError }
    const next = reconnect(graph, command.edgeId, command.patch)
    return { graph: next, changed: next !== graph }
  }
  if (command.op === 'disconnect') {
    if (!graph.edges.some((edge) => edge.id === command.edgeId)) {
      return { graph, changed: false, error: `edge not found: ${command.edgeId}` }
    }
    return { graph: disconnect(graph, command.edgeId), changed: true }
  }
  if (command.op === 'update-edge-data') {
    if (!graph.edges.some((edge) => edge.id === command.edgeId)) {
      return { graph, changed: false, error: `edge not found: ${command.edgeId}` }
    }
    return { graph: updateEdgeData(graph, command.edgeId, structuredClone(command.data)), changed: true }
  }
  const error = missingNode(graph, command.nodeId)
  if (error) return { graph, changed: false, error }
  if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
    return { graph, changed: false, error: `position must contain finite x/y: ${command.nodeId}` }
  }
  return { graph: setNodePosition(graph, command.nodeId, command.position), changed: true }
}

/**
 * 在内存草稿上按序执行；任何命令失败时不返回中间图，调用方因此只能提交全成或全败的结果。
 */
export function executeBlueprintGraphCommands(
  input: GameGraph,
  commands: readonly BlueprintGraphCommand[],
  options: BlueprintGraphCommandOptions = {},
): BlueprintGraphCommandResult {
  let graph = input
  let applied = 0
  let noops = 0
  for (const [index, command] of commands.entries()) {
    const result = executeOne(graph, command)
    const error = result.error ?? (
      options.requireMutation && !result.changed
        ? `command did not mutate graph: ${command.op}`
        : undefined
    )
    if (error) {
      return { ok: false, errors: [error], failedCommandIndex: index, failedCommand: command }
    }
    graph = result.graph
    if (result.changed) applied += 1
    else noops += 1
  }
  return { ok: true, graph, applied, noops }
}

/** 前端单次手势使用同一执行器；失败保持原图。 */
export function executeBlueprintGraphCommand(
  graph: GameGraph,
  command: BlueprintGraphCommand,
): GameGraph {
  const result = executeBlueprintGraphCommands(graph, [command])
  return result.ok ? result.graph : graph
}
