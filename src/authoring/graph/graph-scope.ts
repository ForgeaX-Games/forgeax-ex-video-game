import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import { readNodePosition } from '@/runtime/core/schema/react-flow-schema'

/** Container node ids from a blueprint root graph to the graph currently being edited. */
export type GraphScopePath = readonly string[]

/**
 * Normalize blueprint entry after a graph edit.
 * - Entry deleted → walk the old graph's outgoing edges BFS (prefer `default` handle)
 *   and pick the first surviving successor; else the first remaining node. Empty graph
 *   keeps the previous id (`entry` must stay a string in published contracts).
 * - Entry still present → walk incoming edges upstream until a node with no predecessors.
 *   Multiple predecessors: prefer leftmost / topmost / id (same order as `resolveGraphEntry`).
 *   If the walk hits a cycle, keep the original entry unchanged.
 */
export function resolveEntryAfterGraphChange(
  before: GameGraph,
  after: GameGraph,
  entry: string,
): string {
  if (after.nodes.length === 0) return entry
  const remaining = new Set(after.nodes.map((node) => node.id))
  const candidate = remaining.has(entry)
    ? entry
    : resolveEntrySuccessor(before, remaining, entry) ?? after.nodes[0]!.id
  return walkEntryUpstream(after, candidate)
}

/** BFS along `before` out-edges from a deleted entry; prefer `default` handle. */
function resolveEntrySuccessor(
  before: GameGraph,
  remaining: ReadonlySet<string>,
  entry: string,
): string | undefined {
  const queued = new Set<string>([entry])
  const queue = [entry]
  while (queue.length > 0) {
    const source = queue.shift()!
    const outgoing = before.edges
      .filter((edge) => edge.source === source)
      .sort((a, b) => (
        Number((b.sourceHandle ?? 'default') === 'default')
        - Number((a.sourceHandle ?? 'default') === 'default')
      ))
    for (const edge of outgoing) {
      if (queued.has(edge.target)) continue
      if (remaining.has(edge.target)) return edge.target
      queued.add(edge.target)
      queue.push(edge.target)
    }
  }
  return undefined
}

/** Walk in-edges from `entry` to a root; cycles fall back to `entry`. */
function walkEntryUpstream(graph: GameGraph, entry: string): string {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  let current = entry
  while (!visited.has(current)) {
    visited.add(current)
    const predecessors = graph.edges
      .filter((edge) => edge.target === current)
      .map((edge) => byId.get(edge.source))
      .filter((node): node is NonNullable<typeof node> => !!node)
    if (predecessors.length === 0) return current
    predecessors.sort((a, b) => (
      (readNodePosition(a)?.x ?? 0) - (readNodePosition(b)?.x ?? 0)
      || (readNodePosition(a)?.y ?? 0) - (readNodePosition(b)?.y ?? 0)
      || a.id.localeCompare(b.id)
    ))
    const next = predecessors[0]!.id
    if (visited.has(next)) return entry
    current = next
  }
  return entry
}

export function resolveGraphAtPath(root: GameGraph, path: GraphScopePath): GameGraph | undefined {
  let graph = root
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!process) return undefined
    graph = process.graph
  }
  return graph
}

/** Entry id of the graph addressed by `path` (blueprint root or nested subProcess). */
export function resolveGraphEntryAtPath(
  root: GameGraph,
  rootEntry: string | undefined,
  path: GraphScopePath,
): string | undefined {
  let graph = root
  let entry = rootEntry
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!process) return undefined
    graph = process.graph
    entry = process.entry
  }
  return entry && graph.nodes.some((node) => node.id === entry) ? entry : undefined
}

export function updateGraphAtPath(
  root: GameGraph,
  path: GraphScopePath,
  update: GameGraph | ((graph: GameGraph) => GameGraph),
): GameGraph {
  if (path.length === 0) return typeof update === 'function' ? update(root) : update
  const [containerId, ...rest] = path
  let changed = false
  const nodes = root.nodes.map((node) => {
    if (node.id !== containerId) return node
    const process = getSubProcess(node.data)
    if (!process) return node
    const graph = updateGraphAtPath(process.graph, rest, update)
    if (graph === process.graph) return node
    changed = true
    const entry = rest.length === 0
      ? resolveEntryAfterGraphChange(process.graph, graph, process.entry)
      : process.entry
    return { ...node, data: { ...node.data, subProcess: { ...process, entry, graph } } }
  })
  return changed ? { ...root, nodes } : root
}

/** Keep the longest valid prefix after undo, reset, or deleting an ancestor container. */
export function validGraphPath(root: GameGraph, path: GraphScopePath): string[] {
  const valid: string[] = []
  let graph = root
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!process) break
    valid.push(containerId)
    graph = process.graph
  }
  return valid
}

export function graphPathLabels(root: GameGraph, path: GraphScopePath): Array<{ id: string; name: string }> {
  const labels: Array<{ id: string; name: string }> = []
  let graph = root
  for (const containerId of path) {
    const container = graph.nodes.find((node) => node.id === containerId)
    const process = container ? getSubProcess(container.data) : undefined
    if (!container || !process) break
    labels.push({ id: containerId, name: container.data.name || containerId })
    graph = process.graph
  }
  return labels
}
