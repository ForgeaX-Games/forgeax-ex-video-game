/**
 * 图编辑操作 —— 画布手势落到这些纯函数（不可变返回新 graph）。
 * Overlay 目录在 scenario.ui.overlays；节点挂 overlayNodes[]。
 *
 * 连/删边会同步 event reactions 里的 `advance.edgeId`（显式走向）；
 * 未写 advance 时运行时仍可「有边则默认推进」。
 */
import type { EdgeRouting, EdgeTransition, GameEdge, GameGraph, GameNode, Layout, NodeData, OverlayNode, RoutingSettlement, SubFlowPack, SubFlowPackDef, SubProcess } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import {
  DEFAULT_GRAPH_NODE_POSITION,
  normalizeGraphNodePosition,
  positionAfter,
  readNodePosition,
} from '@/runtime/core/schema/react-flow-schema'
import type { NodeAction, Reaction } from '@/runtime/core/schema/node-config-schema'
import { isLifecycleReaction, isSettlementReaction } from '@/runtime/core/schema/node-config-schema'
import { isSettlementAdvanceHandle, SETTLEMENT_ADVANCE_HANDLE_PREFIX } from '@/authoring/graph/flow-handle-labels'
import { clampSettlementSpawnTtlMs, nodePlayDurationMs } from '@/authoring/graph/timeline-geometry'

let _seq = 0
function newId(prefix: string): string {
  _seq += 1
  return `${prefix}-${Date.now().toString(36)}-${_seq}`
}

/** 生成新的 overlay child id（供编辑器新建用）。 */
export function newElementId(): string {
  return newId('el')
}

/**
 * 把节点标成私有内嵌子流程容器。入口节点只创建在内嵌图中，绝不追加到父图。
 */
export function attachSubProcess(graph: GameGraph, containerId: string): GameGraph {
  const node = graph.nodes.find((n) => n.id === containerId)
  if (!node) return graph
  const existing = getSubProcess(node.data)
  if (existing) {
    return patchNodeData(graph, containerId, { subProcess: existing, subFlowPack: undefined })
  }
  const entryId = newId('sf')
  const hostPos = readNodePosition(node) ?? DEFAULT_GRAPH_NODE_POSITION
  const entry: GameNode = {
    id: entryId,
    type: 'perf',
    position: { x: hostPos.x + 40, y: hostPos.y + 140 },
    inputs: [],
    outputs: [],
    data: { name: '新演出节点' },
  }
  return patchNodeData(graph, containerId, {
    subProcess: { entry: entryId, graph: { nodes: [entry], edges: [] } },
    subFlowPack: undefined,
  })
}

/** 空子蓝图包：单入口叶子（无出边时运行时自动弹回主图容器）。 */
export function makeEmptySubFlowPack(
  opts: { id?: string; title: string; version?: string },
): SubFlowPackDef & { title: string } {
  const id = opts.id ?? newId('pack')
  const entry = 'entry'
  return {
    id,
    version: opts.version ?? '1',
    title: opts.title,
    entry,
    graph: {
      nodes: [
        {
          id: entry,
          type: 'perf',
          position: { x: 80, y: 80 },
          inputs: [],
          outputs: [],
          data: { name: '新演出节点' },
        },
      ],
      edges: [],
    },
  }
}

export function addNode(graph: GameGraph, node: GameNode): GameGraph {
  return { ...graph, nodes: [...graph.nodes, normalizeGraphNodePosition(node)] }
}

/**
 * 在指定节点的某个出口后方插入新演出节点并自动接线：该出口原有的下游边改从新节点的默认出口继续。
 * sourceHandle 缺省 = 'default'（默认推进出口）；gapY 供多出口时按出口行错开，避免新节点叠在一起。
 */
export function insertNodeAfter(
  graph: GameGraph,
  afterId: string,
  opts: { name?: string; gapX?: number; gapY?: number; node?: GameNode; sourceHandle?: string; position?: { x: number; y: number } } = {},
): { graph: GameGraph; nodeId: string } {
  const after = graph.nodes.find((n) => n.id === afterId)
  if (!after) return { graph, nodeId: afterId }
  const sourceHandle = opts.sourceHandle ?? 'default'
  const gapX = opts.gapX ?? 220
  const afterPos = readNodePosition(after) ?? DEFAULT_GRAPH_NODE_POSITION
  const node: GameNode = opts.node
    ? normalizeGraphNodePosition(
      opts.node,
      positionAfter(afterPos, gapX, opts.gapY ?? 0),
    )
    : {
      id: newId('n'),
      type: 'perf',
      position: opts.position ?? positionAfter(afterPos, gapX, opts.gapY ?? 0),
      inputs: [],
      outputs: [],
      data: { name: opts.name ?? '新演出节点' },
    }
  const id = node.id
  let g = addNode(graph, node)
  for (const e of g.edges.filter((e) => e.source === afterId && (e.sourceHandle ?? 'default') === sourceHandle)) {
    g = disconnect(g, e.id)
    g = connect(g, { source: id, sourceHandle: 'default', target: e.target, data: e.data })
  }
  g = connect(g, { source: afterId, sourceHandle, target: id })
  return { graph: g, nodeId: id }
}

/**
 * 在指定节点前方插入新演出节点并自动接线：所有指向该节点的入边改接到新节点，
 * 再从新节点的默认出口连到该节点。新节点落在左侧（默认 gapX=220）。
 */
export function insertNodeBefore(
  graph: GameGraph,
  beforeId: string,
  opts: { name?: string; gapX?: number; gapY?: number; node?: GameNode; position?: { x: number; y: number } } = {},
): { graph: GameGraph; nodeId: string } {
  const before = graph.nodes.find((n) => n.id === beforeId)
  if (!before) return { graph, nodeId: beforeId }
  const gapX = opts.gapX ?? 220
  const beforePos = readNodePosition(before) ?? DEFAULT_GRAPH_NODE_POSITION
  const node: GameNode = opts.node
    ? normalizeGraphNodePosition(
      opts.node,
      positionAfter(beforePos, -gapX, opts.gapY ?? 0),
    )
    : {
      id: newId('n'),
      type: 'perf',
      position: opts.position ?? positionAfter(beforePos, -gapX, opts.gapY ?? 0),
      inputs: [],
      outputs: [],
      data: { name: opts.name ?? '新演出节点' },
    }
  const id = node.id
  let g = addNode(graph, node)
  for (const e of g.edges.filter((e) => e.target === beforeId)) {
    g = disconnect(g, e.id)
    g = connect(g, {
      source: e.source,
      sourceHandle: e.sourceHandle ?? 'default',
      target: id,
      data: e.data,
    })
  }
  g = connect(g, { source: id, sourceHandle: 'default', target: beforeId })
  return { graph: g, nodeId: id }
}

export function removeNode(graph: GameGraph, id: string): GameGraph {
  const removed = graph.edges.filter((e) => e.source === id || e.target === id).map((e) => e.id)
  let g = graph
  for (const edgeId of removed) g = unbindAdvanceFromEdge(g, edgeId)
  return {
    nodes: g.nodes.filter((n) => n.id !== id),
    edges: g.edges.filter((e) => e.source !== id && e.target !== id),
  }
}

/** 深拷贝节点 data（overlayNodes 引用同一 overlay 目录项；child id 在目录侧）。 */
function cloneNodePayload(src: GameNode, nodeId: string, offset: { x: number; y: number }): GameNode {
  const data = structuredClone(src.data)
  const process = getSubProcess(src.data)
  if (process) (data as GameNode['data'] & { subProcess: SubProcess }).subProcess = cloneSubProcess(process)
  const name = data.name?.trim() ?? ''
  if (name && !name.endsWith(' 副本')) data.name = `${name} 副本`
  const srcPos = readNodePosition(src) ?? DEFAULT_GRAPH_NODE_POSITION
  return {
    ...src,
    id: nodeId,
    position: { x: srcPos.x + offset.x, y: srcPos.y + offset.y },
    data,
  }
}

/** 复制私有子图时递归重铸 id，避免副本与原树在同一蓝图命名空间中冲突。 */
function cloneSubProcess(process: SubProcess): SubProcess {
  const nodeIds = new Map<string, string>()
  const edgeIds = new Map<string, string>()
  const collect = (graph: GameGraph): void => {
    for (const node of graph.nodes) {
      nodeIds.set(node.id, newId('n'))
      const nested = getSubProcess(node.data)
      if (nested) collect(nested.graph)
    }
    for (const edge of graph.edges) edgeIds.set(edge.id, newId('edge'))
  }
  collect(process.graph)

  const rewriteRefs = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteRefs)
    if (!value || typeof value !== 'object') return value
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'nodeId' && typeof item === 'string') out[key] = nodeIds.get(item) ?? item
      else if (key === 'edgeId' && typeof item === 'string') out[key] = edgeIds.get(item) ?? item
      else out[key] = rewriteRefs(item)
    }
    return out
  }

  const cloneGraph = (source: GameGraph): GameGraph => ({
    ...source,
    nodes: source.nodes.map((node) => {
      const data = rewriteRefs(structuredClone(node.data)) as GameNode['data']
      const nested = getSubProcess(node.data)
      if (nested) (data as GameNode['data'] & { subProcess: SubProcess }).subProcess = {
        entry: nodeIds.get(nested.entry) ?? nested.entry,
        graph: cloneGraph(nested.graph),
      }
      return { ...node, id: nodeIds.get(node.id)!, data }
    }),
    edges: source.edges.map((edge) => ({
      ...edge,
      id: edgeIds.get(edge.id)!,
      source: nodeIds.get(edge.source) ?? edge.source,
      target: nodeIds.get(edge.target) ?? edge.target,
      data: rewriteRefs(structuredClone(edge.data)) as GameEdge['data'],
    })),
  })

  return { entry: nodeIds.get(process.entry) ?? process.entry, graph: cloneGraph(process.graph) }
}

/**
 * 复制一组节点（及它们之间的内部边）。
 */
export function duplicateNodes(
  graph: GameGraph,
  sourceIds: readonly string[],
  opts: { offset?: { x: number; y: number } } = {},
): { graph: GameGraph; nodeIds: string[] } {
  const idSet = new Set(sourceIds)
  const sources = graph.nodes.filter((n) => idSet.has(n.id))
  if (sources.length === 0) return { graph, nodeIds: [] }
  const offset = opts.offset ?? { x: 48, y: 48 }
  const idMap = new Map<string, string>()
  const created: GameNode[] = []
  for (const src of sources) {
    const nid = newId('n')
    idMap.set(src.id, nid)
    created.push(cloneNodePayload(src, nid, offset))
  }
  const newEdges: GameEdge[] = []
  for (const e of graph.edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue
    const ns = idMap.get(e.source)!
    const nt = idMap.get(e.target)!
    newEdges.push({
      ...structuredClone(e),
      id: newId('edge'),
      source: ns,
      target: nt,
    })
  }
  return {
    graph: {
      nodes: [...graph.nodes, ...created],
      edges: [...graph.edges, ...newEdges],
    },
    nodeIds: created.map((n) => n.id),
  }
}

export function setNodePosition(graph: GameGraph, id: string, position: { x: number; y: number }): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
  }
}

/** 节点 data 补丁：`undefined` 表示删除该键（用于清掉子流程容器字段）。 */
export type NodeDataPatch = Partial<NodeData> & {
  subProcess?: SubProcess | undefined
  subFlowPack?: SubFlowPack | undefined
}

export function patchNodeData(graph: GameGraph, nodeId: string, patch: NodeDataPatch): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.id !== nodeId) return n
      const next: Record<string, unknown> = { ...n.data }
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k]
        else next[k] = v
      }
      return { ...n, data: next as unknown as GameNode['data'] }
    }),
  }
}

/** @deprecated 使用 patchNodeData */
export const updateNodeData = patchNodeData

export function setOverlayNodes(graph: GameGraph, nodeId: string, overlayNodes: OverlayNode[] | undefined): GameGraph {
  return patchNodeData(graph, nodeId, { overlayNodes })
}

/** @deprecated 用 setOverlayNodes；保留为「设为单挂载」。 */
export function setOverlayNode(graph: GameGraph, nodeId: string, overlayNode: OverlayNode | undefined): GameGraph {
  return setOverlayNodes(graph, nodeId, overlayNode ? [overlayNode] : undefined)
}

export interface ConnectSpec {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  data?: EdgeRouting
  id?: string
}

// ── advance.edgeId ↔ 边 同步 ──────────────────────────────────────────────────

/** 映射节点上全部 reactions（node.data + 各挂载）；`null` = 删除该条。 */
function mapNodeReactions(node: GameNode, map: (r: Reaction) => Reaction | null): GameNode {
  const mapList = (list: Reaction[] | undefined): Reaction[] | undefined => {
    if (!list?.length) return list
    const next: Reaction[] = []
    for (const r of list) {
      const m = map(r)
      if (m) next.push(m)
    }
    return next.length ? next : undefined
  }
  const dataReactions = mapList(node.data.reactions)
  const dataChanged = dataReactions !== node.data.reactions
  let mountsChanged = false
  const overlayNodes = node.data.overlayNodes?.map((m) => {
    const reactions = mapList(m.reactions)
    if (reactions === m.reactions) return m
    mountsChanged = true
    return { ...m, reactions }
  })
  if (!dataChanged && !mountsChanged) return node
  return {
    ...node,
    data: {
      ...node.data,
      ...(dataChanged ? { reactions: dataReactions } : {}),
      ...(mountsChanged ? { overlayNodes } : {}),
    },
  }
}

/** 源节点上 `sourceHandle === handle` 的出边数（含刚连上的边）。 */
function countHandleEdges(graph: GameGraph, source: string, handle: string): number {
  return graph.edges.filter((e) => e.source === source && (e.sourceHandle ?? 'default') === handle).length
}

/**
 * 在源节点写入一条 `when.event.id === handle` 的 advance reaction。
 * 挂载选择：已有同名 event reaction 的挂载 > 已有任意 event reaction 的挂载 > 首个挂载；
 * 无挂载则挂 `node.data.reactions`（避免写到 HUD 这类无交互事件的挂载上）。
 */
function ensureEventAdvanceReaction(node: GameNode, handle: string, edgeId: string): GameNode {
  const action: NodeAction = { kind: 'advance', edgeId }
  const reaction: Reaction = { when: { type: 'event', id: handle }, do: [action] }
  const mounts = node.data.overlayNodes
  if (mounts?.length) {
    let best = 0
    let bestScore = -1
    for (let i = 0; i < mounts.length; i++) {
      const rs = mounts[i]!.reactions ?? []
      const same = rs.some((r) => r.when.type === 'event' && r.when.id === handle)
      const anyEv = rs.some((r) => r.when.type === 'event')
      const score = (same ? 2 : 0) + (anyEv ? 1 : 0)
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    const overlayNodes = mounts.map((m, i) =>
      i === best ? { ...m, reactions: [...(m.reactions ?? []), reaction] } : m,
    )
    return { ...node, data: { ...node.data, overlayNodes } }
  }
  return {
    ...node,
    data: { ...node.data, reactions: [...(node.data.reactions ?? []), reaction] },
  }
}

/**
 * 连边后同步显式走向（让作者在 reactions 里能看见「去哪」）：
 * - 非 `default` 且该 handle **仅一条边**：回填/补上 `{ kind:'advance', edgeId }`；
 *   若尚无同名 event reaction，则自动建一条只含 advance 的 reaction。
 * - 同 handle **多条边**（权重/条件池）：去掉独占 `advance`，运行时走边池。
 * - `default` 口不注入（播完走 selectAutoEdge）。
 */
export function bindAdvanceToEdge(graph: GameGraph, edge: GameEdge): GameGraph {
  const handle = edge.sourceHandle ?? 'default'
  if (handle === 'default' || isSettlementAdvanceHandle(handle)) return graph
  const multi = countHandleEdges(graph, edge.source, handle) > 1
  let changed = false
  const nodes = graph.nodes.map((n) => {
    if (n.id !== edge.source) return n
    let foundMatch = false
    let next = mapNodeReactions(n, (r) => {
      if (r.when.type !== 'event' || r.when.id !== handle) return r
      foundMatch = true
      if (multi) {
        // 多边同 handle：独占 advance 会锁死边池，去掉后靠默认推进选边。
        const filtered = r.do.filter((a) => a.kind !== 'advance')
        if (filtered.length === r.do.length) return r
        changed = true
        return filtered.length ? { ...r, do: filtered } : null
      }
      const existing = r.do.find((a): a is Extract<NodeAction, { kind: 'advance' }> => a.kind === 'advance')
      if (!existing) {
        changed = true
        return { ...r, do: [...r.do, { kind: 'advance', edgeId: edge.id }] }
      }
      if (existing.edgeId === edge.id) return r
      // 原 edgeId 已失效 → 改挂到新边；仍有效则不覆盖（作者手选）
      const prevAlive = graph.edges.some((e) => e.id === existing.edgeId)
      if (prevAlive) return r
      changed = true
      return {
        ...r,
        do: r.do.map((a) => (a.kind === 'advance' ? { kind: 'advance' as const, edgeId: edge.id } : a)),
      }
    })
    if (!foundMatch && !multi) {
      changed = true
      next = ensureEventAdvanceReaction(next, handle, edge.id)
    }
    return next
  })
  return changed ? { ...graph, nodes } : graph
}

/** 删边后：清除全图 reactions 中指向该 edgeId 的 advance；若 event reaction 的 do 因此变空则删掉该 reaction。 */
export function unbindAdvanceFromEdge(graph: GameGraph, edgeId: string): GameGraph {
  let changed = false
  const nodes = graph.nodes.map((n) => {
    const next = mapNodeReactions(n, (r) => {
      const filtered = r.do.filter((a) => !(a.kind === 'advance' && a.edgeId === edgeId))
      if (filtered.length === r.do.length) return r
      changed = true
      if (filtered.length === 0 && r.when.type === 'event') return null
      return { ...r, do: filtered }
    })
    return next
  })
  return changed ? { ...graph, nodes } : graph
}

export function connect(graph: GameGraph, spec: ConnectSpec): GameGraph {
  // 自环拒绝（回环请画多节点环）；同 source+handle+target 去重。
  if (spec.source === spec.target) return graph
  const sourceHandle = spec.sourceHandle ?? 'default'
  const targetHandle = spec.targetHandle ?? 'in'
  if (
    graph.edges.some(
      (e) =>
        e.source === spec.source &&
        e.target === spec.target &&
        (e.sourceHandle ?? 'default') === sourceHandle &&
        (e.targetHandle ?? 'in') === targetHandle,
    )
  ) {
    return graph
  }
  const edge: GameEdge = {
    id: spec.id ?? newId('edge'),
    source: spec.source,
    target: spec.target,
    sourceHandle,
    targetHandle,
    data: spec.data,
  }
  return bindAdvanceToEdge({ ...graph, edges: [...graph.edges, edge] }, edge)
}

export function disconnect(graph: GameGraph, edgeId: string): GameGraph {
  const next = { ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) }
  return unbindAdvanceFromEdge(next, edgeId)
}

export function reconnect(
  graph: GameGraph,
  edgeId: string,
  patch: { source?: string; target?: string; sourceHandle?: string; targetHandle?: string },
): GameGraph {
  const before = graph.edges.find((e) => e.id === edgeId)
  const next: GameGraph = {
    ...graph,
    edges: graph.edges.map((e) =>
      e.id === edgeId
        ? {
          ...e,
          source: patch.source ?? e.source,
          target: patch.target ?? e.target,
          sourceHandle: patch.sourceHandle ?? e.sourceHandle,
          targetHandle: patch.targetHandle ?? e.targetHandle,
        }
        : e,
    ),
  }
  const after = next.edges.find((e) => e.id === edgeId)
  if (!before || !after) return next
  const handleChanged =
    (patch.sourceHandle !== undefined && (patch.sourceHandle ?? 'default') !== (before.sourceHandle ?? 'default')) ||
    (patch.source !== undefined && patch.source !== before.source)
  if (!handleChanged) return next
  // handle/源变了：先清旧绑定，再按新 handle 回填
  return bindAdvanceToEdge(unbindAdvanceFromEdge(next, edgeId), after)
}

export function updateEdgeData(graph: GameGraph, edgeId: string, data: EdgeRouting): GameGraph {
  return {
    ...graph,
    edges: graph.edges.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, ...data } } : e)),
  }
}

/** 同一事件 handle 的边共享跳转方式；延迟边共用节点唯一结算点。 */
export function updateEventRouteTiming(
  graph: GameGraph,
  nodeId: string,
  handle: string,
  transition: EdgeTransition,
  settlement?: RoutingSettlement,
): GameGraph {
  const edges = graph.edges.map((edge) => {
    if (edge.source !== nodeId || (edge.sourceHandle ?? 'default') !== handle) return edge
    const data = { ...edge.data }
    if (transition === 'immediate') delete data.transition
    else data.transition = transition
    return { ...edge, data: Object.keys(data).length ? data : undefined }
  })
  const next = { ...graph, edges }
  if (transition === 'onSettlement') {
    return updateNodeData(next, nodeId, { routingSettlement: settlement ?? { type: 'complete' } })
  }
  const stillDeferred = edges.some(
    (edge) => edge.source === nodeId && edge.data?.transition === 'onSettlement',
  )
  return stillDeferred ? next : updateNodeData(next, nodeId, { routingSettlement: undefined })
}

/**
 * 只挪结算时刻的 ms（拖时间轴上的结算标记）——不碰出边的跳转方式。
 *
 * 与 `updateEventRouteTiming` 的分工：那条负责「这条事件边是立即跳还是等结算」并按需建/删
 * 结算点；这条只在**已经是固定时刻结算**的节点上平移那个时刻。故非 `at` 结算一律 no-op：
 * 拖一个不存在的标记不该顺手把「演出结束时结算」偷偷改成固定时刻。
 */
export function setRoutingSettlementMs(graph: GameGraph, nodeId: string, ms: number): GameGraph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (node?.data.routingSettlement?.type !== 'at') return graph
  const next = Math.max(0, Math.round(ms))
  if (next === node.data.routingSettlement.ms) return graph
  return updateNodeData(graph, nodeId, { routingSettlement: { type: 'at', ms: next } })
}

/**
 * 只挪某条生命周期效果的施加时刻（拖时间轴上的青绿菱形）——那一条的 `when` 落成 `at(ms)`。
 *
 * `lifecycleIndex` 是**生命周期子集内的序号**（见 `isLifecycleReaction` 的注释：绝对下标会随
 * 检视器回写漂移）。非生命周期相位不在子集里，压根定位不到，也就不会被误改。
 * 历史 `exit`/`complete` 落成 `at` 是这一刻的显式选择（与检视器改那一行同义），故允许——
 * 语义差异已在检视器角标上说明。
 */
export function setLifecycleReactionMs(graph: GameGraph, nodeId: string, lifecycleIndex: number, ms: number): GameGraph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  const reactions = node?.data.reactions
  if (!reactions) return graph
  let seen = -1
  const absolute = reactions.findIndex((r) => isLifecycleReaction(r) && ++seen === lifecycleIndex)
  const target = reactions[absolute]
  if (!target) return graph
  const next = Math.max(0, Math.round(ms))
  if (target.when.type === 'at' && target.when.ms === next) return graph
  return updateNodeData(graph, nodeId, {
    reactions: reactions.map((r, i) => (i === absolute ? { ...r, when: { type: 'at' as const, ms: next } } : r)),
  })
}

/** 统一结算子集内按序号移动定时结算；条件结算没有时间坐标，定位到它时保持 no-op。 */
export function setSettlementReactionMs(graph: GameGraph, nodeId: string, settlementIndex: number, ms: number): GameGraph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  const reactions = node?.data.reactions
  if (!reactions) return graph
  let seen = -1
  const absolute = reactions.findIndex((r) => isSettlementReaction(r) && ++seen === settlementIndex)
  const target = reactions[absolute]
  if (!target || !isLifecycleReaction(target)) return graph
  const next = Math.max(0, Math.round(ms))
  if (target.when.type === 'at' && target.when.ms === next) return graph
  return updateNodeData(graph, nodeId, {
    reactions: reactions.map((r, i) => (i === absolute ? { ...r, when: { type: 'at' as const, ms: next } } : r)),
  })
}

/** 条件结算界面在视频预览画布拖动后，写回对应 spawn 动作的既有 layout 字段。 */
export function patchSettlementSpawnLayout(
  graph: GameGraph,
  nodeId: string,
  settlementIndex: number,
  actionIndex: number,
  layout: Layout,
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const reactions = node?.data.reactions
  if (!node || !reactions) return graph
  const absolute = settlementReactionAbsoluteIndex(reactions, settlementIndex)
  const reaction = reactions[absolute]
  const action = reaction?.do[actionIndex]
  if (!reaction || action?.kind !== 'spawn') return graph
  return updateNodeData(graph, nodeId, {
    reactions: reactions.map((candidate, reactionIndex) => reactionIndex === absolute
      ? {
        ...candidate,
        do: candidate.do.map((candidateAction, candidateActionIndex) => candidateActionIndex === actionIndex
          ? { ...action, layout }
          : candidateAction),
      }
      : candidate),
  })
}

/**
 * 结算绑定界面在时间轴上被拖动右端后写回显示时长。
 * 起始时刻永远是宿主结算的 `when.ms`，所以这里只碰 `ttlMs`；原本「常驻」（无 ttlMs）的
 * 界面被拖右端即就地转成按时长隐藏。时长夹到本节点演出长度，避免拖出节点之外。
 */
export function setSettlementSpawnTtlMs(
  graph: GameGraph,
  nodeId: string,
  settlementIndex: number,
  actionIndex: number,
  ttlMs: number,
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const reactions = node?.data.reactions
  if (!node || !reactions) return graph
  const absolute = settlementReactionAbsoluteIndex(reactions, settlementIndex)
  const reaction = reactions[absolute]
  const action = reaction?.do[actionIndex]
  if (!reaction || action?.kind !== 'spawn') return graph
  const next = clampSettlementSpawnTtlMs(ttlMs, nodePlayDurationMs(node))
  if (action.ttlMs === next) return graph
  return updateNodeData(graph, nodeId, {
    reactions: reactions.map((candidate, reactionIndex) => reactionIndex === absolute
      ? {
        ...candidate,
        do: candidate.do.map((candidateAction, candidateActionIndex) => candidateActionIndex === actionIndex
          ? { ...action, ttlMs: next }
          : candidateAction),
      }
      : candidate),
  })
}

/** 从时间轴解除一条界面绑定 = 从宿主结算的 `do` 里移除该 spawn 动作；结算本身保留。 */
export function removeSettlementSpawn(
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
  if (reaction?.do[actionIndex]?.kind !== 'spawn') return graph
  return updateNodeData(graph, nodeId, {
    reactions: reactions.map((candidate, reactionIndex) => reactionIndex === absolute
      ? { ...candidate, do: candidate.do.filter((_, index) => index !== actionIndex) }
      : candidate),
  })
}

function settlementReactionAbsoluteIndex(reactions: Reaction[], settlementIndex: number): number {
  let seen = -1
  return reactions.findIndex((reaction) => isSettlementReaction(reaction) && ++seen === settlementIndex)
}

function graphReferencesAdvanceEdge(graph: GameGraph, edgeId: string): boolean {
  const references = (reactions: Reaction[] | undefined) =>
    reactions?.some((reaction) => reaction.do.some((action) => action.kind === 'advance' && action.edgeId === edgeId)) ?? false
  return graph.nodes.some((node) =>
    references(node.data.reactions) || node.data.overlayNodes?.some((mount) => references(mount.reactions)),
  )
}

function removeOrphanSettlementAdvanceEdge(graph: GameGraph, edgeId: string | undefined): GameGraph {
  if (!edgeId || graphReferencesAdvanceEdge(graph, edgeId)) return graph
  const edge = graph.edges.find((candidate) => candidate.id === edgeId)
  if (!edge || !isSettlementAdvanceHandle(edge.sourceHandle ?? 'default')) return graph
  return disconnect(graph, edgeId)
}

/**
 * 把结算动作的“目标节点”编辑意图落成既有契约：`advance.edgeId` + 一条真实边。
 * 已有 source→target 边时复用；没有时才创建仅供显式 advance 消费的专用边。
 */
export function setSettlementAdvanceTarget(
  graph: GameGraph,
  nodeId: string,
  settlementIndex: number,
  actionIndex: number,
  targetId: string,
): GameGraph {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId)
  const reactions = node?.data.reactions
  if (!node || !reactions) return graph
  const absolute = settlementReactionAbsoluteIndex(reactions, settlementIndex)
  const reaction = reactions[absolute]
  const action = reaction?.do[actionIndex]
  if (!reaction || action?.kind !== 'advance') return graph

  const currentEdge = graph.edges.find((edge) => edge.id === action.edgeId)
  if (!targetId) {
    const next = updateNodeData(graph, nodeId, {
      reactions: reactions.map((candidate, index) => index === absolute
        ? { ...candidate, do: candidate.do.filter((_, candidateIndex) => candidateIndex !== actionIndex) }
        : candidate),
    })
    return removeOrphanSettlementAdvanceEdge(next, currentEdge?.id)
  }
  if (targetId === nodeId || !graph.nodes.some((candidate) => candidate.id === targetId)) return graph

  let next = graph
  let edge = currentEdge?.source === nodeId && currentEdge.target === targetId ? currentEdge : undefined
  edge ??= graph.edges.find((candidate) => candidate.source === nodeId && candidate.target === targetId)
  if (!edge && currentEdge?.source === nodeId && isSettlementAdvanceHandle(currentEdge.sourceHandle ?? 'default')) {
    next = reconnect(graph, currentEdge.id, { target: targetId })
    edge = next.edges.find((candidate) => candidate.id === currentEdge.id)
  }
  if (!edge) {
    const edgeId = newId('edge')
    next = connect(graph, {
      id: edgeId,
      source: nodeId,
      sourceHandle: `${SETTLEMENT_ADVANCE_HANDLE_PREFIX}${edgeId}`,
      target: targetId,
      targetHandle: 'in',
    })
    edge = next.edges.find((candidate) => candidate.id === edgeId)
  }
  if (!edge) return graph

  const nextNode = next.nodes.find((candidate) => candidate.id === nodeId)
  const nextReactions = nextNode?.data.reactions
  if (!nextReactions) return graph
  const nextAbsolute = settlementReactionAbsoluteIndex(nextReactions, settlementIndex)
  const nextReaction = nextReactions[nextAbsolute]
  if (nextReaction?.do[actionIndex]?.kind !== 'advance') return graph
  next = updateNodeData(next, nodeId, {
    reactions: nextReactions.map((candidate, index) => index === nextAbsolute
      ? {
        ...candidate,
        do: candidate.do.map((candidateAction, candidateIndex) => candidateIndex === actionIndex
          ? { kind: 'advance' as const, edgeId: edge.id }
          : candidateAction),
      }
      : candidate),
  })
  return removeOrphanSettlementAdvanceEdge(next, currentEdge?.id === edge.id ? undefined : currentEdge?.id)
}

/**
 * 按 (source, sourceHandle) upsert 出边。
 */
export function upsertBranchEdge(graph: GameGraph, spec: ConnectSpec): GameGraph {
  const existing = graph.edges.find(
    (e) => e.source === spec.source && e.sourceHandle === spec.sourceHandle,
  )
  if (existing) {
    let g = reconnect(graph, existing.id, { target: spec.target })
    if (spec.data) g = updateEdgeData(g, existing.id, spec.data)
    return g
  }
  return connect(graph, spec)
}

/**
 * 拆掉一段交互出边（不再改 overlay children —— 目录侧另编）：
 * 删交互 handle 出边，必要时补 out 续连。
 */
export function teardownInteraction(
  graph: GameGraph,
  nodeId: string,
  opts: { kind: string; handlePrefixes: string[]; continueHandle?: string },
): GameGraph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return graph
  const isHandle = (h: string | undefined): boolean =>
    !!h && opts.handlePrefixes.some((p) => h === p || h.startsWith(p))
  const outEdges = graph.edges.filter((e) => e.source === nodeId)
  const contEdge =
    (opts.continueHandle ? outEdges.find((e) => e.sourceHandle === opts.continueHandle) : undefined) ??
    outEdges.find((e) => isHandle(e.sourceHandle))
  const continueTarget = contEdge?.target

  let g: GameGraph = {
    ...graph,
    edges: graph.edges.filter((e) => !(e.source === nodeId && isHandle(e.sourceHandle))),
  }

  if (
    continueTarget &&
    !g.edges.some((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === 'default' && e.target === continueTarget)
  ) {
    g = connect(g, { source: nodeId, sourceHandle: 'default', target: continueTarget })
  }
  return g
}
