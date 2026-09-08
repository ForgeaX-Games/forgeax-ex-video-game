import type { GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import { isSettlementReaction, type NodeAction, type Reaction } from '@/runtime/core/schema/node-config-schema'
import { applyEffects, type MutableState } from '@/runtime/core/engine/apply-effects'
import { evaluateCondition } from '@/runtime/core/engine/condition'
import { initState } from '@/runtime/core/engine/engine-init'
import { GraphSession, type OverlayMountSnap, type SessionSnapshot } from '@/runtime/core/engine/session'
import { settlementSpawnId } from '../video/settlementSpawnGroups'

function applyEffectActions(state: MutableState, actions: readonly NodeAction[]): void {
  for (const action of actions) {
    if (action.kind === 'effect') applyEffects(state, action.effects)
  }
}

function applyPhase(state: MutableState, reactions: readonly Reaction[], phase: 'enter' | 'exit'): void {
  for (const reaction of reactions) {
    if (reaction.when.type === phase) applyEffectActions(state, reaction.do)
  }
}

/**
 * Project the deterministic node state at a preview playhead.
 * Rebuild from scenario initial state on every call so backward scrubbing never retains future effects.
 */
export function projectNodePreviewState(
  scenario: GameScenario,
  node: GameNode,
  playheadMs: number,
  durationMs: number,
): MutableState {
  const state = initState(scenario)
  const reactions = node.data.reactions ?? []

  applyPhase(state, reactions, 'enter')
  for (const reaction of reactions) {
    if (reaction.when.type === 'at' && reaction.when.ms <= playheadMs) {
      applyEffectActions(state, reaction.do)
    }
  }

  if (playheadMs >= durationMs) {
    const completes = reactions.filter((reaction) => reaction.when.type === 'complete')
    const chosen = completes.find((reaction) => (
      reaction.when.type === 'complete'
      && reaction.when.if
      && evaluateCondition(reaction.when.if, { state, visited: new Set<string>() })
    )) ?? completes.find((reaction) => reaction.when.type === 'complete' && !reaction.when.if)
    if (chosen) applyEffectActions(state, chosen.do)
    applyPhase(state, reactions, 'exit')
  }

  return state
}

/** 能在预览画布上摆位的结算触发面：定时相位 + 条件。事件类界面由组件入口自己管理。 */
const SPAWN_PREVIEW_TRIGGERS = new Set(['at', 'enter', 'watch', 'state'])

export interface NodePreviewSpawn {
  mount: OverlayMountSnap
  /** 节点局部时间；只用于编辑器预览冻结/拖动动画，不进入配置协议。 */
  startedAtMs: number
}

export interface SelectedSettlementSpawnPreview {
  id: string
  settlementIndex: number
  actionIndex: number
  label: string
  mount: OverlayMountSnap
}

/**
 * 选中某个结算时，为作者稳定投影它绑定的界面；不要求该结算此刻已在播放头处真实触发。
 * 定时结算（`at` / 历史 `enter`）与条件结算（`watch` / `state`）走同一条投影，作者因此
 * 能用同一套画布手势给两类结算的界面摆位。
 * 每个动作独立走一次正式 GraphSession，使模板合并、表达式兜底和 layout 解析与运行时一致。
 */
export function projectSelectedSettlementSpawns(
  scenario: GameScenario,
  node: GameNode,
  settlementIndex: number | null | undefined,
): SelectedSettlementSpawnPreview[] {
  if (settlementIndex == null) return []
  const reaction = (node.data.reactions ?? []).filter(isSettlementReaction)[settlementIndex]
  if (!reaction || !SPAWN_PREVIEW_TRIGGERS.has(reaction.when.type)) return []

  return reaction.do.flatMap((action, actionIndex) => {
    if (action.kind !== 'spawn') return []
    const previewNode: GameNode = {
      ...node,
      data: {
        ...node.data,
        durationMs: node.data.durationMs ?? 1,
        overlayNodes: undefined,
        subProcess: undefined,
        subFlowPack: undefined,
        routingSettlement: undefined,
        reactions: [{ when: { type: 'enter' }, do: [action] }],
      },
    }
    const previewScenario: GameScenario = {
      ...scenario,
      graph: { nodes: [previewNode], edges: [] },
    }
    const snapshot = new GraphSession(previewScenario, { rngSeed: 0 }).jump(previewNode.id, {
      resetGlobals: true,
      graph: previewScenario.graph,
      graphPath: [],
    })
    const projected = snapshot.overlayMounts.find((mount) => mount.mountId.startsWith('spawn:'))
    if (!projected) return []
    const id = settlementSpawnId(settlementIndex, actionIndex)
    const overlayId = action.from.split('/')[0] ?? ''
    return [{
      id,
      settlementIndex,
      actionIndex,
      label: scenario.ui?.overlays?.[overlayId]?.title?.trim() || action.from,
      mount: {
        ...projected,
        mountId: id,
        children: projected.children.map((child, childIndex) => ({
          ...child,
          elementId: `${id}:${childIndex}`,
        })),
      },
    }]
  })
}

/**
 * 增量重放当前节点的正式运行时逻辑，给编辑 preview 投影 watch/state 触发的动态界面。
 * 宿主换场景或节点时新建实例；向后拖动会自动从初始态重放。
 */
export class NodePreviewRuntimeProjector {
  private readonly scenario: GameScenario
  private readonly node: GameNode
  private readonly timedBoundaries: number[]
  private session!: GraphSession
  private snapshot!: SessionSnapshot
  private elapsedMs = -1
  private readonly spawnStartMs = new Map<string, number>()

  constructor(scenario: GameScenario, node: GameNode) {
    // 节点 preview 只表现当前节点：运行时仍负责 effect/watch/spawn，但推进不能离开编辑对象。
    const previewNode: GameNode = {
      ...node,
      data: {
        ...node.data,
        // 无视频/显式时长的节点在正式运行时会被视为瞬时节点；编辑 preview 仍需停在该节点投影时间轴。
        durationMs: node.data.durationMs ?? 1,
        routingSettlement: undefined,
        reactions: (node.data.reactions ?? []).map((reaction) => ({
          ...reaction,
          do: reaction.do.filter((action) => action.kind !== 'advance'),
        })),
      },
    }
    this.scenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((candidate) => candidate.id === node.id ? previewNode : candidate),
      },
    }
    this.node = previewNode
    this.timedBoundaries = [...new Set(
      (previewNode.data.reactions ?? [])
        .flatMap((reaction) => reaction.when.type === 'at' ? [Math.max(0, reaction.when.ms)] : []),
    )].sort((a, b) => a - b)
    this.reset()
  }

  project(playheadMs: number): NodePreviewSpawn[] {
    const targetMs = Math.max(0, Math.round(playheadMs))
    if (targetMs < this.elapsedMs) this.reset()

    for (const boundaryMs of this.timedBoundaries) {
      if (boundaryMs <= this.elapsedMs || boundaryMs > targetMs) continue
      this.snapshot = this.session.tick(boundaryMs)
      this.captureSpawnStarts(boundaryMs)
      this.elapsedMs = boundaryMs
    }
    if (targetMs > this.elapsedMs) {
      this.snapshot = this.session.tick(targetMs)
      this.captureSpawnStarts(targetMs)
      this.elapsedMs = targetMs
    }

    return this.snapshot.overlayMounts
      .filter((mount) => mount.mountId.startsWith('spawn:'))
      .map((mount) => ({ mount, startedAtMs: this.spawnStartMs.get(mount.mountId) ?? targetMs }))
  }

  /** 正式运行时在当前播放头仍保留的节点挂载；供基础界面层同步条件隐藏结果。 */
  visibleConfiguredMountIds(): string[] {
    return this.snapshot.overlayMounts
      .filter((mount) => !mount.mountId.startsWith('spawn:'))
      .map((mount) => mount.mountId)
  }

  private reset(): void {
    this.session = new GraphSession(this.scenario, { rngSeed: 0 })
    this.snapshot = this.session.jump(this.node.id, {
      resetGlobals: true,
      graph: this.scenario.graph,
      graphPath: [],
    })
    this.elapsedMs = -1
    this.spawnStartMs.clear()
    this.captureSpawnStarts(0)
  }

  private captureSpawnStarts(atMs: number): void {
    for (const mount of this.snapshot.overlayMounts) {
      if (mount.mountId.startsWith('spawn:') && !this.spawnStartMs.has(mount.mountId)) {
        this.spawnStartMs.set(mount.mountId, atMs)
      }
    }
  }
}
