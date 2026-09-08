import { t as translateUi } from '../../i18n'
/**
 * graphMaterialOps —— 「新引擎 › 视频」编辑器的 scenario 原生数据层（读投影 + 写映射）。
 *
 * 权威数据 = `graphScenarioStore` 合出的 `GameScenario`（graph + `ui.overlays`）。一个演出节点
 * （`node.id === scene.id`）经 `node.data.overlayNodes` 指向 `scenario.ui.overlays[id]`，
 * 该 overlay 的 `children[]`（`OverlayChild[]`）就是旧 Scene 的 dialogue/overlays/qte/choice/branches
 * 的**统一容器**。这里把它投影成时间轴用的 `MaterialItem[]` / 预览叠层，并把编辑（拖拽/检视器/增删/
 * 选项分支）经 `overlay-edit` + `graph-edit` 原语写回 —— 全程不落任何 Scene 拷贝。
 *
 * 每个节点专属一张 overlay（`node:<nodeId>`，见 `ensureNodeOverlay`）：本编辑器只直写该 overlay 的
 * `children`。挂载侧仅 `overlay` + `layout` + `reactions`，不补丁子组件。
 *
 * 旧 → 新 kind 映射：
 *   字幕 dialogue[]     → kind 'Dialogue'   （MaterialItem 'subtitle'）
 *   飘字 overlays[]      → kind 'floatText'  （'overlay'）+ 结算联动 = 节点 reaction（effect.id `${floatId}-settle`）
 *   QTE  qte.cues[]      → kind 'qte'（inputs.cues[]）→ 每 cue 一个 'qte' 项（整段 QTE 跨度由 cues 派生，不再单列 'qte_window' 轨）
 *   选项 choice+branches → kind 'choice'（inputs.events[]）+ 分支跳转 = 出边 `<id>`；效果 = 节点 event reaction
 */
import type {
  Entity,
  GameNode,
  GameScenario,
  GraphEffect,
  GraphTextStyle,
  Layout,
  NumOrExpr,
  Overlay,
  OverlayChild,
  OverlayInstanceChild,
  Reaction,
  Trigger,
} from '@/runtime/core/schema/graph-schema'
import type { NodeAction } from '@/runtime/core/schema/node-config-schema'
import type { ChoiceOption, FloatTextParams, QteCue } from './overlayMaterialTypes'
import { componentHandles, getComponent } from '@/runtime/core/registry/component-registry'
import {
  componentTypeLabel,
  defaultsForComponent,
  hasCuePointsInput,
  hasOptionEventsInput,
  isPositionable,
} from '../shell/editors'
import { decodeEffectOperation, encodeEffectOperation } from '../shell/valueExprPick'
import { FILTER_PRESETS, FX_PRESETS } from '@/runtime/core/fx/video-fx'
import { initState } from '@/runtime/core/engine/engine-init'
import type { OverlaySnap } from '@/runtime/core/engine/session'
import type { MaterialItem, MaterialKind } from './materialTimelineShared'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'
import { FLOAT_TEXT_TIMELINE_WIDTH_PX, clampLayer, clampMs, normalizeLayer } from './materialTimelineShared'
import {
  type PreviewEvalContext,
  type QteOutcomePreview,
  resolveChoicePreviewDetail,
  resolveFloatTextPreviewLabel,
  resolveQteCuePreviewLabel,
  resolveQteOutcomesPreviewDetail,
} from './previewResolve'
import {
  disconnect,
  newElementId,
  updateNodeData,
  upsertBranchEdge,
} from '@/authoring/graph/graph-edit'
import {
  addOverlayChild,
  addOverlayChildToMount,
  dropOverlayIfUnreferenced,
  ensureNodeOverlay,
  findMountOwningChild,
  forkSchemeForEdit,
  overriddenChildIds,
  patchOverlayChild,
  patchOverlayChildInMount,
  patchOverlayMount,
  primaryOverlayMount,
  removeOverlayChild,
  resetOverride,
} from '@/authoring/graph/overlay-edit'
import { clampSettlementSpawnTtlMs, nodePlayDurationMs } from '@/authoring/graph/timeline-geometry'
import { createOverlayMount, overlayMountId } from '@/runtime/core/schema/node-config-schema'
import { expandNodeChildren, resolveMountChildren } from '@/runtime/core/schema/expand-overlay'
import {
  STAGE_FILL_LAYOUT,
  layoutIsEffectivelyEmpty,
  resolveMountLayoutForChildren,
} from '@/runtime/core/schema/layout'

/**
 * 新建/克隆子件 layout（通用，不按 component id 特判）：
 * - 有来源 layout（方案克隆 / 面板角落锚点）→ 原样保留
 * - 否则一律 `STAGE_FILL_LAYOUT`（视频编辑器叠层默认铺满舞台；% 自绘才有正确坐标空间）
 */
function layoutForNewChild(fromLayout: Layout | undefined, zIndex: number | undefined): Layout {
  const base =
    fromLayout && !layoutIsEffectivelyEmpty(fromLayout)
      ? { ...fromLayout }
      : { ...STAGE_FILL_LAYOUT }
  return { ...base, zIndex: zIndex ?? fromLayout?.zIndex ?? 3 }
}

// ── overlay children 读取小工具（内容挂载 = 原型 ⊕ 稀疏差量，见 resolveMountChildren） ──
/** 内容挂载的 children：原型（共享方案）跟随 + 本挂载 overrides/added/removed 差量。 */
function childrenOf(scenario: GameScenario, node: GameNode | undefined): OverlayChild[] {
  const mount = primaryOverlayMount(node)
  if (!mount) return []
  return resolveMountChildren(scenario.ui?.overlays, mount)
}

/** 节点所有挂载（共享方案 + 节点专属）解析后的 children；交互元素检索用。 */
function mountedChildrenOf(scenario: GameScenario, node: GameNode | undefined): OverlayChild[] {
  if (!node) return []
  const out: OverlayChild[] = []
  for (const mount of node.data.overlayNodes ?? []) {
    out.push(...resolveMountChildren(scenario.ui?.overlays, mount))
  }
  return out.length ? out : childrenOf(scenario, node)
}
/**
 * 拆掉一整段交互：先按 child 事件级联清边+结算，再摘组件；最后按需把 default 续连到原先第一条交互边的目标。
 * （续连目标必须在清边前读出——`cascadeClearChildrenEvents` 会先 disconnect。）
 */
function teardownInteractionScenario(
  scenario: GameScenario,
  node: GameNode,
  opts: { kind: string; handlePrefixes: string[]; continueHandle?: string; childId?: string },
): GameScenario {
  const el = opts.childId ? findElement(scenario, node, opts.childId) : undefined
  const handles = opts.handlePrefixes.length
    ? opts.handlePrefixes
    : el
      ? eventHandlesOfChild(el)
      : []
  const isHandle = (h: string | undefined): boolean =>
    !!h && handles.some((p) => h === p || h.startsWith(p))
  const outEdges = scenario.graph.edges.filter((e) => e.source === node.id)
  const contEdge =
    (opts.continueHandle ? outEdges.find((e) => e.sourceHandle === opts.continueHandle) : undefined) ??
    outEdges.find((e) => isHandle(e.sourceHandle))
  const continueTarget = contEdge?.target

  let s = el ? cascadeClearChildrenEvents(scenario, node, [el]) : scenario
  if (!el && handles.length) {
    for (const e of outEdges.filter((edge) => isHandle(edge.sourceHandle))) {
      s = { ...s, graph: disconnect(s.graph, e.id) }
    }
  }
  if (opts.childId) s = removeOverlayChild(s, node.id, opts.childId)

  if (
    continueTarget &&
    !s.graph.edges.some(
      (e) =>
        e.source === node.id &&
        (e.sourceHandle ?? 'default') === 'default' &&
        e.target === continueTarget,
    )
  ) {
    s = {
      ...s,
      graph: upsertBranchEdge(s.graph, {
        source: node.id,
        sourceHandle: 'default',
        target: continueTarget,
      }),
    }
  }
  return s
}

// ── 预览叠层 ─────────────────────────────────────────────────────────────────
export type PreviewTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'qteCue'; elementId: string; cueId: string }
  /** 拖拽移动整个挂载盒（overlay 相对位置）。mount.layout 以「满舞台盒 + left/top 偏移」落盘：
      点元素（飘字等）自身是相对舞台的 inputs.x/y 锚点，挂载盒在其上叠加偏移，拖动即改偏移。 */
  | { kind: 'mount'; mountId: string; elementId: string }
  | { kind: 'readonly' }

export interface PreviewOverlay {
  id: string
  materialKey: string
  kind: MaterialKind
  label: string
  /** 求值后的效果摘要（选项各分支 / QTE 各档改数值），多行；预览副标题展示。 */
  detail?: string
  x: number
  y: number
  zIndex: number
  movable: boolean
  style?: GraphTextStyle
  target: PreviewTarget
}

export const SUBTITLE_XY = { x: 0.5, y: 0.9 }
export const OVERLAY_XY = { x: 0.5, y: 0.42 }
/** 选项整组默认锚点（预览拖拽 / 新建缺省 / 皮肤回退共用）。 */
export const OPTION_XY = { x: 0.5, y: 0.72 }
const QTE_GOOD_WINDOW = 480
/**
 * QTE 元素级参数键（落 el.inputs，非某个 cue）：完美半窗 / 过关次数 /
 * 出口目录（events/defaultEvent）/ 皮肤自管时长
 * （windowMs 或 durationMs——注意与 cue 级 `durationMs` hold 时长同名冲突）。
 */
const QTE_ELEMENT_PARAM_KEYS = new Set([
  'perfectMs',
  'passingHits',
  'events',
  'defaultEvent',
  'windowMs',
  'durationMs',
  'timeoutMs',
])
/** 边路由统一后选项 handle = 裸 event id（无 `opt:` 前缀）。 */
const CHOICE_HANDLE = ''

// ── 元素读取小工具 ────────────────────────────────────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function paramsOf(el: OverlayChild | undefined): Record<string, unknown> {
  return el?.inputs ?? {}
}
function cuesOf(el: OverlayChild | undefined): QteCue[] {
  const cues = paramsOf(el).cues
  return Array.isArray(cues) ? (cues as QteCue[]) : []
}
function optionsOf(el: OverlayChild | undefined): ChoiceOption[] {
  const events = paramsOf(el).events
  return Array.isArray(events) ? (events as ChoiceOption[]) : []
}

/** 结算后刷出的瞬态组件（NodeAction.spawn；本版 ttl 截断到当前节点时长）。 */
export interface SettlementSpawn {
  from: string
  ttlMs?: number
  inputs?: Record<string, unknown>
}

// spawn ttl 的夹取住在 graph 层（graph-edit 的时间轴回写也要用），这里只转出给既有消费方。
export { clampSettlementSpawnTtlMs, nodePlayDurationMs }

function readSpawnFromDo(actions: NodeAction[] | undefined): SettlementSpawn | undefined {
  const a = actions?.find((x) => x.kind === 'spawn' && x.from)
  if (!a || a.kind !== 'spawn') return undefined
  return {
    from: a.from,
    ...(a.ttlMs != null ? { ttlMs: a.ttlMs } : {}),
    ...(a.inputs && Object.keys(a.inputs).length ? { inputs: a.inputs } : {}),
  }
}

function spawnActionOf(spawn: SettlementSpawn, nodeDurMs: number): Extract<NodeAction, { kind: 'spawn' }> {
  return {
    kind: 'spawn',
    from: spawn.from,
    ttlMs: clampSettlementSpawnTtlMs(spawn.ttlMs, nodeDurMs),
    ...(spawn.inputs && Object.keys(spawn.inputs).length ? { inputs: spawn.inputs } : {}),
  }
}

/**
 * legacy 读兜底 —— 2026-07-16 边路由统一重构曾把选项/组件结算误写进 `node.data.reactions`
 * （运行时 emitComponentEvent 只读 mount.reactions，这条数据从未被执行过，见
 * §结算 mount-scoped 改造说明）。现只在 `readMountEventEffects`/`readMountEventSpawn` mount 侧
 * 无命中时回落一次，避免历史配置在升级后静默消失；不再是任何结算的主写入位置。
 */
function readEventEffects(node: GameNode, id: string): GraphEffect[] {
  const r = (node.data.reactions ?? []).find((rc) => rc.when.type === 'event' && rc.when.id === id)
  const eff = r?.do.find((a) => a.kind === 'effect')
  return eff && eff.kind === 'effect' ? eff.effects : []
}

function readEventSpawn(node: GameNode, id: string): SettlementSpawn | undefined {
  const r = (node.data.reactions ?? []).find((rc) => rc.when.type === 'event' && rc.when.id === id)
  return readSpawnFromDo(r?.do)
}

/** legacy 清理用：见 `clearLegacyNodeEvent`（写入 mount 侧后同步清掉这条 node 级残留）。 */
function writeEventEffectsData(
  reactions: Reaction[] | undefined,
  id: string,
  effects: GraphEffect[],
): Reaction[] | undefined {
  const list = reactions ?? []
  const idx = list.findIndex((r) => r.when.type === 'event' && r.when.id === id)
  if (idx < 0) {
    if (!effects.length) return reactions
    return [...list, { when: { type: 'event', id }, do: [{ kind: 'effect', effects }] }]
  }
  const r = list[idx]!
  const rest = r.do.filter((a) => a.kind !== 'effect')
  const nextDo = effects.length ? [{ kind: 'effect' as const, effects }, ...rest] : rest
  const next = [...list]
  if (nextDo.length) next[idx] = { ...r, do: nextDo }
  else next.splice(idx, 1)
  return next.length ? next : undefined
}

/** legacy 清理用：见 `clearLegacyNodeEvent`。 */
function writeEventSpawnData(
  reactions: Reaction[] | undefined,
  id: string,
  spawn: SettlementSpawn | undefined,
  nodeDurMs: number,
): Reaction[] | undefined {
  const list = reactions ?? []
  const idx = list.findIndex((r) => r.when.type === 'event' && r.when.id === id)
  const spawnDo = spawn?.from ? [spawnActionOf(spawn, nodeDurMs)] : []
  if (idx < 0) {
    if (!spawnDo.length) return reactions
    return [...list, { when: { type: 'event', id }, do: spawnDo }]
  }
  const r = list[idx]!
  const rest = r.do.filter((a) => a.kind !== 'spawn')
  const nextDo = [...rest, ...spawnDo]
  const next = [...list]
  if (nextDo.length) next[idx] = { ...r, do: nextDo }
  else next.splice(idx, 1)
  return next.length ? next : undefined
}

/** 目录里可选作 spawn 模板的组件（`overlayId/childId`）。 */
export function listSpawnTemplateOptions(
  scenario: GameScenario,
): Array<{ value: string; label: string }> {
  const overlays = scenario.ui?.overlays ?? {}
  const out: Array<{ value: string; label: string }> = []
  for (const ov of Object.values(overlays)) {
    for (const c of ov.children) {
      const value = `${ov.id}/${c.id}`
      const name = [ov.title?.trim(), componentTypeLabel(c.component)]
        .filter((part, index, all) => part && all.indexOf(part) === index)
        .join(' · ')
      out.push({
        value,
        label: authoringOptionLabel(name, value),
      })
    }
  }
  return out
}
function filterLabel(id: unknown): string {
  return FILTER_PRESETS.find((p) => p.id === id)?.label ?? '滤镜'
}
function fxLabel(id: unknown): string {
  return FX_PRESETS.find((p) => p.id === id)?.label ?? '特效'
}

/** 预览求值上下文：以场景 meta 初始态求所有公式（与试玩首帧一致）。 */
function previewCtxFor(scenario: GameScenario): { ctx: PreviewEvalContext; state: ReturnType<typeof initState> } {
  const state = initState(scenario)
  return {
    state,
    ctx: {
      evalCtx: { vars: state.vars, entities: state.entities, flags: state.flags, score: state.score, rng: state.rng },
      entities: scenario.entities,
      variables: scenario.variables,
    },
  }
}

// ── 结算（选项分支 / QTE 档位 / 通用组件事件，三者共用同一套读写内核）──────────────
// 运行时只读 mount.reactions 承接 event 类反应（engine.ts emitComponentEvent
// 都只查 nodeOverlayMounts(node)...reactions），落盘统一走 mount 级——跳转=边，改数值/生成组件=
// mount 的 event reaction。candidate handle 来自各自的 events 目录（选项=inputs.events 的 id、
// QTE=componentHandles(skin, inputs)、通用组件=manifest.events/inputs.events）。
export type QteOutcomeHandle = string
export interface OutcomeCandidate {
  handle: QteOutcomeHandle
  label: string
}
export interface OutcomeView {
  key: string
  label: string
  targetId: string | undefined
  edgeId: string | undefined
  effects: GraphEffect[]
  /** 结算后刷出的瞬态组件（本节点内，ttl 截断到节点时长）。 */
  spawn?: SettlementSpawn
  /**
   * QTE 默认三档里「良好」未单独配置时，运行时会按「完美」结算 —— UI 提示用。
   * 仅当候选同时含 pass/good 时才可能为 true（选项/通用组件恒为 false）。
   */
  fallsBackToPass?: boolean
}
/** QTE 结算专用别名（语义与 OutcomeCandidate/OutcomeView 相同）。 */
export type QteOutcomeCandidate = OutcomeCandidate

/**
 * 组件出口目录：新规格以 manifest.events 为准；无静态 events 时才看实例 `inputs.events`。
 */
function componentEventCatalog(
  componentId: string,
  inputs: Record<string, unknown> = {},
): Array<{ id: string; label?: string }> {
  const plugin = getComponent(componentId)
  if (plugin?.events?.length) return plugin.events.map((e) => ({ id: e.id, label: e.label }))
  return componentHandles(componentId, inputs)
}

/** 某 QTE 元素当前样式声明的结算候选 = component manifest.events。 */
function qteOutcomeCandidates(el: OverlayChild | undefined): QteOutcomeCandidate[] {
  if (!el) return []
  return componentEventCatalog(el.component, paramsOf(el)).map((o) => ({
    handle: o.id,
    label: o.label ?? o.id,
  }))
}

/** 出边命中（跳转=边，与 reactions 无关）；无 `sourceHandle` 视为 `'default'`。 */
function edgeForHandle(scenario: GameScenario, nodeId: string, handle: string) {
  return scenario.graph.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === handle)
}

/**
 * 含指定元素 elId 的挂载 id——选项/QTE/通用组件结算统一用这个定位落盘位置。
 * 取代原先只找「含 qte 子件」的 QTE 专属定位，改为按元素 id 精确定位（HUD 等第二份挂载同样命中）。
 */
function mountIdForElement(scenario: GameScenario, node: GameNode, elId: string): string | undefined {
  const owning = findMountOwningChild(scenario, node, elId)
  if (owning) return overlayMountId(owning)
  const pm = primaryOverlayMount(node)
  return pm ? overlayMountId(pm) : undefined
}

function mountReactionsOf(scenario: GameScenario, node: GameNode, mountId: string): Reaction[] {
  const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === mountId)
  return mount?.reactions ?? []
}

function hasMountEventReaction(scenario: GameScenario, node: GameNode, elId: string, eventId: string): boolean {
  const mountId = mountIdForElement(scenario, node, elId)
  if (!mountId) return false
  return mountReactionsOf(scenario, node, mountId).some((r) => r.when.type === 'event' && r.when.id === eventId)
}

/**
 * 读某元素 event(id) 结算的 effect——运行时真正读的地方（mount.reactions）。
 * legacy 兜底：2026-07-16 边路由统一重构一度把选项/组件结算误写进 `node.data.reactions`
 * （运行时从不读，等于配了不生效，见本次修复说明），mount 侧无该档时回落扫一遍，
 * 避免历史配置在升级后静默消失；下一次编辑写入时会同步清掉这条 legacy 残留（见 writeMountEventEffects）。
 */
function readMountEventEffects(scenario: GameScenario, node: GameNode, elId: string, eventId: string): GraphEffect[] {
  const mountId = mountIdForElement(scenario, node, elId)
  const rx = mountId ? mountReactionsOf(scenario, node, mountId) : []
  const hit = rx.find((r) => r.when.type === 'event' && r.when.id === eventId)
  const eff = hit?.do.find((a) => a.kind === 'effect')
  if (eff && eff.kind === 'effect' && eff.effects.length) return eff.effects
  return readEventEffects(node, eventId)
}

/** 读某元素 event(id) 结算的 spawn；legacy 兜底同 `readMountEventEffects`。 */
function readMountEventSpawn(scenario: GameScenario, node: GameNode, elId: string, eventId: string): SettlementSpawn | undefined {
  const mountId = mountIdForElement(scenario, node, elId)
  const rx = mountId ? mountReactionsOf(scenario, node, mountId) : []
  const hit = rx.find((r) => r.when.type === 'event' && r.when.id === eventId)
  const spawn = readSpawnFromDo(hit?.do)
  return spawn ?? readEventSpawn(node, eventId)
}

function isOutcomeConfigured(scenario: GameScenario, node: GameNode, elId: string, handle: string): boolean {
  if (edgeForHandle(scenario, node.id, handle)) return true
  if (hasMountEventReaction(scenario, node, elId, handle)) return true
  if (readMountEventEffects(scenario, node, elId, handle).length > 0) return true
  return !!readMountEventSpawn(scenario, node, elId, handle)
}

function outcomeView(
  scenario: GameScenario,
  node: GameNode,
  elId: string,
  handle: string,
  label: string,
  candidates: OutcomeCandidate[],
): OutcomeView {
  const edge = edgeForHandle(scenario, node.id, handle)
  const hasGood = candidates.some((c) => c.handle === 'good')
  return {
    key: handle,
    label,
    targetId: edge?.target,
    edgeId: edge?.id,
    effects: readMountEventEffects(scenario, node, elId, handle),
    spawn: readMountEventSpawn(scenario, node, elId, handle),
    fallsBackToPass: handle === 'pass' && hasGood && !isOutcomeConfigured(scenario, node, elId, 'good'),
  }
}

/** 检视器：已配置的 QTE 结算档；无任何配置时默认展示样式的第一档候选（可不跳转）。 */
export function listQteOutcomeViews(scenario: GameScenario, node: GameNode): OutcomeView[] {
  const el = qteElement(scenario, node)
  if (!el) return []
  const candidates = qteOutcomeCandidates(el)
  const configured = candidates.filter((c) => isOutcomeConfigured(scenario, node, el.id, c.handle))
  if (configured.length === 0) {
    const first = candidates[0] ?? { handle: 'pass', label: translateUi('ui.object.803f92e3381a') }
    return [outcomeView(scenario, node, el.id, first.handle, first.label, candidates)]
  }
  return configured.map((c) => outcomeView(scenario, node, el.id, c.handle, c.label, candidates))
}

/** 还可添加的 QTE 结算档（来自当前样式的候选集，减去已配置的）。 */
export function listAvailableQteOutcomes(scenario: GameScenario, node: GameNode): OutcomeCandidate[] {
  const el = qteElement(scenario, node)
  if (!el) return []
  const used = new Set(listQteOutcomeViews(scenario, node).map((o) => o.key))
  return qteOutcomeCandidates(el).filter((c) => !used.has(c.handle))
}

/** 确保节点至少有一份可编辑挂载，并定位 elId 所属挂载 id（写路径通用入口）。 */
function ensureReactionMountFor(scenario: GameScenario, node: GameNode, elId: string): { scenario: GameScenario; mountId: string } {
  let s = forkSchemeForEdit(scenario, node.id)
  const n = s.graph.nodes.find((x) => x.id === node.id)!
  let mountId = mountIdForElement(s, n, elId)
  if (!mountId) {
    const pm = primaryOverlayMount(n)!
    mountId = overlayMountId(pm)
  }
  return { scenario: s, mountId }
}

/**
 * 写挂载级 event reaction 的 effect（保留 spawn 等其它 do）。
 * `effects: []` 仍落一条空 effect，用作「该档已配置」标记（与历史行为一致）。
 */
function patchMountEventReaction(
  scenario: GameScenario,
  node: GameNode,
  mountId: string,
  handle: string,
  effects: GraphEffect[] | undefined,
  remove = false,
): GameScenario {
  const prev = mountReactionsOf(scenario, node, mountId)
  const existing = prev.find((r) => r.when.type === 'event' && r.when.id === handle)
  const kept = prev.filter((r) => !(r.when.type === 'event' && r.when.id === handle))
  if (!remove) {
    const rest = (existing?.do ?? []).filter((a) => a.kind !== 'effect')
    kept.push({
      when: { type: 'event', id: handle },
      do: [{ kind: 'effect', effects: effects ?? [] }, ...rest],
    })
  }
  return patchOverlayMount(scenario, node.id, mountId, { reactions: kept.length ? kept : undefined })
}

/** 写挂载级 event reaction 的 spawn（保留 effect 等其它 do；本版 ttl 截断到节点时长）。 */
function patchMountEventSpawn(
  scenario: GameScenario,
  node: GameNode,
  mountId: string,
  handle: string,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  const prev = mountReactionsOf(scenario, node, mountId)
  const existing = prev.find((r) => r.when.type === 'event' && r.when.id === handle)
  const kept = prev.filter((r) => !(r.when.type === 'event' && r.when.id === handle))
  const rest = (existing?.do ?? []).filter((a) => a.kind !== 'spawn')
  // 尚无 reaction 时补空 effect，保证该档算「已配置」
  const withEffect = rest.some((a) => a.kind === 'effect')
    ? rest
    : ([{ kind: 'effect' as const, effects: [] as GraphEffect[] }, ...rest] as NodeAction[])
  const nextDo = spawn?.from
    ? [...withEffect, spawnActionOf(spawn, nodePlayDurationMs(node))]
    : withEffect
  if (nextDo.length) kept.push({ when: { type: 'event', id: handle }, do: nextDo })
  return patchOverlayMount(scenario, node.id, mountId, { reactions: kept.length ? kept : undefined })
}

/** 删掉挂载上某档整条 event reaction（区别于「effects 置空」——那仍算「已配置」）。 */
function removeMountEventReaction(scenario: GameScenario, node: GameNode, elId: string, eventId: string): GameScenario {
  const mountId = mountIdForElement(scenario, node, elId)
  if (!mountId) return scenario
  return patchMountEventReaction(scenario, node, mountId, eventId, undefined, true)
}

/** 清掉 legacy `node.data.reactions` 里同 id 的残留（写入新位置后不留两处数据）。 */
function clearLegacyNodeEvent(scenario: GameScenario, node: GameNode, eventId: string): GameScenario {
  const n = scenario.graph.nodes.find((x) => x.id === node.id) ?? node
  let reactions = writeEventEffectsData(n.data.reactions, eventId, [])
  reactions = writeEventSpawnData(reactions, eventId, undefined, nodePlayDurationMs(n))
  if (reactions === n.data.reactions) return scenario
  return { ...scenario, graph: updateNodeData(scenario.graph, node.id, { reactions }) }
}

/** 写某元素 event(id) 结算的 effect（mount 级，运行时真正读的地方）+ 顺带清 legacy 残留。 */
function writeMountEventEffects(scenario: GameScenario, node: GameNode, elId: string, eventId: string, effects: GraphEffect[]): GameScenario {
  const { scenario: s0, mountId } = ensureReactionMountFor(scenario, node, elId)
  const n = s0.graph.nodes.find((x) => x.id === node.id)!
  const s1 = patchMountEventReaction(s0, n, mountId, eventId, effects)
  return clearLegacyNodeEvent(s1, s1.graph.nodes.find((x) => x.id === node.id)!, eventId)
}

/** 写某元素 event(id) 结算的 spawn（mount 级）+ 顺带清 legacy 残留。 */
function writeMountEventSpawn(scenario: GameScenario, node: GameNode, elId: string, eventId: string, spawn: SettlementSpawn | undefined): GameScenario {
  const { scenario: s0, mountId } = ensureReactionMountFor(scenario, node, elId)
  const n = s0.graph.nodes.find((x) => x.id === node.id)!
  const s1 = patchMountEventSpawn(s0, n, mountId, eventId, spawn)
  return clearLegacyNodeEvent(s1, s1.graph.nodes.find((x) => x.id === node.id)!, eventId)
}

export function addQteOutcomeGraph(scenario: GameScenario, node: GameNode, handle: QteOutcomeHandle): GameScenario {
  const el = qteElement(scenario, node)
  if (!el || isOutcomeConfigured(scenario, node, el.id, handle)) return scenario
  let s = scenario
  const first = qteOutcomeCandidates(el)[0]?.handle ?? 'pass'
  if (listQteOutcomeViews(s, node).length === 1 && !isOutcomeConfigured(s, node, el.id, first) && handle !== first) {
    s = ensureQtePassOutcomeGraph(s, node)
  }
  return setQteOutcomeEffectsGraph(s, node, handle, [])
}

/** 确保样式第一档候选（缺省 'pass'）已显式落盘——避免"只有一张隐式默认卡"的歧义态。 */
export function ensureQtePassOutcomeGraph(scenario: GameScenario, node: GameNode): GameScenario {
  const el = qteElement(scenario, node)
  if (!el) return scenario
  const first = qteOutcomeCandidates(el)[0]?.handle ?? 'pass'
  if (isOutcomeConfigured(scenario, node, el.id, first)) return scenario
  return setQteOutcomeEffectsGraph(scenario, node, first, [])
}

export function removeQteOutcomeGraph(scenario: GameScenario, node: GameNode, handle: QteOutcomeHandle): GameScenario {
  const cards = listQteOutcomeViews(scenario, node)
  if (cards.length <= 1) return scenario
  let s = scenario
  const edge = edgeForHandle(s, node.id, handle)
  if (edge) s = { ...s, graph: disconnect(s.graph, edge.id) }
  const n = s.graph.nodes.find((x) => x.id === node.id)!
  const el = qteElement(s, n)
  if (el) s = removeMountEventReaction(s, s.graph.nodes.find((x) => x.id === node.id)!, el.id, handle)
  return s
}

export function setQteOutcomeTargetGraph(
  scenario: GameScenario,
  node: GameNode,
  handle: QteOutcomeHandle,
  targetId: string,
): GameScenario {
  let s = scenario
  if (!targetId) {
    const edge = edgeForHandle(s, node.id, handle)
    return edge ? { ...s, graph: disconnect(s.graph, edge.id) } : s
  }
  const el = qteElement(s, node)
  if (el && !isOutcomeConfigured(s, node, el.id, handle)) {
    s = setQteOutcomeEffectsGraph(s, node, handle, [])
  }
  return { ...s, graph: upsertBranchEdge(s.graph, { source: node.id, sourceHandle: handle, target: targetId }) }
}

export function setQteOutcomeEffectsGraph(
  scenario: GameScenario,
  node: GameNode,
  handle: QteOutcomeHandle,
  effects: GraphEffect[],
): GameScenario {
  const el = qteElement(scenario, node)
  if (!el) return scenario
  return writeMountEventEffects(scenario, node, el.id, handle, effects)
}

export function setQteOutcomeSpawnGraph(
  scenario: GameScenario,
  node: GameNode,
  handle: QteOutcomeHandle,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  const el = qteElement(scenario, node)
  if (!el) return scenario
  return writeMountEventSpawn(scenario, node, el.id, handle, spawn)
}

/** 预览摘要：各档改数值（读 mount reactions，legacy 兜底见 readMountEventEffects）。 */
function listQteOutcomes(scenario: GameScenario, node: GameNode): QteOutcomePreview[] {
  return listQteOutcomeViews(scenario, node)
    .filter((o) => o.effects.length > 0)
    .map((o) => ({
      handle: o.key,
      label: o.label,
      effects: o.effects,
      fallsBackToPass: o.fallsBackToPass,
    }))
}

function firstEntityId(entities: Record<string, Entity> | undefined, kind: 'boss' | 'player'): string {
  for (const [id, e] of Object.entries(entities ?? {})) if (e.kind === kind) return e.id ?? id
  return `ent-${kind}`
}

/** 从飘字内容里解析伤害数值：取首个数字的绝对值，无数字则 0。 */
export function parseDamageFromContent(content: string): number {
  const m = content.match(/-?\d+(?:\.\d+)?/)
  return m ? Math.abs(Number(m[0])) || 0 : 0
}

/**
 * 「飘字联动结算」的结算副作用 = 挂在**节点 reactions** 上的一条 effect（不再是 settle 组件）。
 * 通过 effect.id = `${floatId}-settle` 把结算与对应飘字绑定，便于检视器定位/删改。
 */
function settleEffectId(floatId: string): string {
  return `${floatId}-settle`
}
export function createDamageHpEffect(
  entities: Record<string, Entity> | undefined,
  target: 'boss' | 'player',
  amount: NumOrExpr,
  floatId: string,
): GraphEffect {
  const encoded = encodeEffectOperation('sub', amount)
  return {
    kind: 'attr',
    entityId: firstEntityId(entities, target),
    attr: 'hp',
    ...encoded,
    id: settleEffectId(floatId),
  }
}
/** 飘字出现时机 → 结算 reaction 的相位（at:ms 优先，否则 enter）。 */
function floatSettleWhen(float: OverlayChild | undefined): Reaction['when'] {
  const t = float?.trigger
  if (t?.when === 'at') return { type: 'at', ms: t.ms }
  const start = float?.window?.startMs
  return typeof start === 'number' && start > 0 ? { type: 'at', ms: start } : { type: 'enter' }
}
/** 定位某飘字对应的结算 reaction（node.data.reactions 中含 effect.id=`${floatId}-settle` 的那条）。 */
export function settleElementFor(scenario: GameScenario, node: GameNode | undefined, floatId: string): Reaction | undefined {
  const eid = settleEffectId(floatId)
  return (node?.data.reactions ?? []).find((r) =>
    r.do.some((a) => a.kind === 'effect' && a.effects.some((e) => e.id === eid)),
  )
}
function settleHpEffect(
  settle: Reaction | undefined,
): Extract<GraphEffect, { kind: 'attr' }> | undefined {
  for (const a of settle?.do ?? []) {
    if (a.kind !== 'effect') continue
    const hp = a.effects.find((e) => e.kind === 'attr' && e.attr === 'hp')
    if (hp?.kind === 'attr') return hp
  }
  return undefined
}
/** 结算 reaction 的绝对伤害（公式态时取不到常量，返回 0）。 */
export function settleDamage(settle: Reaction | undefined): number {
  const hp = settleHpEffect(settle)
  if (!hp) return 0
  const operation = decodeEffectOperation(hp.op, hp.value)
  return operation.op === 'sub' && typeof operation.value === 'number'
    ? Math.abs(operation.value)
    : 0
}
/** 结算 reaction 里 hp effect 的原始值（常量或 `{expr,pick}`），供检视器公式编辑器回填。 */
export function settleValue(settle: Reaction | undefined): NumOrExpr | undefined {
  return settleHpEffect(settle)?.value
}
/** 结算作用于 boss 还是 player。 */
export function settleTargetKind(
  settle: Reaction | undefined,
  entities: Record<string, Entity> | undefined,
): 'boss' | 'player' {
  const hp = settleHpEffect(settle)
  const ent = hp?.entityId ? entities?.[hp.entityId] : undefined
  return ent?.kind === 'player' ? 'player' : 'boss'
}
/** 飘字到点广播的 effects（settle reaction 里挂的完整效果列表；无结算则 []）。 */
export function overlayEffects(
  scenario: GameScenario,
  node: GameNode | undefined,
  floatId: string,
): GraphEffect[] {
  const settle = settleElementFor(scenario, node, floatId)
  for (const a of settle?.do ?? []) {
    if (a.kind === 'effect') return a.effects
  }
  return []
}
function exprText(v: NumOrExpr): string {
  return typeof v === 'number' ? String(v) : v.expr
}
/** 预览用飘字 inputs：`expr` 缺省时回落结算效果第一条的值，与「所见即所广播」一致。 */
function floatPreviewParams(
  scenario: GameScenario,
  node: GameNode | undefined,
  el: OverlayChild,
  inputs: FloatTextParams,
): FloatTextParams {
  const raw = inputs as FloatTextParams & {
    fixedText?: unknown
    parameter?: unknown
    expr?: unknown
  }
  if (el.component === 'DamageFloatText' || el.component === 'GainFloatText') {
    const fixedText = typeof raw.fixedText === 'string' ? raw.fixedText : ''
    if (Object.prototype.hasOwnProperty.call(raw, 'parameter')) {
      if (typeof raw.parameter === 'string') {
        return { ...inputs, text: `${fixedText}${raw.parameter}`, expr: undefined }
      }
      if (
        typeof raw.parameter === 'number'
        || (
          raw.parameter
          && typeof raw.parameter === 'object'
          && typeof (raw.parameter as { expr?: unknown }).expr === 'string'
        )
      ) {
        return { ...inputs, text: `${fixedText}{v}`, expr: raw.parameter as never }
      }
      return { ...inputs, text: fixedText, expr: undefined }
    }
  }
  if (raw.expr != null && (typeof raw.expr !== 'string' || raw.expr.trim() !== '')) return inputs
  const first = overlayEffects(scenario, node, el.id).find((e) => e.kind === 'attr' || e.kind === 'var')
  const v = first && (
    first.kind === 'attr'
    || (first.kind === 'var' && first.valueType !== 'text')
  ) ? first.value : undefined
  if (v === undefined) return inputs
  return { ...inputs, expr: exprText(v) }
}
/** 删除某飘字的结算 reaction。 */
function removeSettleReaction(scenario: GameScenario, node: GameNode, floatId: string): GameScenario {
  const eid = settleEffectId(floatId)
  const kept = (node.data.reactions ?? []).filter(
    (r) => !r.do.some((a) => a.kind === 'effect' && a.effects.some((e) => e.id === eid)),
  )
  return { ...scenario, graph: updateNodeData(scenario.graph, node.id, { reactions: kept.length ? kept : undefined }) }
}
/**
 * 写入/覆盖某飘字的结算 reaction，effects 为完整效果列表（对齐 `EffectsEditor` 的编辑单位）。
 * 空列表＝纯展示，等价删除。首条效果打上 `${floatId}-settle` 定位 id，供 `settleElementFor` 检索；
 * 其余保留用户自定义 id（缺省兜底生成，避免 undefined 冲突）。
 */
function upsertSettleEffects(
  scenario: GameScenario,
  node: GameNode,
  floatId: string,
  when: Reaction['when'],
  effects: GraphEffect[],
): GameScenario {
  if (effects.length === 0) return removeSettleReaction(scenario, node, floatId)
  const eid = settleEffectId(floatId)
  const kept = (node.data.reactions ?? []).filter(
    (r) => !r.do.some((a) => a.kind === 'effect' && a.effects.some((e) => e.id === eid)),
  )
  const tagged = effects.map((e, i) => (i === 0 ? { ...e, id: eid } : { ...e, id: e.id ?? `${eid}-${i + 1}` }))
  kept.push({ when, do: [{ kind: 'effect', effects: tagged }] })
  return { ...scenario, graph: updateNodeData(scenario.graph, node.id, { reactions: kept }) }
}

// ── 节点/元素定位 ─────────────────────────────────────────────────────────────
export function findNode(graph: GameScenario['graph'], nodeId: string | undefined): GameNode | undefined {
  if (!nodeId) return undefined
  return graph.nodes.find((n) => n.id === nodeId)
}
export function findElement(scenario: GameScenario, node: GameNode | undefined, elId: string): OverlayChild | undefined {
  // 扫全部挂载：HUD 方案常挂在内容挂载之外的第二份上。
  return mountedChildrenOf(scenario, node).find((e) => e.id === elId)
}
export function qteElementOfCue(scenario: GameScenario, node: GameNode | undefined, cueId: string): OverlayChild | undefined {
  return mountedChildrenOf(scenario, node).find((e) => hasCuePointsInput(e.component) && cuesOf(e).some((c) => c.id === cueId))
}
export function qteElement(scenario: GameScenario, node: GameNode | undefined): OverlayChild | undefined {
  return mountedChildrenOf(scenario, node).find((e) => hasCuePointsInput(e.component))
}

/** 编辑器预览：当前节点 QTE 用到可联调皮肤时，供节点预览渲染真实交互皮。
 *  传入 `playheadMs` 时：播放头不落在任一 cue 窗内则返回 null（皮肤层整段卸掉，避免窗外残留）。 */
export function qteSkinPreviewInteraction(
  scenario: GameScenario,
  node: GameNode | undefined,
  playheadMs?: number,
): OverlaySnap | null {
  const el = qteElement(scenario, node)
  if (!el) return null
  const component = el.component
  const inputs = paramsOf(el)
  const cues = cuesOf(el)
  if (!cues.length) return null
  if (playheadMs != null) {
    const inWindow = cues.some((c) => {
      const s = c.appearAt ?? 0
      const end = c.endAt ?? s + QTE_GOOD_WINDOW
      return playheadMs >= s && playheadMs <= end
    })
    if (!inWindow) return null
  }
  return {
    elementId: el.id,
    component,
    inputs: { ...inputs, component, cues },
  }
}

export function choiceElement(scenario: GameScenario, node: GameNode | undefined): OverlayChild | undefined {
  return mountedChildrenOf(scenario, node).find((e) => hasOptionEventsInput(e.component))
}

/** 写回锁定 events，并清掉已不存在的出口边。 */
function writeChoiceParamsWithEdgeCleanup(
  scenario: GameScenario,
  node: GameNode,
  el: OverlayChild,
  nextParams: Record<string, unknown>,
): GameScenario {
  const keep = new Set(
    (Array.isArray(nextParams.events) ? (nextParams.events as ChoiceOption[]) : []).map((o) => o.id),
  )
  let s = patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
  for (const edge of s.graph.edges) {
    if (edge.source !== node.id || edge.sourceHandle == null) continue
    if (edge.sourceHandle === 'default' || edge.sourceHandle === 'in') continue
    if (!keep.has(edge.sourceHandle)) s = { ...s, graph: disconnect(s.graph, edge.id) }
  }
  return s
}

/**
 * 编辑器预览：当前节点 choice 用到可联调皮肤时，供节点预览渲染真实交互皮。
 * 传入 `playheadMs` 时按 `window` 门闸（窗外卸掉，避免残留默认清单叠层）。
 * 可能同时挂多份（方案里應默+技能条），全部返回。
 */
export function choiceSkinPreviewInteractions(
  scenario: GameScenario,
  node: GameNode | undefined,
  playheadMs?: number,
  maxMs = 60_000,
): OverlaySnap[] {
  if (!node) return []
  const out: OverlaySnap[] = []
  for (const el of mountedChildrenOf(scenario, node)) {
    if (!hasOptionEventsInput(el.component)) continue
    const component = el.component
    if (playheadMs != null) {
      const start = el.window?.startMs ?? 0
      const end = el.window?.endMs ?? maxMs
      if (playheadMs < start || playheadMs > end) continue
    }
    const inputs = paramsOf(el)
    out.push({
      elementId: el.id,
      component,
      inputs: { ...inputs, component },
    })
  }
  return out
}

/** 起点：window.startMs 优先；否则 trigger='at' 用 ms；其余（含缺省 trigger）落 0。 */
function timedStart(el: OverlayChild): number {
  if (el.window?.startMs != null) return el.window.startMs
  if (el.trigger?.when === 'at') return el.trigger.ms
  return 0
}

/**
 * 该元素是否来自某个真实方案挂载（`node.data.overlayNodes` 中非 `node:` 前缀的那份），
 * 而不是节点本地内容容器（`node:<nodeId>`）——「方案来源组件统一走通用编辑逻辑」的唯一判定入口。
 * 不看组件的 component/kind 是什么，只看它物理落在哪份挂载上（prototype 原型 / overrides / added
 * 皆算方案来源；只有节点本地容器里的才算「默认样式」来源）。
 */
export function isSchemeOriginElement(scenario: GameScenario, node: GameNode | undefined, elId: string): boolean {
  if (!node) return false
  const mount = findMountOwningChild(scenario, node, elId)
  return !!mount && !mount.overlay.startsWith('node:')
}

/**
 * 时间轴 / 检视器分类的唯一入口。方案来源的元素统一归为 `'component'`（走通用编辑 UI，
 * 不管它底层是 dialogue/qte/choice 还是自定义组件）；只有节点本地容器（「默认样式」来源）
 * 的元素才继续按字面 `component` 细分到字幕/飘字/QTE/选项/滤镜/特效六个专属分支
 * （默认样式的这六个位置落盘时 `component` 恒为对应字面值，无需别名折叠）。
 */
function materialKindForChild(scenario: GameScenario, node: GameNode | undefined, el: OverlayChild): MaterialKind {
  if (isSchemeOriginElement(scenario, node, el.id)) return 'component'
  if (el.component === 'Dialogue') return 'subtitle'
  if (el.component === 'DamageFloatText' || el.component === 'GainFloatText') return 'overlay'
  if (hasOptionEventsInput(el.component)) return 'option'
  if (hasCuePointsInput(el.component)) return 'qte'
  if (el.component === 'filter') return 'filter'
  if (el.component === 'fx') return 'fx'
  return 'component'
}

/** 这两种新飘字的持续时间由组件 `durationMs` 控制，时间轴只负责放置触发时刻。 */
function isSelfTimedFloatText(componentId: string): boolean {
  return componentId === 'DamageFloatText' || componentId === 'GainFloatText'
}

/** `kind` 由调用方传入（已由 `materialKindForChild` 算好），避免这里重复一遍 isKind 判断。 */
function componentLabelOf(el: OverlayChild, kind: MaterialKind): string {
  const id = el.component
  const params = paramsOf(el)
  if (kind === 'subtitle') return str(params.text) || '字幕'
  if (kind === 'overlay') {
    const fixedText = str(params.fixedText) ?? ''
    const parameter = typeof params.parameter === 'string' || typeof params.parameter === 'number'
      ? String(params.parameter)
      : ''
    return `${fixedText}${parameter}`.trim() || (str(params.text) ?? '').trim() || '飘字'
  }
  if (kind === 'option') return componentTypeLabel(id) || '选项'
  if (kind === 'filter') return filterLabel(params.filter)
  if (kind === 'fx') return fxLabel(params.fx)
  // 通用组件（含方案来源）：实例 params.label（如「我方」）→ 类型展示名（manifest.label）→ component id
  return str(params.label) || componentTypeLabel(id)
}

// ── 读投影：node → MaterialItem[] ─────────────────────────────────────────────
export function collectMaterialsFromNode(scenario: GameScenario, node: GameNode | undefined, maxMs: number): MaterialItem[] {
  if (!node) return []
  // 全部挂载的「↺ 回连方案」徽章（HUD 等第二份挂载也要能标）——只标真正的 overrides；
  // added 是纯新增实例，没有原型可回连，resetMaterialOverrideGraph 对它是 no-op，不该显示这个按钮。
  const flagged = new Set<string>()
  for (const mount of node.data.overlayNodes ?? []) {
    const { overridden } = overriddenChildIds(mount)
    for (const id of overridden) flagged.add(id)
  }
  const out: MaterialItem[] = []
  for (const el of mountedChildrenOf(scenario, node)) {
    const overriddenFlag = flagged.has(el.id) || undefined
    const componentId = el.component
    const kind = materialKindForChild(scenario, node, el)
    if (kind === 'qte') {
      for (const c of cuesOf(el)) {
        // 左缘=出现(appearAt) 右缘=消失(endAt) 菱形=命中判定(targetAt，计分锚点)。
        const s = c.appearAt ?? 0
        const target = c.targetAt ?? s
        const end = c.endAt ?? Math.max(target + 300, s + (c.durationMs ?? 500))
        out.push({
          key: `qte:${el.id}:${c.id}`,
          id: c.id,
          kind: 'qte',
          componentId,
          label: c.label || translateUi('ui.object.aa2eccd7649c'),
          startMs: s,
          endMs: end,
          markerMs: Math.min(Math.max(target, s), end),
          zIndex: normalizeLayer(c.zIndex, 2),
          overridden: overriddenFlag,
        })
      }
      continue
    }
    const start = kind === 'subtitle' || kind === 'overlay'
      ? timedStart(el)
      : (el.window?.startMs ?? timedStart(el))
    const defaultEnd = kind === 'subtitle' ? start + 2000 : kind === 'overlay' ? start + 1200 : maxMs
    out.push({
      key: `${kind}:${el.id}`,
      id: el.id,
      kind,
      componentId,
      label: componentLabelOf(el, kind),
      startMs: start,
      endMs: el.window?.endMs ?? Math.min(maxMs, defaultEnd),
      zIndex: normalizeLayer(el.layout?.zIndex, kind === 'component' ? 3 : kind === 'filter' ? 4 : kind === 'fx' ? 5 : kind === 'option' ? 3 : kind === 'overlay' ? 1 : 0),
      fixedWidthPx: isSelfTimedFloatText(componentId) ? FLOAT_TEXT_TIMELINE_WIDTH_PX : undefined,
      overridden: overriddenFlag,
    })
  }
  return out
}

/** 素材属性「↺ 回连方案」：清掉该素材所属组件在挂载上的差量，改回跟随共享方案。 */
export function resetMaterialOverrideGraph(scenario: GameScenario, node: GameNode, item: MaterialItem): GameScenario {
  const elId = item.kind === 'qte' ? qteElementOfCue(scenario, node, item.id)?.id : item.id
  if (!elId) return scenario
  return resetOverride(scenario, node.id, elId)
}

// ── 读投影：node → 挂载级 MaterialItem[]（蓝图节点配置面板时间轴用） ──────────────
/**
 * 单个子件在视频上的**可见窗口** —— 唯一时序 SSOT = `window.startMs/endMs`，全组件一视同仁。
 *
 * 与运行时同源：引擎两处挂载通道都在 `el.window` 存在时跳过 `trigger`
 * （`nodes/perf.ts` 的 enter 通道、`engine.ts#flushTimeline` 的 at 通道），`window` 到点显示、
 * 到点移除（`engine.ts#tickWindows`）。所以编辑器**不再**从 `inputs.cues` 反推显隐窗：
 * 拍点 `appearAt/targetAt/endAt` 只表达拍点之间的相对时序（皮肤内部时钟从挂载那刻起算、
 * 按 `appearAt - min(appearAt)` 归一，见 InkKouLayer），绝对值不决定它出现在视频何处。
 *
 * `window` 缺失时才回落 `timedStart`（trigger）→ maxMs——仅兜底未落 window 的瞬态 spawn。
 * 自计时飘字例外：它的结束由 `inputs.durationMs` 决定；新挂载通常只有起点，若仍回落 maxMs，
 * 固定宽度时间轴条会被误判为占满整段视频，导致无法水平移动。
 * 滤镜/特效无位置语义，返回 null（不参与挂载条跨度）。
 */
export function childVisibleSpan(el: OverlayChild, maxMs: number): { start: number; end: number } | null {
  if (el.component === 'filter' || el.component === 'fx') return null
  const start = el.window?.startMs ?? timedStart(el)
  const end = el.window?.endMs ?? (
    isSelfTimedFloatText(el.component)
      ? Math.min(maxMs, start + resolveFloatTextDurationMs(paramsOf(el).durationMs))
      : maxMs
  )
  return { start, end }
}

function resolveFloatTextDurationMs(value: unknown, fallback = 1100): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * 每份挂载（overlayNodes[i]）投影成一条时间轴 item（kind 'mount'）——蓝图节点配置面板专用。
 * - 跨度 = 该挂载全部子件**可见窗口**（`childVisibleSpan`，cue 优先）的 [min, max]，与预览/运行时
 *   实际显隐一致；无位置语义子件（滤镜/特效）不计；全空 → [0, maxMs] 占位（挂载必然可见）。
 * - label = 覆盖物 title；id/key = 挂载 id（overlayMountId），供 shift/remove/focus 路由。
 * - zIndex = 挂载序号（每份挂载独占一行）。
 * 与视频 tab 的 child 级 `collectMaterialsFromNode` 并存、互不影响。
 */
export function collectMountItemsFromNode(scenario: GameScenario, node: GameNode | undefined, maxMs: number): MaterialItem[] {
  if (!node) return []
  const mounts = node.data.overlayNodes ?? []
  if (!mounts.length) return []
  return mounts.map((mount, i) => {
    const mid = overlayMountId(mount)
    const children = resolveMountChildren(scenario.ui?.overlays, mount)
    const timedChildren: OverlayChild[] = []
    let start: number | undefined
    let end: number | undefined
    for (const el of children) {
      const sp = childVisibleSpan(el, maxMs)
      if (!sp) continue
      timedChildren.push(el)
      start = start == null ? sp.start : Math.min(start, sp.start)
      end = end == null ? sp.end : Math.max(end, sp.end)
    }
    const title = scenario.ui?.overlays?.[mount.overlay]?.title?.trim()
    return {
      key: `mount:${mid}`,
      id: mid,
      kind: 'mount' as MaterialKind,
      label: authoringOptionLabel(title, mid),
      startMs: start ?? 0,
      endMs: end ?? maxMs,
      zIndex: i,
      componentId: children.length > 1 ? `${children.length} 组件` : undefined,
      fixedWidthPx: timedChildren.length === 1 && isSelfTimedFloatText(timedChildren[0]!.component)
        ? FLOAT_TEXT_TIMELINE_WIDTH_PX
        : undefined,
    }
  })
}

// ── 写映射：挂载级编辑（挂载 / 移除 / 整体平移） ──────────────────────────────────
/**
 * 挂载一张覆盖物到节点（「添加控件」入口）：目录缺失且给了 preset 时先写入固化原型，
 * 再 push 一份挂载（已挂载则原样返回）。候选须已在 live overlays 目录中。
 */
export function mountOverlayGraph(
  scenario: GameScenario,
  node: GameNode,
  overlayId: string,
  preset?: Overlay,
): GameScenario {
  const mounts = node.data.overlayNodes ?? []
  let ui = scenario.ui
  if (!ui?.overlays?.[overlayId] && preset) {
    ui = { ...ui, overlays: { ...(ui?.overlays ?? {}), [overlayId]: structuredClone(preset) } }
  }
  const definition = ui?.overlays?.[overlayId]
  const layout = resolveMountLayoutForChildren(
    undefined,
    definition?.children.map((child) => child.layout) ?? [],
  )
  const created = createOverlayMount(mounts, overlayId)
  const next = [...mounts, { ...created, ...(layout ? { layout } : {}) }]
  return { ...scenario, ui, graph: updateNodeData(scenario.graph, node.id, { overlayNodes: next }) }
}

/**
 * 某 overlay child 会占用的出边 sourceHandle / event id 集合（选项 events、QTE outcomes、通用组件 events）。
 * 删除组件或整份挂载时用它级联清边与结算。
 */
function eventHandlesOfChild(el: OverlayChild): string[] {
  if (hasOptionEventsInput(el.component) || hasCuePointsInput(el.component)) {
    return componentEventCatalog(el.component, paramsOf(el)).map((o) => o.id)
  }
  const plugin = getComponent(el.component)
  if (!plugin) return []
  return componentEventCatalog(el.component, paramsOf(el)).map((h) => h.id)
}

/**
 * 清掉这些 children 占用的跳转边 + 挂载/legacy 结算（effect/spawn/advance）。
 * 不删除 children 本身——调用方再 `removeOverlayChild` / 卸挂载。
 */
function cascadeClearChildrenEvents(
  scenario: GameScenario,
  node: GameNode,
  children: OverlayChild[],
): GameScenario {
  let s = scenario
  for (const el of children) {
    for (const handle of eventHandlesOfChild(el)) {
      const edges = s.graph.edges.filter(
        (e) => e.source === node.id && (e.sourceHandle ?? 'default') === handle,
      )
      for (const edge of edges) s = { ...s, graph: disconnect(s.graph, edge.id) }
      const n = s.graph.nodes.find((x) => x.id === node.id) ?? node
      s = removeMountEventReaction(s, n, el.id, handle)
      s = clearLegacyNodeEvent(s, s.graph.nodes.find((x) => x.id === node.id) ?? n, handle)
    }
  }
  return s
}

/** 删一个会发事件的 overlay child：先级联清边/结算，再摘组件。 */
function removeOverlayChildCascading(scenario: GameScenario, node: GameNode, childId: string): GameScenario {
  const el = findElement(scenario, node, childId)
  const s0 = el ? cascadeClearChildrenEvents(scenario, node, [el]) : scenario
  return removeOverlayChild(s0, node.id, childId)
}

/**
 * 移除一份挂载（时间轴删除挂载条 / 「添加控件」已挂列表的 ✕ / 节点配置「覆盖物 › 移除」）：
 * 先级联清掉该挂载下组件占用的跳转边与结算，再从 overlayNodes 去掉该挂载，
 * 并清理只被它引用的 node:* 孤儿副本（共享方案不删）。
 */
export function removeMountGraph(scenario: GameScenario, node: GameNode, mountId: string): GameScenario {
  const mounts = node.data.overlayNodes ?? []
  const mount = mounts.find((m) => overlayMountId(m) === mountId)
  if (!mount) return scenario
  const children = resolveMountChildren(scenario.ui?.overlays, mount)
  let s = cascadeClearChildrenEvents(scenario, node, children)
  const cur = s.graph.nodes.find((x) => x.id === node.id) ?? node
  const curMounts = cur.data.overlayNodes ?? []
  const removeIndex = curMounts.findIndex((m) => overlayMountId(m) === mountId)
  const next = curMounts.filter((_, index) => index !== removeIndex)
  s = {
    ...s,
    graph: updateNodeData(s.graph, node.id, { overlayNodes: next.length ? next : undefined }),
  }
  if (mount.overlay.startsWith('node:')) s = dropOverlayIfUnreferenced(s, mount.overlay)
  return s
}

/**
 * 拖动挂载级时间轴条：把该挂载全部子件整体平移 delta（= 新起点 − 当前可见窗口起点）。
 *
 * 写回**只落 `window.startMs/endMs`**（唯一时序 SSOT，全组件同一条路）。不再平移
 * `inputs.cues`——拍点绝对值不决定显隐（皮肤时钟从挂载起算），过去移 cues 在运行时其实是空操作，
 * 只改了编辑器自己的投影，正是编辑器与运行时错位的来源。
 */
export function shiftMountWindowGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  mountId: string,
  patch: { startMs?: number; endMs?: number },
): GameScenario {
  const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === mountId)
  if (!mount) return scenario
  const children = resolveMountChildren(scenario.ui?.overlays, mount)
  let curStart: number | undefined
  for (const el of children) {
    const sp = childVisibleSpan(el, maxMs)
    if (sp) curStart = curStart == null ? sp.start : Math.min(curStart, sp.start)
  }
  if (curStart == null) return scenario
  const delta = Math.round((patch.startMs ?? curStart) - curStart)
  if (delta === 0) return scenario
  const shift = (v: number): number => Math.max(0, Math.min(maxMs, v + delta))
  let s = scenario
  for (const el of children) {
    const sp = childVisibleSpan(el, maxMs)
    if (!sp) continue // filter/fx 无时序语义
    s = patchOverlayChildInMount(s, node.id, mountId, el.id, {
      window: { startMs: shift(sp.start), endMs: shift(sp.end) },
    })
  }
  return s
}

/** 挂载条最短跨度（ms），与子件级 `patchMaterialGraph` 的下限一致——避免拖成 0 长度后再也抓不住。 */
const MOUNT_MIN_SPAN_MS = 100

/**
 * 拖挂载条**边缘**（拉伸，区别于整体平移）：只改定义该边界的子件的 `window`，保住挂载内部错峰。
 * - 拖左缘 → 跨度起点最早的子件改 `startMs`（其余子件不动）；
 * - 拖右缘 → 跨度终点最晚的子件改 `endMs`。
 * 单子件挂载（`base:*` 全是）即"直接改这一个子件的 window"，与直觉一致。
 * 两端都夹 `MOUNT_MIN_SPAN_MS`，短条也永远留得住可抓的宽度。
 */
export function resizeMountWindowGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  mountId: string,
  patch: { startMs?: number; endMs?: number },
): GameScenario {
  const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === mountId)
  if (!mount) return scenario
  const spans: Array<{ el: OverlayChild; start: number; end: number }> = []
  for (const el of resolveMountChildren(scenario.ui?.overlays, mount)) {
    const sp = childVisibleSpan(el, maxMs)
    if (sp) spans.push({ el, start: sp.start, end: sp.end })
  }
  if (!spans.length) return scenario
  const curStart = Math.min(...spans.map((x) => x.start))
  const curEnd = Math.max(...spans.map((x) => x.end))

  // 两个边缘模式都会把「另一端」原值一并带回来，故以「哪端与当前不同」判定拖的是哪条边。
  if (patch.startMs != null && patch.startMs !== curStart) {
    // 最短跨度只拦「拖到更短」，不能拦「拉长」：本就短于下限的旧数据（如 1000→1001）
    // 若直接夹到 curEnd-100 会变成负数→0，左缘一拖就跳回起点。故上限兜到当前起点。
    const next = clampMs(patch.startMs, 0, Math.max(curEnd - MOUNT_MIN_SPAN_MS, Math.min(curStart, curEnd)))
    let s = scenario
    for (const x of spans) {
      if (x.start !== curStart) continue
      s = patchOverlayChildInMount(s, node.id, mountId, x.el.id, { window: { startMs: next, endMs: x.end } })
    }
    return s
  }
  if (patch.endMs != null && patch.endMs !== curEnd) {
    // 同上（对称）：右缘的下限不得高过当前终点，否则短条一碰就被顶长。
    const next = clampMs(patch.endMs, Math.min(curStart + MOUNT_MIN_SPAN_MS, Math.max(curEnd, curStart)), maxMs)
    let s = scenario
    for (const x of spans) {
      if (x.end !== curEnd) continue
      s = patchOverlayChildInMount(s, node.id, mountId, x.el.id, { window: { startMs: x.start, endMs: next } })
    }
    return s
  }
  return scenario
}

// ── 读投影：预览叠层 ──────────────────────────────────────────────────────────
export function activePreviewOverlaysFromNode(
  scenario: GameScenario,
  node: GameNode | undefined,
  ms: number,
  maxMs: number,
): PreviewOverlay[] {
  if (!node) return []
  const out: PreviewOverlay[] = []
  const { ctx: previewCtx, state: previewState } = previewCtxFor(scenario)
  let qteOutcomeDetail: string | undefined
  for (const el of mountedChildrenOf(scenario, node)) {
    const inputs = paramsOf(el)
    // 与 collectMaterialsFromNode 用同一分类入口：方案来源元素统一走末尾的通用手柄分支，
    // 保证 materialKey（`${kind}:${el.id}`）与时间轴条目一致，选中态才能对上。
    const kind = materialKindForChild(scenario, node, el)
    if (kind === 'subtitle') {
      const start = timedStart(el)
      const end = el.window?.endMs ?? Math.min(maxMs, start + 2000)
      if (ms < start || ms > end) continue
      const speaker = str(inputs.speaker)
      const text = str(inputs.text) ?? ''
      out.push({
        id: `subtitle:${el.id}`,
        materialKey: `subtitle:${el.id}`,
        kind: 'subtitle',
        label: speaker ? `${speaker}：${text}` : text,
        x: (inputs.x as number) ?? SUBTITLE_XY.x,
        y: (inputs.y as number) ?? SUBTITLE_XY.y,
        zIndex: normalizeLayer(el.layout?.zIndex, 0),
        movable: true,
        style: inputs.style as GraphTextStyle | undefined,
        target: { kind: 'element', elementId: el.id },
      })
    } else if (kind === 'overlay') {
      const start = timedStart(el)
      const end = el.window?.endMs ?? Math.min(maxMs, start + 1200)
      if (ms < start || ms > end) continue
      const label = resolveFloatTextPreviewLabel(floatPreviewParams(scenario, node, el, inputs as FloatTextParams), previewCtx)
      if (!label) continue
      const mount = findMountOwningChild(scenario, node, el.id)
      const mountId = mount ? overlayMountId(mount) : ''
      out.push({
        id: `overlay:${el.id}`,
        materialKey: `overlay:${el.id}`,
        kind: 'overlay',
        label,
        x: 0.5 + (typeof mount?.layout?.left === 'number' ? mount.layout.left : 0),
        y: 0.5 + (typeof mount?.layout?.top === 'number' ? mount.layout.top : 0),
        zIndex: normalizeLayer(el.layout?.zIndex, 1),
        movable: true,
        style: inputs.style as GraphTextStyle | undefined,
        target: { kind: 'mount', mountId, elementId: el.id },
      })
    } else if (kind === 'qte') {
      if (qteOutcomeDetail === undefined) {
        qteOutcomeDetail = resolveQteOutcomesPreviewDetail(listQteOutcomes(scenario, node), previewState, previewCtx)
      }
      for (const c of cuesOf(el)) {
        const s = c.appearAt ?? 0
        const end = c.endAt ?? s + QTE_GOOD_WINDOW
        if (ms < s || ms > end) continue
        out.push({
          id: `qte:${c.id}`,
          materialKey: `qte:${el.id}:${c.id}`,
          kind: 'qte',
          label: resolveQteCuePreviewLabel(c),
          detail: qteOutcomeDetail || undefined,
          x: c.x ?? 0.5,
          y: c.y ?? 0.55,
          zIndex: normalizeLayer(c.zIndex, 2),
          movable: true,
          target: { kind: 'qteCue', elementId: el.id, cueId: c.id },
        })
      }
    } else if (kind === 'option') {
      const start = el.window?.startMs ?? 0
      const end = el.window?.endMs ?? maxMs
      if (ms < start || ms > end) continue
      const mount = findMountOwningChild(scenario, node, el.id)
      const mountId = mount ? overlayMountId(mount) : ''
      out.push({
        id: `option:list:${el.id}`,
        materialKey: `option:${el.id}`,
        kind: 'option',
        label: translateUi('ui.object.da590a8fe3ce'),
        detail: resolveChoicePreviewDetail(
          optionsOf(el).map((o) => ({ label: o.label ?? o.id, effects: readMountEventEffects(scenario, node, el.id, o.id), condition: o.condition })),
          previewCtx,
          previewState,
        ) || undefined,
        x: 0.5 + (typeof mount?.layout?.left === 'number' ? mount.layout.left : 0),
        y: 0.5 + (typeof mount?.layout?.top === 'number' ? mount.layout.top : 0),
        zIndex: normalizeLayer(el.layout?.zIndex, 3),
        movable: true,
        target: { kind: 'mount', mountId, elementId: el.id },
      })
    } else if (kind === 'filter' || kind === 'fx') {
      // 滤镜/特效走 videoFx 旁路，不进可拖叠层
      continue
    } else {
      // 通用组件手柄（含方案来源的字幕/QTE/选项等）。
      // 方案来源的 cue 型交互（如 inkKou QTE）：按 cue 出可拖手柄，与皮肤同源（cue x/y、cue 时窗、
      // target=qteCue 拖拽写回 cue.x/y）——修掉「方案 QTE 落中心、取 trigger.ms、不可拖」的错位。
      // materialKey 仍用 `component:${el.id}` 与 child 级时间轴一致，选中态对得上。
      const cues = hasCuePointsInput(el.component) ? cuesOf(el) : []
      if (cues.length > 0) {
        for (const c of cues) {
          const s = c.appearAt ?? 0
          const end = c.endAt ?? s + QTE_GOOD_WINDOW
          if (ms < s || ms > end) continue
          out.push({
            id: `component-cue:${el.id}:${c.id}`,
            materialKey: `component:${el.id}`,
            kind: 'component',
            label: componentLabelOf(el, kind),
            x: c.x ?? 0.5,
            y: c.y ?? 0.55,
            zIndex: normalizeLayer(c.zIndex ?? el.layout?.zIndex, 3),
            movable: true,
            target: { kind: 'qteCue', elementId: el.id, cueId: c.id },
          })
        }
        continue
      }
      // 无 cue 的通用组件（点元素：飘字/血条等）：拖拽移动**整个挂载盒**（overlay 相对位置 = mount.layout
      // 偏移），而非内部组件 x/y。手柄锚点 = 组件基准 x/y + 挂载盒偏移（与贴纸渲染位置一致，见 NodePreviewStage）。
      const start = el.window?.startMs ?? timedStart(el)
      const end = el.window?.endMs ?? maxMs
      if (ms < start || ms > end) continue
      const ownMount = findMountOwningChild(scenario, node, el.id)
      const mid = ownMount ? overlayMountId(ownMount) : ''
      const offX = typeof ownMount?.layout?.left === 'number' ? ownMount.layout.left : 0
      const offY = typeof ownMount?.layout?.top === 'number' ? ownMount.layout.top : 0
      const baseX = typeof inputs.x === 'number' ? inputs.x : 0.5
      const baseY = typeof inputs.y === 'number' ? inputs.y : 0.5
      out.push({
        id: `component:${el.id}`,
        materialKey: `component:${el.id}`,
        kind: 'component',
        label: componentLabelOf(el, kind),
        x: baseX + offX,
        y: baseY + offY,
        zIndex: normalizeLayer(el.layout?.zIndex, 3),
        movable: isPositionable(el.component),
        target: { kind: 'mount', mountId: mid, elementId: el.id },
      })
    }
  }
  return out.sort((a, b) => a.zIndex - b.zIndex)
}

/**
 * 当前播放头落在 `window` 内、应画到预览皮肤层的挂载 children（不含 filter/fx）。
 * 判定与时间轴条、运行时同走 `childVisibleSpan`（唯一时序 SSOT），三处不可能再对不上。
 */
export function previewSkinChildrenInWindow(
  scenario: GameScenario,
  node: GameNode | undefined,
  ms: number,
  maxMs: number,
): OverlayInstanceChild[] {
  if (!node) return []
  const out: OverlayInstanceChild[] = []
  // 与运行时一致：扫全部挂载（内容轨 + 常驻 HUD 方案），不能只看 primary。
  // 必须保留实例 source.mountId；重复挂载同一方案时，裸 childId 无法区分所属挂载。
  for (const el of expandNodeChildren(scenario, node)) {
    const sp = childVisibleSpan(el, maxMs)
    if (!sp) continue
    if (ms < sp.start || ms > sp.end) continue
    out.push(el)
  }
  return out
}

// ── 写映射：时间轴拖拽（start/end/zIndex）──────────────────────────────────────
export function patchMaterialGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  item: MaterialItem,
  patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number },
): GameScenario {
  const start = clampMs(patch.startMs ?? item.startMs, 0, Math.max(0, maxMs - 100))
  const end = clampMs(patch.endMs ?? item.endMs, start + 100, maxMs)
  const zIndex = patch.zIndex == null ? item.zIndex : clampLayer(patch.zIndex)
  switch (item.kind) {
    case 'mount':
      // 挂载级条：只有 move 会带 zIndex（见 MaterialTimeline#onPointerMove）——据此区分
      // 「整体平移」与「拖边缘拉伸」。之前一律走平移，导致短条拖左缘只是整条前移、跨度永远拉不长。
      return patch.zIndex != null
        ? shiftMountWindowGraph(scenario, node, maxMs, item.id, { startMs: patch.startMs })
        : resizeMountWindowGraph(scenario, node, maxMs, item.id, patch)
    case 'subtitle':
    case 'overlay':
    case 'filter':
    case 'fx':
    case 'component':
      return patchOverlayChild(scenario, node.id, item.id, {
        window: { startMs: start, endMs: end },
        trigger: { when: 'at', ms: start },
        layout: { zIndex },
      })
    case 'option':
      return patchOverlayChild(scenario, node.id, item.id, {
        window: { startMs: start, endMs: end },
        layout: { zIndex },
      })
    case 'qte': {
      const el = qteElementOfCue(scenario, node, item.id)
      if (!el) return scenario
      const isMove = patch.zIndex != null && patch.startMs != null && patch.endMs != null
      const cues = cuesOf(el).map((c) => {
        if (c.id !== item.id) return c
        const next: QteCue = { ...c }
        if (patch.markerMs != null) {
          // 拖菱形：只改命中判定点，夹在 [出现, 消失] 内。
          const lo = c.appearAt ?? 0
          const hi = c.endAt ?? Math.max(lo, c.targetAt ?? lo)
          next.targetAt = clampMs(patch.markerMs, lo, Math.max(lo, hi))
          return next
        }
        if (isMove) {
          // 整体平移：出现/命中/消失同步移，保持相对间距。
          const shift = start - (c.appearAt ?? 0)
          next.appearAt = start
          next.endAt = end
          if (c.targetAt != null) next.targetAt = clampMs(c.targetAt + shift, start, end)
          next.zIndex = zIndex
          return next
        }
        // 拖边缘：左缘→出现(appearAt)，右缘→消失(endAt)；命中点夹回窗内。
        next.appearAt = start
        next.endAt = end
        if (c.targetAt != null) next.targetAt = clampMs(c.targetAt, start, end)
        next.zIndex = zIndex
        return next
      })
      // 时长 SSOT 是 cue 本身的 [appearAt, endAt]（上面已经写好）；哪个皮肤读它、怎么读，是运行时
      // 的事——这里不认识任何具体组件 id，也不需要另外维护一份 windowMs/durationMs 影子字段。
      const nextParams: Record<string, unknown> = { ...(el.inputs ?? {}), cues }
      return patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
    }
    default:
      return scenario
  }
}

// ── 写映射：预览拖拽定位（x/y）─────────────────────────────────────────────────
export function patchOverlayPositionGraph(
  scenario: GameScenario,
  node: GameNode,
  target: PreviewTarget,
  x: number,
  y: number,
): GameScenario {
  if (target.kind === 'element') {
    const el = findElement(scenario, node, target.elementId)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...el.inputs, x, y } })
  }
  if (target.kind === 'qteCue') {
    const el = findElement(scenario, node, target.elementId)
    if (!el) return scenario
    const cues = cuesOf(el).map((c) => (c.id === target.cueId ? { ...c, x, y } : c))
    return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...el.inputs, cues } })
  }
  if (target.kind === 'mount') {
    const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === target.mountId)
    const el = findElement(scenario, node, target.elementId)
    if (!mount || !el) return scenario
    // 偏移模型：飘字等点元素的基准锚点是自身 inputs.x/y（相对舞台）；拖拽目标点 P 换算成
    // 挂载盒偏移 = P − 基准锚点，落 mount.layout.left/top（满舞台盒，盒位置即偏移量），保留其它字段。
    const baseX = typeof el.inputs?.x === 'number' ? (el.inputs.x as number) : 0.5
    const baseY = typeof el.inputs?.y === 'number' ? (el.inputs.y as number) : 0.5
    return patchOverlayMount(scenario, node.id, target.mountId, {
      layout: { ...mount.layout, left: x - baseX, top: y - baseY, width: 1, height: 1 },
    })
  }
  return scenario
}

/** 新规格画布：移动/调层整份挂载，内部 child 相对排版保持不变。 */
export function patchOverlayMountLayoutGraph(
  scenario: GameScenario,
  node: GameNode,
  mountId: string,
  patch: Partial<Layout>,
): GameScenario {
  const mount = (node.data.overlayNodes ?? []).find((item) => overlayMountId(item) === mountId)
  if (!mount) return scenario
  const children = resolveMountChildren(scenario.ui?.overlays, mount)
  const layout = resolveMountLayoutForChildren(
    { ...mount.layout, ...patch },
    children.map((child) => child.layout),
  )
  return patchOverlayMount(scenario, node.id, mountId, {
    layout,
  })
}

/** 预览画布层级调整：沿用元素 layout.zIndex / cue.zIndex，不增加并行字段。 */
export function patchOverlayZIndexGraph(
  scenario: GameScenario,
  node: GameNode,
  target: PreviewTarget,
  zIndex: number,
): GameScenario {
  const nextZ = clampLayer(zIndex)
  if (target.kind === 'element' || target.kind === 'mount') {
    const el = findElement(scenario, node, target.elementId)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, {
      layout: { ...el.layout, zIndex: nextZ },
    })
  }
  if (target.kind === 'qteCue') {
    const el = findElement(scenario, node, target.elementId)
    if (!el) return scenario
    const cues = cuesOf(el).map((cue) =>
      cue.id === target.cueId ? { ...cue, zIndex: nextZ } : cue)
    return patchOverlayChild(scenario, node.id, el.id, {
      inputs: { ...el.inputs, cues },
    })
  }
  return scenario
}

// ── 写映射：删除 + 二次确认 ────────────────────────────────────────────────────
function isWholeInteractionDelete(scenario: GameScenario, node: GameNode, item: MaterialItem): boolean {
  if (item.kind === 'option') return true
  if (item.kind === 'qte') return cuesOf(qteElementOfCue(scenario, node, item.id)).length <= 1
  return false
}
export function confirmMaterialDelete(scenario: GameScenario, node: GameNode, item: MaterialItem): boolean {
  if (!isWholeInteractionDelete(scenario, node, item)) return true
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
  const message =
    item.kind === 'option'
      ? '删除整条选项交互？\n该节点将改回叙事节点，并自动续连到「第一个选项」原本指向的场景。\n这会同步更改蓝图上的节点连接关系，是否确认？'
      : '删除整段 QTE 交互？\n该节点将改回叙事节点，并自动续连到「通过 QTE」原本指向的场景。\n这会同步更改蓝图上的节点连接关系，是否确认？'
  return window.confirm(message)
}
export function deleteMaterialGraph(scenario: GameScenario, node: GameNode, item: MaterialItem): GameScenario {
  switch (item.kind) {
    case 'mount':
      return removeMountGraph(scenario, node, item.id)
    case 'subtitle':
    case 'filter':
    case 'fx':
      return removeOverlayChild(scenario, node.id, item.id)
    case 'component':
      // 方案来源的應默/技能条/叩击等归为 component：删组件时必须级联清跳转边与结算。
      return removeOverlayChildCascading(scenario, node, item.id)
    case 'overlay': {
      const s1 = removeOverlayChild(scenario, node.id, item.id)
      const s1Node = findNode(s1.graph, node.id) ?? node
      return removeSettleReaction(s1, s1Node, item.id)
    }
    case 'qte':
      return removeQteCueGraph(scenario, node, item.id)
    case 'option': {
      const el = choiceElement(scenario, node)
      return teardownInteractionScenario(scenario, node, { kind: 'choice', handlePrefixes: el ? optionsOf(el).map((o) => o.id) : [], childId: el?.id })
    }
    default:
      return scenario
  }
}

// ── 写映射：新增材料 ──────────────────────────────────────────────────────────
/** 默认六槽 template；其它值为原始 component id（添加未分类组件）。 */
export type MaterialTemplate = 'subtitle' | 'overlay' | 'qte' | 'option' | 'filter' | 'fx' | string

const BUILTIN_TEMPLATES = new Set(['subtitle', 'overlay', 'qte', 'option', 'filter', 'fx'])

export function isBuiltinMaterialTemplate(t: string): boolean {
  return BUILTIN_TEMPLATES.has(t)
}

/**
 * 「添加控件」二级栏卡片：某个方案挂载目录里的一个**原型 OverlayChild**（对齐 `spawn.from = mountId/childId`）。
 * 同 `component` 类型可有多份（如两份 battleHpBar：我方/敌方，各有自己的 params.bind）。
 * 不按 kind 过滤——字幕/QTE/选项等基础 kind 若来自方案，也照样列出（拖入后统一走通用编辑逻辑）。
 */
export interface ExtraAddableComponent {
  /** = `mountId/childId`（添加时作 template，克隆该实例的 params）。 */
  id: string
  /** 卡片标题：实例 params.label → 类型名 · childId → childId。 */
  label: string
  /** 注册表 component id（图标/描述用）。 */
  componentId: string
}

/** 「添加控件」一级分类里，一个已挂载方案对应的一个 tab。 */
export interface SchemeMountTab {
  /** 挂载键（`overlayMountId(mount)`），tab 选中态 key，也是落盘目标挂载。 */
  mountId: string
  /** tab 标题：overlay.title → mountId。 */
  title: string
  components: ExtraAddableComponent[]
}

/**
 * 每个已挂载的真实方案（排除 `node:*` 本地内容容器）对应一个 tab，tab 下是该方案**目录原型**
 * 里的全部组件——
 * 刻意排除：
 * - `node:*` 本地内容容器（时间轴直写产物，不是可复用界面方案）
 * - `mount.added`（本节点已克隆新增的实例——再列进库面板会导致「添加一次多一张卡」）
 * 只枚举目录原型；overrides 改字段仍可借 resolveSchemeChildTemplate 取合并结果，但不把 added 当模板。
 */
export function listSchemeMountTabs(scenario: GameScenario, node: GameNode | undefined): SchemeMountTab[] {
  if (!node) return []
  const out: SchemeMountTab[] = []
  const seenMount = new Set<string>()
  for (const mount of node.data.overlayNodes ?? []) {
    if (mount.overlay.startsWith('node:')) continue
    const mountId = overlayMountId(mount)
    if (seenMount.has(mountId)) continue
    seenMount.add(mountId)
    const overlay = scenario.ui?.overlays?.[mount.overlay]
    const overlayTitle = overlay?.title?.trim()
    const title = overlayTitle
      ? (mountId === mount.overlay ? overlayTitle : `${overlayTitle} · ${mountId}`)
      : mountId
    const components: ExtraAddableComponent[] = []
    for (const el of overlay?.children ?? []) {
      const componentId = el.component
      if (!componentId) continue
      const params = paramsOf(el)
      const instanceLabel = str(params.label)
      components.push({
        id: `${mountId}/${el.id}`,
        label: instanceLabel || `${componentTypeLabel(componentId)} · ${el.id}`,
        componentId,
      })
    }
    out.push({ mountId, title, components: components.sort((a, b) => a.label.localeCompare(b.label, 'zh')) })
  }
  return out
}

/** 解析 `overlayId/childId`：优先当前挂载的合并结果（含 overrides），再回退目录原型。 */
export function resolveSchemeChildTemplate(
  scenario: GameScenario,
  node: GameNode | undefined,
  from: string,
): OverlayChild | undefined {
  const slash = from.indexOf('/')
  if (slash <= 0 || slash >= from.length - 1) return undefined
  const head = from.slice(0, slash)
  const childId = from.slice(slash + 1)
  if (node) {
    for (const mount of node.data.overlayNodes ?? []) {
      if (mount.overlay !== head && overlayMountId(mount) !== head) continue
      const hit = resolveMountChildren(scenario.ui?.overlays, mount).find((c) => c.id === childId)
      if (hit) return hit
    }
  }
  return scenario.ui?.overlays?.[head]?.children.find((c) => c.id === childId)
}

function isSchemeTemplateRef(template: string): boolean {
  return template.includes('/')
}

export interface AddResult {
  scenario: GameScenario
  selectKey: string | null
}

/** 从素材库拖入时间轴的落点：ms = 落点时刻，zIndex = 落点所在轨。 */
export interface DropAt {
  ms: number
  zIndex: number
}

export function addMaterialGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  template: MaterialTemplate,
  entities: Record<string, Entity> | undefined,
  playheadMs: number,
  at?: DropAt,
): AddResult {
  const dur = clampMs(2500, 100, maxMs)
  // at 存在 = 从素材库拖入的精确落点；缺省（点击添加）落在 0ms / 语义默认轨。
  const startMs = at ? clampMs(at.ms, 0, Math.max(0, maxMs - 100)) : 0
  const endMs = clampMs(startMs + dur, startMs + 100, maxMs)
  if (template === 'subtitle') {
    const id = newElementId()
    const el: OverlayChild = {
      id,
      component: 'Dialogue',
      trigger: { when: 'enter' },
      window: { startMs, endMs },
      layout: { zIndex: at ? at.zIndex : 0 },
      inputs: { text: '新字幕' },
    }
    return { scenario: addOverlayChild(scenario, node.id, el), selectKey: `subtitle:${id}` }
  }
  if (template === 'overlay') {
    const id = newElementId()
    const float: OverlayChild = {
      id,
      component: 'DamageFloatText',
      trigger: { when: 'enter' },
      window: { startMs, endMs },
      layout: layoutForNewChild(undefined, at ? at.zIndex : 1),
      inputs: { fixedText: '', parameter: '-100' },
    }
    const s1 = addOverlayChild(scenario, node.id, float)
    const s1Node = findNode(s1.graph, node.id) ?? node
    // 结算副作用挂节点 reaction（默认对 boss 扣 100，与飘字同相位出现）。
    const s2 = upsertSettleEffects(s1, s1Node, id, floatSettleWhen(float), [createDamageHpEffect(entities, 'boss', 100, id)])
    return { scenario: s2, selectKey: `overlay:${id}` }
  }
  if (template === 'filter' || template === 'fx') {
    const id = newElementId()
    const el: OverlayChild = {
      id,
      component: template,
      trigger: { when: 'at', ms: startMs },
      window: { startMs, endMs },
      layout: { zIndex: at ? at.zIndex : template === 'filter' ? 4 : 5 },
      inputs: template === 'filter' ? { filter: 'warm', intensity: 1 } : { fx: 'flash', intensity: 1 },
    }
    return { scenario: addOverlayChild(scenario, node.id, el), selectKey: `${template}:${id}` }
  }
  if (template === 'qte') {
    return addQteCueGraph(scenario, node, maxMs, at ? at.ms : playheadMs)
  }
  if (template === 'option') {
    const existing = choiceElement(scenario, node)
    if (existing) return { scenario, selectKey: `option:${existing.id}` }
    const existingQte = qteElement(scenario, node)
    const s0 = teardownInteractionScenario(scenario, node, {
      kind: 'qte',
      handlePrefixes: qteOutcomeCandidates(existingQte).map((c) => c.handle),
    })
    const id = newElementId()
    const optStart = at ? startMs : 0
    const optEnd = at ? endMs : dur
    // 默认选项固定使用新规格「應/默」组件。
    const inputs = {}
    const el: OverlayChild = {
      id,
      component: 'InkYingMo',
      trigger: { when: 'enter' },
      window: { startMs: optStart, endMs: optEnd },
      layout: layoutForNewChild(undefined, at ? at.zIndex : 3),
      inputs,
    }
    const s = addOverlayChild(s0, node.id, el)
    return { scenario: s, selectKey: `option:${id}` }
  }
  // 未分类：优先 `overlayId/childId` 克隆挂载实例（保留 bind/label 等输入）；否则按 component id 用 defaults。
  const fromChild = isSchemeTemplateRef(template)
    ? resolveSchemeChildTemplate(scenario, node, template)
    : undefined
  const componentId = fromChild ? fromChild.component : template
  const plugin = getComponent(componentId)
  if (!plugin && !fromChild) return { scenario, selectKey: null }
  const id = newElementId()
  const defaults = defaultsForComponent(componentId) as Record<string, unknown>
  // 克隆自方案实例时也要垫 defaults：方案目录里的组件可能缺 inputs，
  // 直接搬 fromChild.inputs 会把残缺原样克隆出去。
  const seeded = fromChild
    ? { ...defaults, ...(fromChild.inputs ?? {}) }
    : { x: 0.5, y: 0.5, ...defaults }
  const el: OverlayChild = {
    id,
    component: componentId,
    trigger: { when: 'at', ms: startMs },
    window: { startMs, endMs },
    layout: layoutForNewChild(fromChild?.layout, at ? at.zIndex : undefined),
    inputs: seeded,
  }
  // 方案克隆（template = `mountId/childId`）：落进「那个方案」自己的挂载 added[]，
  // 不能落进节点本地容器——否则 isSchemeOriginElement 会误判成默认样式来源。
  if (fromChild) {
    const mountId = template.slice(0, template.indexOf('/'))
    return { scenario: addOverlayChildToMount(scenario, node.id, mountId, el), selectKey: `component:${id}` }
  }
  return { scenario: addOverlayChild(scenario, node.id, el), selectKey: `component:${id}` }
}

/**
 * 新增一个 QTE 按键点（无 qte 元素则新建整段 QTE，并清掉 choice）。
 * 默认样式的 QTE 皮肤固定为「叩击」（inkKou，单点提示环）——不再有多皮肤可选，
 * 拍点节奏/出口自然只有一套（inkKou 的 pass/fail），无需按皮肤分支。
 */
export function addQteCueGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  playheadMs: number,
  afterCueId?: string,
): AddResult {
  const el = qteElement(scenario, node)
  const cues = cuesOf(el)
  const base = afterCueId ? cues.find((c) => c.id === afterCueId) : cues[cues.length - 1]
  const appear = clampMs(
    cues.length ? (base?.targetAt ?? playheadMs) + 500 : playheadMs,
    0,
    Math.max(0, maxMs - 200),
  )
  const target = clampMs(appear + 300, appear + 100, Math.max(appear + 100, maxMs - 100))
  const end = clampMs(target + 400, target + 100, maxMs)
  const cueId = `q-${Date.now().toString(36)}`
  const cue: QteCue = {
    id: cueId,
    shape: base?.shape ?? 'tap',
    triggerKey: base?.triggerKey,
    x: base?.x ?? 0.5,
    y: base?.y ?? 0.55,
    appearAt: appear,
    targetAt: target,
    endAt: end,
    label: `${translateUi('ui.object.4197b45f18ba')}${cues.length + 1}`,
    zIndex: base?.zIndex ?? 2,
  }
  if (el) {
    const nextParams: Record<string, unknown> = { ...(el.inputs ?? {}), cues: [...cues, cue] }
    const s = patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
    return { scenario: s, selectKey: `qte:${el.id}:${cueId}` }
  }
  // 首次建 QTE：清掉 choice（互斥），新建固定 inkKou 皮肤的 qte 元素。
  const choice = choiceElement(scenario, node)
  const s0 = teardownInteractionScenario(scenario, node, { kind: 'choice', handlePrefixes: choice ? optionsOf(choice).map((o) => o.id) : [], childId: choice?.id })
  const id = newElementId()
  const seeded = { cues: [cue] }
  const newEl: OverlayChild = {
    id,
    component: 'InkKou',
    trigger: { when: 'enter' },
    // 显隐唯一 SSOT = window：按首个拍点的可见区间落窗，作者随后可在时间轴上拖改。
    window: { startMs: cue.appearAt ?? 0, endMs: cue.endAt ?? end },
    layout: layoutForNewChild(undefined, 3),
    inputs: seeded,
  }
  let s = addOverlayChild(s0, node.id, newEl)
  const n = findNode(s.graph, node.id) ?? node
  s = ensureQtePassOutcomeGraph(s, n)
  return { scenario: s, selectKey: `qte:${id}:${cueId}` }
}

/** 删一个 QTE 按键点（删到最后一个 = 拆整段 QTE；结算是整段共享的，删单个拍点不动结算）。 */
export function removeQteCueGraph(scenario: GameScenario, node: GameNode, cueId: string): GameScenario {
  const el = qteElementOfCue(scenario, node, cueId)
  if (!el) return scenario
  const cues = cuesOf(el)
  if (cues.length <= 1) {
    return teardownInteractionScenario(scenario, node, {
      kind: 'qte',
      handlePrefixes: qteOutcomeCandidates(el).map((c) => c.handle),
      continueHandle: qteOutcomeCandidates(el)[0]?.handle ?? 'pass',
      childId: el.id,
    })
  }
  const remaining = cues.filter((c) => c.id !== cueId)
  return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...el.inputs, cues: remaining } })
}

// ── 写映射：检视器 inputs 编辑 ────────────────────────────────────────────────
/**
 * 合并出下一份完整 inputs 快照。`v === undefined` 的键**保留但置为 undefined**（不 delete）——
 * 下游 `patchOverlayChild` → `mergeChild`/`mergePatch` 对 inputs 是「浅 spread」式累积合并
 * （`{ ...base.inputs, ...patch.inputs }`），若这里直接删键，缺席的键不会覆盖 base/override 里
 * 的旧值，「清空」就会被历史值悄悄复活。显式置 undefined 才能穿透层层浅合并真正生效清空；
 * 落盘走 JSON 时 undefined 键本就会被丢弹，不会遗留脏数据。
 */
function mergeParams(el: OverlayChild, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...el.inputs, ...patch }
}

/** 字幕/QTE-cue/选项的通用 inputs 编辑（飘字见 patchOverlayGraph）。 */
export function patchSelectedGraph(
  scenario: GameScenario,
  node: GameNode,
  item: MaterialItem,
  patch: Record<string, unknown>,
): GameScenario {
  if (item.kind === 'subtitle' || item.kind === 'filter' || item.kind === 'fx') {
    const el = findElement(scenario, node, item.id)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, { inputs: mergeParams(el, patch) })
  }
  if (item.kind === 'qte') {
    const el = qteElementOfCue(scenario, node, item.id)
    if (!el) return scenario
    // 元素级 QTE 参数（如完美半窗 perfectMs）落 el.inputs；其余按 cue 级 patch 进当前拍点。
    const elemPatch: Record<string, unknown> = {}
    const cuePatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (QTE_ELEMENT_PARAM_KEYS.has(k)) elemPatch[k] = v
      else cuePatch[k] = v
    }
    const cues = cuesOf(el).map((c) => (c.id === item.id ? { ...c, ...cuePatch } : c))
    const nextParams = { ...(el.inputs ?? {}), ...elemPatch, cues }
    return patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
  }
  if (item.kind === 'option') {
    const el = findElement(scenario, node, item.id)
    if (!el) return scenario
    const next = mergeParams(el, patch)
    return patchOverlayChild(scenario, node.id, el.id, { inputs: next })
  }
  if (item.kind === 'component') {
    const el = findElement(scenario, node, item.id)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, { inputs: mergeParams(el, patch) })
  }
  return scenario
}

/**
 * 尺寸/位置盒子（`Layout.width/height/...`）——对所有 MaterialItem.kind 通用的同一条写路径，
 * 不像 `patchSelectedGraph`/`patchOverlayGraph` 按 kind 分流进 inputs：Layout 的语义和落点
 * （`OverlayChild.layout`）跟组件是什么 kind 完全无关，一套写法即覆盖字幕/飘字/QTE/选项/通用组件。
 * `patchOverlayChild` 内部 `mergeChild`/`mergePatch` 对 `layout` 是浅合并，不会连带丢掉 zIndex。
 */
export function patchSelectedLayoutGraph(
  scenario: GameScenario,
  node: GameNode,
  item: MaterialItem,
  patch: Partial<Layout>,
): GameScenario {
  const el = item.kind === 'qte' ? qteElementOfCue(scenario, node, item.id) : findElement(scenario, node, item.id)
  if (!el) return scenario
  return patchOverlayChild(scenario, node.id, el.id, { layout: patch })
}

/**
 * 飘字（floatText 展示 + 联动结算 reaction）的 inputs 编辑。键：
 *   - content  → inputs.fixedText（显示文案；`{v}` 位置由 parameter 替换）
 *   - effects  → 结算 reaction 的完整效果列表（`EffectsEditor` 直接产出；空数组＝纯展示，删结算）
 *   - expr → inputs.parameter；其余（style/x/y…）直接并入 inputs。
 * parameter 缺省时预览回落 effects 第一条的值；显式配置后显示与效果解耦。
 */
export function patchOverlayGraph(
  scenario: GameScenario,
  node: GameNode,
  floatId: string,
  patch: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): GameScenario {
  const float = findElement(scenario, node, floatId)
  if (!float) return scenario
  let s = scenario
  const curNode = () => findNode(s.graph, node.id) ?? node

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'content') {
      const content = String(value)
      const cur = findElement(s, node, floatId)
      if (!cur) continue
      const { text: _text, ...currentInputs } = cur.inputs ?? {}
      const hasParameterSlot = content.includes('{v}')
      s = patchOverlayChild(s, node.id, floatId, {
        inputs: {
          ...currentInputs,
          fixedText: content.replace('{v}', ''),
          ...(hasParameterSlot ? {} : { parameter: '' }),
        },
      })
    } else if (key === 'effects') {
      const list = Array.isArray(value) ? (value as GraphEffect[]) : []
      s = upsertSettleEffects(s, curNode(), floatId, floatSettleWhen(float), list)
    } else {
      const cur = findElement(s, node, floatId)
      if (cur) {
        const inputKey = key === 'expr' ? 'parameter' : key
        s = patchOverlayChild(s, node.id, floatId, { inputs: mergeParams(cur, { [inputKey]: value }) })
      }
    }
  }
  return s
}

// ── 写映射：选项分支（= 出边 <id> + mount event reaction effects，与 QTE 同内核）─────
/** 向后兼容命名（选项分支专用别名，结构与 OutcomeView 相同）。 */
export type OptionBranchView = OutcomeView
export function listOptionBranches(scenario: GameScenario, node: GameNode): OutcomeView[] {
  const el = choiceElement(scenario, node)
  if (!el) return []
  const candidates: OutcomeCandidate[] = componentEventCatalog(el.component, paramsOf(el)).map((o) => ({
    handle: o.id,
    label: o.label ?? o.id,
  }))
  return candidates.map((c) => outcomeView(scenario, node, el.id, c.handle, c.label, candidates))
}

export function addOptionBranchGraph(scenario: GameScenario, node: GameNode): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  const events = optionsOf(el)
  const id = `opt${events.length}-${Date.now().toString(36).slice(-3)}`
  const label = `选项 ${events.length + 1}`
  return patchOverlayChild(scenario, node.id, el.id, {
    inputs: { ...(el.inputs ?? {}), events: [...events, { id, label }] },
  })
}
export function updateOptionLabelGraph(scenario: GameScenario, node: GameNode, key: string, label: string): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  const events = optionsOf(el).map((o) => (o.id === key ? { ...o, label } : o))
  return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...(el.inputs ?? {}), events } })
}
export function setOptionTargetGraph(scenario: GameScenario, node: GameNode, key: string, targetId: string): GameScenario {
  const handle = `${CHOICE_HANDLE}${key}`
  if (!targetId) {
    const edge = edgeForHandle(scenario, node.id, handle)
    if (!edge) return scenario
    return { ...scenario, graph: disconnect(scenario.graph, edge.id) }
  }
  return { ...scenario, graph: upsertBranchEdge(scenario.graph, { source: node.id, sourceHandle: handle, target: targetId }) }
}
export function setOptionBranchEffectsGraph(
  scenario: GameScenario,
  node: GameNode,
  key: string,
  effects: GraphEffect[],
): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  return writeMountEventEffects(scenario, node, el.id, key, effects)
}

export function setOptionBranchSpawnGraph(
  scenario: GameScenario,
  node: GameNode,
  key: string,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  return writeMountEventSpawn(scenario, node, el.id, key, spawn)
}

/** 通用组件的事件结算列表（manifest.events；跳转·改数值·spawn 与选项/QTE 同内核）。 */
export function listComponentEventViews(
  scenario: GameScenario,
  node: GameNode,
  el: OverlayChild | undefined,
): OutcomeView[] {
  if (!el) return []
  const candidates: OutcomeCandidate[] = componentEventCatalog(el.component, paramsOf(el)).map((e) => ({
    handle: e.id,
    label: e.label ?? e.id,
  }))
  if (!candidates.length) return []
  return candidates.map((c) => outcomeView(scenario, node, el.id, c.handle, c.label, candidates))
}

/**
 * 通用组件事件结算写入（elId = 该组件在时间轴上的落盘 id，与 listComponentEventViews 用同一个）。
 * 修复：此前 UI 把通用组件的改数值/生成组件误接到 setOptionBranchEffectsGraph/Spawn（内部按
 * choiceElement 定位，非选项元素时静默 no-op），这里补上真正 elId-驱动的写入路径。
 */
export function setComponentEventEffectsGraph(
  scenario: GameScenario,
  node: GameNode,
  elId: string,
  key: string,
  effects: GraphEffect[],
): GameScenario {
  return writeMountEventEffects(scenario, node, elId, key, effects)
}

export function setComponentEventSpawnGraph(
  scenario: GameScenario,
  node: GameNode,
  elId: string,
  key: string,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  return writeMountEventSpawn(scenario, node, elId, key, spawn)
}
export function removeOptionBranchGraph(scenario: GameScenario, node: GameNode, key: string): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  const events = optionsOf(el).filter((o) => o.id !== key)
  // 删到 0 个选项 = 拆整段选项交互（回落叙事 + 自动续连）。
  if (events.length === 0) {
    return teardownInteractionScenario(scenario, node, { kind: 'choice', handlePrefixes: optionsOf(el).map((o) => o.id), childId: el.id })
  }
  let s = patchOverlayChild(scenario, node.id, el.id, { inputs: { ...(el.inputs ?? {}), events } })
  const edge = edgeForHandle(s, node.id, key)
  if (edge) s = { ...s, graph: disconnect(s.graph, edge.id) }
  // 清掉该分支的 event 反应（mount 级 effect + spawn，legacy node 级残留一并清）。
  const n = s.graph.nodes.find((x) => x.id === node.id)!
  s = removeMountEventReaction(s, n, el.id, key)
  s = clearLegacyNodeEvent(s, s.graph.nodes.find((x) => x.id === node.id)!, key)
  return s
}

// ── 写映射：视频绑定 ──────────────────────────────────────────────────────────
export function bindVideoGraph(
  scenario: GameScenario,
  node: GameNode,
  ref: string,
  durationMs: number | undefined,
): GameScenario {
  return {
    ...scenario,
    graph: updateNodeData(scenario.graph, node.id, {
      media: { ...(node.data.media ?? {}), kind: 'VIDEO', ref },
      ...(durationMs != null ? { durationMs } : {}),
    }),
  }
}

/** 写节点媒体提示词（生成面板）；空串清掉 `prompt`。 */
export function setNodePromptGraph(
  scenario: GameScenario,
  node: GameNode,
  prompt: string,
): GameScenario {
  const media = node.data.media ?? { kind: 'VIDEO' }
  return {
    ...scenario,
    graph: updateNodeData(scenario.graph, node.id, {
      media: { ...media, prompt: prompt || undefined },
    }),
  }
}

// 保留 ensureNodeOverlay 引用路径可见（供上层需要时显式确保节点已有专属 overlay）。
export { ensureNodeOverlay }
export type { Trigger }
