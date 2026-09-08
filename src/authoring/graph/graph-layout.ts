/**
 * 蓝图自动布局 —— 用 dagre 给 GameGraph 的节点算坐标（LR 左→右），纯函数零 React 依赖。
 * 自环边（source===target）与悬空边跳过（dagre 不支持自环）。返回 nodeId → {x,y}（左上角）。
 */
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'

export interface GraphLayoutOptions {
  nodeWidth: number
  nodeHeight: number
  nodeSep: number
  rankSep: number
  direction: 'LR' | 'TB'
}

export const DEFAULT_GRAPH_LAYOUT: GraphLayoutOptions = {
  nodeWidth: 190,
  nodeHeight: 96,
  nodeSep: 44,
  rankSep: 140,
  direction: 'LR',
}

export function computeGraphLayout(graph: GameGraph, partial?: Partial<GraphLayoutOptions>): Record<string, { x: number; y: number }> {
  const opts = { ...DEFAULT_GRAPH_LAYOUT, ...(partial ?? {}) }
  const g = new graphlib.Graph()
  g.setGraph({ rankdir: opts.direction, nodesep: opts.nodeSep, ranksep: opts.rankSep, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  const ids = new Set(graph.nodes.map((n) => n.id))
  for (const n of graph.nodes) g.setNode(n.id, { width: opts.nodeWidth, height: opts.nodeHeight })
  const seen = new Set<string>()
  for (const e of graph.edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue
    const key = `${e.source}->${e.target}`
    if (seen.has(key)) continue // 多重边合并，布局算一次
    seen.add(key)
    g.setEdge(e.source, e.target)
  }

  const out: Record<string, { x: number; y: number }> = {}
  try {
    dagreLayout(g)
    for (const n of graph.nodes) {
      const nd = g.node(n.id)
      if (nd) out[n.id] = { x: nd.x - opts.nodeWidth / 2, y: nd.y - opts.nodeHeight / 2 }
    }
  } catch {
    // 极端环结构 dagre 偶发抛错 → 退化为纵向单列
    let y = 40
    for (const n of graph.nodes) {
      out[n.id] = { x: 40, y }
      y += opts.nodeHeight + opts.nodeSep
    }
  }
  return out
}
