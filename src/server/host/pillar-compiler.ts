/**
 * 支柱编译器：支柱是唯一的创作面，蓝图是它的确定性产物。
 *
 * # 为什么是编译器而不是「更强的证明器」
 *
 * 前身 `pillar-buildability` 用下游那套真代码按最小方案把支柱画一遍，画得出来
 * 才放行。它抓住了正确的直觉，却在最后一步把画好的图**丢掉**，再让总脉络 peer
 * 重新画一张不同的——它自己的注释写着「最小方案是存在性证明，不是建议方案」。
 * 证明覆盖不到 peer 新画的那张，于是「支柱过门 → 下游无解重试」这个形状在
 * 09-03 / 09-04 / 09-07 之后仍然复发：09-09 那次在终局节点上空转 76 分钟。
 *
 * 这里把证明产物本身变成交付物。证明用的每一个 probe 占位
 * （`entity.probe.attr.value` / `ms: 1200` / `StatusNotice` / 轮询取事件）
 * 都由支柱 IR v4 的真值取代，因此「能编译」与「所交付的图」指的是同一张图。
 *
 * # 失败关闭
 *
 * 证明器把自身异常吞掉（`catch { return [] }`）当作放行——证明器的 bug 会变成
 * 一份不可执行的支柱通过作者确认。编译器不允许失败开放：抛出即编译失败。
 */
import { documentFromBlueprints, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import {
  composePillarNodeStoryText,
  composePillarNodeVideoPrompt,
} from '@/authoring/commands/node-video-prompt'
import { ensureBuiltinSchemes } from '@/authoring/overlays/builtin-schemes'
import { parseExprToFormulaAst } from '@/authoring/blueprint/formula-authoring'
import {
  configureBlueprintOutlineNode,
  createBlueprintOutlineSkeleton,
} from '@/authoring/commands/progressive-blueprint-outline'
import type {
  CompactOutlineActionIntent,
  CompactOutlineChapterIntent,
  CompactOutlineResolutionIntent,
  CompactOutlineSettlementIntent,
} from '@/authoring/commands/compile-blueprint-outline'
import type {
  PillarFormulaContract,
  PillarInteractionActionContract,
  PillarInteractionBeatContract,
  PillarInteractionContract,
  PillarVariableContract,
} from '@/authoring/documents/pillar-interaction-contract'
import { hydratePillarContract } from '@/authoring/documents/pillar-hydrate'
import type {
  GraphLibraryDocument,
  NodeCastBinding,
  NodeInteractionSettlementPlan,
  NodeSceneBinding,
} from '@/runtime/core/schema/graph-schema'
import type { CharacterDefinition, SceneDefinition } from '@/authoring/assets/registry-types'
import { componentContracts } from './component-catalog'
import { integrateCompiledPillar, normalizeStateTrigger } from './pillar-integration'

export interface PillarCompileIssue {
  code:
    | 'document.pillar.role-unsupported'
    | 'document.pillar.not-buildable'
    | 'document.pillar.compiler-error'
  message: string
}

interface CompiledRoute {
  id: string
  target: string
  producer: { kind: 'action' | 'settlement'; ref: string }
}

interface CompiledConfiguration {
  nodeId: string
  actions: CompactOutlineActionIntent[]
  settlements: CompactOutlineSettlementIntent[]
  resolvesActions: CompactOutlineResolutionIntent[]
  outgoingRoutes: CompiledRoute[]
}

export interface CompiledPillarPlan {
  chapters: CompactOutlineChapterIntent[]
  configurations: CompiledConfiguration[]
  /** 节拍 ID → 承载它的互动节点 ID。出边解析的唯一依据。 */
  beatNodeIds: Record<string, string>
  /** 终局 ID → 终局节点 ID。终局节点没有出边，因此不可能成环。 */
  endingNodeIds: Record<string, string>
}

export type PillarCompileResult =
  | { ok: true; document: GraphLibraryDocument; plan: CompiledPillarPlan }
  | { ok: false; issues: PillarCompileIssue[] }

/** 没有 `requiredRole` 的 v1/v2 支柱按最常见的输入角色编译，不因缺字段误伤。 */
const DEFAULT_ACTION_ROLE = 'player-choice'

interface Carrier {
  component: string
  events: readonly string[]
}

/**
 * 角色 → 目录里真的具备该角色的组件。承载不存在时支柱无法编译：无论怎么写
 * 节点配置都挂不上这个动作。
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

function nodeId(...segments: string[]): string {
  const slug = segments
    .map((segment) => segment.trim().replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, ''))
    .filter(Boolean)
    .join('-')
  return `node-${slug || 'chapter'}`
}

/**
 * 蓝图画布上的节点标题用故事章节名，不用节拍 ID。
 * `B07` 是机器身份，作者看见它会以为蓝图还没写完。
 */
function chapterTitle(beat: PillarInteractionBeatContract, extra?: string): string {
  const title = beat.narrativeIntent.trim() || beat.id
  return extra ? `${title} · ${extra}` : title
}

/** 支柱角色按声明顺序得到稳定 ASCII ID；中文名无法进 id，所以用序号。 */
export function pillarCharacterBindings(pillar: PillarInteractionContract): NodeCastBinding[] {
  return (pillar.cast ?? []).map((entry, index) => ({
    characterId: `character-${index + 1}`,
    role: index === 0 ? 'primary' as const : 'supporting',
    onScreen: true,
  }))
}

export function pillarSceneBindings(pillar: PillarInteractionContract): NodeSceneBinding[] {
  return (pillar.settings ?? []).map((entry, index) => ({
    sceneId: `scene-${index + 1}`,
    role: index === 0 ? 'primary' as const : 'secondary',
    useAsVideoReference: true,
  }))
}

/**
 * 资产生成读的是目录实体，不是蓝图节点上的名字。
 * 编译时按支柱 `cast` / `settings` 种下同 ID 的条目，建模才能补外观、预览才能出图。
 */
export function pillarAssetDefinitions(pillar: PillarInteractionContract): {
  characters: Record<string, CharacterDefinition>
  scenes: Record<string, SceneDefinition>
} {
  const characters: Record<string, CharacterDefinition> = {}
  for (const [index, entry] of (pillar.cast ?? []).entries()) {
    const id = `character-${index + 1}`
    const prompt = entry.summary?.trim() || `${entry.name}，电影感角色设定图，半身，清晰五官`
    characters[id] = {
      id,
      name: entry.name,
      ...(entry.summary ? { summary: entry.summary } : {}),
      appearance: {
        description: entry.summary?.trim() || `${entry.name}，互动影游角色`,
        previewPrompt: prompt,
      },
    }
  }
  const scenes: Record<string, SceneDefinition> = {}
  for (const [index, entry] of (pillar.settings ?? []).entries()) {
    const id = `scene-${index + 1}`
    const prompt = entry.summary?.trim() || `${entry.name}，电影感场景概念图，宽构图`
    scenes[id] = {
      id,
      name: entry.name,
      ...(entry.summary ? { summary: entry.summary } : {}),
      visual: {
        description: entry.summary?.trim() || `${entry.name}，互动影游场景`,
        previewPrompt: prompt,
      },
      source: 'outline',
    }
  }
  return { characters, scenes }
}

function withCastAndScenes(
  chapter: CompactOutlineChapterIntent,
  pillar: PillarInteractionContract,
): CompactOutlineChapterIntent {
  const cast = pillarCharacterBindings(pillar)
  const scenes = pillarSceneBindings(pillar)
  return {
    ...chapter,
    ...(cast.length > 0 ? { cast } : {}),
    ...(scenes.length > 0 ? { scenes } : {}),
  }
}

function chapterCopy(
  beat: PillarInteractionBeatContract,
  pillar: PillarInteractionContract,
  extras?: {
    nameExtra?: string
    actionIntent?: string
    ending?: NonNullable<PillarInteractionContract['endings']>[number]
  },
): Pick<CompactOutlineChapterIntent, 'storyText' | 'videoPrompt'> {
  const chapterName = extras?.ending
    ? extras.ending.title
    : chapterTitle(beat, extras?.nameExtra)
  return {
    storyText: composePillarNodeStoryText({
      beat,
      chapterName,
      actionIntent: extras?.actionIntent,
      ending: extras?.ending,
    }),
    videoPrompt: composePillarNodeVideoPrompt({
      beat,
      pillar,
      chapterName,
      actionIntent: extras?.actionIntent,
      ending: extras?.ending,
    }),
  }
}

/**
 * 没有入边的终局/节拍会在画布上变成游离节点。入口节拍是唯一允许没有入边的点。
 */
function pruneUnreachableNodes(
  plan: CompiledPillarPlan,
  entryBeatId: string,
): CompiledPillarPlan {
  const entry = plan.beatNodeIds[entryBeatId]
  if (!entry) return plan
  const reachable = new Set<string>([entry])
  const byNode = new Map(plan.configurations.map((configuration) => (
    [configuration.nodeId, configuration] as const
  )))
  const queue = [entry]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    for (const route of byNode.get(nodeId)?.outgoingRoutes ?? []) {
      if (reachable.has(route.target)) continue
      reachable.add(route.target)
      queue.push(route.target)
    }
  }
  if (plan.chapters.every((chapter) => reachable.has(chapter.id))) return plan
  return {
    chapters: plan.chapters.filter((chapter) => reachable.has(chapter.id)),
    configurations: plan.configurations.filter((configuration) => reachable.has(configuration.nodeId)),
    beatNodeIds: Object.fromEntries(
      Object.entries(plan.beatNodeIds).filter(([, nodeId]) => reachable.has(nodeId)),
    ),
    endingNodeIds: Object.fromEntries(
      Object.entries(plan.endingNodeIds).filter(([, nodeId]) => reachable.has(nodeId)),
    ),
  }
}

function beatKind(beat: PillarInteractionBeatContract): CompactOutlineChapterIntent['beat'] {
  if (beat.actions.some((action) => action.requiredRole === 'combat-command')) return 'combat'
  if (beat.actions.some((action) => action.requiredRole === 'timed-input')) return 'timed'
  if (beat.actions.length === 0) return 'narrative'
  return 'choice'
}

/**
 * v4 的结算触发器直接来自支柱。v1–v3 没有这个字段，退回一组保守缺省——
 * 那条路径只用于让历史支柱仍可读，不用于交付。
 */
function triggerSpecFor(
  settlement: { trigger: 'at' | 'watch' | 'state'; triggerSpec?: unknown },
): NonNullable<NodeInteractionSettlementPlan['triggerSpec']> {
  if (settlement.triggerSpec) {
    // 计划与 reaction 会被逐字段比对，所以归一化必须发生在计划成形时，
    // 而不是只在落 reaction 时——否则两边形状不同，结算被判成没接上。
    return normalizeStateTrigger(settlement.triggerSpec) as NonNullable<NodeInteractionSettlementPlan['triggerSpec']>
  }
  if (settlement.trigger === 'at') return { type: 'at', ms: 1200 }
  if (settlement.trigger === 'watch') return { type: 'watch', of: 'var.progress' }
  return { type: 'state', condition: { all: [{ type: 'score', op: 'gte', value: 1 }] } }
}

function feedbackSpecFor(
  declared: PillarInteractionActionContract['feedbackSpec'],
  fallback: CompactOutlineActionIntent['feedbackSpec'],
): CompactOutlineActionIntent['feedbackSpec'] {
  return (declared as CompactOutlineActionIntent['feedbackSpec'] | undefined) ?? fallback
}

/** 飘字与状态提示只能由 reaction.spawn 动态产生；静态挂载会被 `ui.floattext.static-mount` 拦下。 */
function isSpawnOnly(component: string): boolean {
  return componentContracts().find((contract) => contract.id === component)?.timing?.kind === 'spawn-only'
}

/**
 * 结果节点承接的数值动作，可见反馈只有一份：配对结算在命中帧弹出的那一下。
 *
 * 动作自己的界面事件只沿边进入结果视频，不改数值也不弹飘字，所以「动作的
 * feedbackSpec」要么是能真的挂在结果节点上的常驻控件（血条），要么就必须与配对
 * 结算 spawn 的那个控件是同一个——否则整装照动作那份施工会得到一个兑现不了的
 * 承诺：审查报 `finalization.plan.effect-feedback-missing`，而支柱里明明写了反馈。
 */
function settledFeedbackSpec(
  declared: PillarInteractionActionContract['feedbackSpec'],
  paired: PillarInteractionBeatContract['settlements'][number],
): CompactOutlineActionIntent['feedbackSpec'] {
  if (declared?.kind === 'state-binding' && !isSpawnOnly(declared.component)) {
    return declared as CompactOutlineActionIntent['feedbackSpec']
  }
  return feedbackSpecFor(
    paired.feedbackSpec,
    { kind: 'transient-component', component: 'StatusNotice' },
  )
}

/** 由结果节点承接的数值动作：`stateMutationOwner=settlement` 且有同节拍配对结算。 */
function settledActions(beat: PillarInteractionBeatContract) {
  return beat.actions.filter((action) => (
    action.stateMutationOwner === 'settlement'
    && beat.settlements.some((settlement) => settlement.sourceActionId === action.id)
  ))
}

/**
 * 回合契约 `loop.backTo`：未分胜负时回到哪个节点。
 *
 * 判据只能是真实回边——`NodeInteractionPlan.loop` 写着「由 Host 校验真实回边」，
 * 所以这里只在支柱确实把某个动作的出口指回本节拍时盖章；那条 `结果节点 → 互动
 * 节点` 的边编译器本来就会连。不这样盖章的话，一个真正的回合节拍在审查里也会被
 * 判成「没有回合」，而策划改 IR 补不上这个字段。
 */
function loopBackFor(
  beat: PillarInteractionBeatContract,
  interactiveId: string,
): Pick<CompactOutlineChapterIntent, 'loop'> | null {
  const loopsBack = beat.actions.some((action) => (
    action.exit?.kind === 'beat' && action.exit.toBeatId === beat.id
  ))
  if (!loopsBack) return null
  const note = beat.loop?.progress?.trim()
  return { loop: { backTo: interactiveId, ...(note ? { note } : {}) } }
}

/**
 * 支柱里写下的每个动作和结算都必须在编译产物里有落点。落不下去的结算是一条
 * 永远兑现不了的设计承诺：下游只会反复报缺失，而缺的东西在支柱里明明写着。
 */
function coverageIssues(
  pillar: PillarInteractionContract,
  placedActionIds: ReadonlySet<string>,
  placedSettlementIds: ReadonlySet<string>,
): PillarCompileIssue[] {
  const issues: PillarCompileIssue[] = []
  for (const beat of pillar.beats) {
    for (const action of beat.actions) {
      if (placedActionIds.has(action.id)) continue
      issues.push({
        code: 'document.pillar.not-buildable',
        message: `节拍 ${beat.id} 的动作 ${action.id} 没有承载节点；`
          + '请把它挂到本节拍的互动章节，或从支柱里去掉',
      })
    }
    for (const settlement of beat.settlements) {
      if (placedSettlementIds.has(settlement.id)) continue
      issues.push({
        code: 'document.pillar.not-buildable',
        message: `节拍 ${beat.id} 的结算 ${settlement.id} 没有落点`
          + `${settlement.sourceActionId ? `：它承接的动作 ${settlement.sourceActionId} 不在 ${beat.id} 内` : ''}；`
          + '结算必须与它所承接的动作同节拍',
      })
    }
  }
  return issues
}

function derivePlan(
  pillar: PillarInteractionContract,
): { ok: true; plan: CompiledPillarPlan } | { ok: false; issues: PillarCompileIssue[] } {
  const issues: PillarCompileIssue[] = []
  const chapters: CompactOutlineChapterIntent[] = []
  const configurations: CompiledConfiguration[] = []
  const placedActionIds = new Set<string>()
  const placedSettlementIds = new Set<string>()
  const beatNodeIds: Record<string, string> = {}
  const endingNodeIds: Record<string, string> = {}

  for (const beat of pillar.beats) beatNodeIds[beat.id] = nodeId(beat.id)

  // 终局是一等公民：它编译成自己的节点且没有出边。旧结构里终局只能表达成
  // 「一条指向某节点的边」，而指向任何已有节点都会成环——node-10 的死结。
  for (const ending of pillar.endings ?? []) {
    const id = nodeId('ending', ending.id)
    endingNodeIds[ending.id] = id
    const lastBeat = pillar.beats.at(-1)!
    chapters.push(withCastAndScenes({
      id,
      name: ending.title,
      pillarBeatId: lastBeat.id,
      beat: 'narrative',
      ...chapterCopy(lastBeat, pillar, { ending }),
    }, pillar))
    configurations.push({ nodeId: id, actions: [], settlements: [], resolvesActions: [], outgoingRoutes: [] })
  }

  for (const beat of pillar.beats) {
    const interactiveId = beatNodeIds[beat.id]!
    const systemSettlements = beat.settlements
      .filter((settlement) => !settlement.sourceActionId)
      .map((settlement): CompactOutlineSettlementIntent => {
        placedSettlementIds.add(settlement.id)
        return {
          pillarSettlementId: settlement.id,
          triggerSpec: triggerSpecFor(settlement),
          feedbackSpec: feedbackSpecFor(
            settlement.feedbackSpec,
            { kind: 'transient-component', component: 'StatusNotice' },
          ),
        }
      })

    if (beat.actions.length === 0) {
      chapters.push(withCastAndScenes({
        id: interactiveId,
        name: chapterTitle(beat),
        pillarBeatId: beat.id,
        beat: 'narrative',
        ...chapterCopy(beat, pillar),
      }, pillar))
      configurations.push({
        nodeId: interactiveId,
        actions: [],
        settlements: systemSettlements,
        resolvesActions: [],
        outgoingRoutes: [],
      })
      continue
    }

    chapters.push(withCastAndScenes({
      id: interactiveId,
      name: chapterTitle(beat),
      pillarBeatId: beat.id,
      beat: beatKind(beat),
      ...chapterCopy(beat, pillar),
      ...(loopBackFor(beat, interactiveId) ?? {}),
    }, pillar))
    const actions: CompactOutlineActionIntent[] = []
    for (const [index, action] of beat.actions.entries()) {
      // 已声明的能力缺口就是「目录承载不了这个玩法」的明确表态，不该被
      // 默认角色悄悄兜住——兜住的结果是编译出一个不是作者想要的玩法。
      if (action.capabilityGap) {
        issues.push({
          code: 'document.pillar.role-unsupported',
          message: `支柱节拍 ${beat.id} 的动作 ${action.id} 声明了目录承载不了的能力：`
            + `${action.capabilityGap.need}（${action.capabilityGap.why}）；改设计或补控件后再提交`,
        })
        continue
      }
      const role = action.requiredRole ?? DEFAULT_ACTION_ROLE
      // 支柱指名了承载元件就用它；没指名时按角色从目录里取，保持 v1–v3 可编译。
      const carrier = action.carrier
        ? { component: action.carrier.component, events: [action.carrier.event] }
        : carrierForRole(role)
      if (!carrier) {
        issues.push({
          code: 'document.pillar.role-unsupported',
          message: `支柱节拍 ${beat.id} 的动作 ${action.id} 需要 ${role} 角色承载，`
            + '但组件目录里没有任何组件具备该角色；改用已有角色或补控件后再提交',
        })
        continue
      }
      placedActionIds.add(action.id)
      const paired = action.stateMutationOwner === 'settlement'
        ? beat.settlements.find((settlement) => settlement.sourceActionId === action.id)
        : undefined
      actions.push({
        pillarActionId: action.id,
        component: carrier.component,
        event: carrier.events[index % carrier.events.length]!,
        ...(action.effect ? { effect: { ...action.effect } } : {}),
        feedbackSpec: paired
          ? settledFeedbackSpec(action.feedbackSpec, paired)
          : feedbackSpecFor(action.feedbackSpec, { kind: 'hide-interface' }),
      })
    }

    const outgoingRoutes: CompiledRoute[] = []
    // 数值动作先落到同节拍的结果节点，结果节点再按 exit 走向下一站。
    // 这里的自定义结算出口（settlement.id，例如 B07-mo-result）不是 LLM 在画布上
    // 发明的：结果节点没有玩家动作，必须等结算触发才能离开。lifecycle 的 default
    // 出口会在演出结束时就走，结算还没应用。过场（stateMutationOwner=none）不会
    // 走进这个分支，也就不会多出结果节点。
    const resultNodeIdByAction = new Map<string, string>()
    const resultSettlementIdByAction = new Map<string, string>()
    const settled = settledActions(beat)
    if (settled.length > 0) {
      const resultId = nodeId(beat.id, 'result')
      const lead = settled[0]!
      chapters.push(withCastAndScenes({
        id: resultId,
        name: chapterTitle(beat, lead.intent),
        pillarBeatId: beat.id,
        beat: 'narrative',
        ...chapterCopy(beat, pillar, { nameExtra: lead.intent, actionIntent: lead.intent }),
      }, pillar))
      const resolvesActions: CompiledConfiguration['resolvesActions'] = []
      for (const action of settled) {
        resultNodeIdByAction.set(action.id, resultId)
        outgoingRoutes.push({
          id: `edge-${beat.id}-${action.id}`,
          target: resultId,
          producer: { kind: 'action', ref: action.id },
        })
        const paired = beat.settlements.find((settlement) => settlement.sourceActionId === action.id)!
        placedSettlementIds.add(paired.id)
        resultSettlementIdByAction.set(action.id, paired.id)
        resolvesActions.push({
          sourceNodeId: interactiveId,
          pillarActionId: action.id,
          triggerSpec: triggerSpecFor(paired),
          ...(paired.feedbackSpec
            ? { feedbackSpec: paired.feedbackSpec as CompactOutlineResolutionIntent['feedbackSpec'] }
            : {}),
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

    // exit 是结构化出口：解析成具体节点 ID 是查表，不是推断。
    for (const action of beat.actions) {
      const exit = action.exit
      if (!exit || exit.kind === 'stay') continue
      const target = exit.kind === 'beat' ? beatNodeIds[exit.toBeatId] : endingNodeIds[exit.endingId]
      if (!target) {
        const reference = exit.kind === 'beat' ? exit.toBeatId : exit.endingId
        issues.push({
          code: 'document.pillar.not-buildable',
          message: `节拍 ${beat.id} 的动作 ${action.id} 出口指向 ${reference}，但支柱里没有这个${exit.kind === 'beat' ? '节拍' : '终局'}`,
        })
        continue
      }
      const from = resultNodeIdByAction.get(action.id)
      if (from) {
        // 结果节点承接完数值后离开。它自己没有动作，所以离开由承接该动作的
        // 结算产出——把 producer 写成 action 会让节点配置报 `action not found`。
        const configuration = configurations.find((candidate) => candidate.nodeId === from)!
        configuration.outgoingRoutes.push({
          id: `edge-${from}-exit-${action.id}`,
          target,
          producer: { kind: 'settlement', ref: resultSettlementIdByAction.get(action.id)! },
        })
        continue
      }
      outgoingRoutes.push({
        id: `edge-${beat.id}-${action.id}-exit`,
        target,
        producer: { kind: 'action', ref: action.id },
      })
    }

    // 战斗胜负这类系统结算没有玩家动作，出口必须从互动节点自己走出去，
    // 否则满载而归 / 终局节拍永远进不了可达图，prune 会把它们丢掉。
    for (const settlement of beat.settlements) {
      if (settlement.sourceActionId) continue
      const exit = settlement.exit
      if (!exit || exit.kind === 'stay') continue
      const target = exit.kind === 'beat' ? beatNodeIds[exit.toBeatId] : endingNodeIds[exit.endingId]
      if (!target) {
        const reference = exit.kind === 'beat' ? exit.toBeatId : exit.endingId
        issues.push({
          code: 'document.pillar.not-buildable',
          message: `节拍 ${beat.id} 的结算 ${settlement.id} 出口指向 ${reference}，但支柱里没有这个${exit.kind === 'beat' ? '节拍' : '终局'}`,
        })
        continue
      }
      outgoingRoutes.push({
        id: `edge-${beat.id}-${settlement.id}-exit`,
        target,
        producer: { kind: 'settlement', ref: settlement.id },
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
  // 一个成因只报一条，否则作者会以为有两个独立问题要修。
  if (issues.length > 0) return { ok: false, issues }
  const uncovered = coverageIssues(pillar, placedActionIds, placedSettlementIds)
  if (uncovered.length > 0) return { ok: false, issues: uncovered }
  return {
    ok: true,
    plan: pruneUnreachableNodes(
      { chapters, configurations, beatNodeIds, endingNodeIds },
      pillar.beats[0]!.id,
    ),
  }
}

/**
 * 把支柱的数值声明编译成图文档里的规则目录。
 *
 * 数值是设计决策，所以它在支柱里定稿；`rules.catalog` 那个由 LLM 从散文里
 * 反推公式的活动因此不再需要。公式落盘要 AST，用作者态那套解析器转换，
 * 保证「写得进去」和「跑得起来」是同一套语法。
 */
function compileRules(
  pillar: PillarInteractionContract,
): {
  ok: true
  variables: Record<string, unknown>
  entities: Record<string, unknown>
  formulas: Record<string, unknown>
} | { ok: false; issues: PillarCompileIssue[] } {
  const variables: Record<string, unknown> = {}
  for (const variable of pillar.variables ?? []) {
    variables[variable.id] = {
      id: variable.id,
      ...(variable.label ? { name: variable.label } : {}),
      initial: variable.initial,
      ...(variable.min === undefined ? {} : { min: variable.min }),
      ...(variable.max === undefined ? {} : { max: variable.max }),
    }
  }
  const entities: Record<string, unknown> = {}
  for (const entity of pillar.entities ?? []) {
    const attrs: Record<string, number> = {}
    const attrMeta: Record<string, { label?: string; initial: number; min?: number; max?: number }> = {}
    for (const attr of entity.attrs) {
      attrs[attr.id] = attr.initial
      attrMeta[attr.id] = {
        initial: attr.initial,
        ...(attr.label ? { label: attr.label } : {}),
        ...(attr.min === undefined ? {} : { min: attr.min }),
        ...(attr.max === undefined ? {} : { max: attr.max }),
      }
    }
    entities[entity.id] = {
      id: entity.id,
      ...(entity.label ? { name: entity.label } : {}),
      ...(entity.kind ? { kind: entity.kind } : {}),
      attrs,
      attrMeta,
    }
  }
  const formulas: Record<string, unknown> = {}
  const issues: PillarCompileIssue[] = []
  for (const formula of pillar.formulas ?? []) {
    try {
      formulas[formula.id] = {
        id: formula.id,
        ...(formula.summary ? { description: formula.summary } : {}),
        ast: parseExprToFormulaAst(formula.expression),
      }
    } catch (error) {
      issues.push({
        code: 'document.pillar.not-buildable',
        message: `公式 ${formula.id} 无法解析：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, variables, entities, formulas }
}

/**
 * 把一份支柱编译成可交付蓝图。成功即保证「作者确认的这份支柱能出可玩蓝图」，
 * 因为被证明的和被交付的是同一张图。
 */
export function compilePillar(pillar: PillarInteractionContract): PillarCompileResult {
  const ready = pillar.schemaVersion >= 4 ? hydratePillarContract(pillar) : pillar
  let derived: ReturnType<typeof derivePlan>
  try {
    derived = derivePlan(ready)
  } catch (error) {
    return {
      ok: false,
      issues: [{
        code: 'document.pillar.compiler-error',
        message: `支柱编译器异常：${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
  if (!derived.ok) return { ok: false, issues: derived.issues }

  const { chapters, configurations } = derived.plan
  if (chapters.length === 0) {
    return {
      ok: false,
      issues: [{ code: 'document.pillar.not-buildable', message: '支柱没有任何可编译的节拍' }],
    }
  }

  const compiledRules = compileRules(ready)
  if (!compiledRules.ok) return { ok: false, issues: compiledRules.issues }

  try {
    const packTitle = ready.title?.trim() || '蓝图总脉络'
    const seed = documentFromBlueprints(
      {
        [MAIN_ID]: {
          id: MAIN_ID,
          title: packTitle,
          entry: '',
          graph: { nodes: [], edges: [] },
        },
      },
      MAIN_ID,
      { entities: compiledRules.entities as never, variables: compiledRules.variables as never },
    )
    seed.formulas = compiledRules.formulas
    // 整装要按 `base:<组件>` 挂载与 spawn，所以目录里每个组件都得有一份单组件
    // 方案。缺了它，反馈元件会在挂载时报 `overlay not found`。
    seed.ui = { ...seed.ui, overlays: ensureBuiltinSchemes(seed.ui?.overlays) }
    const entry = derived.plan.beatNodeIds[ready.beats[0]!.id]!
    const skeleton = createBlueprintOutlineSkeleton(
      seed,
      { entry, chapters, title: packTitle },
      ready,
    )
    if (!skeleton.ok) {
      return {
        ok: false,
        issues: skeleton.errors.map((message) => ({ code: 'document.pillar.not-buildable' as const, message })),
      }
    }

    let document = skeleton.document
    for (const configuration of configurations) {
      const configured = configureBlueprintOutlineNode(document, configuration, ready)
      if (!configured.ok) {
        return {
          ok: false,
          issues: configured.errors.map((message) => ({ code: 'document.pillar.not-buildable' as const, message })),
        }
      }
      document = configured.document
    }

    // 上面只完成了总脉络那半边——它写工单，不挂元件。少了整装，产出的图里
    // `overlayNodes` 恒为空：没有东西会发出动作事件，玩家点不到任何控件。
    const integrated = integrateCompiledPillar(document, ready, derived.plan.endingNodeIds)
    if (!integrated.ok) return { ok: false, issues: integrated.issues }

    return { ok: true, document: integrated.document, plan: derived.plan }
  } catch (error) {
    // 失败关闭。证明器时代这里 `return []`（放行），于是证明器自身的 bug 会让
    // 一份不可执行的支柱通过作者确认。
    return {
      ok: false,
      issues: [{
        code: 'document.pillar.compiler-error',
        message: `支柱编译器异常：${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
}
