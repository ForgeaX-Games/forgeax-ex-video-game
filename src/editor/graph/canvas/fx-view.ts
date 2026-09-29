/**
 * 渲染派生层：GameGraph（域 SSOT） → react-flow(FX) 渲染视图。
 *
 * spec §2.1.1：SSOT 与渲染视图**分离但同源**。此处只读地把域图投影成 reactflow 能画的形状：
 *  - inputs = 画布约定的单一入口 'in'（与边上 targetHandle 对齐）；outputs = deriveOutputs ∪ 该节点出边用到的路由 handle。
 *  - position 来自 node.position（域里存了布局）；缺坐标或全在原点时拓扑 autoLayout。
 *  - data 只放渲染需要的少量字段（标题/角标）；不把整块 node.data 塞进去。
 * 不回写域图。
 */
import type { FXEdge, FXGraph, FXNode, Handle, Position } from '@/runtime/core/schema/react-flow-schema'
import {
  DEFAULT_GRAPH_NODE_POSITION,
  GRAPH_NODE_COL_W,
  readNodePosition,
} from '@/runtime/core/schema/react-flow-schema'
import type { GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import type { Overlay } from '@/runtime/core/schema/node-config-schema'
import { getSubFlowPack, getSubProcess } from '@/runtime/core/schema/graph-schema'
import { deriveOutputs } from '@/runtime/core/registry/component-registry'
import { flowHandleDisplay, mergeFlowHandles } from '@/authoring/graph/flow-handle-labels'

/** 节点各出口 handle 的稳定 id → 组件 label 映射（边 label / 引脚展示共用）。 */
function nodeEventLabels(node: GameNode, overlays?: Record<string, Overlay>): Map<string, string> {
  const map = new Map<string, string>()
  for (const h of deriveOutputs(node, overlays)) {
    if (h.label) map.set(h.id, h.label)
  }
  return map
}

function nodeOutputHandles(
  graph: GameGraph,
  node: GameNode,
  overlays?: Record<string, Overlay>,
  labels?: Map<string, string>,
): Array<{ value: string; label: string }> {
  const lookup = labels ?? nodeEventLabels(node, overlays)
  const extra = graph.edges
    .filter((e) => e.source === node.id && e.sourceHandle)
    .map((e) => ({ id: e.sourceHandle!, label: lookup.get(e.sourceHandle!) }))
  return mergeFlowHandles(deriveOutputs(node, overlays), extra)
}

function toHandle(id: string, label: string, type: 'source' | 'target'): Handle<{ flowId: string; displayLabel: string }> {
  return {
    id: `${type}:${id}`,
    type,
    position: type === 'source' ? 'right' : 'left',
    label,
    data: { flowId: id, displayLabel: label },
  }
}

/** 当节点缺 position 或全部堆在原点时，按拓扑分层自动布局。 */
function autoLayout(graph: GameGraph): Record<string, Position> {
  const ROW_H = 96
  const targets = new Set(graph.edges.map((e) => e.target))
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target)
  const depth = new Map<string, number>()
  const roots = graph.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id)
  const queue = roots.length > 0 ? [...roots] : graph.nodes.slice(0, 1).map((n) => n.id)
  for (const r of queue) depth.set(r, 0)
  while (queue.length) {
    const id = queue.shift()!
    const d = depth.get(id) ?? 0
    for (const nx of adj.get(id) ?? []) {
      if (depth.has(nx)) continue
      depth.set(nx, d + 1)
      queue.push(nx)
    }
  }
  const rowCursor = new Map<number, number>()
  const out: Record<string, Position> = {}
  for (const n of graph.nodes) {
    const col = depth.get(n.id) ?? 0
    const row = rowCursor.get(col) ?? 0
    rowCursor.set(col, row + 1)
    out[n.id] = { x: col * GRAPH_NODE_COL_W, y: row * ROW_H }
  }
  return out
}

function needsAutoLayout(graph: GameGraph): boolean {
  if (graph.nodes.some((n) => !readNodePosition(n))) return true
  if (graph.nodes.length <= 1) return false
  return graph.nodes.every((n) => {
    const p = readNodePosition(n)
    return !!p && p.x === 0 && p.y === 0
  })
}

function resolveNodePositions(graph: GameGraph): Record<string, Position> {
  if (needsAutoLayout(graph)) return autoLayout(graph)
  const out: Record<string, Position> = {}
  for (const n of graph.nodes) {
    const p = readNodePosition(n)
    if (p) out[n.id] = p
  }
  return out
}

export function toFXView(graph: GameGraph, overlays?: Record<string, Overlay>): FXGraph {
  const layout = resolveNodePositions(graph)
  const labelsByNode = new Map<string, Map<string, string>>()
  for (const n of graph.nodes) labelsByNode.set(n.id, nodeEventLabels(n, overlays))
  return {
    nodes: graph.nodes.map((node): FXNode => ({
      id: node.id,
      type: 'default',
      position: layout[node.id] ?? readNodePosition(node) ?? DEFAULT_GRAPH_NODE_POSITION,
      inputs: [toHandle('in', '入口', 'target')],
      outputs: nodeOutputHandles(graph, node, overlays, labelsByNode.get(node.id)).map((h) =>
        toHandle(h.value, h.label, 'source'),
      ),
      data: {
        label: node.data.name,
        badge: badgeOf(node),
      },
    })),
    edges: graph.edges.map((e): FXEdge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: `source:${e.sourceHandle ?? 'default'}`,
      targetHandle: 'target:in',
      label: flowHandleDisplay(
        e.sourceHandle ?? 'default',
        labelsByNode.get(e.source)?.get(e.sourceHandle ?? 'default'),
      ),
    })),
  }
}

function badgeOf(node: GameNode): string {
  if (getSubFlowPack(node.data)) return 'pack'
  if (getSubProcess(node.data)) return 'subflow'
  if (node.data.overlayNodes?.length) return 'overlay'
  return ''
}
