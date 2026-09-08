/**
 * GraphSession —— 引擎(GraphRuntime) 与 UI 之间的**视图模型控制器**（纯 TS，可 headless 单测）。
 *
 * 职责：驱动引擎、消费其产出的泛型 directive，维护一份「随时可渲染的快照」SessionSnapshot：
 * 当前演出片段 / 活动叠层 / HUD 数值 / 执行态(供蓝图可视化)。
 * React Player 只需订阅 snapshot 渲染 + 把玩家事件回灌 emitEvent()——UI 与引擎彻底解耦。
 */
import type { GameGraph, GameNode, GameScenario, GraphLibraryDocument, SubFlowPackDef } from '../schema/graph-schema'
import type { Layout } from '../schema/node-config-schema'
import { GraphRuntime, type GraphRuntimeCheckpoint } from './engine'
import {
  defaultComponentRegistry,
  type ComponentRegistry,
} from '../registry/component-registry'
import { installLocalComponentManifests } from '../component-catalog'
import type { RuntimeDirective } from './directives'
import type { BgmPlaybackCommand } from './bgm-stack'

/** GraphSession 构造选项：可注入自定义注册表；缺省共用 bootComponents 的默认表。 */
export interface GraphSessionOptions {
  components?: ComponentRegistry
  /** 测试注入依赖表。缺省用 `scenario.manifest.packs`。 */
  packs?: readonly SubFlowPackDef[]
  /** 试玩根蓝图 id；缺省 `manifest.mainPackId` 或 `__root__`。 */
  rootBlueprintId?: string
  /** 本会话的确定性随机种子；缺省 0，宿主的新游戏入口应显式生成。 */
  rngSeed?: number
}

const MAX_LOGS = 60

/** 把引擎指令转成运行日志一行（对齐旧试玩「运行日志」）。 */
function logLine(d: RuntimeDirective): string | undefined {
  switch (d.type) {
    case 'playClip':
      return `▶ 进入「${d.name}」${d.loop ? ' (Loop)' : ''}`
    case 'renderOverlay':
      return `✦ ${d.component}`
    case 'routeInfo':
      return `↳ 走「${d.via}」→ ${d.target}：${d.reason}`
    // 床轨的失败样子是「没声」/「点了结束没反应」，光看节点流水看不出所以然；这一行是唯一的线索。
    // `restart: false` = 同一首接着播（战斗多回合靠它不断曲），值得和「重头起播」分开显示。
    case 'bgm':
      return d.ref === null
        ? '♪ 停播'
        : `♪ ${d.restart ? '起播' : '续播'} ${d.ref}`
    case 'log':
      return d.message
    default:
      return undefined
  }
}

export interface ClipSnap {
  nodeId: string
  name: string
  mediaId?: string
  loop: boolean
  durationMs?: number
}
export interface OverlaySnap {
  elementId: string
  component: string
  inputs: Record<string, unknown>
}

export interface OverlayChildSnap {
  elementId: string
  component: string
  inputs: Record<string, unknown>
  /** 子组件级排版（相对挂载盒）→ CSS。 */
  childLayout?: Layout
}

/** 一份 overlay 挂载的运行态视图（挂载盒 + 其内可见子组件）。 */
export interface OverlayMountSnap {
  mountId: string
  /** 挂载级排版（相对视频舞台；节点 overlayNodes[].layout）。 */
  mountLayout?: Layout
  children: OverlayChildSnap[]
}
export interface HudEntitySnap {
  /** 实体显示名，供挂载态组件做字符串绑定。 */
  name?: string
  /** 约定便捷字段（= attrs.hp / attrMeta.hp.max）。 */
  hp: number
  maxHp: number
  /** 全量 attrs，供 HUD 绑定非 hp 属性。 */
  attrs: Record<string, number>
  /** attr → max（来自 attrMeta.max；无则回退当前值）。 */
  attrMax: Record<string, number>
  /** attr → 本局初始值；覆盖物用它把运行时变化量投影到作者配置的显示基线。 */
  initialAttrs?: Record<string, number>
}
export interface HudSnap {
  entities: Record<string, HudEntitySnap>
  vars: Record<string, number>
  textVars?: Record<string, string>
  flags: Record<string, number>
  score: number
}
export interface CallStackFrameSnap {
  blueprintId: string
  callerNodeId: string
  graphPath: string[]
  title?: string
}
/**
 * 快照里的床轨指令 = `BgmPlaybackCommand` + **指令序号**。
 *
 * `seq` 存在的唯一理由：`bgm` 是**事件**（「现在换成这样播」），快照是**状态**，而同一条事件
 * 可以逐字段相同——`restart: true` 的回合循环每轮都发一条一模一样的重开指令。壳层要分辨
 * 「引擎又发了一条」与「同一条快照又渲染了一遍」，引用不行（快照过 `postMessage`
 * 序列化后每次都是新对象），字段也不行（上面那条），只有序号行。
 */
export interface BgmSnapshot extends BgmPlaybackCommand {
  seq: number
}

export interface SessionSnapshot {
  phase: string
  currentNodeId: string | null
  clip?: ClipSnap
  /**
   * 本会话内 `playClip` 的单调递增序号。节点 id 只在各自图内唯一，且循环会再次进入同一节点；
   * 播放壳用这个序号区分每一次实际开演。
   */
  clipSeq: number
  /**
   * 床轨此刻该怎么响（= 最近一条 `bgm` 指令的载荷，去掉 type tag、加上 `seq`）。**会话级**：
   * 与 `hud` 同寿，不随 `playClip` / overlay 清理，直到下一条 `bgm` 指令为止。
   *
   * - `null` = 本局还没发过任何 `bgm` 指令（静音起局，见 SPEC §3.1 缺省）。壳层什么也别做——
   *   别拿它当停播令去建音频元素。
   * - 非 `null` 且 `ref === null` = **显式停播**（栈清空 / 弹回静音）：只有 `fadeOutMs` 有意义，
   *   把正响的那条淡出。这条与上面那条 `null` 的区别就是「淡出谁」有没有人交代。
   * - 非 `null` 且有 `ref` = 该 ref 正在（或应当）响；`restart: false` 表示同曲续播，别动播放头。
   */
  bgm: BgmSnapshot | null
  overlayMounts: OverlayMountSnap[]
  hud: HudSnap
  /** 进入当前节点所走的边 + 命中条件（含实时值）；起始节点为 undefined。 */
  entryReason?: string
  visited: string[]
  traversedEdgeIds: string[]
  log: string[]
  activeBlueprintId: string
  activeGraphPath: string[]
  callStack: CallStackFrameSnap[]
}

interface GraphSessionCheckpointData {
  runtime: GraphRuntimeCheckpoint
  snapshot: SessionSnapshot
  pendingEntryReason: string | undefined
  clipSeq: number
  bgmSeq: number
}

/** 编辑器预览使用的内存恢复点；不会写入游戏配置。 */
export interface GraphSessionCheckpoint {
  readonly kind: 'game-video.session-checkpoint.v1'
  readonly payload: unknown
}

export class GraphSession {
  readonly runtime: GraphRuntime
  snapshot: SessionSnapshot
  private readonly nodesById: Map<string, GameNode>
  private readonly blueprintTitles: Map<string, string>
  private readonly entityNames: Record<string, string>
  private pendingEntryReason: string | undefined
  /** 已发出的 `playClip` 指令条数；本局单调递增，作为每次演出的唯一身份。 */
  private clipSeq = 0
  /** 已发出的 `bgm` 指令条数；本局单调递增，作快照里那条指令的身份（见 BgmSnapshot）。 */
  private bgmSeq = 0

  constructor(scenario: GameScenario, opts: GraphSessionOptions = {}) {
    // 缺省共用进程内默认表（内建 + 已 boot 的游戏组件）；调用方自带则假定已装全。
    const components = opts.components ?? installLocalComponentManifests(defaultComponentRegistry)
    const rootId =
      opts.rootBlueprintId
      ?? (scenario as GraphLibraryDocument).manifest?.mainPackId
      ?? '__root__'
    this.blueprintTitles = new Map()
    const manifestPacks = (scenario as GraphLibraryDocument).manifest?.packs
    if (manifestPacks) {
      for (const [id, pack] of Object.entries(manifestPacks)) {
        if (pack.title) this.blueprintTitles.set(id, pack.title)
      }
    }
    // 开跑用根 graph；依赖解析在 GraphRuntime 内走 manifest.packs（或 opts.packs 注入）。
    this.runtime = new GraphRuntime(
      scenario.graph,
      scenario,
      components,
      opts.packs ?? [],
      rootId,
      opts.rngSeed,
    )
    this.nodesById = new Map(scenario.graph.nodes.map((n) => [n.id, n]))
    this.entityNames = Object.fromEntries(
      Object.entries(scenario.entities ?? {}).map(([id, entity]) => [id, entity.name?.trim() || id]),
    )
    this.snapshot = this.freshSnapshot()
  }

  private freshSnapshot(): SessionSnapshot {
    return {
      phase: this.runtime.state.phase,
      currentNodeId: this.runtime.state.currentNodeId,
      clipSeq: 0,
      bgm: null,
      overlayMounts: [],
      hud: this.readHud(),
      visited: [],
      traversedEdgeIds: [],
      log: [],
      activeBlueprintId: this.runtime.getActiveBlueprintId(),
      activeGraphPath: this.runtime.getActiveGraphPath(),
      callStack: this.projectCallStack(),
    }
  }

  private projectCallStack(): CallStackFrameSnap[] {
    return this.runtime.state.callStack.map((f) => ({
      blueprintId: f.returnBlueprintId,
      callerNodeId: f.callerNodeId,
      graphPath: [...f.returnGraphPath],
      title: this.blueprintTitles.get(f.returnBlueprintId),
    }))
  }

  private readHud(): HudSnap {
    const s = this.runtime.state
    const entities: HudSnap['entities'] = {}
    for (const [id, e] of Object.entries(s.entities)) {
      const attrs = { ...e.attrs }
      const attrMax: Record<string, number> = {}
      const initialAttrs: Record<string, number> = {}
      for (const [k, v] of Object.entries(attrs)) {
        attrMax[k] = e.attrMeta?.[k]?.max ?? v
        initialAttrs[k] = e.attrMeta?.[k]?.initial ?? e.attrMeta?.[k]?.max ?? v
      }
      for (const [k, m] of Object.entries(e.attrMeta ?? {})) {
        if (attrMax[k] === undefined && m.max !== undefined) attrMax[k] = m.max
        if (initialAttrs[k] === undefined && m.initial !== undefined) initialAttrs[k] = m.initial
      }
      entities[id] = {
        name: this.entityNames[id] ?? id,
        hp: attrs.hp ?? 0,
        maxHp: e.attrMeta?.hp?.max ?? attrs.hp ?? 0,
        attrs,
        attrMax,
        initialAttrs,
      }
    }
    return {
      entities,
      vars: { ...s.vars },
      textVars: { ...s.textVars },
      flags: { ...s.flags },
      score: s.score,
    }
  }

  // ── 控制（驱动引擎 + 消费指令）────────────────────────────────────────────────
  start(): SessionSnapshot {
    return this.apply(this.runtime.start())
  }
  tick(elapsedMs: number): SessionSnapshot {
    return this.apply(this.runtime.tick(elapsedMs))
  }
  performanceEnd(): SessionSnapshot {
    return this.apply(this.runtime.onPerformanceEnd())
  }
  /** 组件事件（点击 / 判定 / 超时 defaultEvent）→ 跑挂载 reactions，必要时按 handle 找边。 */
  emitEvent(elementId: string, key: string): SessionSnapshot {
    return this.apply(this.runtime.emitComponentEvent(elementId, key))
  }
  /** 点击运行时蓝图节点 → 跳转执行。 */
  jump(
    nodeId: string,
    opts?: { resetGlobals?: boolean; graph?: GameGraph; blueprintId?: string; graphPath?: string[] },
  ): SessionSnapshot {
    return this.apply(this.runtime.jumpToNode(nodeId, opts))
  }

  createCheckpoint(): GraphSessionCheckpoint {
    const payload: GraphSessionCheckpointData = {
      runtime: this.runtime.createCheckpoint(),
      snapshot: cloneSessionSnapshotForCheckpoint(this.snapshot),
      pendingEntryReason: this.pendingEntryReason,
      clipSeq: this.clipSeq,
      bgmSeq: this.bgmSeq,
    }
    return { kind: 'game-video.session-checkpoint.v1', payload }
  }

  restoreCheckpoint(checkpoint: GraphSessionCheckpoint): SessionSnapshot {
    if (checkpoint.kind !== 'game-video.session-checkpoint.v1') {
      throw new Error('unsupported graph session checkpoint')
    }
    const payload = checkpoint.payload as GraphSessionCheckpointData
    this.runtime.restoreCheckpoint(payload.runtime)
    this.snapshot = cloneSessionSnapshotForCheckpoint(payload.snapshot)
    this.pendingEntryReason = payload.pendingEntryReason
    this.clipSeq = payload.clipSeq
    this.bgmSeq = payload.bgmSeq
    return this.cloned()
  }

  /** 当前节点之后可能播放的视频，供 UI 在切换前建立并保留媒体元素。 */
  preloadClips(limit = 4): ClipSnap[] {
    return this.runtime.getPreloadNodes(limit).map((node) => ({
      nodeId: node.id,
      name: node.data.name,
      mediaId: node.data.media?.ref,
      loop: node.data.mediaPlayMode === 'loop',
      durationMs: node.data.durationMs,
    }))
  }

  private apply(dirs: RuntimeDirective[]): SessionSnapshot {
    for (const d of dirs) {
      const line = logLine(d)
      if (line && d.type !== 'log') this.snapshot.log.push(line)
      switch (d.type) {
        case 'routeInfo':
          // 进入下一节点的原因（边 + 条件 + 实时值），在紧随其后的 playClip 落到该节点。
          this.pendingEntryReason = `走「${d.via}」→ ${d.target}：${d.reason}`
          break
        case 'playClip':
          // 新节点开演：换片、清空上一节点的叠层。
          this.clipSeq += 1
          this.snapshot.clipSeq = this.clipSeq
          this.snapshot.clip = {
            nodeId: d.nodeId,
            name: d.name,
            mediaId: d.mediaId,
            loop: d.loop,
            durationMs: d.durationMs,
          }
          this.snapshot.overlayMounts = []
          this.snapshot.entryReason = this.pendingEntryReason
          this.pendingEntryReason = undefined
          break
        case 'renderOverlay': {
          const mountId = d.mountId ?? d.elementId
          let mount = this.snapshot.overlayMounts.find((m) => m.mountId === mountId)
          if (!mount) {
            mount = { mountId, mountLayout: d.mountLayout, children: [] }
            this.snapshot.overlayMounts.push(mount)
          } else if (d.mountLayout) {
            mount.mountLayout = d.mountLayout
          }
          const child: OverlayChildSnap = {
            elementId: d.elementId,
            component: d.component,
            inputs: d.inputs,
            childLayout: d.childLayout,
          }
          const idx = mount.children.findIndex((c) => c.elementId === d.elementId)
          if (idx >= 0) mount.children[idx] = child
          else mount.children.push(child)
          break
        }
        case 'removeOverlay':
          for (const mount of this.snapshot.overlayMounts) {
            mount.children = mount.children.filter((c) => c.elementId !== d.elementId)
          }
          this.snapshot.overlayMounts = this.snapshot.overlayMounts.filter((m) => m.children.length > 0)
          break
        case 'bgm': {
          // 会话级：这里**只**换床轨，不碰 clip / overlayMounts；反之 playClip 也不许清它。
          // `seq` 每条 +1：字段相同的两条重开指令得让壳层看出是两次（见 BgmSnapshot）。
          const { type: _type, ...cmd } = d
          this.bgmSeq += 1
          this.snapshot.bgm = { ...cmd, seq: this.bgmSeq }
          break
        }
        case 'log':
          this.snapshot.log.push(d.message)
          break
        case 'stateChanged':
        case 'hudUpdate':
          this.snapshot.hud = this.readHud()
          break
      }
    }
    if (this.snapshot.log.length > MAX_LOGS) this.snapshot.log = this.snapshot.log.slice(-MAX_LOGS)
    // 同步执行态（供 HUD / 蓝图可视化）
    const s = this.runtime.state
    this.snapshot.phase = s.phase
    this.snapshot.currentNodeId = s.currentNodeId
    this.snapshot.hud = this.readHud()
    this.snapshot.visited = [...s.visited]
    this.snapshot.traversedEdgeIds = [...s.traversedEdgeIds]
    this.snapshot.activeBlueprintId = this.runtime.getActiveBlueprintId()
    this.snapshot.activeGraphPath = this.runtime.getActiveGraphPath()
    this.snapshot.callStack = this.projectCallStack()
    // 返回**新的对象引用**——GraphSession 内部快照是原地累积的，若直接返回同一引用，
    // React 的 setState 会因 Object.is 相等而跳过重渲染（引擎推进了、界面却不更新）。
    return this.cloned()
  }

  /** 快照浅拷贝（关键：给 React 一个新引用触发重渲染）。 */
  private cloned(): SessionSnapshot {
    const s = this.snapshot
    return {
      ...s,
      overlayMounts: s.overlayMounts.map((m) => ({
        ...m,
        children: [...m.children],
      })),
      visited: [...s.visited],
      traversedEdgeIds: [...s.traversedEdgeIds],
      callStack: s.callStack.map((frame) => ({ ...frame, graphPath: [...frame.graphPath] })),
      activeGraphPath: [...s.activeGraphPath],
      log: [...s.log],
      hud: { ...s.hud, entities: { ...s.hud.entities }, vars: { ...s.hud.vars }, flags: { ...s.hud.flags } },
    }
  }
}

function cloneSessionSnapshotForCheckpoint(s: SessionSnapshot): SessionSnapshot {
  return {
    ...s,
    clip: s.clip ? { ...s.clip } : undefined,
    bgm: s.bgm ? { ...s.bgm } : null,
    overlayMounts: s.overlayMounts.map((mount) => ({
      ...mount,
      mountLayout: mount.mountLayout ? { ...mount.mountLayout } : undefined,
      children: mount.children.map((child) => ({
        ...child,
        inputs: { ...child.inputs },
        childLayout: child.childLayout ? { ...child.childLayout } : undefined,
      })),
    })),
    visited: [...s.visited],
    traversedEdgeIds: [...s.traversedEdgeIds],
    callStack: s.callStack.map((frame) => ({ ...frame, graphPath: [...frame.graphPath] })),
    activeGraphPath: [...s.activeGraphPath],
    log: [...s.log],
    hud: {
      ...s.hud,
      entities: Object.fromEntries(Object.entries(s.hud.entities).map(([id, entity]) => [id, {
        ...entity,
        attrs: { ...entity.attrs },
        attrMax: { ...entity.attrMax },
        initialAttrs: entity.initialAttrs ? { ...entity.initialAttrs } : undefined,
      }])),
      vars: { ...s.hud.vars },
      flags: { ...s.hud.flags },
    },
  }
}
