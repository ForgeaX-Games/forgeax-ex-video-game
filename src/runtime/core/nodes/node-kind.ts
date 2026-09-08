/**
 * 节点运行时契约（NodeKind）+ 注册表 —— flow 执行的「节点层」标准化。
 *
 * 设计见 `docs/node-runtime-spec.md`。要点：
 * - 引擎是**调度层**（callStack/redirect/phase/走边/switchGraph/checkRules/tick(at·window)…）；
 * - NodeKind 是**节点层**：只描述「进入即执行(execute)」和「被时间驱动唤醒后怎么走(next)」，返回 `NextIntent`；
 * - 节点**不碰** callStack/phase/redirect/边，只返回意图，由引擎执行；
 * - 判别符 = `GameNode.type`，回退 `perf`（当前 subProcess/subFlowPack 由 data 字段派生）。
 * 新增节点类型 = 在本目录加一个文件实现 NodeKind + 在 index 的 CORE_NODE_KINDS 注册即可；
 *   `GameNodeType` 是开放联合、合法集合以本注册表为 SSOT，无需回改 schema（validate.ts 据注册表查未知 type）。
 */
import type { GameGraph, GameNode } from '../schema/graph-schema'
import { getSubFlowPack, getSubProcess } from '../schema/graph-schema'
import type { OverlayInstanceChild } from '../schema/node-config-schema'
import type { MutableState } from '../engine/apply-effects'
import type { RuntimeDirective } from '../engine/directives'

/**
 * 节点执行后的「走向意图」——引擎据此走边/挂起/下钻（节点不自己动栈与相位）。
 * 注：**结束与弹回都无需专门意图**，皆由 `advance` 自然涌现——`advanceAuto` 走到「无自动出边」时，
 * 有 event 出边则声明式等待 emit；否则有调用栈则 pop 弹回 caller、栈空则 `finishEnd`。
 */
export type NextIntent =
  | { kind: 'advance' }                                 // 沿默认出边推进（无边：event 边则等待；有栈则弹回；栈空则结束）
  | { kind: 'await' }                                   // 挂起：等媒体/时钟/组件 event
  | { kind: 'descend'; entry: string; graph?: GameGraph } // 下钻子流程(同图)/子蓝图(带 graph 切图)

/**
 * 引擎提供给 NodeKind 的受控上下文。节点通过这里发指令/跑元素/读调度态，
 * 不能直接改 callStack/phase/redirect。
 */
export interface NodeRuntimeCtx {
  readonly node: GameNode
  readonly state: MutableState
  readonly elapsedMs: number
  /** 是否由子流程/子蓝图弹回本容器（弹回不重播，直接续 out）。 */
  readonly returning: boolean
  /** 是否有待消费的 redirect（state 规则 / 组件 event advance 的硬打断）。 */
  readonly redirected: boolean
  emit(d: RuntimeDirective): void
  childrenOf(node: GameNode): OverlayInstanceChild[]
  runElement(el: OverlayInstanceChild): void
  /** perf 进入即调：重置本节点态 + 条件基线 + 发 playClip(换片清叠层) + 相位置 playing。 */
  beginPerform(): void
  /** 容器弹回即调：重置 fired + 相位置 playing（不重播演出）。 */
  beginResume(): void
  /** 施加 enter 相位 reactions 的副作用。 */
  applyEnterReactions(node: GameNode): void
  /** 瞬时节点：无 media、无 durationMs、无可 emit 事件的组件 → 进入即可推进。 */
  isInstant(node: GameNode): boolean
  /** 解析子蓝图包入口 + 其图（subflowPack 用）；缺失返回 undefined。 */
  resolvePackEntry(node: GameNode): { entry: string; graph: GameGraph } | undefined
}

/** 节点类型契约：type + execute（必）+ next（可选，缺省 advance）。 */
export interface NodeKind {
  type: string
  /** 初始化 + 执行 + 首个走向意图。同步节点一次出结果；perf 有 media/事件组件返回 { kind:'await' }。 */
  execute(ctx: NodeRuntimeCtx): NextIntent
  /** 被引擎时间驱动（媒体播完/时长到点）唤醒后如何走；缺省 = advance。 */
  next?(ctx: NodeRuntimeCtx): NextIntent
}

/**
 * 节点类型判别：subFlowPack / subProcess 由 data 字段派生优先；否则用 `node.type`。
 */
export function resolveNodeType(node: GameNode): string {
  if (getSubFlowPack(node.data)) return 'subflowPack'
  if (getSubProcess(node.data)) return 'subProcess'
  return node.type ?? 'perf'
}

/** 可注入的节点类型注册表（每局引擎持一份即可隔离）。 */
export class NodeKindRegistry {
  private readonly kinds = new Map<string, NodeKind>()
  register(kind: NodeKind): void {
    this.kinds.set(kind.type, kind)
  }
  get(type: string): NodeKind | undefined {
    return this.kinds.get(type)
  }
  /** 按节点解析出 NodeKind：resolveNodeType → 查表 → 回退 perf。 */
  resolve(node: GameNode): NodeKind | undefined {
    return this.kinds.get(resolveNodeType(node)) ?? this.kinds.get('perf')
  }
}
