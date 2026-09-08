/**
 * scenario 级 overlay 编辑 —— children 住在 ui.overlays，节点挂 overlayNodes[]。
 *
 * 内容挂载分两类：
 * - 节点本地 overlay（`node:<id>`）：空节点从零搭建，或历史遗留的整张 fork 副本——直改其
 *   `ui.overlays[id].children`，与旧行为一致。
 * - 共享方案：**不再克隆**。改动写成挂载上的稀疏差量（`overrides`/`added`/`removed`），未改组件
 *   继续跟随共享方案（prototype + sparse override，见 `runtime/schema/expand-overlay.ts`）。
 */
import type { GameScenario, GraphLibraryDocument, OverlayChild, OverlayNode, GameGraph } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import type { Overlay } from '@/runtime/core/schema/node-config-schema'
import { overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { mergeChild, resolveMountChildren } from '@/runtime/core/schema/expand-overlay'

export function nodeOverlayId(nodeId: string): string {
  return `node:${nodeId}`
}

function nodeOverlayTitle(node: { id: string; data: { name?: string } }): string {
  return node.data.name?.trim() || node.id
}

function ensureNodeOverlayCatalogEntry(
  overlays: Record<string, Overlay>,
  overlayId: string,
  title: string,
): Record<string, Overlay> {
  const current = overlays[overlayId]
  if (!current) return { ...overlays, [overlayId]: { id: overlayId, title, children: [] } }
  if (current.title?.trim()) return overlays
  return { ...overlays, [overlayId]: { ...current, title } }
}

/** 设节点的 overlayNodes（本层内联，避免 runtime→graph 反向依赖）。 */
function setNodeOverlayNodes(graph: GameGraph, nodeId: string, overlayNodes: OverlayNode[]): GameGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, overlayNodes } } : n)),
  }
}

/** 内容挂载在 `mounts` 里的下标：优先 `node:<id>`，否则第一份；无挂载 = -1。 */
function contentMountIndex(node: { id: string }, mounts: OverlayNode[]): number {
  if (!mounts.length) return -1
  const idx = mounts.findIndex((m) => m.overlay === nodeOverlayId(node.id))
  return idx >= 0 ? idx : 0
}

/**
 * 含指定 childId 的挂载下标（扫全部挂载的合并结果）。
 * HUD 等常作为第二份挂载；写 overrides/删组件必须打到真正拥有它的那份，不能死盯内容挂载。
 */
function mountIndexOwningChild(
  overlays: Record<string, Overlay> | undefined,
  node: { id: string; data: { overlayNodes?: OverlayNode[] } },
  childId: string,
): number {
  const mounts = node.data.overlayNodes ?? []
  for (let i = 0; i < mounts.length; i++) {
    if (resolveMountChildren(overlays, mounts[i]!).some((c) => c.id === childId)) return i
  }
  return -1
}

/**
 * 含指定 childId 的挂载（跨全部挂载扫描；HUD 等常作第二份挂载，交互结算定位挂载复用这个）。
 * 找不到则 undefined（调用方自行兜底 primaryOverlayMount）。
 */
export function findMountOwningChild(
  scenario: GameScenario,
  node: { id: string; data: { overlayNodes?: OverlayNode[] } },
  childId: string,
): OverlayNode | undefined {
  const idx = mountIndexOwningChild(scenario.ui?.overlays, node, childId)
  return idx >= 0 ? (node.data.overlayNodes ?? [])[idx] : undefined
}

/** 节点素材编辑用的主挂载：优先 `node:<id>`，否则第一份。 */
export function primaryOverlayMount(
  node: { id: string; data: { overlayNodes?: OverlayNode[] } } | undefined,
): OverlayNode | undefined {
  const mounts = node?.data.overlayNodes ?? []
  if (!node || !mounts.length) return undefined
  return mounts[contentMountIndex(node, mounts)]
}

/**
 * 确保节点至少有一份内容挂载可编辑：
 * - 无任何挂载的空节点 → 建空的节点本地 overlay `node:<id>` 并挂上。
 * - 已有挂载（本地或共享）→ 原样返回；共享方案不再克隆，编辑改走 overrides/added/removed
 *   （见 `addOverlayChild` / `removeOverlayChild` / `patchOverlayChild`）。
 */
export function ensureNodeOverlay(scenario: GameScenario, nodeId: string): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const overlayId = nodeOverlayId(nodeId)
  const title = nodeOverlayTitle(node)
  const mounts = node.data.overlayNodes ?? []

  if (!mounts.length) {
    const overlays = ensureNodeOverlayCatalogEntry({ ...(scenario.ui?.overlays ?? {}) }, overlayId, title)
    return {
      ...scenario,
      ui: { ...scenario.ui, overlays },
      graph: setNodeOverlayNodes(scenario.graph, nodeId, [{ overlay: overlayId }]),
    }
  }

  // 防御性补壳/补标题：内容挂载已指向 node:<id>，但目录里那张 overlay 缺失或没有标题。
  const contentMount = mounts[contentMountIndex(node, mounts)]
  if (contentMount?.overlay === overlayId) {
    const currentOverlays = scenario.ui?.overlays ?? {}
    const overlays = ensureNodeOverlayCatalogEntry(currentOverlays, overlayId, title)
    if (overlays === currentOverlays) return scenario
    return {
      ...scenario,
      ui: { ...scenario.ui, overlays },
    }
  }
  return scenario
}

/**
 * @deprecated 克隆共享方案的分支已退休（改为逐组件 overrides/added/removed 差量，未改组件持续跟随
 * 共享方案，见 `resolveMountChildren`）。现仅剩"确保至少一份挂载存在"的语义，等价于
 * `ensureNodeOverlay`；保留导出供既有调用点零改。
 */
export function forkSchemeForEdit(scenario: GameScenario, nodeId: string): GameScenario {
  return ensureNodeOverlay(scenario, nodeId)
}

/** 汇总多张蓝图中每个 overlay 的挂载引用次数。 */
export function countOverlayReferences(graphs: Iterable<GameGraph>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      for (const mount of node.data.overlayNodes ?? []) {
        counts[mount.overlay] = (counts[mount.overlay] ?? 0) + 1
      }
    }
  }
  return counts
}

/** 某 overlay 是否被 scenario 中任一图挂载引用；库文档以 manifest.packs 为 SSOT，避免重复扫描主图镜像。 */
export function isOverlayReferenced(scenario: GameScenario, overlayId: string): boolean {
  const inGraph = (g: GameGraph): boolean =>
    g.nodes.some((n) =>
      (n.data.overlayNodes ?? []).some((m) => m.overlay === overlayId)
      || (getSubProcess(n.data) ? inGraph(getSubProcess(n.data)!.graph) : false),
    )
  if (inGraph(scenario.graph)) return true
  const bps = (scenario as GraphLibraryDocument).manifest?.packs
  const graphs = bps ? Object.values(bps).map((doc) => doc.graph) : [scenario.graph]
  return (countOverlayReferences(graphs)[overlayId] ?? 0) > 0
}

/** 从目录移除无人引用的节点本地副本（仅 `node:` 前缀，避免误删共享方案）。 */
export function dropOverlayIfUnreferenced(scenario: GameScenario, overlayId: string): GameScenario {
  if (!overlayId.startsWith('node:')) return scenario
  if (!scenario.ui?.overlays?.[overlayId]) return scenario
  if (isOverlayReferenced(scenario, overlayId)) return scenario
  const { [overlayId]: _drop, ...rest } = scenario.ui.overlays
  return { ...scenario, ui: { ...scenario.ui, overlays: rest } }
}

/** 累积一条差量补丁（顶层覆盖 + inputs/layout 各自浅合），用于往 `mount.overrides[childId]` 里叠加。 */
function mergePatch(prev: Partial<OverlayChild> | undefined, patch: Partial<OverlayChild>): Partial<OverlayChild> {
  return {
    ...prev,
    ...patch,
    inputs: patch.inputs ? { ...prev?.inputs, ...patch.inputs } : prev?.inputs,
    layout: patch.layout ? { ...prev?.layout, ...patch.layout } : prev?.layout,
  }
}

export function addOverlayChild(scenario: GameScenario, nodeId: string, child: OverlayChild): GameScenario {
  const scn = ensureNodeOverlay(scenario, nodeId)
  const node = scn.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scn
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = contentMountIndex(node, mounts)
  if (idx < 0) return scn
  const mount = mounts[idx]!

  if (mount.overlay.startsWith('node:')) {
    const overlayId = mount.overlay
    const ov = scn.ui?.overlays?.[overlayId]
    if (!ov) return scn
    return {
      ...scn,
      ui: {
        ...scn.ui,
        overlays: { ...scn.ui!.overlays, [overlayId]: { ...ov, children: [...ov.children, child] } },
      },
    }
  }

  mounts[idx] = { ...mount, added: [...(mount.added ?? []), child] }
  return { ...scn, graph: setNodeOverlayNodes(scn.graph, nodeId, mounts) }
}

/**
 * 同 `addOverlayChild`，但按显式 `mountId` 定位落盘挂载（不走 `contentMountIndex` 的"内容主挂载"自动解析）。
 * 供「添加控件」二级栏——从某个方案 tab 拖入的组件必须落进**那个方案自己的挂载** `added[]`，
 * 不能落进节点本地内容容器，否则「统一逻辑」编辑分支（按挂载归属判定，见 `graphMaterialOps.isSchemeOriginElement`）
 * 就会误判成默认样式来源。
 */
export function addOverlayChildToMount(
  scenario: GameScenario,
  nodeId: string,
  mountId: string,
  child: OverlayChild,
): GameScenario {
  const scn = ensureNodeOverlay(scenario, nodeId)
  const node = scn.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scn
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = mounts.findIndex((m) => overlayMountId(m) === mountId)
  if (idx < 0) return scn
  const mount = mounts[idx]!

  if (mount.overlay.startsWith('node:')) {
    const overlayId = mount.overlay
    const ov = scn.ui?.overlays?.[overlayId]
    if (!ov) return scn
    return {
      ...scn,
      ui: {
        ...scn.ui,
        overlays: { ...scn.ui!.overlays, [overlayId]: { ...ov, children: [...ov.children, child] } },
      },
    }
  }

  mounts[idx] = { ...mount, added: [...(mount.added ?? []), child] }
  return { ...scn, graph: setNodeOverlayNodes(scn.graph, nodeId, mounts) }
}

export function removeOverlayChild(scenario: GameScenario, nodeId: string, childId: string): GameScenario {
  const scn = ensureNodeOverlay(scenario, nodeId)
  const node = scn.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scn
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = mountIndexOwningChild(scn.ui?.overlays, node, childId)
  if (idx < 0) return scn
  const mount = mounts[idx]!

  if (mount.overlay.startsWith('node:')) {
    const overlayId = mount.overlay
    const ov = scn.ui?.overlays?.[overlayId]
    if (!ov) return scn
    return {
      ...scn,
      ui: {
        ...scn.ui,
        overlays: { ...scn.ui!.overlays, [overlayId]: { ...ov, children: ov.children.filter((c) => c.id !== childId) } },
      },
    }
  }

  if (mount.added?.some((c) => c.id === childId)) {
    mounts[idx] = { ...mount, added: mount.added.filter((c) => c.id !== childId) }
  } else {
    const { [childId]: _drop, ...restOverrides } = mount.overrides ?? {}
    mounts[idx] = {
      ...mount,
      overrides: Object.keys(restOverrides).length ? restOverrides : undefined,
      removed: mount.removed?.includes(childId) ? mount.removed : [...(mount.removed ?? []), childId],
    }
  }
  return { ...scn, graph: setNodeOverlayNodes(scn.graph, nodeId, mounts) }
}

function patchOverlayChildAtMountIndex(
  scn: GameScenario,
  nodeId: string,
  mounts: OverlayNode[],
  idx: number,
  childId: string,
  patch: Partial<OverlayChild>,
): GameScenario {
  const mount = mounts[idx]!

  if (mount.overlay.startsWith('node:')) {
    const overlayId = mount.overlay
    const ov = scn.ui?.overlays?.[overlayId]
    if (!ov) return scn
    return {
      ...scn,
      ui: {
        ...scn.ui,
        overlays: {
          ...scn.ui!.overlays,
          [overlayId]: { ...ov, children: ov.children.map((c) => (c.id === childId ? mergeChild(c, patch) : c)) },
        },
      },
    }
  }

  if (mount.added?.some((c) => c.id === childId)) {
    mounts[idx] = { ...mount, added: mount.added.map((c) => (c.id === childId ? mergeChild(c, patch) : c)) }
    return { ...scn, graph: setNodeOverlayNodes(scn.graph, nodeId, mounts) }
  }

  mounts[idx] = {
    ...mount,
    overrides: { ...mount.overrides, [childId]: mergePatch(mount.overrides?.[childId], patch) },
  }
  return { ...scn, graph: setNodeOverlayNodes(scn.graph, nodeId, mounts) }
}

export function patchOverlayChild(
  scenario: GameScenario,
  nodeId: string,
  childId: string,
  patch: Partial<OverlayChild>,
): GameScenario {
  const scn = ensureNodeOverlay(scenario, nodeId)
  const node = scn.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scn
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = mountIndexOwningChild(scn.ui?.overlays, node, childId)
  if (idx < 0) return scn
  return patchOverlayChildAtMountIndex(scn, nodeId, mounts, idx, childId, patch)
}

/**
 * 同 `patchOverlayChild`，但按显式 `mountId` 定位实例。
 * 同一 overlay 可重复挂载，而这些实例会共享 catalog child id；挂载级时间轴写回必须走这里，
 * 否则仅凭 child id 会始终命中第一份实例。
 */
export function patchOverlayChildInMount(
  scenario: GameScenario,
  nodeId: string,
  mountId: string,
  childId: string,
  patch: Partial<OverlayChild>,
): GameScenario {
  const scn = ensureNodeOverlay(scenario, nodeId)
  const node = scn.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scn
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = mounts.findIndex((m) => overlayMountId(m) === mountId)
  if (idx < 0) return scn
  const mount = mounts[idx]!
  if (!resolveMountChildren(scn.ui?.overlays, mount).some((c) => c.id === childId)) return scn
  return patchOverlayChildAtMountIndex(scn, nodeId, mounts, idx, childId, patch)
}

export function patchOverlayChildParams(
  scenario: GameScenario,
  nodeId: string,
  childId: string,
  inputs: Record<string, unknown>,
): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const idx = mountIndexOwningChild(scenario.ui?.overlays, node, childId)
  if (idx < 0) return scenario
  const mount = node.data.overlayNodes![idx]!
  const child = resolveMountChildren(scenario.ui?.overlays, mount).find((c) => c.id === childId)
  if (!child) return scenario
  return patchOverlayChild(scenario, nodeId, childId, { inputs: { ...child.inputs, ...inputs } })
}

/** 改 ui.overlays 目录里的 child（界面 tab / 共享 overlay，不经节点挂载路由）。 */
export function patchOverlayCatalogChild(
  scenario: GameScenario,
  overlayId: string,
  childId: string,
  patch: Partial<OverlayChild>,
): GameScenario {
  const ov = scenario.ui?.overlays?.[overlayId]
  if (!ov) return scenario
  return {
    ...scenario,
    ui: {
      ...scenario.ui,
      overlays: {
        ...scenario.ui!.overlays,
        [overlayId]: { ...ov, children: ov.children.map((c) => (c.id === childId ? mergeChild(c, patch) : c)) },
      },
    },
  }
}

export function patchOverlayMount(
  scenario: GameScenario,
  nodeId: string,
  mountId: string,
  patch: Partial<OverlayNode>,
): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const mounts = (node.data.overlayNodes ?? []).map((m) =>
    overlayMountId(m) === mountId ? { ...m, ...patch } : m,
  )
  return { ...scenario, graph: setNodeOverlayNodes(scenario.graph, nodeId, mounts) }
}

/** 本挂载上被覆盖/新增/屏蔽的 childId 集合（供 UI 展示"已覆盖 N / 新增 M / 屏蔽 K"）。 */
export function overriddenChildIds(mount: OverlayNode | undefined): { overridden: string[]; added: string[]; removed: string[] } {
  return {
    overridden: mount?.overrides ? Object.keys(mount.overrides) : [],
    added: mount?.added?.map((c) => c.id) ?? [],
    removed: mount?.removed ?? [],
  }
}

/** 单个组件回连原型：清掉该 childId 的 override（对 added/removed 无效——它们本就不是"跟随原型"的组件）。 */
export function resetOverride(scenario: GameScenario, nodeId: string, childId: string): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = mountIndexOwningChild(scenario.ui?.overlays, node, childId)
  if (idx < 0) return scenario
  const mount = mounts[idx]!
  if (!mount.overrides?.[childId]) return scenario
  const { [childId]: _drop, ...rest } = mount.overrides
  mounts[idx] = { ...mount, overrides: Object.keys(rest).length ? rest : undefined }
  return { ...scenario, graph: setNodeOverlayNodes(scenario.graph, nodeId, mounts) }
}

/** 整体回连：清空内容挂载的 overrides/added/removed，节点内容完全跟随共享方案。 */
export function relinkScheme(scenario: GameScenario, nodeId: string): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = contentMountIndex(node, mounts)
  if (idx < 0) return scenario
  const mount = mounts[idx]!
  if (!mount.overrides && !mount.added && !mount.removed) return scenario
  mounts[idx] = { ...mount, overrides: undefined, added: undefined, removed: undefined }
  return { ...scenario, graph: setNodeOverlayNodes(scenario.graph, nodeId, mounts) }
}
