/**
 * GraphRuntime —— 纯 TS 状态机，**直接执行 GameGraph**（无 Scene/branches/编译层）。
 *
 * 走法（spec §3）：进入节点 → 跑 enter reactions + emit playClip → tick 时按 trigger 触发 overlay 子件
 * → 到 trigger 时机 renderOverlay → 组件 emit(event) → reactions / 出边 → 下一节点。
 * 产**泛型 directive**，Player 消费。无 openInteraction / awaitInteraction；等待为声明式
 * （无 default 出边且仅有 event 出边时，演出结束不自动推进）。
 *
 * 关键机制：
 *  - 触发时机 Trigger：enter / at(ms)。
 *  - 出口=handle：sourceHandle === 出口 event id（default = 保留字/默认推进），edge 只管连接 + 条件/权重。
 *  - 条件网关：同 handle 多边，有条件者按序求值、无条件兜底；加权随机：候选皆带 weight → rng 加权。
 *  - 组件事件：emitComponentEvent → reactions.do（effect/spawn/advance）→ 无显式 advance 则按 handle 找边。
 *  - 副作用：一律走 reactions。
 *  - 换节点：只经边；reactions.do 的 advance(edgeId) 或引擎默认推进 / handle 出边。
 *  - jumpToNode：seek 到任意节点（默认保留全局态）。
 */
import type {
  BlueprintDoc,
  GameEdge,
  GameGraph,
  GameNode,
  GameScenario,
  GraphCondition,
  GraphEffect,
  GraphLibraryDocument,
  SubFlowPack,
  SubFlowPackDef,
} from '../schema/graph-schema'
import { getNodeBgm, getSubFlowPack, isSubflowContainerData, resolveGraphEntry } from '../schema/graph-schema'
import { nodeOverlayChildren, nodeOverlayMounts, resolveMountChildren } from '../schema/expand-overlay'
import { resolveEventReactions, resolveOverlayReaction, completeReactions } from '../schema/overlay-events'
import type { Layout, NodeAction, OverlayInstanceChild, Reaction } from '../schema/node-config-schema'
import { overlayMountId } from '../schema/node-config-schema'
import { applyEffects, effectTargetValue, type EffectWrite, type MutableState } from './apply-effects'
import {
  BgmStack,
  DOC_BGM_OWNER,
  type BgmApplyInput,
  type BgmOwner,
  type BgmPlaybackCommand,
  type BgmStackFrame,
} from './bgm-stack'
import { initState } from './engine-init'
import { defaultComponentRegistry, type ComponentRegistry } from '../registry/component-registry'
import type { RuntimeDirective, RenderOverlayDirective } from './directives'
import { evaluateCondition, describeCondition, type ConditionTarget } from './condition'
import { evalExpr, type EvalCtx } from './expr'
import { layoutIsEffectivelyEmpty, resolveMountLayoutForChildren } from '../schema/layout'
import {
  createCoreNodeKindRegistry,
  type NextIntent,
  type NodeKindRegistry,
  type NodeRuntimeCtx,
} from '../nodes'
import { createRng } from './rng'

export type GraphPhase = 'idle' | 'playing' | 'ended'

/** call/return 栈帧：弹回时恢复 caller 所在图。 */
export interface CallFrame {
  callerNodeId: string
  returnGraph: GameGraph
  returnBlueprintId: string
  returnGraphPath: string[]
}

export interface RuntimeState extends MutableState {
  currentNodeId: string | null
  phase: GraphPhase
  elapsedMs: number
  visited: Set<string>
  traversedEdgeIds: Set<string>
  callStack: CallFrame[]
  log: string[]
}

interface GraphScope {
  graph: GameGraph
  blueprintId: string
  graphPath: string[]
  /** callStack.length means the active graph; otherwise the owner frame index. */
  frameIndex: number
}

interface ScopedEdge extends GraphScope {
  edge: GameEdge
}

interface GraphRuntimeCheckpointData {
  activeGraph: GameGraph
  activeBlueprintId: string
  activeGraphPath: string[]
  state: RuntimeState
  bgmFrames: readonly BgmStackFrame[]
  fired: Set<string>
  firedAtReactions: Set<number>
  windowShown: Set<string>
  windowRemoved: Set<string>
  chain: number
  redirect: { route: ScopedEdge; resetGlobals?: boolean } | null
  inExit: boolean
  returningTo: Set<string>
  numericReactionPrev: Map<string, number>
  stateConditionPrev: Map<string, boolean>
  shownChildren: Set<string>
  hiddenFired: Set<string>
  pendingSpawns: Array<{ elementId: string; nodeId: string; removeAtMs: number }>
  spawnSeq: number
  pendingRoute: { settleNodeId: string; route: ScopedEdge } | null
  routingSettled: boolean
  queue: RuntimeDirective[]
}

/** 仅内存的运行时恢复点；不属于游戏配置或持久化协议。 */
export interface GraphRuntimeCheckpoint {
  readonly kind: 'game-video.runtime-checkpoint.v1'
  readonly payload: unknown
}

const CHAIN_GUARD = 200

function packLookupKey(id: string, version?: string): string {
  return version ? `${id}@${version}` : id
}

export class GraphRuntime {
  private readonly nodes = new Map<string, GameNode>()
  private readonly outgoing = new Map<string, GameEdge[]>()
  /** 主图（构造时传入）；jump/start 始终回到这里。 */
  private readonly rootGraph: GameGraph
  /** 当前正在执行的图（根 graph，或执行中解析到的子蓝图 graph）。 */
  private activeGraph: GameGraph
  private activeBlueprintId: string
  private activeGraphPath: string[] = []
  private readonly rootBlueprintId: string
  /** 依赖查找表：id / id@version → 子蓝图（来自 manifest.packs，或测试注入的 packs）。 */
  private readonly packsByKey = new Map<string, { id: string; version?: string; entry: string; graph: GameGraph }>()
  readonly state: RuntimeState
  private queue: RuntimeDirective[] = []
  /** 床轨作用域栈（会话级）：配了就一直播，结束时机见 §4.3；引擎只在生命周期检查点上动它。 */
  private readonly bgm = new BgmStack()

  // 每节点重置的运行游标
  private fired = new Set<string>() // 已触发的 enter/at 元素 id
  private firedAtReactions = new Set<number>() // 已触发的 at reaction 下标（按 node.data.reactions 顺序）
  private windowShown = new Set<string>() // 已按 window.startMs 显示的元素 id
  private windowRemoved = new Set<string>() // 已按 window.endMs 移除的元素 id
  private chain = 0 // 同步穿链计数（anti-runaway）

  // watch / lifecycle 的 advance 硬打断：命中即设 redirect，在安全边界消费为一次跳转。
  private redirect: { route: ScopedEdge; resetGlobals?: boolean } | null = null
  private inExit = false // 跑 exit 元素期间抑制规则消费，避免退出时自跳环
  private returningTo = new Set<string>() // 正在弹回的容器节点：下一次 enter 跳过 subProcess 下钻、直接续 out

  // 响应式：变化值与状态条件基线（key = 反应作用域#下标）；每个写屏障重采样比对。
  private numericReactionPrev = new Map<string, number>()
  private stateConditionPrev = new Map<string, boolean>()
  // 组件生命周期：本次节点访问内已 shown / 已 hidden 的运行态 child id。
  private shownChildren = new Set<string>()
  private hiddenFired = new Set<string>()
  // spawn 出的瞬态叠层：到 removeAtMs（本节点 elapsedMs）即发 removeOverlay。
  private pendingSpawns: Array<{ elementId: string; nodeId: string; removeAtMs: number }> = []
  private spawnSeq = 0
  /** 当前节点已选中、等待统一结算点提交的事件边。 */
  private pendingRoute: { settleNodeId: string; route: ScopedEdge } | null = null
  /** 固定时间结算只执行一次；到点后才发生的延迟选择按立即跳转处理。 */
  private routingSettled = false

  /** 组件契约表（缺省与 bootComponents 共享默认表）。 */
  readonly components: ComponentRegistry

  /** 节点类型注册表：按 GameNode.type 派发 execute/next（perf/subflow/subflowPack 内置）。 */
  private readonly nodeKinds: NodeKindRegistry = createCoreNodeKindRegistry()

  /**
   * @param graph 开跑入口图（通常 = scenario 根 graph / 主图）。
   * @param packs 可选测试注入；生产路径依赖从 `scenario.manifest.packs` 按需解析。
   *              非空时优先于 manifest。
   */
  constructor(
    graph: GameGraph,
    private readonly scenario: GameScenario,
    components: ComponentRegistry = defaultComponentRegistry,
    packs: readonly SubFlowPackDef[] = [],
    rootBlueprintId?: string,
    private readonly rngSeed = 0,
  ) {
    this.rootGraph = graph
    this.activeGraph = graph
    this.rootBlueprintId =
      rootBlueprintId
      ?? (scenario as { manifest?: { mainPackId?: string } }).manifest?.mainPackId
      ?? '__root__'
    this.activeBlueprintId = this.rootBlueprintId
    this.components = components
    this.loadDependencyTable(scenario, packs)
    this.indexGraph(graph)
    this.state = { ...initState(scenario, rngSeed), ...control() }
  }

  getActiveBlueprintId(): string {
    return this.activeBlueprintId
  }

  getActiveGraphPath(): string[] {
    return [...this.activeGraphPath]
  }

  /** 捕获完整可变执行态，供编辑器在已走过的时间轴片段间无损回放。 */
  createCheckpoint(): GraphRuntimeCheckpoint {
    const data: GraphRuntimeCheckpointData = {
      activeGraph: this.activeGraph,
      activeBlueprintId: this.activeBlueprintId,
      activeGraphPath: [...this.activeGraphPath],
      state: cloneRuntimeState(this.state),
      bgmFrames: this.bgm.frames().map((frame) => ({ ...frame })),
      fired: new Set(this.fired),
      firedAtReactions: new Set(this.firedAtReactions),
      windowShown: new Set(this.windowShown),
      windowRemoved: new Set(this.windowRemoved),
      chain: this.chain,
      redirect: cloneRedirect(this.redirect),
      inExit: this.inExit,
      returningTo: new Set(this.returningTo),
      numericReactionPrev: new Map(this.numericReactionPrev),
      stateConditionPrev: new Map(this.stateConditionPrev),
      shownChildren: new Set(this.shownChildren),
      hiddenFired: new Set(this.hiddenFired),
      pendingSpawns: this.pendingSpawns.map((spawn) => ({ ...spawn })),
      spawnSeq: this.spawnSeq,
      pendingRoute: clonePendingRoute(this.pendingRoute),
      routingSettled: this.routingSettled,
      queue: [...this.queue],
    }
    return { kind: 'game-video.runtime-checkpoint.v1', payload: data }
  }

  /** 恢复 `createCheckpoint` 捕获的状态；不执行节点、边或副作用。 */
  restoreCheckpoint(checkpoint: GraphRuntimeCheckpoint): void {
    if (checkpoint.kind !== 'game-video.runtime-checkpoint.v1') {
      throw new Error('unsupported graph runtime checkpoint')
    }
    const data = checkpoint.payload as GraphRuntimeCheckpointData
    this.switchGraph(data.activeGraph)
    this.activeBlueprintId = data.activeBlueprintId
    this.activeGraphPath = [...data.activeGraphPath]
    Object.assign(this.state, cloneRuntimeState(data.state))
    this.bgm.restore(data.bgmFrames)
    this.fired = new Set(data.fired)
    this.firedAtReactions = new Set(data.firedAtReactions)
    this.windowShown = new Set(data.windowShown)
    this.windowRemoved = new Set(data.windowRemoved)
    this.chain = data.chain
    this.redirect = cloneRedirect(data.redirect)
    this.inExit = data.inExit
    this.returningTo = new Set(data.returningTo)
    this.numericReactionPrev = new Map(data.numericReactionPrev)
    this.stateConditionPrev = new Map(data.stateConditionPrev)
    this.shownChildren = new Set(data.shownChildren)
    this.hiddenFired = new Set(data.hiddenFired)
    this.pendingSpawns = data.pendingSpawns.map((spawn) => ({ ...spawn }))
    this.spawnSeq = data.spawnSeq
    this.pendingRoute = clonePendingRoute(data.pendingRoute)
    this.routingSettled = data.routingSettled
    this.queue = [...data.queue]
  }

  /**
   * 当前节点之后可能播放的媒体节点（只读预取提示，不执行条件、不消耗 rng）。
   * 无媒体的逻辑节点会继续向后穿透；数量有界，避免分支图一次拉取过多视频。
   */
  getPreloadNodes(limit = 4): GameNode[] {
    const currentId = this.state.currentNodeId
    if (!currentId || limit <= 0) return []

    const queue = (this.outgoing.get(currentId) ?? []).map((edge) => edge.target)
    const visited = new Set<string>([currentId])
    const candidates: GameNode[] = []

    while (queue.length > 0 && candidates.length < limit) {
      const nodeId = queue.shift() as string
      if (visited.has(nodeId)) continue
      visited.add(nodeId)

      const node = this.nodes.get(nodeId)
      if (!node) continue
      if (node.data.media?.ref) {
        candidates.push(node)
        continue
      }
      for (const edge of this.outgoing.get(nodeId) ?? []) queue.push(edge.target)
    }
    return candidates
  }

  /** 执行中发现 subFlowPack 时的查表源：构造注入 packs（单测）> scenario.manifest.packs。 */
  private loadDependencyTable(scenario: GameScenario, packs: readonly SubFlowPackDef[]): void {
    const register = (id: string, entry: string, g: GameGraph, version?: string) => {
      const row = { id, version, entry, graph: g }
      if (version) this.packsByKey.set(packLookupKey(id, version), row)
      if (!this.packsByKey.has(id)) this.packsByKey.set(id, row)
    }
    if (packs.length > 0) {
      for (const p of packs) register(p.id, p.entry, p.graph, p.version)
      return
    }
    const blueprints = (scenario as GraphLibraryDocument).manifest?.packs
    if (!blueprints) return
    for (const d of Object.values(blueprints) as BlueprintDoc[]) {
      register(d.id, d.entry, d.graph, d.version)
    }
  }

  private indexGraph(graph: GameGraph): void {
    this.nodes.clear()
    this.outgoing.clear()
    for (const node of graph.nodes) this.nodes.set(node.id, node)
    for (const edge of graph.edges) {
      const list = this.outgoing.get(edge.source)
      if (list) list.push(edge)
      else this.outgoing.set(edge.source, [edge])
    }
  }

  private switchGraph(graph: GameGraph): void {
    this.activeGraph = graph
    this.indexGraph(graph)
  }

  private resolvePack(ref: SubFlowPack): { id: string; version?: string; entry: string; graph: GameGraph } {
    const keyed = ref.version ? this.packsByKey.get(packLookupKey(ref.id, ref.version)) : undefined
    const pack = keyed ?? this.packsByKey.get(ref.id)
    if (!pack) {
      const ver = ref.version ? `@${ref.version}` : ''
      throw new Error(`subFlowPack '${ref.id}${ver}' is not loaded`)
    }
    // 入口节点校验挪到 resolvePackEntry（可回退到图内根节点）；这里只保证依赖已在表中。
    return pack
  }

  private pushCall(callerNodeId: string): void {
    this.state.callStack.push({
      callerNodeId,
      returnGraph: this.activeGraph,
      returnBlueprintId: this.activeBlueprintId,
      returnGraphPath: [...this.activeGraphPath],
    })
  }

  private getComponent(componentId: string) {
    return this.components.getComponent(componentId)
  }

  /**
   * 本节点可调度的 overlay children：**调用栈容器（我方/敌方回合等）挂载的 overlay 覆盖整段子流程** +
   * 本节点自身挂载。容器 children 排在前（先渲染，避免被本节点交互中断枚举）。
   */
  private childrenOf(node: GameNode | null | undefined): OverlayInstanceChild[] {
    if (!node) return []
    const inherited = this.state.callStack.flatMap((f) => {
      const c = f.returnGraph.nodes.find((n) => n.id === f.callerNodeId)
      return c ? nodeOverlayChildren(this.scenario, c) : []
    })
    return [...inherited, ...nodeOverlayChildren(this.scenario, node)]
  }

  /** 运行态元素来自当前节点或某个调用栈容器；按 childrenOf 的继承顺序恢复其精确图作用域。 */
  private scopeForElement(el: OverlayInstanceChild): GraphScope {
    const ownsMount = (node: GameNode | undefined) => node?.id === el.source.nodeId
      && nodeOverlayMounts(node).some((mount) => overlayMountId(mount) === el.source.mountId)
    for (let i = 0; i < this.state.callStack.length; i++) {
      const frame = this.state.callStack[i]!
      const container = frame.returnGraph.nodes.find((node) => node.id === frame.callerNodeId)
      if (ownsMount(container)) return this.frameScope(i)
    }
    return this.activeScope()
  }

  /** 找 el 所属挂载的 reactions（本节点或调用栈容器上）。 */
  private mountReactionsFor(el: OverlayInstanceChild): Reaction[] | undefined {
    const find = (n: GameNode | undefined) =>
      n ? nodeOverlayMounts(n).find((m) => overlayMountId(m) === el.source.mountId)?.reactions : undefined
    const own = find(this.node(this.state.currentNodeId))
    if (own) return own
    for (const f of this.state.callStack) {
      const c = f.returnGraph.nodes.find((n) => n.id === f.callerNodeId)
      const r = find(c)
      if (r) return r
    }
    return undefined
  }

  /**
   * 组件事件（点击 / 判定 / 超时 defaultEvent）：跑挂载 event 反应；
   * 无显式 advance 时按 handle 找边默认推进（与旧 submitInteraction 对齐）。
   */
  emitComponentEvent(elementId: string, key: string): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    const el = this.childrenOf(node).find((e) => e.id === elementId)
    if (!node || !el) return this.drain()
    const outcome =
      typeof key === 'string' && key
        ? key
        : ((el.inputs as { defaultEvent?: unknown }).defaultEvent as string) ?? 'fail'
    this.chain = 0
    if (this.consumeRedirect()) return this.drain()

    const mountReactions = this.mountReactionsFor(el)
    const evReactions = resolveEventReactions(mountReactions, outcome, el.source.childId, el.source.mountId)
    const catalogReaction = resolveOverlayReaction(
      this.scenario.ui?.overlays?.[el.source.overlayId]?.reactions,
      el.source.childId,
      outcome,
    )
    let advanced = false
    // 目录动作先执行，挂载动作随后追加；目录专用类型排除了 advance，因此走向始终属于节点挂载/边。
    if (catalogReaction) this.runEventActions(catalogReaction.do, el)
    for (const r of evReactions) {
      if (this.redirect) break
      if (this.runEventActions(r.do, el)) {
        advanced = true
        break
      }
      if (this.redirect) break
    }
    if (this.consumeRedirect()) return this.drain()
    if (advanced) return this.drain()

    const candidates: Array<{ scope: GraphScope; nodeId: string }> = []
    if (this.state.currentNodeId) candidates.push({ scope: this.activeScope(), nodeId: this.state.currentNodeId })
    for (let i = this.state.callStack.length - 1; i >= 0; i--) {
      candidates.push({ scope: this.frameScope(i), nodeId: this.state.callStack[i]!.callerNodeId })
    }
    for (const candidate of candidates) {
      const scoped = this.selectHandleEdgeInScope(candidate.scope, candidate.nodeId, outcome)
      if (!scoped) continue
      this.requestEventRoute(scoped)
      break
    }
    return this.drain()
  }

  // ── 指令队列 ────────────────────────────────────────────────────────────────
  private emit(d: RuntimeDirective): void {
    this.queue.push(d)
  }
  private drain(): RuntimeDirective[] {
    const q = this.queue
    this.queue = []
    return q
  }
  // 经方法赋值，避免 TS 把 this.state.phase 的类型窄化成某个字面量（跨方法可被 runElement 改写）。
  private setPhase(p: GraphPhase): void {
    this.state.phase = p
  }
  private condTarget(): ConditionTarget {
    return { state: this.state, visited: this.state.visited }
  }
  private node(id: string | null): GameNode | undefined {
    return id ? this.nodes.get(id) : undefined
  }

  // ── 床轨作用域（BGM）──────────────────────────────────────────────────────────
  // v2：**配了就一直播**（D5）。调度层只在两个检查点动栈：descend（容器 `data.bgm`）与
  // beginPerform（普通节点 `data.bgm`），两者都归 `applyNodeBgm`。**离开节点、弹 `callStack`
  // 帧、局内清空 `callStack` 一律不动 BGM 栈**——`runExit` 与弹帧路径一个字都不发。栈是否真的
  // 变了由 BgmStack 判定，没变就没有 command、也就没有指令。
  /** 栈没变（`null`）就不发指令。 */
  private emitBgmCommand(cmd: BgmPlaybackCommand | null): void {
    if (cmd) this.emit({ type: 'bgm', ...cmd })
  }

  /**
   * 床轨层的 owner。**必须带蓝图前缀**：`switchGraph → indexGraph` 每次按蓝图重建 `this.nodes`，
   * 故 nodeId 只在本蓝图内唯一。可复用包里叫 `combat` / `enter` / `end` 的通名节点跟主图 caller
   * 同名是常态（本平台由 agent 铸 id）；裸 nodeId 作 owner 时，包内那个同名节点起播会被下面的
   * 「回同一节点不叠层」判成「自己那层已在栈顶」→ 就地 replace 掉主图容器的层，出包后再 `stop`
   * 就回不到那首了（层没了）。全程无报错，纯听感缺陷。
   */
  private bgmOwner(nodeId: string): BgmOwner {
    return `${this.activeBlueprintId}::${nodeId}`
  }

  /**
   * 节点上的 `bgm` 生效点（§4.2 `applyNodeBgm`）：无 `data.bgm` = 空操作。
   *
   * - `mode: 'stop'` → `stack.stop()`：结束当前这层，回到上一层还没结束的（写它的节点通常压根
   *   没开过层，故与 owner 无关）。
   * - 只有 `volume` → `stack.setVolume()`：不换曲、不新建层；当前没有 BGM 时无操作。
   * - 其余 → `stack.apply()` 开一层，从此一直响，直到别处 `mode: 'stop'` 或 `jump`/清局结束它。
   *   容器与普通节点同一条规则：`callStack` 深度与这一层的寿命无关。
   */
  private applyNodeBgm(node: GameNode): void {
    const bgm = getNodeBgm(node.data)
    if (!bgm) return
    if (bgm.mode === 'stop') return this.emitBgmCommand(this.bgm.stop())
    if (!bgm.ref) {
      if (bgm.volume !== undefined) this.emitBgmCommand(this.bgm.setVolume(bgm.volume))
      return
    }
    // owner 由引擎算、不从落盘数据展开：混进 `bgm.owner` 也盖不掉算出来的那个。
    const owner = this.bgmOwner(node.id)
    const input: BgmApplyInput = {
      owner,
      // stop / volume-only 已在上面分流，余下分支必有非空 ref。
      ref: bgm.ref as string,
      mode: bgm.mode,
      volume: bgm.volume,
      fadeInMs: bgm.fadeInMs,
      fadeOutMs: bgm.fadeOutMs,
      restart: bgm.restart,
      loop: bgm.loop,
    }
    const top = this.bgm.top()
    if (top?.owner !== owner) return this.emitBgmCommand(this.bgm.apply(input))
    // 自己那层已在栈顶 = 回合循环又走进来了（§6.1 的战斗床就配在循环入口）。**绝不加深栈**：
    // 每轮压一层的话栈无界增长，之后一次 `stop` 只能退回上一轮的同一首（听起来「没反应」）。
    // 曲子和目标音量都没变、且没要求重开 → 一条指令都不发（壳层别碰播放头）。volume-only
    // 节点可能改过本层音量；回到 owner 时即使 ref 相同，也要恢复 owner 自己配置的音量。
    if (
      top.ref === input.ref
      && top.volume === (input.volume ?? top.volume)
      && top.loop === (input.loop ?? true)
      && !bgm.restart
    ) return
    // 要么作者显式 `restart`（每轮从头播），要么这层的曲子被别人 replace 走了（该换回自己那首）：
    // 就地换栈顶，`replace` 保留本层的 owner——这一层仍归**第一次**开它的那个作用域，于是下一轮
    // 走进来时守卫照样认得出「自己那层已在栈顶」。
    this.emitBgmCommand(this.bgm.apply({ ...input, mode: 'replace' }))
  }

  /**
   * **作者跳转 / 清局**（`jumpToNode`，SPEC §4.2 生命周期表）：导航被整体重置，栈上那些作用域层
   * （容器层与节点层）再没有上下文可言，故就地退到栈底文档床。
   *
   * **不含局内清 `callStack` 的那三条路径**（容器 handle 出边 / 显式 advance 走容器边 / 规则硬
   * 打断）——那些只清 `callStack`，一个字都不发：层不绑 `callStack`（D5 / D11），被剧情弹出容器
   * 不是作者说的「结束」。
   *
   * 一次转场只发**最终**该响的那条：中间层的 resume 指令对壳层没有意义（会白起一段又立刻换）。
   * 但淡出要取**第一次**离场那帧的——正在响的是栈顶那条，作者写在它 `fadeOutMs` 上的值才是
   * 这次转场听得到的那个淡出；沿用最后一条命令的话，报出去的是最深那层（早就没在响）的时长。
   *
   * `rederiveDocBed` = 与 `resetGlobalsState` 同步的「清局」：状态回 `initState(scenario)`，
   * 床轨同理按 `scenario.bgm` 重压（从头起播）；默认 jump 保留全局态，故文档床原样留着继续响。
   */
  private unwindBgmToDocBed(rederiveDocBed = false): void {
    let cmd: BgmPlaybackCommand | null = null
    // 正在响的那条的淡出时长（第一次 stop / clear 给的）；后续层的值都不该被听到。
    let soundingFadeOutMs: number | undefined
    if (rederiveDocBed) {
      const stopped = this.bgm.top() ? this.bgm.clear() : null
      soundingFadeOutMs = stopped?.fadeOutMs
      cmd = this.applyDocBgm() ?? stopped
    } else {
      // `stop()` 逐层退且**永不弹文档床**（D13），所以这个循环恰好停在栈底那层文档床上。
      for (;;) {
        const popped = this.bgm.stop()
        if (!popped) break
        soundingFadeOutMs ??= popped.fadeOutMs
        cmd = popped
      }
    }
    if (cmd && soundingFadeOutMs !== undefined) cmd = { ...cmd, fadeOutMs: soundingFadeOutMs }
    this.emitBgmCommand(cmd)
  }

  /** 压入文档默认床轨；`scenario.bgm` 缺省 = 静音起局（返回 null，不发指令）。 */
  private applyDocBgm(): BgmPlaybackCommand | null {
    const doc = this.scenario.bgm
    if (!doc?.ref) return null
    return this.bgm.apply({ ...doc, owner: DOC_BGM_OWNER })
  }

  // ── 控制入口 ────────────────────────────────────────────────────────────────
  start(): RuntimeDirective[] {
    this.activeBlueprintId = this.rootBlueprintId
    this.activeGraphPath = []
    this.switchGraph(this.rootGraph)
    // 跟 BlueprintDoc.entry，不是 nodes[] 创建顺序——作者把节点接到入口前时 entry 会前移，
    // 但数组首位仍可能是旧节点。
    const preferred = this.packsByKey.get(this.rootBlueprintId)?.entry
    const entryId = resolveGraphEntry(this.rootGraph, preferred)
    if (!entryId) {
      this.setPhase('ended')
      return this.drain()
    }
    this.chain = 0
    this.returningTo = new Set()
    // 文档床先压：入口节点/容器自己的层要叠在它上面。
    this.unwindBgmToDocBed(true)
    this.enterNode(entryId)
    return this.drain()
  }

  /** seek 到任意节点从头跑（调试/可视化点击）。默认保留全局态，resetGlobals 干净复现。 */
  jumpToNode(
    id: string,
    opts: { resetGlobals?: boolean; graph?: GameGraph; blueprintId?: string; graphPath?: string[] } = {},
  ): RuntimeDirective[] {
    if (opts.resetGlobals) this.resetGlobalsState()
    if (opts.blueprintId) {
      const pack = this.packsByKey.get(opts.blueprintId)
      const g = opts.graph ?? pack?.graph
      if (!g) throw new Error(`jump blueprint '${opts.blueprintId}' not loaded`)
      this.switchGraph(g)
      this.activeBlueprintId = opts.blueprintId
      this.activeGraphPath = [...(opts.graphPath ?? [])]
    } else if (opts.graph) {
      this.switchGraph(opts.graph)
      this.activeBlueprintId = opts.graph === this.rootGraph ? this.rootBlueprintId : this.activeBlueprintId
      this.activeGraphPath = [...(opts.graphPath ?? [])]
    } else {
      this.switchGraph(this.rootGraph)
      this.activeBlueprintId = this.rootBlueprintId
      this.activeGraphPath = []
    }
    this.state.callStack = []
    this.chain = 0
    this.returningTo = new Set()
    // 清栈 = 弃掉所有容器作用域（以及当前节点自己的层）；resetGlobals 连文档床一起重 derive。
    this.unwindBgmToDocBed(opts.resetGlobals === true)
    this.enterNode(id)
    return this.drain()
  }

  private resetGlobalsState(): void {
    const base = initState(this.scenario, this.rngSeed)
    this.state.vars = base.vars
    this.state.varMeta = base.varMeta
    this.state.entities = base.entities
    this.state.flags = base.flags
    this.state.score = base.score
    this.state.items = base.items
    this.state.rng = base.rng
    this.state.appliedOnce = base.appliedOnce
    this.state.visited = new Set()
    this.state.traversedEdgeIds = new Set()
  }

  // ── 进入节点 ────────────────────────────────────────────────────────────────
  private enterNode(id: string): void {
    if (++this.chain > CHAIN_GUARD) {
      this.emit({ type: 'log', message: `anti-runaway: chain>${CHAIN_GUARD} at ${id}` })
      this.setPhase('ended')
      return
    }
    const node = this.nodes.get(id)
    if (!node) {
      this.setPhase('ended')
      return
    }
    const kind = this.nodeKinds.resolve(node)
    if (!kind) {
      this.setPhase('ended')
      return
    }
    // 待提交路由只属于离开前的演出节点，任何新入场都不得继承。
    this.pendingRoute = null
    this.routingSettled = false
    // 调度层公共入场：认领当前节点、清弹回标记、置时钟原点。节点态重置 / 换片 / 相位、跑元素 / 交互
    // 全由 kind.execute 经 ctx.beginPerform / beginResume 表达（descend 下钻不重置、不重播）。
    const returning = this.returningTo.delete(id)
    this.state.currentNodeId = id
    this.state.elapsedMs = 0
    this.state.visited.add(id)
    const intent = kind.execute(this.nodeCtx(node, returning))
    if (this.consumeRedirect()) return
    this.runIntent(intent, node)
  }

  /** 执行 NodeKind 返回的走向意图（节点只表达意图，动栈 / 切图 / 走边 / 结束由此代劳）。 */
  private runIntent(intent: NextIntent, node: GameNode): void {
    switch (intent.kind) {
      case 'descend':
        this.pushCall(node.id)
        // 容器的 `data.bgm` 在**下钻**这一刻生效（普通节点那条走 beginPerform，容器不进那条）。
        // returning 再 enter 容器时 NodeKind 返回 advance 而非 descend，故不会二次 apply（§4.4）。
        this.applyNodeBgm(node)
        if (intent.graph) {
          const packId = getSubFlowPack(node.data)?.id
          if (packId) {
            this.activeBlueprintId = packId
            this.activeGraphPath = []
          } else {
            this.activeGraphPath = [...this.activeGraphPath, node.id]
          }
          this.switchGraph(intent.graph)
        }
        this.enterNode(intent.entry)
        return
      case 'advance':
        // 无自动出边时 advanceAuto 自理：有调用栈则弹回 caller，栈空则 finishEnd 结束本局。
        if (this.state.phase === 'playing') this.advanceAuto()
        return
      case 'await':
      default:
        return
    }
  }

  /** 构造给 NodeKind 的受控上下文：读调度态 + 发指令 / 跑元素 + 节点态生命周期钩子。 */
  private nodeCtx(node: GameNode, returning: boolean): NodeRuntimeCtx {
    const self = this
    return {
      node,
      state: self.state,
      elapsedMs: self.state.elapsedMs,
      returning,
      get redirected() {
        return self.redirect !== null
      },
      emit: (d) => self.emit(d),
      childrenOf: (n) => self.childrenOf(n),
      runElement: (el) => self.runElement(el),
      beginPerform: () => self.beginPerform(node),
      beginResume: () => self.beginResume(),
      applyEnterReactions: (n) => self.applyPhaseReactionEffects(n, 'enter'),
      isInstant: (n) => self.isInstantNode(n),
      resolvePackEntry: (n) => self.resolvePackEntry(n),
    }
  }

  /** perf 进入：重置本节点态 + 条件基线 + 发 playClip（换片清上一节点叠层）+ 相位置 playing。 */
  private beginPerform(node: GameNode): void {
    this.fired = new Set()
    this.firedAtReactions = new Set()
    this.windowShown = new Set()
    this.windowRemoved = new Set()
    // 组件生命周期 / spawn 游标随节点重置；条件基线按当前态重建（本节点内的变化才 fire）。
    this.shownChildren = new Set()
    this.hiddenFired = new Set()
    this.pendingSpawns = []
    this.seedReactiveConditions()
    // 先发 playClip（换片会清空上一节点的叠层/交互）；随后 enter 元素产生的 overlay/interaction 才不会被反清。
    this.emit({
      type: 'playClip',
      nodeId: node.id,
      name: node.data.name,
      mediaId: node.data.media?.ref,
      loop: node.data.mediaPlayMode === 'loop',
      durationMs: node.data.durationMs,
    })
    this.setPhase('playing')
    // window 是显隐唯一 SSOT（有 window 就跳过 trigger，见 nodes/perf.ts 与 flushTimeline）：
    // 这里立刻按 elapsed=0 冲一遍窗口，让 `startMs<=0` 的子件与 `trigger:enter` 同帧出现，
    // 而不是等宿主第一次 tick 才冒出来（headless / 首帧前就该可见）。
    this.tickWindows(node, 0)
    // 普通节点的 `data.bgm` 只走这条演出入场路径（容器 returning 走 beginResume，不会到这里）；
    // 容器排除在外是因为它那句归 descend 管，否则一次进入会 apply 两遍。
    if (!isSubflowContainerData(node.data)) this.applyNodeBgm(node)
  }

  /** 容器弹回：不重播演出、不跑 enter 元素，只重置 fired/pending + 相位置 playing，随后沿 out 续走。 */
  private beginResume(): void {
    this.fired = new Set()
    this.setPhase('playing')
  }

  /** 瞬时节点：无 media、无 durationMs、无可 emit 事件的组件 → 进入即可推进（逻辑穿链）。 */
  private isInstantNode(node: GameNode): boolean {
    if (node.data.media?.ref) return false
    if (node.data.durationMs) return false
    return !this.childrenOf(node).some(
      (el) => this.components.handlesOf(el.component, el.inputs).length > 0,
    )
  }

  /** 解析子蓝图包入口 + 其图（subflowPack 用）；非 pack 返回 undefined。 */
  private resolvePackEntry(node: GameNode): { entry: string; graph: GameGraph } | undefined {
    const ref = getSubFlowPack(node.data)
    if (!ref) return undefined
    const pack = this.resolvePack(ref)
    const entry = resolveGraphEntry(pack.graph, ref.entry ?? pack.entry)
    if (!entry) {
      throw new Error(`subFlowPack '${pack.id}' has no nodes`)
    }
    return { entry, graph: pack.graph }
  }

  // ── tick / 演出结束 ─────────────────────────────────────────────────────────
  /** 推进节点时钟：触发到点的 at 元素 + window 时段叠层。 */
  tick(elapsedMs: number): RuntimeDirective[] {
    this.flushTimeline(elapsedMs)
    return this.drain()
  }

  /**
   * 把节点时钟推到 elapsedMs，并补跑到点的 at / window / spawn 收割。
   * 不 drain——供 tick 与 onPerformanceEnd 共用（片尾也必须先冲刷 at，再决定是否 advance）。
   */
  private flushTimeline(elapsedMs: number): void {
    const node = this.node(this.state.currentNodeId)
    const previousMs = this.state.elapsedMs
    const loopWrapped = node?.data.mediaPlayMode === 'loop' && elapsedMs + 50 < previousMs
    // 媒体 loop 会把 currentTime 拉回 0；节点逻辑时钟只能前进。回绕时补齐作者声明的节点末端，
    // 确保片尾结算/界面消失执行一次，随后视频可以继续独立循环。
    const timelineMs = loopWrapped
      ? Math.max(previousMs, node?.data.durationMs ?? previousMs)
      : Math.max(previousMs, elapsedMs)
    this.state.elapsedMs = timelineMs
    if (!node || this.state.phase !== 'playing') return

    for (const el of this.childrenOf(node)) {
      if (el.trigger.when === 'at' && !el.window && el.trigger.ms <= timelineMs && !this.fired.has(el.id)) {
        this.runElement(el)
        if (this.redirect) break
      }
    }
    if (!this.redirect) this.applyAtReactionEffects(node, timelineMs)

    this.tickWindows(node, timelineMs)
    this.reapSpawns(timelineMs)
    if (this.consumeRedirect()) return

    const settlement = node.data.routingSettlement
    if (
      !this.routingSettled &&
      settlement?.type === 'at' &&
      Number.isFinite(settlement.ms) &&
      timelineMs >= settlement.ms
    ) {
      this.routingSettled = true
      this.advanceAuto()
    }
  }

  /** window 时段：到 startMs 显示、到 endMs 移除（表现层叠层的可见时段，如漂字/计时器只显示某段）。 */
  private tickWindows(node: GameNode, elapsedMs: number): void {
    for (const el of this.childrenOf(node)) {
      if (!el.window) continue
      const start = el.window.startMs ?? 0
      const end = el.window.endMs
      if (!this.windowShown.has(el.id) && elapsedMs >= start && (end == null || elapsedMs < end)) {
        this.windowShown.add(el.id)
        this.runElement(el)
      }
      if (!this.windowRemoved.has(el.id) && end != null && elapsedMs >= end) {
        this.windowRemoved.add(el.id)
        if (this.windowShown.has(el.id)) {
          this.emit({ type: 'removeOverlay', nodeId: node.id, elementId: el.id })
          // 组件消失（unmount）→ 触发 hidden 生命周期反应（每节点访问首次）。
          if (this.shownChildren.has(el.id) && !this.hiddenFired.has(el.id)) {
            this.hiddenFired.add(el.id)
            this.fireLifecycle('hidden', el)
          }
        }
      }
    }
  }

  /**
   * 演出（视频/时长）结束：先把时钟冲到节点时长并补挂 `trigger.at`（如 video_end 才出现的應/默），
   * 再交给 NodeKind.next（缺省 advance；仅有 event 边时 advanceAuto 会停住等待 emit）。
   */
  onPerformanceEnd(): RuntimeDirective[] {
    const node = this.node(this.state.currentNodeId)
    if (!node || this.state.phase !== 'playing') return this.drain()
    this.chain = 0
    const dur = typeof node.data.durationMs === 'number' ? node.data.durationMs : undefined
    const endMs = Math.max(this.state.elapsedMs, dur ?? this.state.elapsedMs)
    this.flushTimeline(endMs)
    // 固定时间结算可能已在 flushTimeline 内换了节点；旧媒体的结束回调不得再推进新节点。
    if (this.state.currentNodeId !== node.id) return this.drain()
    if (this.state.phase !== 'playing') return this.drain()
    if (this.consumeRedirect()) return this.drain()
    // 固定时间已结算但没有可走边时保持等待；片尾不得重复跑 complete。
    if (this.routingSettled) return this.drain()
    this.routingSettled = true
    // 时间驱动唤醒（媒体播完/时长到点）→ 交由 NodeKind.next 决定走向（缺省 advance）。
    const kind = this.nodeKinds.resolve(node)
    const intent: NextIntent = kind?.next ? kind.next(this.nodeCtx(node, false)) : { kind: 'advance' }
    this.runIntent(intent, node)
    return this.drain()
  }

  /** 结算动作：按序施加 effect、显示/隐藏界面，或沿当前结算节点的真实出边推进。 */
  private runSettlementActions(node: GameNode, actions: NodeAction[]): void {
    const scope = this.activeScope()
    // 顺序即语义：spawn 读紧邻上一条 effect 实际造成的变化，让绑定界面的数字派生自结算本身。
    let lastWrite: EffectWrite | undefined
    for (const a of actions) {
      if (a.kind === 'effect' && a.effects.length) lastWrite = this.applyAndReact(a.effects)
      else if (a.kind === 'spawn') this.doSpawn(a, lastWrite)
      else if (a.kind === 'hideOverlay') this.doHideOverlay(a, node)
      else if (a.kind === 'advance' && !this.redirect && !this.inExit) {
        const route = this.scopedEdgeInScope(a.edgeId, scope)
        if (route?.edge.source === node.id) {
          this.requestReactionRoute(route)
          return
        }
      }
      if (this.redirect) return
    }
  }

  /** 事件路由可匹配的节点 id：当前节点 + 调用栈容器 + 元素所属节点。 */
  private eventRoutingNodeIds(el?: OverlayInstanceChild): string[] {
    const ids: string[] = []
    const cur = this.state.currentNodeId
    if (cur) ids.push(cur)
    for (const f of this.state.callStack) {
      if (!ids.includes(f.callerNodeId)) ids.push(f.callerNodeId)
    }
    if (el?.source.nodeId && !ids.includes(el.source.nodeId)) ids.push(el.source.nodeId)
    return ids
  }

  /** 交互事件 do：effect/spawn/advance；advance = 沿当前图的边软推进。返回是否已换节点。 */
  private runEventActions(actions: NodeAction[], el?: OverlayInstanceChild): boolean {
    const scope = el ? this.scopeForElement(el) : this.activeScope()
    for (const a of actions) {
      if (a.kind === 'effect') {
        if (a.effects.length) this.applyAndReact(a.effects)
      } else if (a.kind === 'spawn') {
        this.doSpawn(a)
      } else if (a.kind === 'hideOverlay') {
        const owner = el ? scope.graph.nodes.find((node) => node.id === el.source.nodeId) : undefined
        this.doHideOverlay(a, owner)
      } else if (a.kind === 'advance') {
        const scoped = this.scopedEdgeInScope(a.edgeId, scope)
        if (scoped && this.eventRoutingNodeIds(el).includes(scoped.edge.source)) {
          return this.requestEventRoute(scoped)
        }
      }
      if (this.redirect) return false
    }
    return false
  }

  /** 施加节点某生命周期相位（enter/exit）reactions 的副作用。 */
  private applyPhaseReactionEffects(node: GameNode, phase: 'enter' | 'exit'): void {
    for (const r of node.data.reactions ?? []) {
      if (r.when.type === phase) this.runSettlementActions(node, r.do)
      if (this.redirect) return
    }
  }

  /** 施加节点 at 相位 reactions 的副作用（到点、去重）。 */
  private applyAtReactionEffects(node: GameNode, elapsedMs: number): void {
    const reactions = node.data.reactions ?? []
    for (let i = 0; i < reactions.length; i++) {
      const r = reactions[i]!
      if (r.when.type !== 'at' || this.firedAtReactions.has(i) || r.when.ms > elapsedMs) continue
      this.firedAtReactions.add(i)
      this.runSettlementActions(node, r.do)
      if (this.redirect) return
    }
  }

  /**
   * 节点收尾（complete）reactions 的副作用：按作者顺序取首个 `if` 成立的分支（否则无 `if` 兜底），施加其 effect。
   * 仅副作用，不决定走向（走向由 selectAutoEdge 的边负责）。
   */
  private applyCompleteReactionEffects(node: GameNode): void {
    const completes = completeReactions(node.data.reactions)
    if (!completes.length) return
    const target = this.condTarget()
    const chosen =
      completes.find((r) => r.when.type === 'complete' && r.when.if && evaluateCondition(r.when.if, target)) ??
      completes.find((r) => r.when.type === 'complete' && !r.when.if)
    if (chosen) this.runSettlementActions(node, chosen.do)
  }

  private mountLayoutFor(el: OverlayInstanceChild): Layout | undefined {
    const node = this.nodes.get(el.source.nodeId)
    const mount = nodeOverlayMounts(node).find((m) => overlayMountId(m) === el.source.mountId)
    if (!mount) return undefined
    const mountLayout = mount.layout && !layoutIsEffectivelyEmpty(mount.layout)
      ? mount.layout
      : undefined
    return resolveMountLayoutForChildren(
      mountLayout,
      resolveMountChildren(this.scenario.ui?.overlays, mount).map((child) => child.layout),
    )
  }

  private emitRenderOverlay(d: RenderOverlayDirective, el: OverlayInstanceChild): void {
    this.emit({
      ...d,
      mountId: d.mountId ?? el.source.mountId,
      mountLayout: d.mountLayout ?? this.mountLayoutFor(el),
      childLayout: d.childLayout ?? el.layout,
    } as RenderOverlayDirective & { mountId: string })
  }

  // ── 元素派发 ────────────────────────────────────────────────────────────────
  private runElement(el: OverlayInstanceChild): void {
    this.fired.add(el.id)
    // 组件出现（mount）→ 触发 shown 生命周期反应（每节点访问首次）。
    if (!this.shownChildren.has(el.id)) {
      this.shownChildren.add(el.id)
      this.fireLifecycle('shown', el)
      if (this.redirect) return
    }
    // 全部组件统一 renderOverlay；expr 等绘制时 resolve（见 floatText / battleHpBar）。
    this.emitRenderOverlay({
      type: 'renderOverlay',
      nodeId: this.state.currentNodeId ?? '',
      elementId: el.id,
      component: el.component,
      inputs: el.inputs,
    }, el)
  }

  /** 离开节点前跑 exit 相位 reactions（副作用）+ 仍可见组件的 hidden 生命周期。 */
  private runExit(node: GameNode): void {
    this.inExit = true
    this.applyPhaseReactionEffects(node, 'exit')
    // 离场：本节点仍显示、未触发 hidden 的组件，统一 unmount → 触发 hidden。
    for (const el of this.childrenOf(node)) {
      if (this.shownChildren.has(el.id) && !this.hiddenFired.has(el.id)) {
        this.hiddenFired.add(el.id)
        this.fireLifecycle('hidden', el)
      }
    }
    this.inExit = false
    // 床轨在这里**什么都不做**（D5）：v2 里「离开节点」不再是结束信号，配了就一直播。
    // 结束只有两个来源：别处 `mode: 'stop'`（applyNodeBgm）、`jump`/清局（unwindBgmToDocBed）。
  }

  /** 若有待消费的 redirect（watch/lifecycle advance），跑当前节点 exit 后即时跳转。返回是否跳转。 */
  private consumeRedirect(): boolean {
    if (!this.redirect) return false
    const { route, resetGlobals } = this.redirect
    this.redirect = null
    const cur = this.node(this.state.currentNodeId)
    // 与普通 traverse 保持同一份可视化事实：显式结算/条件推进同样是一条真实走过的边。
    this.emit({
      type: 'routeInfo',
      via: route.edge.sourceHandle ?? 'default',
      target: route.edge.target,
      reason: describeCondition(route.edge.data?.condition, this.condTarget()),
    })
    this.state.traversedEdgeIds.add(route.edge.id)
    // 硬打断会清掉边所属作用域之下的调用帧，但那是局内路径 → BGM 栈原样，等某处 `mode: 'stop'`。
    // `resetGlobals` 这一路**目前没有任何调用方**：`this.redirect` 只在一处赋值，且只写 route。
    // 留着这两个分支纯粹是
    // 为了与紧邻的 `if (resetGlobals) this.resetGlobalsState()` 成对——真有人开始写这个字段时，
    // 「状态回 initState」与「床轨按 scenario.bgm 重 derive」必须同时发生，少一个就是半清局。
    if (resetGlobals) this.unwindBgmToDocBed(true)
    if (cur) this.runExit(cur)
    this.setPhase('playing')
    if (resetGlobals) this.resetGlobalsState()
    // 硬打断切到边所属图，并只清掉该作用域之下的调用帧。
    this.state.callStack = this.state.callStack.slice(0, route.frameIndex)
    this.returningTo.clear()
    this.switchGraph(route.graph)
    this.activeBlueprintId = route.blueprintId
    this.activeGraphPath = [...route.graphPath]
    this.enterNode(route.edge.target)
    return true
  }

  /**
   * 施加 effect 并推进响应式条件。返回**最后一个 effect 条目**的观测变化，供同一 do 内其后的
   * spawn 以 `prev` / `next` / `delta` 读取；`flag` / `item` 无数值目标时返回 undefined。
   * 采样夹在 applyEffects 两侧，因此不含 checkReactiveConditions 级联带来的后续改动。
   */
  private applyAndReact(effects: GraphEffect[]): EffectWrite | undefined {
    const target = effects[effects.length - 1]
    const prev = target ? effectTargetValue(this.state, target) : null
    applyEffects(this.state, effects)
    const next = target && prev != null ? effectTargetValue(this.state, target) : null
    this.emit({ type: 'stateChanged' })
    this.checkReactiveConditions()
    return prev == null || next == null ? undefined : { prev, next, delta: next - prev }
  }

  // ── 响应式条件结算（pull-diff 于写屏障）──────────────────────────────────────
  private evalCtx(locals?: Record<string, number>): EvalCtx {
    return {
      vars: this.state.vars,
      entities: this.state.entities,
      flags: this.state.flags,
      formulas: this.state.formulas,
      score: this.state.score,
      rng: this.state.rng,
      ...(locals ? { locals } : {}),
    }
  }

  private safeEval(expr: string, locals?: Record<string, number>): number {
    try {
      return evalExpr(expr, this.evalCtx(locals))
    } catch {
      return 0
    }
  }

  /**
   * 当前作用域内的 watch / state 条件反应，带稳定 key：
   * 当前节点 + 各挂载 + **调用栈上的子流程容器节点**（容器级 watch 覆盖整段子流程，
   * 如「我方回合」容器上的 watch 在其技能子节点执行期间仍生效）。
   */
  private activeReactiveConditions(): Array<{ key: string; r: Reaction; scope: GraphScope; owner: GameNode }> {
    const out: Array<{ key: string; r: Reaction; scope: GraphScope; owner: GameNode }> = []
    const node = this.node(this.state.currentNodeId)
    if (node) {
      ;(node.data.reactions ?? []).forEach((r, i) => {
        if (r.when.type === 'watch' || r.when.type === 'state') out.push({ key: `n:${node.id}#${i}`, r, scope: this.activeScope(), owner: node })
      })
      nodeOverlayMounts(node).forEach((m) => {
        const mid = overlayMountId(m)
        ;(m.reactions ?? []).forEach((r, i) => {
          if (r.when.type === 'watch' || r.when.type === 'state') out.push({ key: `m:${node.id}:${mid}#${i}`, r, scope: this.activeScope(), owner: node })
        })
      })
    }
    // 调用栈上的容器（我方回合/敌方回合/子蓝图）：其数值反应在整段子流程内生效。
    this.state.callStack.forEach((frame, d) => {
      const container = frame.returnGraph.nodes.find((n) => n.id === frame.callerNodeId)
      ;(container?.data.reactions ?? []).forEach((r, i) => {
        if (container && (r.when.type === 'watch' || r.when.type === 'state')) {
          out.push({ key: `c${d}:${frame.callerNodeId}#${i}`, r, scope: this.frameScope(d), owner: container })
        }
      })
    })
    return out
  }

  /** 进入节点时建立基线（不触发），使本节点内后续的变化或条件成立才 fire。 */
  private seedReactiveConditions(): void {
    for (const { key, r } of this.activeReactiveConditions()) {
      if (r.when.type === 'watch') this.numericReactionPrev.set(key, this.safeEval(r.when.of))
      else if (r.when.type === 'state') this.stateConditionPrev.set(key, evaluateCondition(r.when.condition, this.condTarget()))
    }
  }

  /** 写屏障后重采样：watch 按变化方向命中；state 仅在 false → true 时命中。 */
  private checkReactiveConditions(): void {
    if (this.inExit || this.state.phase === 'ended') return
    for (const { key, r, scope, owner } of this.activeReactiveConditions()) {
      if (r.when.type === 'watch') {
        const next = this.safeEval(r.when.of)
        if (!this.numericReactionPrev.has(key)) {
          this.numericReactionPrev.set(key, next)
          continue
        }
        const prev = this.numericReactionPrev.get(key)!
        if (next === prev) continue
        const on = r.when.on ?? 'change'
        const fire = on === 'inc' ? next > prev : on === 'dec' ? next < prev : true
        // 先更新基线再跑 do，避免 do 内改状态导致自触发。
        this.numericReactionPrev.set(key, next)
        if (!fire) continue
        this.runReactiveActions(r.do, { prev, next, delta: next - prev }, scope, owner)
      } else if (r.when.type === 'state') {
        const next = evaluateCondition(r.when.condition, this.condTarget())
        if (!this.stateConditionPrev.has(key)) {
          this.stateConditionPrev.set(key, next)
          continue
        }
        const prev = this.stateConditionPrev.get(key)!
        this.stateConditionPrev.set(key, next)
        if (prev || !next) continue
        this.runReactiveActions(r.do, undefined, scope, owner)
      }
      if (this.redirect) return
    }
  }

  /** watch / shown / hidden / 非阻塞 emit 的 do：advance 可立即 redirect，也可锁定路线等待结算点。 */
  private runReactiveActions(
    actions: NodeAction[],
    locals?: Record<string, number>,
    scope = this.activeScope(),
    owner = this.node(this.state.currentNodeId),
  ): void {
    for (const a of actions) {
      if (a.kind === 'effect') {
        if (a.effects.length) this.applyAndReact(a.effects)
      } else if (a.kind === 'spawn') {
        this.doSpawn(a, locals)
      } else if (a.kind === 'hideOverlay') {
        this.doHideOverlay(a, owner)
      } else if (a.kind === 'advance') {
        // exit 期不接受 advance（避免与正在进行的 consumeRedirect 自跳环）。
        if (!this.redirect && !this.inExit) {
          const route = this.scopedEdgeInScope(a.edgeId, scope)
          if (route) {
            this.requestReactionRoute(route)
            return
          }
        }
      }
      if (this.redirect) return
    }
  }

  private resolveBind(value: unknown, locals?: Record<string, number>): unknown {
    if (value && typeof value === 'object') {
      const o = value as Record<string, unknown>
      // 数值绑定：`{ expr }`（走 expr 求值，返回数字）。
      if (typeof o.expr === 'string') return this.safeEval(o.expr, locals)
      // 标识/字符串绑定：`{ ref }`（如 entity.<id>.name，随实体改名动态取；不写死）。
      if (typeof o.ref === 'string') return this.resolveRef(o.ref)
    }
    return value
  }

  /**
   * 解析非数值引用（字符串场景，如实体名）。名字取自 scenario.entities（作者可改），非落盘写死。
   * 支持：entity.<id>.name / entity.<id>.attr.<a>(数字) / var.<id> / score。
   */
  private resolveRef(ref: string): unknown {
    const p = ref.split('.')
    if (p[0] === 'entity') {
      const id = p[1] ?? ''
      if (p[2] === 'name') return this.scenario.entities?.[id]?.name ?? id
      if (p[2] === 'attr' && p[3]) return this.state.entities[id]?.attrs[p[3]] ?? 0
      return id
    }
    if (p[0] === 'var') return this.state.vars[p.slice(1).join('.')] ?? 0
    if (p[0] === 'score') return this.state.score
    return ref
  }

  /** 主动刷出一个 overlay 组件模板实例（瞬态；ttl 到点自动移除）。 */
  private doSpawn(action: Extract<NodeAction, { kind: 'spawn' }>, locals?: Record<string, number>): void {
    const nodeId = this.state.currentNodeId
    if (!nodeId) return
    const slash = action.from.indexOf('/')
    const overlayId = slash >= 0 ? action.from.slice(0, slash) : action.from
    const childId = slash >= 0 ? action.from.slice(slash + 1) : ''
    const tpl = this.scenario.ui?.overlays?.[overlayId]?.children.find((c) => c.id === childId)
    // 模板默认 + spawn 覆盖，合并后统一 resolveBind：{expr}(数值) / {ref}(实体名等) 均在此就地求值成具体值。
    const merged: Record<string, unknown> = { ...(tpl?.inputs ?? {}), ...(action.inputs ?? {}) }
    const inputs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(merged)) inputs[k] = this.resolveBind(v, locals)
    const component = tpl?.component ?? overlayId
    const layout: Layout | undefined = action.layout ?? (tpl?.layout && !layoutIsEffectivelyEmpty(tpl.layout) ? tpl.layout : undefined)
    const elementId = `spawn:${++this.spawnSeq}`
    this.emit({
      type: 'renderOverlay',
      nodeId,
      mountId: elementId,
      mountLayout: layout,
      elementId,
      component,
      inputs,
    })
    if (action.ttlMs && action.ttlMs > 0) {
      this.pendingSpawns.push({
        elementId,
        nodeId,
        removeAtMs: this.state.elapsedMs + action.ttlMs,
      })
    }
  }

  /** 隐藏作者已挂载在节点上的整组界面；只处理当前已出现的 child，重复调用保持幂等。 */
  private doHideOverlay(action: Extract<NodeAction, { kind: 'hideOverlay' }>, owner?: GameNode | null): void {
    if (!owner) return
    const hidden = nodeOverlayChildren(this.scenario, owner).filter((element) => (
      element.source.mountId === action.mountId
      && this.shownChildren.has(element.id)
      && !this.hiddenFired.has(element.id)
    ))
    if (!hidden.length) return

    // 先移除整组并锁定 hidden，再触发生命周期，避免首个 child 的跳转让同挂载的其余 child 残留。
    for (const element of hidden) {
      this.hiddenFired.add(element.id)
      this.emit({ type: 'removeOverlay', nodeId: owner.id, elementId: element.id })
    }
    for (const element of hidden) {
      this.fireLifecycle('hidden', element, owner)
      if (this.redirect) return
    }
  }

  /** 到点回收 ttl 到期的 spawn 叠层。 */
  private reapSpawns(elapsedMs: number): void {
    if (!this.pendingSpawns.length) return
    const nodeId = this.state.currentNodeId
    const keep: typeof this.pendingSpawns = []
    for (const s of this.pendingSpawns) {
      if (s.nodeId === nodeId && elapsedMs >= s.removeAtMs) {
        this.emit({ type: 'removeOverlay', nodeId: s.nodeId, elementId: s.elementId })
      } else {
        keep.push(s)
      }
    }
    this.pendingSpawns = keep
  }

  // ── 组件生命周期（shown / hidden）─────────────────────────────────────────────
  /** `of` 是否指向该运行态 child（支持 childId / mountId-overlayId/childId / 运行态全 id）。 */
  private matchOf(of: string, el: OverlayInstanceChild): boolean {
    const s = el.source
    return (
      of === s.childId ||
      of === el.id ||
      of === `${s.mountId}/${s.childId}` ||
      of === `${s.overlayId}/${s.childId}`
    )
  }

  private lifecycleReactions(node: GameNode, kind: 'shown' | 'hidden', el: OverlayInstanceChild): Reaction[] {
    const out: Reaction[] = []
    for (const r of node.data.reactions ?? []) {
      if (r.when.type === kind && this.matchOf(r.when.of, el)) out.push(r)
    }
    for (const m of nodeOverlayMounts(node)) {
      for (const r of m.reactions ?? []) {
        if (r.when.type === kind && this.matchOf(r.when.of, el)) out.push(r)
      }
    }
    return out
  }

  private fireLifecycle(kind: 'shown' | 'hidden', el: OverlayInstanceChild, owner?: GameNode | null): void {
    const node = owner ?? this.node(this.state.currentNodeId)
    if (!node) return
    for (const r of this.lifecycleReactions(node, kind, el)) {
      this.runReactiveActions(r.do, undefined, this.scopeForElement(el), node)
      if (this.redirect) return
    }
  }

  // ── 出口选择 / 边遍历 ───────────────────────────────────────────────────────
  private activeScope(): GraphScope {
    return {
      graph: this.activeGraph,
      blueprintId: this.activeBlueprintId,
      graphPath: [...this.activeGraphPath],
      frameIndex: this.state.callStack.length,
    }
  }

  private frameScope(index: number): GraphScope {
    const frame = this.state.callStack[index]!
    return {
      graph: frame.returnGraph,
      blueprintId: frame.returnBlueprintId,
      graphPath: [...frame.returnGraphPath],
      frameIndex: index,
    }
  }

  private scopedEdgeInScope(id: string, scope: GraphScope): ScopedEdge | undefined {
    const edge = scope.graph.edges.find((candidate) => candidate.id === id)
    return edge ? { ...scope, edge } : undefined
  }

  /** 从候选边里选一条：有条件者按序求值，命中优先；否则无条件兜底；多条候选皆带 weight 则加权随机。 */
  private pickEdge(edges: GameEdge[]): GameEdge | undefined {
    if (edges.length === 0) return undefined
    const conditioned = edges.filter((e) => e.data?.condition)
    const uncond = edges.filter((e) => !e.data?.condition)
    const passing = conditioned.filter((e) => evaluateCondition(e.data?.condition, this.condTarget()))
    const pool = passing.length > 0 ? passing : uncond
    if (pool.length === 0) return undefined
    if (pool.length > 1 && pool.every((e) => e.data?.weight !== undefined)) return this.pickWeighted(pool)
    return pool[0]
  }

  /** 是否存在非 default 的 event 出边（声明式等待：演出结束不自动推进）。 */
  private hasEventHandleOutEdges(nodeId: string): boolean {
    return (this.outgoing.get(nodeId) ?? []).some(
      (e) => e.sourceHandle != null && e.sourceHandle !== 'default',
    )
  }

  /** 自动推进：默认出口（sourceHandle === 'default' 或缺省）。 */
  private selectAutoEdge(nodeId: string): GameEdge | undefined {
    return this.pickEdge(
      (this.outgoing.get(nodeId) ?? []).filter((e) => e.sourceHandle === undefined || e.sourceHandle === 'default'),
    )
  }

  private selectHandleEdgeInScope(scope: GraphScope, nodeId: string, handle: string): ScopedEdge | undefined {
    const edge = this.pickEdge(scope.graph.edges.filter(
      (candidate) => candidate.source === nodeId && (candidate.sourceHandle ?? 'default') === handle,
    ))
    return edge ? { ...scope, edge } : undefined
  }

  private pickWeighted(edges: GameEdge[]): GameEdge {
    const total = edges.reduce((s, e) => s + (e.data?.weight ?? 1), 0)
    let r = (this.state.rng?.next() ?? 0) * total
    for (const e of edges) {
      r -= e.data?.weight ?? 1
      if (r < 0) return e
    }
    return edges[edges.length - 1] as GameEdge
  }

  private advanceAuto(): void {
    const nodeId = this.state.currentNodeId
    if (!nodeId) return
    // 收尾副作用（complete reactions）先施加，再由边决定走向；副作用可能触发 watch advance 改道。
    const curNode = this.nodes.get(nodeId)
    if (curNode) {
      this.applyCompleteReactionEffects(curNode)
      if (this.consumeRedirect()) return
    }
    const pending = this.pendingRoute?.settleNodeId === nodeId ? this.pendingRoute : null
    this.pendingRoute = null
    if (pending) {
      this.traverseEventEdge(pending.route)
      return
    }
    const edge = this.selectAutoEdge(nodeId)
    if (!edge) {
      // 声明式等待：仅有 event 出边、无 default → 停在本节点等组件 emit（不结束本局）。
      if (this.hasEventHandleOutEdges(nodeId)) return
      // 无自动出边 + 调用栈非空 → 弹回 caller（subProcess / subFlowPack）；回环用显式边。
      const node = this.nodes.get(nodeId)
      if (this.state.callStack.length > 0) {
        const frame = this.state.callStack.pop() as CallFrame
        if (node) this.runExit(node)
        // 弹帧对 BGM **什么都不做**（§4.2 末行）：层不绑 `callStack`，照 D5 一直播。
        this.returningTo.add(frame.callerNodeId) // 弹回容器时跳过 subProcess 再下钻
        this.switchGraph(frame.returnGraph)
        this.activeBlueprintId = frame.returnBlueprintId
        this.activeGraphPath = [...frame.returnGraphPath]
        this.enterNode(frame.callerNodeId)
        return
      }
      this.finishEnd(nodeId)
      return
    }
    this.traverse(edge)
  }

  private traverse(edge: GameEdge): void {
    // 记录"为什么进入下一节点"：命中的边 + 条件（含求值时实时值），在应用边副作用前取值。
    this.emit({
      type: 'routeInfo',
      via: edge.sourceHandle ?? 'default',
      target: edge.target,
      reason: describeCondition(edge.data?.condition, this.condTarget()),
    })
    this.state.traversedEdgeIds.add(edge.id)
    const cur = this.node(this.state.currentNodeId)
    if (cur) this.runExit(cur)
    this.enterNode(edge.target)
  }

  /** 锁定首个延迟选择；返回 true 表示应等待节点的统一结算点。 */
  private deferRouteUntilSettlement(scoped: ScopedEdge): boolean {
    const edge = scoped.edge
    if (edge.data?.transition !== 'onSettlement' || this.routingSettled) return false
    if (!this.pendingRoute && this.state.currentNodeId) {
      this.pendingRoute = { settleNodeId: this.state.currentNodeId, route: scoped }
    }
    return true
  }

  /** 结算/响应动作：立即边保持既有 redirect 顺序；延迟边等待统一结算点。 */
  private requestReactionRoute(scoped: ScopedEdge): void {
    if (!this.deferRouteUntilSettlement(scoped)) this.redirect = { route: scoped }
  }

  /** 事件边：立即跳转，或锁定首个选择等待节点统一结算。 */
  private requestEventRoute(scoped: ScopedEdge): boolean {
    if (this.deferRouteUntilSettlement(scoped)) return false
    this.traverseEventEdge(scoped)
    return true
  }

  /** 保留容器挂载事件从容器边离开时清调用栈的既有语义。 */
  private traverseEventEdge(scoped: ScopedEdge): void {
    const { edge } = scoped
    if (scoped.graph !== this.activeGraph) {
      const cur = this.node(this.state.currentNodeId)
      if (cur) this.runExit(cur)
      this.state.callStack = this.state.callStack.slice(0, scoped.frameIndex)
      this.returningTo.clear()
      this.switchGraph(scoped.graph)
      this.activeBlueprintId = scoped.blueprintId
      this.activeGraphPath = [...scoped.graphPath]
      this.emit({
        type: 'routeInfo',
        via: edge.sourceHandle ?? 'default',
        target: edge.target,
        reason: describeCondition(edge.data?.condition, this.condTarget()),
      })
      this.state.traversedEdgeIds.add(edge.id)
      this.enterNode(edge.target)
      return
    }
    this.traverse(edge)
  }

  private finishEnd(_nodeId: string): void {
    // 无出边且调用栈空 → 本局结束。引擎只负责把相位切到 ended，不强制任何结局文案；
    // 胜负/结局表现完全交给节点 overlay 与图规则（reactions），配了什么才演什么。
    this.setPhase('ended')
    this.pendingRoute = null
  }
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    vars: { ...state.vars },
    varMeta: state.varMeta
      ? Object.fromEntries(Object.entries(state.varMeta).map(([key, meta]) => [key, { ...meta }]))
      : undefined,
    entities: Object.fromEntries(Object.entries(state.entities).map(([id, entity]) => [id, {
      attrs: { ...entity.attrs },
      attrMeta: entity.attrMeta
        ? Object.fromEntries(Object.entries(entity.attrMeta).map(([key, meta]) => [key, { ...meta }]))
        : undefined,
    }])),
    flags: { ...state.flags },
    score: state.score,
    items: state.items ? { ...state.items } : undefined,
    rng: state.rng ? createRng(state.rng.getState().seed, state.rng.getState().step) : undefined,
    appliedOnce: state.appliedOnce ? new Set(state.appliedOnce) : undefined,
    currentNodeId: state.currentNodeId,
    phase: state.phase,
    elapsedMs: state.elapsedMs,
    visited: new Set(state.visited),
    traversedEdgeIds: new Set(state.traversedEdgeIds),
    callStack: state.callStack.map((frame) => ({
      ...frame,
      returnGraphPath: [...frame.returnGraphPath],
    })),
    log: [...state.log],
  }
}

function cloneScopedEdge(route: ScopedEdge): ScopedEdge {
  return {
    ...route,
    graphPath: [...route.graphPath],
  }
}

function cloneRedirect(
  redirect: { route: ScopedEdge; resetGlobals?: boolean } | null,
): { route: ScopedEdge; resetGlobals?: boolean } | null {
  return redirect ? { ...redirect, route: cloneScopedEdge(redirect.route) } : null
}

function clonePendingRoute(
  pending: { settleNodeId: string; route: ScopedEdge } | null,
): { settleNodeId: string; route: ScopedEdge } | null {
  return pending ? { ...pending, route: cloneScopedEdge(pending.route) } : null
}

function control(): Omit<RuntimeState, keyof MutableState> {
  return {
    currentNodeId: null,
    phase: 'idle',
    elapsedMs: 0,
    visited: new Set<string>(),
    traversedEdgeIds: new Set<string>(),
    callStack: [],
    log: [],
  }
}
