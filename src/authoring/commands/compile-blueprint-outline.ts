import type { PillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import {
  composePillarNodeStoryText,
  composePillarNodeVideoPrompt,
} from './node-video-prompt'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import {
  executeBlueprintGraphCommands,
  type BlueprintGraphCommand,
} from '@/authoring/commands/blueprint-graph-command'
import type {
  EdgeTransition,
  GameEdge,
  GameGraph,
  GameNode,
  GraphCondition,
  GraphLibraryDocument,
  InteractionFeedbackSpec,
  NodeCastBinding,
  NodeInteractionAction,
  NodeInteractionPlan,
  NodeInteractionSettlementPlan,
  NodeSceneBinding,
} from '@/runtime/core/schema/graph-schema'

export interface CompactOutlineActionIntent {
  pillarActionId: string
  component: string
  event: string
  effect?: NodeInteractionAction['effect']
  feedbackSpec: InteractionFeedbackSpec
}

export interface CompactOutlineSettlementIntent {
  pillarSettlementId: string
  triggerSpec: NonNullable<NodeInteractionSettlementPlan['triggerSpec']>
  feedbackSpec: InteractionFeedbackSpec
  pattern?: string
}

export interface CompactOutlineResolutionIntent {
  sourceNodeId: string
  pillarActionId: string
  triggerSpec: NonNullable<NodeInteractionSettlementPlan['triggerSpec']>
  pattern?: string
  /**
   * 结算自己的反馈（伤害飘字等），与源动作的反馈（锁定/隐藏界面）不是一回事。
   * 省略时沿用源动作的 feedbackSpec，保持历史调用方行为不变。
   */
  feedbackSpec?: InteractionFeedbackSpec
}

export interface CompactOutlineChapterIntent {
  id: string
  name: string
  pillarBeatId: string
  beat: NodeInteractionPlan['beat']
  lane?: number
  cast?: NodeCastBinding[]
  scenes?: NodeSceneBinding[]
  actions?: CompactOutlineActionIntent[]
  settlements?: CompactOutlineSettlementIntent[]
  resolvesActions?: CompactOutlineResolutionIntent[]
  loop?: NodeInteractionPlan['loop']
  terminals?: NodeInteractionPlan['terminals']
  /** 编译器从支柱写出的节点正文；配置节点时必须原样带回，否则会被骨架缺省冲掉。 */
  storyText?: string
  /** 编译器从支柱写出的可拍摄镜头词；资产支线应沿用并只补 generation。 */
  videoPrompt?: string
}

export interface CompactOutlineRouteIntent {
  id?: string
  source: string
  target: string
  producer: {
    kind: 'action' | 'settlement' | 'lifecycle'
    ref: string
  }
  sourceHandle?: string
  targetHandle?: string
  condition?: GraphCondition
  transition?: EdgeTransition
  narrativePayoff?: string
}

export interface CompileBlueprintOutlineInput {
  blueprintId?: string
  title?: string
  entry: string
  chapters: CompactOutlineChapterIntent[]
  routes: CompactOutlineRouteIntent[]
}

export type CompileBlueprintOutlineResult =
  | {
      ok: true
      document: GraphLibraryDocument
      blueprintId: string
      nodeCount: number
      edgeCount: number
      commandCount: number
    }
  | { ok: false; errors: string[]; failedPath?: string }

type CompactMaterializationResult =
  | { ok: true; nodes: GameNode[]; edges: GameEdge[] }
  | { ok: false; errors: string[]; failedPath: string }

function compactFailure(path: string, message: string): CompactMaterializationResult {
  return { ok: false, errors: [message], failedPath: path }
}

function compactFailures(errors: string[], failedPath: string | undefined): CompactMaterializationResult {
  return { ok: false, errors, failedPath: failedPath ?? 'chapters' }
}

function chapterMedia(
  chapter: CompactOutlineChapterIntent,
  beat: NonNullable<PillarInteractionContract['beats'][number]>,
  pillar: PillarInteractionContract,
): { storyText: string; media: { kind: 'video'; prompt: string } } {
  return {
    storyText: chapter.storyText?.trim()
      || composePillarNodeStoryText({ beat, chapterName: chapter.name }),
    media: {
      kind: 'video',
      prompt: chapter.videoPrompt?.trim()
        || composePillarNodeVideoPrompt({ beat, pillar, chapterName: chapter.name }),
    },
  }
}

function stableSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'route'
}

function settlementPattern(trigger: NodeInteractionSettlementPlan['trigger'], resolvesAction: boolean): string {
  if (trigger === 'at') return resolvesAction ? 'timeline-hit-sync' : 'qte-timeout'
  if (trigger === 'watch') return 'watch-state-feedback'
  return 'health-terminal'
}

export function materializeCompactOutline(
  input: CompileBlueprintOutlineInput,
  pillar: PillarInteractionContract | undefined,
): CompactMaterializationResult {
  const chapters = input.chapters
  const routes = input.routes
  if (!pillar) return compactFailure('pillar', 'compact outline requires a valid pillar interaction contract')
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return compactFailure('chapters', 'chapters must be a non-empty array')
  }
  if (!Array.isArray(routes)) return compactFailure('routes', 'routes must be an array')

  const errors: string[] = []
  let failedPath: string | undefined
  const fail = (path: string, message: string): void => {
    failedPath ??= path
    errors.push(message)
  }
  const chapterIds = new Set<string>()
  const nodes: GameNode[] = []
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const chapterPath = `chapters[${chapterIndex}]`
    if (!chapter.id?.trim()) {
      fail(`${chapterPath}.id`, 'chapter id is required')
      continue
    }
    if (chapterIds.has(chapter.id)) {
      fail(`${chapterPath}.id`, `duplicate chapter id: ${chapter.id}`)
      continue
    }
    const beat = pillar.beats.find((candidate) => candidate.id === chapter.pillarBeatId)
    if (!beat) {
      fail(
        `${chapterPath}.pillarBeatId`,
        `chapter ${chapter.id} references unknown pillar beat ${chapter.pillarBeatId}; `
          + `available pillar beats: ${pillar.beats.map((candidate) => candidate.id).join(', ') || '(none)'}`,
      )
      continue
    }
    const actions: NodeInteractionAction[] = []
    for (const [actionIndex, binding] of (chapter.actions ?? []).entries()) {
      const actionPath = `${chapterPath}.actions[${actionIndex}]`
      const source = beat.actions.find((candidate) => candidate.id === binding.pillarActionId)
      if (!source) {
        const owner = pillar.beats.find((candidate) => (
          candidate.actions.some((action) => action.id === binding.pillarActionId)
        ))
        fail(
          `${actionPath}.pillarActionId`,
          owner
            ? `pillar action ${binding.pillarActionId} belongs to beat ${owner.id}, but chapter ${chapter.id} `
              + `is bound to beat ${beat.id}; bind this chapter to ${owner.id} or pick an action from ${beat.id} `
              + `(${beat.actions.map((action) => action.id).join(', ') || 'none'})`
            : `unknown pillar action ${binding.pillarActionId}; beat ${beat.id} defines: `
              + `${beat.actions.map((action) => action.id).join(', ') || '(none)'}`,
        )
        continue
      }
      if (source.stateMutationOwner === 'settlement' && !binding.effect) {
        fail(`${actionPath}.effect`, `pillar action ${source.id} requires a settlement-owned effect`)
      }
      if (source.stateMutationOwner === 'none' && binding.effect) {
        fail(`${actionPath}.effect`, `pillar action ${source.id} is a narrative-only route`)
      }
      actions.push({
        sourcePillarActionId: source.id,
        ...(source.stateMutationOwner ? { stateMutationOwner: source.stateMutationOwner } : {}),
        component: binding.component,
        event: binding.event,
        intent: source.intent,
        stateChangeIntent: source.stateChange,
        feedback: source.immediateFeedback,
        feedbackSpec: structuredClone(binding.feedbackSpec),
        downstreamPayoff: source.downstreamPayoff,
        exitIntent: source.exitIntent,
        ...(binding.effect ? { effect: structuredClone(binding.effect) } : {}),
      })
    }
    const settlements: NodeInteractionSettlementPlan[] = []
    for (const [settlementIndex, binding] of (chapter.settlements ?? []).entries()) {
      const settlementPath = `${chapterPath}.settlements[${settlementIndex}]`
      const source = beat.settlements.find((candidate) => candidate.id === binding.pillarSettlementId)
      if (!source) {
        // 这个 ID 通常是存在的，只是属于别的节拍。不写清作用域，调用方会误以为
        // ID 被冻结或被消费，然后去猜各种不存在的规则。
        const owner = pillar.beats.find((candidate) => (
          candidate.settlements.some((settlement) => settlement.id === binding.pillarSettlementId)
        ))
        fail(
          `${settlementPath}.pillarSettlementId`,
          owner
            ? `pillar settlement ${binding.pillarSettlementId} belongs to beat ${owner.id}, but chapter `
              + `${chapter.id} is bound to beat ${beat.id}; a settlement must sit on a result node in its own `
              + `beat — re-bind ${chapter.id} to ${owner.id}, or use a settlement from ${beat.id} `
              + `(${beat.settlements.map((settlement) => settlement.id).join(', ') || 'none'})`
            : `unknown pillar settlement ${binding.pillarSettlementId}; beat ${beat.id} defines: `
              + `${beat.settlements.map((settlement) => settlement.id).join(', ') || '(none)'}`,
        )
        continue
      }
      if (source.trigger !== binding.triggerSpec.type) {
        fail(
          `${settlementPath}.triggerSpec`,
          `pillar settlement ${source.id} requires ${source.trigger}, received ${binding.triggerSpec.type}`,
        )
      }
      settlements.push({
        id: source.id,
        sourcePillarSettlementId: source.id,
        ...(source.sourceActionId ? { sourcePillarActionId: source.sourceActionId } : {}),
        pattern: binding.pattern ?? settlementPattern(source.trigger, Boolean(source.sourceActionId)),
        trigger: source.trigger,
        triggerSpec: structuredClone(binding.triggerSpec),
        intent: source.intent,
        source: source.source,
        feedback: source.feedback,
        feedbackSpec: structuredClone(binding.feedbackSpec),
        exitIntent: source.exitIntent,
      })
    }
    chapterIds.add(chapter.id)
    nodes.push({
      id: chapter.id,
      type: 'perf',
      position: {
        x: 80 + chapterIndex * 320,
        y: 80 + (chapter.lane ?? 0) * 160,
      },
      inputs: [],
      outputs: [],
      data: {
        name: chapter.name,
        chapterSummary: beat.narrativeIntent,
        ...chapterMedia(chapter, beat, pillar),
        ...(chapter.cast ? { cast: structuredClone(chapter.cast) } : {}),
        ...(chapter.scenes ? { scenes: structuredClone(chapter.scenes) } : {}),
        interaction: {
          beat: chapter.beat,
          sourcePillarBeatId: beat.id,
          narrativeIntent: beat.narrativeIntent,
          playerInformation: [...beat.playerInformation],
          actions,
          settlements,
          ...(chapter.loop ? { loop: structuredClone(chapter.loop) } : {}),
          ...(chapter.terminals ? { terminals: structuredClone(chapter.terminals) } : {}),
        },
      },
    })
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const workingRoutes = routes.map((route) => ({ ...route, producer: { ...route.producer } }))
  const extraRoutes: CompactOutlineRouteIntent[] = []

  const ensureSameBeatResultNode = (
    sourceNode: GameNode,
    actionId: string,
    beat: NonNullable<typeof pillar.beats[number]>,
  ): GameNode => {
    const resultId = `${sourceNode.id}-${actionId}-result`
    const existing = nodeById.get(resultId)
    if (existing) return existing
    const resultNode: GameNode = {
      id: resultId,
      type: 'perf',
      position: {
        x: sourceNode.position.x + 240,
        y: sourceNode.position.y + 80,
      },
      inputs: [],
      outputs: [],
      data: {
        name: `${sourceNode.data.name ?? actionId}·结果`,
        chapterSummary: beat.narrativeIntent,
        ...chapterMedia(
          { id: resultId, name: `${sourceNode.data.name ?? actionId}·结果`, pillarBeatId: beat.id, beat: 'narrative' },
          beat,
          pillar,
        ),
        interaction: {
          beat: 'narrative',
          sourcePillarBeatId: beat.id,
          narrativeIntent: beat.narrativeIntent,
          playerInformation: [...beat.playerInformation],
          actions: [],
          settlements: [],
        },
      },
    }
    nodes.push(resultNode)
    nodeById.set(resultId, resultNode)
    return resultNode
  }

  for (const [chapterIndex, chapter] of chapters.entries()) {
    const submittedTarget = nodeById.get(chapter.id)
    if (!submittedTarget) continue
    for (const [resolutionIndex, resolution] of (chapter.resolvesActions ?? []).entries()) {
      const path = `chapters[${chapterIndex}].resolvesActions[${resolutionIndex}]`
      const sourceNode = nodeById.get(resolution.sourceNodeId)
      const sourcePlan = sourceNode?.data.interaction
      const action = sourcePlan?.actions?.find((candidate) => (
        candidate.sourcePillarActionId === resolution.pillarActionId
      ))
      if (!sourceNode || !sourcePlan || !action) {
        fail(path, `resolution source action not found: ${resolution.sourceNodeId}/${resolution.pillarActionId}`)
        continue
      }
      const sourceBeat = pillar.beats.find((candidate) => candidate.id === sourcePlan.sourcePillarBeatId)
      if (!sourceBeat) {
        fail(path, `resolution source beat not found: ${sourcePlan.sourcePillarBeatId}`)
        continue
      }
      const paired = sourceBeat.settlements.find((candidate) => candidate.sourceActionId === resolution.pillarActionId)
      if (!paired) {
        fail(path, `pillar action ${resolution.pillarActionId} has no paired settlement`)
        continue
      }
      if (paired.trigger !== resolution.triggerSpec.type) {
        fail(`${path}.triggerSpec`, `paired settlement ${paired.id} requires ${paired.trigger}`)
        continue
      }
      const sameBeat = submittedTarget.data.interaction?.sourcePillarBeatId === sourcePlan.sourcePillarBeatId
      const target = sameBeat
        ? submittedTarget
        : ensureSameBeatResultNode(sourceNode, resolution.pillarActionId, sourceBeat)
      if (!sameBeat) {
        for (const route of workingRoutes) {
          if (
            route.source !== resolution.sourceNodeId
            || route.producer.kind !== 'action'
            || route.producer.ref !== resolution.pillarActionId
            || route.target !== chapter.id
          ) continue
          extraRoutes.push({
            source: target.id,
            target: chapter.id,
            producer: { kind: 'settlement', ref: paired.id },
            narrativePayoff: paired.exitIntent,
          })
          route.target = target.id
        }
      }
      target.data.interaction!.settlements = [
        ...(target.data.interaction!.settlements ?? []),
        {
          id: paired.id,
          sourcePillarSettlementId: paired.id,
          sourcePillarActionId: resolution.pillarActionId,
          pattern: resolution.pattern ?? settlementPattern(paired.trigger, true),
          trigger: paired.trigger,
          triggerSpec: structuredClone(resolution.triggerSpec),
          intent: paired.intent,
          source: paired.source,
          feedback: paired.feedback,
          feedbackSpec: structuredClone(resolution.feedbackSpec ?? action.feedbackSpec),
          exitIntent: paired.exitIntent,
        },
      ]
      if (target.data.chapterSummary === sourceBeat.narrativeIntent && action.downstreamPayoff) {
        target.data.chapterSummary = action.downstreamPayoff
      }
    }
  }

  const edgeIds = new Set<string>()
  const evidenceIdsByNode = new Map<string, Set<string>>()
  const edges: GameEdge[] = []
  for (const [routeIndex, route] of [...workingRoutes, ...extraRoutes].entries()) {
    const routePath = `routes[${routeIndex}]`
    const sourceNode = nodeById.get(route.source)
    const targetNode = nodeById.get(route.target)
    const isEntrySeed = route.source === 'entry'
    if ((!sourceNode && !isEntrySeed) || !targetNode) {
      fail(routePath, `route references missing node: ${route.source} -> ${route.target}`)
      continue
    }
    const sourcePlan = sourceNode?.data.interaction
    let sourceHandle = route.sourceHandle
    let producer: NonNullable<NonNullable<GameEdge['data']>['design']>['producer']
    let payoff = route.narrativePayoff
    if (route.producer.kind === 'action') {
      const action = sourcePlan?.actions?.find((candidate) => candidate.sourcePillarActionId === route.producer.ref)
      if (!action) {
        fail(`${routePath}.producer.ref`, `action not found: ${route.producer.ref}`)
        continue
      }
      if (sourceHandle !== undefined && sourceHandle !== action.event) {
        fail(
          `${routePath}.sourceHandle`,
          `component-event route handle must match ${action.component}.${action.event}; received ${sourceHandle}`,
        )
        continue
      }
      sourceHandle ??= action.event
      action.exit = sourceHandle
      action.targetNodeId = route.target
      producer = { kind: 'component-event', ref: `${action.component}.${action.event}` }
      payoff ??= action.downstreamPayoff
    } else if (route.producer.kind === 'settlement') {
      const settlement = sourcePlan?.settlements?.find((candidate) => (
        candidate.id === route.producer.ref || candidate.sourcePillarSettlementId === route.producer.ref
      ))
      if (!settlement) {
        fail(`${routePath}.producer.ref`, `settlement not found: ${route.producer.ref}`)
        continue
      }
      if (sourceHandle !== undefined && sourceHandle !== settlement.id) {
        fail(
          `${routePath}.sourceHandle`,
          `settlement route handle must match ${settlement.id}; received ${sourceHandle}`,
        )
        continue
      }
      sourceHandle ??= settlement.id
      settlement.exit = sourceHandle
      settlement.targetNodeId = route.target
      producer = { kind: 'settlement', ref: settlement.id }
      payoff ??= settlement.exitIntent || settlement.intent
    } else {
      if (sourceHandle !== undefined && sourceHandle !== 'default') {
        fail(
          `${routePath}.sourceHandle`,
          `lifecycle route handle must be default; received ${sourceHandle}`,
        )
        continue
      }
      sourceHandle ??= 'default'
      producer = { kind: 'lifecycle', ref: route.producer.ref }
      payoff ??= targetNode.data.chapterSummary
    }
    if (!payoff?.trim()) {
      fail(`${routePath}.narrativePayoff`, 'route payoff is required')
      continue
    }
    const edgeId = route.id?.trim()
      || `edge-${stableSegment(route.source)}-${stableSegment(sourceHandle)}-${stableSegment(route.target)}`
    if (edgeIds.has(edgeId)) {
      fail(`${routePath}.id`, `duplicate route id: ${edgeId}`)
      continue
    }
    edgeIds.add(edgeId)
    const evidenceBase = `${sourcePlan?.sourcePillarBeatId ?? targetNode.data.interaction?.sourcePillarBeatId}/${route.producer.ref}/${route.target}`
    const usedEvidence = evidenceIdsByNode.get(route.target) ?? new Set<string>()
    let evidenceId = evidenceBase
    let evidenceSuffix = 2
    while (usedEvidence.has(evidenceId)) evidenceId = `${evidenceBase}-${evidenceSuffix++}`
    usedEvidence.add(evidenceId)
    evidenceIdsByNode.set(route.target, usedEvidence)
    targetNode.data.outcomeEvidence = [
      ...(targetNode.data.outcomeEvidence ?? []),
      { id: evidenceId, sourceEdgeId: edgeId, presentation: payoff.trim() },
    ]
    edges.push({
      id: edgeId,
      source: route.source,
      target: route.target,
      sourceHandle,
      targetHandle: route.targetHandle ?? 'in',
      data: {
        ...(route.condition ? { condition: structuredClone(route.condition) } : {}),
        ...(route.transition ? { transition: route.transition } : {}),
        design: {
          pillarBeatId: sourcePlan?.sourcePillarBeatId ?? targetNode.data.interaction?.sourcePillarBeatId!,
          producer,
          narrativePayoff: payoff.trim(),
          outcomeEvidenceId: evidenceId,
        },
      },
    })
  }
  if (errors.length > 0) return compactFailures(errors, failedPath)
  return { ok: true, nodes, edges }
}

/**
 * 把总脉络的目标状态编译为一张完整图。领域原语仍与画布一致，但调用方
 * 不再需要生成 remove/add/connect 的命令式 patch 序列。
 */
export function compileBlueprintOutline(
  inputDocument: GraphLibraryDocument,
  input: CompileBlueprintOutlineInput,
  pillar?: PillarInteractionContract,
): CompileBlueprintOutlineResult {
  const rawInput = input as unknown as Record<string, unknown>
  const forbiddenFullGraphField = ['nodes', 'edges'].find((field) => field in rawInput)
  if (forbiddenFullGraphField) {
    return {
      ok: false,
      errors: [`${forbiddenFullGraphField} is not accepted; submit compact chapters/routes intents`],
      failedPath: forbiddenFullGraphField,
    }
  }
  const document = normalizeDocument(structuredClone(inputDocument))
  const blueprintId = input.blueprintId ?? document.manifest.mainPackId
  const pack = document.manifest.packs[blueprintId]
  if (!pack) return { ok: false, errors: [`blueprint not found: ${blueprintId}`], failedPath: 'blueprintId' }
  const compact = materializeCompactOutline(input, pillar)
  if (!compact.ok) return compact
  const { nodes, edges } = compact
  if (!nodes.some((node) => node.id === input.entry)) {
    return { ok: false, errors: [`entry node not found: ${input.entry}`], failedPath: 'entry' }
  }

  const commands: BlueprintGraphCommand[] = [
    ...nodes.map((node): BlueprintGraphCommand => ({ op: 'add-node', node })),
    ...edges.map((edge): BlueprintGraphCommand => ({
      op: 'connect',
      spec: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        data: structuredClone(edge.data),
      },
    })),
  ]
  // New game templates contain a single visual entry seed. Keep that seed
  // while replacing the generated outline so routes may start at `entry`
  // without forcing the model to repeat it in every compact batch. Any
  // previously materialized outline nodes are intentionally discarded.
  const materializedNodeIds = new Set(nodes.map((node) => node.id))
  const seedNodes = input.routes.some((route) => route.source === 'entry')
    && !materializedNodeIds.has('entry')
    ? pack.graph.nodes.filter((node) => node.id === 'entry')
    : []
  const executed = executeBlueprintGraphCommands(
    { nodes: seedNodes, edges: [] } satisfies GameGraph,
    commands,
    { requireMutation: true },
  )
  if (!executed.ok) {
    const routeIndex = executed.failedCommandIndex - nodes.length
    return {
      ok: false,
      errors: executed.errors,
      failedPath: routeIndex >= 0 ? `routes/${routeIndex}` : `chapters/${executed.failedCommandIndex}`,
    }
  }
  const graph = executed.graph

  const next = normalizeDocument({
    ...document,
    manifest: {
      ...document.manifest,
      packs: {
        ...document.manifest.packs,
        [blueprintId]: {
          ...pack,
          ...(input.title?.trim() ? { title: input.title.trim() } : {}),
          entry: input.entry,
          graph,
        },
      },
    },
  })
  return {
    ok: true,
    document: next,
    blueprintId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    commandCount: commands.length,
  }
}
