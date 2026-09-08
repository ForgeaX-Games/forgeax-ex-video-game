/**
 * reactflow 渲染层数据契约 —— 逐字对齐 `cinegame/src/react-flow-schema.d.ts`。
 *
 * 这是**转换层**（蓝图 → reactflow）的目标形态：reactflow 节点的 inputs/outputs
 * 由蓝图节点的 incoming/outgoing 派生为 handles；edge 的 sourceHandle/targetHandle
 * 用同一个 flow id 对齐。蓝图域节点（GameNode）与此处的 Node 共用 position 形状，
 * 见 patch-graph `$defs/graphNode` 与 `DEFAULT_GRAPH_NODE_POSITION` / `GRAPH_NODE_COL_W`。
 */

/** 主图章节横向列宽；与 fx-view autoLayout、Agent prompt 一致。 */
export const GRAPH_NODE_COL_W = 240

/** 空库 / 缺省 add-node 时的画布原点；与 emptyBlueprintDoc 一致。 */
export const DEFAULT_GRAPH_NODE_POSITION: Position = { x: 80, y: 80 }

export interface Position {
  x: number
  y: number
}

export function isPosition(value: unknown): value is Position {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Position).x === 'number' && Number.isFinite((value as Position).x)
    && typeof (value as Position).y === 'number' && Number.isFinite((value as Position).y)
}

export function readNodePosition(node: { position?: unknown }): Position | undefined {
  return isPosition(node.position) ? node.position : undefined
}

/** 把域节点 / patch_graph node 规范成满足 Node.position 的形状。 */
export function normalizeGraphNodePosition<T extends { position?: unknown }>(
  node: T,
  fallback: Position = DEFAULT_GRAPH_NODE_POSITION,
): T & { position: Position } {
  return { ...node, position: readNodePosition(node) ?? fallback }
}

export function positionAfter(predecessor: Position, gapX = GRAPH_NODE_COL_W, gapY = 0): Position {
  return { x: predecessor.x + gapX, y: predecessor.y + gapY }
}

export type HandleType = 'source' | 'target'
export type HandlePosition = 'left' | 'right' | 'top' | 'bottom'

export interface Handle<TData = unknown> {
  id: string
  type: HandleType
  position: HandlePosition
  label?: string
  data?: TData
}

export interface Node<TData = unknown, TType extends string = string, THandleData = unknown> {
  id: string
  type: TType
  position: Position
  inputs: Handle<THandleData>[]
  outputs: Handle<THandleData>[]
  data: TData
}

export interface Edge<TData = unknown> {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  label?: string
  data?: TData
}

export interface Graph<TNode extends Node = Node, TEdge extends Edge = Edge> {
  nodes: TNode[]
  edges: TEdge[]
}

export interface FXHandleData {
  flowId: string
  /** 引脚旁展示的中文标签（与 flow-handle-labels 一致）。 */
  displayLabel?: string
}

export interface FXNodeData {
  label: string
  /** 节点角标：overlay / subflow / pack 等，驱动标题条样式。 */
  badge: string
}

export type FXNode = Node<FXNodeData, string, FXHandleData>
export type FXEdge = Edge
export type FXGraph = Graph<FXNode, FXEdge>
