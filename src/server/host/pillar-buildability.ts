/**
 * 支柱可执行性的构造式证明：Host 在作者确认前，用**下游那套真代码**按最小方案
 * 把这份支柱画一遍。画得出来才放行。
 *
 * 为什么不是再写一批支柱期规则：点状规则会和总脉络的规则漂移，而漂移出来的缺口
 * 恰好就是 09-03 / 09-04 / 09-07 三次死锁的共同形状——支柱过了门、下游画不出来、
 * 且不存在任何合法工具调用序列能救回来。这里复用 `createBlueprintOutlineSkeleton`
 * 和 `configureBlueprintOutlineNode` 本身，所以总脉络以后新增的任何约束都自动
 * 变成支柱期闸门，不需要在两处各维护一份。
 *
 * 最小方案是**存在性证明**，不是建议方案：它只回答「至少存在一种画法」，
 * 总脉络仍然可以按叙事需要铺更多章节。
 */
import { documentFromBlueprints, emptyBlueprintDoc, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import {
  configureBlueprintOutlineNode,
  createBlueprintOutlineSkeleton,
} from '@/authoring/commands/progressive-blueprint-outline'
import type {
  CompactOutlineActionIntent,
  CompactOutlineChapterIntent,
  CompactOutlineSettlementIntent,
} from '@/authoring/commands/compile-blueprint-outline'
import type {
  PillarInteractionBeatContract,
  PillarInteractionContract,
  PillarSettlementContract,
} from '@/authoring/documents/pillar-interaction-contract'
import type { NodeInteractionSettlementPlan } from '@/runtime/core/schema/graph-schema'
import { componentContracts } from './component-catalog'

export interface PillarBuildabilityIssue {
  code: 'document.pillar.role-unsupported' | 'document.pillar.not-buildable'
  message: string
}

/** 没有 `requiredRole` 的 v1/v2 支柱按最常见的输入角色试画，不因缺字段误伤。 */
const DEFAULT_ACTION_ROLE = 'player-choice'

interface Carrier {
  component: string
  events: readonly string[]
}

/**
 * 角色 → 目录里真的具备该角色的组件。承载不存在时支柱不可执行：下游无论怎么写
 * `configure_blueprint_outline_node` 都挂不上这个动作。
 */
function carrierForRole(role: string): Carrier | null {
  for (const contract of componentContracts()) {
    if (!contract.gameplaySemantics?.roles.includes(role as never)) continue
    const events = contract.gameplaySemantics.eventSemantics.length > 0
      ? contract.gameplaySemantics.eventSemantics.map((entry) => entry.event)
      : contract.events.map((event) => event.id)
    if (events.length > 0) return { component: contract.id, events }
  }
  return null
}

/** 章节 ID 只用于试画，必须是稳定且合法的节点 ID。 */
function probeId(...segments: string[]): string {
  const slug = segments
    .map((segment) => segment.trim().replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, ''))
    .filter(Boolean)
    .join('-')
  return `probe-${slug || 'chapter'}`
}

function beatKind(beat: PillarInteractionBeatContract): CompactOutlineChapterIntent['beat'] {
  if (beat.actions.some((action) => action.requiredRole === 'combat-command')) return 'combat'
  if (beat.actions.some((action) => action.requiredRole === 'timed-input')) return 'timed'
  return 'choice'
}

function triggerSpecFor(
  trigger: PillarSettlementContract['trigger'],
): NonNullable<NodeInteractionSettlementPlan['triggerSpec']> {
  if (trigger === 'at') return { type: 'at', ms: 1200 }
  if (trigger === 'watch') return { type: 'watch', of: 'var.probe' }
  return { type: 'state', condition: { all: [{ type: 'score', op: 'gte', value: 1 }] } }
}

/** 由结果节点承接的数值动作：`stateMutationOwner=settlement` 且有同节拍配对结算。 */
function settledActions(beat: PillarInteractionBeatContract) {
  return beat.actions.filter((action) => (
    action.stateMutationOwner === 'settlement'
    && beat.settlements.some((settlement) => settlement.sourceActionId === action.id)
  ))
}

/**
 * 支柱里写下的每个动作和结算，都必须在派生出的总脉络里有落点。
 * 落不下去的结算是一条永远兑现不了的设计承诺：下游只会反复报缺失，
 * 而缺的东西在支柱里明明写着，于是模型开始怀疑 ID 被冻结（09-07 的错误结论）。
 */
function coverageIssues(
  pillar: PillarInteractionContract,
  placedActionIds: ReadonlySet<string>,
  placedSettlementIds: ReadonlySet<string>,
): PillarBuildabilityIssue[] {
  const issues: PillarBuildabilityIssue[] = []
  for (const beat of pillar.beats) {
    for (const action of beat.actions) {
      if (placedActionIds.has(action.id)) continue
      issues.push({
        code: 'document.pillar.not-buildable',
        message: `节拍 ${beat.id} 的动作 ${action.id} 在最小方案里没有承载节点；`
          + '请把它挂到本节拍的互动章节，或从支柱里去掉',
      })
    }
    for (const settlement of beat.settlements) {
      if (placedSettlementIds.has(settlement.id)) continue
      issues.push({
        code: 'document.pillar.not-buildable',
        message: `节拍 ${beat.id} 的结算 ${settlement.id} 在最小方案里没有落点`
          + `${settlement.sourceActionId ? `：它承接的动作 ${settlement.sourceActionId} 不在 ${beat.id} 内` : ''}；`
          + '结算必须与它所承接的动作同节拍',
      })
    }
  }
  return issues
}

interface ProbePlan {
  chapters: CompactOutlineChapterIntent[]
  configurations: Array<{
    nodeId: string
    actions: CompactOutlineActionIntent[]
    settlements: CompactOutlineSettlementIntent[]
    resolvesActions: Array<{ sourceNodeId: string; pillarActionId: string; triggerSpec: NonNullable<NodeInteractionSettlementPlan['triggerSpec']> }>
    outgoingRoutes: Array<{ id: string; target: string; producer: { kind: 'action'; ref: string } }>
  }>
}

function derivePlan(
  pillar: PillarInteractionContract,
): { ok: true; plan: ProbePlan } | { ok: false; issues: PillarBuildabilityIssue[] } {
  const issues: PillarBuildabilityIssue[] = []
  const chapters: CompactOutlineChapterIntent[] = []
  const configurations: ProbePlan['configurations'] = []
  const placedActionIds = new Set<string>()
  const placedSettlementIds = new Set<string>()

  for (const beat of pillar.beats) {
    const interactiveId = probeId(beat.id)
    // 系统结算（没有 sourceActionId）跟着本节拍的主章节；动作结算跟着各自的结果章节。
    const systemSettlements = beat.settlements
      .filter((settlement) => !settlement.sourceActionId)
      .map((settlement): CompactOutlineSettlementIntent => {
        placedSettlementIds.add(settlement.id)
        return {
          pillarSettlementId: settlement.id,
          triggerSpec: triggerSpecFor(settlement.trigger),
          feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
        }
      })

    if (beat.actions.length === 0) {
      chapters.push({ id: interactiveId, name: beat.id, pillarBeatId: beat.id, beat: 'narrative' })
      configurations.push({
        nodeId: interactiveId,
        actions: [],
        settlements: systemSettlements,
        resolvesActions: [],
        outgoingRoutes: [],
      })
      continue
    }

    chapters.push({ id: interactiveId, name: beat.id, pillarBeatId: beat.id, beat: beatKind(beat) })
    const actions: CompactOutlineActionIntent[] = []
    for (const [index, action] of beat.actions.entries()) {
      const role = action.requiredRole ?? DEFAULT_ACTION_ROLE
      const carrier = carrierForRole(role)
      if (!carrier) {
        issues.push({
          code: 'document.pillar.role-unsupported',
          message: `支柱节拍 ${beat.id} 的动作 ${action.id} 需要 ${role} 角色承载，`
            + '但组件目录里没有任何组件具备该角色；改用已有角色或补控件后再提交',
        })
        continue
      }
      placedActionIds.add(action.id)
      actions.push({
        pillarActionId: action.id,
        component: carrier.component,
        event: carrier.events[index % carrier.events.length]!,
        ...(action.stateMutationOwner === 'settlement'
          ? { effect: { target: 'entity.probe.attr.value', op: 'add' as const, value: 1 } }
          : {}),
        feedbackSpec: { kind: 'hide-interface' },
      })
    }

    const outgoingRoutes: ProbePlan['configurations'][number]['outgoingRoutes'] = []
    const settled = settledActions(beat)
    if (settled.length > 0) {
      const resultId = probeId(beat.id, 'result')
      chapters.push({ id: resultId, name: `${beat.id}·result`, pillarBeatId: beat.id, beat: 'narrative' })
      const resolvesActions: ProbePlan['configurations'][number]['resolvesActions'] = []
      for (const action of settled) {
        outgoingRoutes.push({
          id: `probe-edge-${beat.id}-${action.id}`,
          target: resultId,
          producer: { kind: 'action', ref: action.id },
        })
        const paired = beat.settlements.find((settlement) => settlement.sourceActionId === action.id)!
        placedSettlementIds.add(paired.id)
        resolvesActions.push({
          sourceNodeId: interactiveId,
          pillarActionId: action.id,
          triggerSpec: triggerSpecFor(paired.trigger),
        })
      }
      configurations.push({
        nodeId: resultId,
        actions: [],
        settlements: [],
        resolvesActions,
        outgoingRoutes: [],
      })
    }

    // 源节点必须先于结果节点配置：结果节点的 resolvesActions 要在图上找到该动作。
    configurations.unshift({
      nodeId: interactiveId,
      actions,
      settlements: systemSettlements,
      resolvesActions: [],
      outgoingRoutes,
    })
  }

  // 角色缺承载时动作本来就落不下去，覆盖率会跟着报一遍同一件事。
  // 一个成因只报一条，否则 peer 会以为有两个独立问题要修。
  if (issues.length > 0) return { ok: false, issues }
  const uncovered = coverageIssues(pillar, placedActionIds, placedSettlementIds)
  return uncovered.length > 0
    ? { ok: false, issues: uncovered }
    : { ok: true, plan: { chapters, configurations } }
}

/**
 * 返回「Host 自己都画不出来」的理由。空数组表示这份支柱至少存在一种合法画法。
 *
 * 试画自身抛异常属于本模块的缺陷，不是支柱的问题：那种情况放行，由测试兜住，
 * 绝不能让证明器的 bug 变成作者过不去的门。
 */
export function pillarBuildabilityIssues(
  pillar: PillarInteractionContract,
): PillarBuildabilityIssue[] {
  try {
    const derived = derivePlan(pillar)
    if (!derived.ok) return derived.issues
    const { chapters, configurations } = derived.plan
    if (chapters.length === 0) return []

    const seed = documentFromBlueprints(
      { [MAIN_ID]: emptyBlueprintDoc({ id: MAIN_ID, title: '可执行性试画' }) },
      MAIN_ID,
      { entities: {}, variables: {} },
    )
    const skeleton = createBlueprintOutlineSkeleton(
      seed,
      { entry: chapters[0]!.id, chapters },
      pillar,
    )
    if (!skeleton.ok) {
      return skeleton.errors.map((message) => ({ code: 'document.pillar.not-buildable', message }))
    }

    let document = skeleton.document
    for (const configuration of configurations) {
      const configured = configureBlueprintOutlineNode(document, configuration, pillar)
      if (!configured.ok) {
        return configured.errors.map((message) => ({ code: 'document.pillar.not-buildable', message }))
      }
      document = configured.document
    }
    return []
  } catch {
    return []
  }
}
