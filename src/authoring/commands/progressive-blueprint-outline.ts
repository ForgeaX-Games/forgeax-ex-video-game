import type { PillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import {
  executeBlueprintGraphCommands,
  type BlueprintGraphCommand,
} from '@/authoring/commands/blueprint-graph-command'
import {
  materializeCompactOutline,
  type CompactOutlineActionIntent,
  type CompactOutlineChapterIntent,
  type CompactOutlineResolutionIntent,
  type CompactOutlineRouteIntent,
  type CompactOutlineSettlementIntent,
} from '@/authoring/commands/compile-blueprint-outline'
import type {
  GameEdge,
  GameNode,
  GraphLibraryDocument,
} from '@/runtime/core/schema/graph-schema'

export interface CreateBlueprintOutlineSkeletonInput {
  blueprintId?: string
  title?: string
  entry: string
  chapters: CompactOutlineChapterIntent[]
}

export interface ConfigureBlueprintOutlineNodeInput {
  blueprintId?: string
  nodeId: string
  beat?: CompactOutlineChapterIntent['beat']
  /**
   * 纠正节点绑定的支柱节拍。结果节点必须和它结算的动作同节拍，而这一点只有在配置
   * 出边和结算时才暴露；骨架不可重建，所以这里必须允许就地改绑，否则活动无解。
   */
  pillarBeatId?: string
  actions: CompactOutlineActionIntent[]
  settlements: CompactOutlineSettlementIntent[]
  resolvesActions?: CompactOutlineResolutionIntent[]
  outgoingRoutes: Omit<CompactOutlineRouteIntent, 'source'>[]
  cast?: CompactOutlineChapterIntent['cast']
  scenes?: CompactOutlineChapterIntent['scenes']
  loop?: CompactOutlineChapterIntent['loop']
  terminals?: CompactOutlineChapterIntent['terminals']
}

export type ProgressiveOutlineResult =
  | {
      ok: true
      document: GraphLibraryDocument
      blueprintId: string
      nodeCount: number
      edgeCount: number
      commandCount: number
      nodeId?: string
    }
  | { ok: false; errors: string[]; failedPath?: string }

function compactChapterFromNode(node: GameNode): CompactOutlineChapterIntent | undefined {
  const plan = node.data.interaction
  if (!plan?.sourcePillarBeatId) return undefined
  return {
    id: node.id,
    name: node.data.name,
    pillarBeatId: plan.sourcePillarBeatId,
    beat: plan.beat,
    ...(node.data.cast ? { cast: structuredClone(node.data.cast) } : {}),
    ...(node.data.scenes ? { scenes: structuredClone(node.data.scenes) } : {}),
    ...(node.data.storyText ? { storyText: node.data.storyText } : {}),
    ...(node.data.media?.kind === 'video' && node.data.media.prompt
      ? { videoPrompt: node.data.media.prompt }
      : {}),
    actions: (plan.actions ?? []).flatMap((action) => (
      action.sourcePillarActionId && action.feedbackSpec
        ? [{
            pillarActionId: action.sourcePillarActionId,
            component: action.component,
            event: action.event,
            ...(action.effect ? { effect: structuredClone(action.effect) } : {}),
            feedbackSpec: structuredClone(action.feedbackSpec),
          }]
        : []
    )),
    settlements: (plan.settlements ?? []).flatMap((settlement) => (
      settlement.sourcePillarSettlementId && settlement.triggerSpec && settlement.feedbackSpec
        ? [{
            pillarSettlementId: settlement.sourcePillarSettlementId,
            triggerSpec: structuredClone(settlement.triggerSpec),
            feedbackSpec: structuredClone(settlement.feedbackSpec),
            ...(settlement.pattern ? { pattern: settlement.pattern } : {}),
          }]
        : []
    )),
    ...(plan.loop ? { loop: structuredClone(plan.loop) } : {}),
    ...(plan.terminals ? { terminals: structuredClone(plan.terminals) } : {}),
  }
}

function validateSkeletonPlan(
  chapters: readonly CompactOutlineChapterIntent[],
  pillar: PillarInteractionContract | undefined,
): { ok: true } | { ok: false; errors: string[]; failedPath: string } {
  if (!pillar) return { ok: false, errors: ['compact outline requires a valid pillar interaction contract'], failedPath: 'pillar' }

  const errors: string[] = []
  for (const beat of pillar.beats) {
    if (beat.actions.length === 0) continue
    const hasInteractiveChapter = chapters.some((chapter) => (
      chapter.pillarBeatId === beat.id && chapter.beat !== 'narrative'
    ))
    if (!hasInteractiveChapter) {
      // 绝大多数情况不是「章节类型选错了」，而是这一拍根本没人能走到：不可达的
      // 节点在编译时被剪掉，于是它的章节整个消失。最常见的成因是战斗拍只写了
      // 回边、没写带 exit 的离场结算，把它后面的所有节拍一起悬空。
      // 报成「改章节类型」会把策划引去改一个没错的地方。
      errors.push(
        `节拍 ${beat.id} 写了 ${beat.actions.length} 个动作，但它在编译图里不可达，章节已被剪掉。`
          + '检查有没有任何动作或结算的 exit 指向它：'
          + '战斗拍的动作指回自己时，必须另写一条 trigger="state" 且带 exit 的系统结算把流程送出去。',
      )
    }
    // 数值动作的结算只能落在同节拍的结果节点上。骨架是唯一还能自由选择节点归属的时刻，
    // 漏掉这个节点的话，后面逐节点配置时无论怎么改都补不回来。
    const settledActions = beat.actions.filter((action) => (
      action.stateMutationOwner === 'settlement'
      && beat.settlements.some((settlement) => settlement.sourceActionId === action.id)
    ))
    if (settledActions.length === 0) continue
    const hasResultChapter = chapters.some((chapter) => (
      chapter.pillarBeatId === beat.id && chapter.beat === 'narrative'
    ))
    if (!hasResultChapter) {
      errors.push(
        `pillar beat ${beat.id} settles ${settledActions.map((action) => action.id).join(', ')} `
          + `but the skeleton has no narrative result chapter bound to ${beat.id}; add one narrative `
          + `chapter with pillarBeatId="${beat.id}" for this beat's settled actions — result chapters live in the beat of `
          + 'the action they settle, not in the beat the story moves on to',
      )
    }
  }

  for (const chapter of chapters) {
    const beat = pillar.beats.find((candidate) => candidate.id === chapter.pillarBeatId)
    if (!beat || chapter.beat !== 'combat') continue
    if (!beat.actions.some((action) => action.requiredRole === 'combat-command')) {
      errors.push(
        `chapter ${chapter.id} is combat, but pillar beat ${beat.id} has no combat-command action`,
      )
    }
  }

  return errors.length > 0
    ? { ok: false, errors, failedPath: 'chapters' }
    : { ok: true }
}

function withGraph(
  document: GraphLibraryDocument,
  blueprintId: string,
  graph: { nodes: GameNode[]; edges: GameEdge[] },
  title?: string,
  entry?: string,
): GraphLibraryDocument {
  const pack = document.manifest.packs[blueprintId]!
  return normalizeDocument({
    ...document,
    manifest: {
      ...document.manifest,
      packs: {
        ...document.manifest.packs,
        [blueprintId]: {
          ...pack,
          ...(title?.trim() ? { title: title.trim() } : {}),
          ...(entry ? { entry } : {}),
          graph,
        },
      },
    },
  })
}

export function createBlueprintOutlineSkeleton(
  inputDocument: GraphLibraryDocument,
  input: CreateBlueprintOutlineSkeletonInput,
  pillar?: PillarInteractionContract,
): ProgressiveOutlineResult {
  const document = normalizeDocument(structuredClone(inputDocument))
  const blueprintId = input.blueprintId ?? document.manifest.mainPackId
  if (!document.manifest.packs[blueprintId]) {
    return { ok: false, errors: [`blueprint not found: ${blueprintId}`], failedPath: 'blueprintId' }
  }
  const skeletonValidation = validateSkeletonPlan(input.chapters, pillar)
  if (!skeletonValidation.ok) return skeletonValidation
  const compact = materializeCompactOutline({
    entry: input.entry,
    chapters: input.chapters,
    routes: [],
  }, pillar)
  if (!compact.ok) return compact
  if (!compact.nodes.some((node) => node.id === input.entry)) {
    return { ok: false, errors: [`entry node not found: ${input.entry}`], failedPath: 'entry' }
  }
  const commands = compact.nodes.map((node): BlueprintGraphCommand => ({ op: 'add-node', node }))
  const executed = executeBlueprintGraphCommands({ nodes: [], edges: [] }, commands, { requireMutation: true })
  if (!executed.ok) {
    return {
      ok: false,
      errors: executed.errors,
      failedPath: `chapters/${executed.failedCommandIndex}`,
    }
  }
  const next = withGraph(document, blueprintId, executed.graph, input.title, input.entry)
  return {
    ok: true,
    document: next,
    blueprintId,
    nodeCount: executed.graph.nodes.length,
    edgeCount: 0,
    commandCount: commands.length,
  }
}

function removeOutgoingEvidence(nodes: GameNode[], edgeIds: ReadonlySet<string>): GameNode[] {
  if (edgeIds.size === 0) return nodes
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      ...(node.data.outcomeEvidence
        ? { outcomeEvidence: node.data.outcomeEvidence.filter((item) => !edgeIds.has(item.sourceEdgeId)) }
        : {}),
    },
  }))
}

export function configureBlueprintOutlineNode(
  inputDocument: GraphLibraryDocument,
  input: ConfigureBlueprintOutlineNodeInput,
  pillar?: PillarInteractionContract,
): ProgressiveOutlineResult {
  const document = normalizeDocument(structuredClone(inputDocument))
  const blueprintId = input.blueprintId ?? document.manifest.mainPackId
  const pack = document.manifest.packs[blueprintId]
  if (!pack) return { ok: false, errors: [`blueprint not found: ${blueprintId}`], failedPath: 'blueprintId' }
  const currentNode = pack.graph.nodes.find((node) => node.id === input.nodeId)
  if (!currentNode) return { ok: false, errors: [`node not found: ${input.nodeId}`], failedPath: 'nodeId' }
  const currentChapter = compactChapterFromNode(currentNode)
  if (!currentChapter) {
    return { ok: false, errors: [`node has no outline skeleton: ${input.nodeId}`], failedPath: 'nodeId' }
  }
  const requestedBeat = input.beat ?? currentChapter.beat
  if (requestedBeat === 'narrative' && input.actions.length > 0) {
    return {
      ok: false,
      errors: [`node ${input.nodeId} is narrative but received ${input.actions.length} action(s); use beat=choice/combat/check/timed or remove actions`],
      failedPath: 'beat',
    }
  }
  if (requestedBeat !== 'narrative' && input.actions.length === 0) {
    return {
      ok: false,
      errors: [`node ${input.nodeId} is ${requestedBeat} but received no actions; use beat=narrative if it is display-only`],
      failedPath: 'actions',
    }
  }
  const chapters = pack.graph.nodes.flatMap((node) => {
    const chapter = compactChapterFromNode(node)
    if (!chapter) return []
    if (node.id !== input.nodeId) return [chapter]
    return [{
      ...chapter,
      ...(input.beat !== undefined ? { beat: input.beat } : {}),
      ...(input.pillarBeatId !== undefined ? { pillarBeatId: input.pillarBeatId } : {}),
      actions: structuredClone(input.actions),
      settlements: structuredClone(input.settlements),
      resolvesActions: structuredClone(input.resolvesActions ?? []),
      ...(input.cast !== undefined ? { cast: structuredClone(input.cast) } : {}),
      ...(input.scenes !== undefined ? { scenes: structuredClone(input.scenes) } : {}),
      ...(input.loop !== undefined ? { loop: structuredClone(input.loop) } : {}),
      ...(input.terminals !== undefined ? { terminals: structuredClone(input.terminals) } : {}),
    }]
  })
  // 结算只能落在与源动作同节拍的结果节点上。跨节拍时 materialize 会把结算改写到别的节点
  // （新建影子节点或复用同名节点），而下面的写回只保留 input.nodeId，那份结算会被丢掉——
  // 工具报成功、图上却没变，调用方只能原地打转。先在这里拦下并指出该改哪个字段。
  const boundBeatId = input.pillarBeatId ?? currentChapter.pillarBeatId
  const crossBeatResolutions = (input.resolvesActions ?? []).flatMap((resolution) => {
    const sourceBeatId = pack.graph.nodes
      .find((node) => node.id === resolution.sourceNodeId)?.data.interaction?.sourcePillarBeatId
    return sourceBeatId && sourceBeatId !== boundBeatId
      ? [{ ...resolution, sourceBeatId }]
      : []
  })
  if (crossBeatResolutions.length > 0) {
    return {
      ok: false,
      errors: crossBeatResolutions.map((resolution) => (
        `node ${input.nodeId} is bound to pillar beat ${boundBeatId}, but it resolves `
        + `${resolution.sourceNodeId}/${resolution.pillarActionId} from pillar beat ${resolution.sourceBeatId}; `
        + 'a settlement must sit on a result node in the same beat as the action it settles. '
        + `Re-send this call with pillarBeatId="${resolution.sourceBeatId}" — the node keeps its id, incoming `
        + `edges and chapter name — or move this resolution onto a node already bound to ${resolution.sourceBeatId}.`
      )),
      failedPath: 'resolvesActions',
    }
  }

  const routes = input.outgoingRoutes.map((route) => ({ ...structuredClone(route), source: input.nodeId }))
  const compact = materializeCompactOutline({
    entry: pack.entry,
    chapters,
    routes,
  }, pillar)
  if (!compact.ok) return compact
  // 兜底：写回只覆盖 input.nodeId，所以 materialize 不允许要求新增节点。
  // 上面的同节拍校验已经拦掉了已知来源，这里避免以后有新路径再次静默丢改动。
  const droppedNodes = compact.nodes.filter((node) => (
    !pack.graph.nodes.some((existing) => existing.id === node.id)
  ))
  if (droppedNodes.length > 0) {
    return {
      ok: false,
      errors: [
        `configuring ${input.nodeId} would require creating node(s) `
        + `${droppedNodes.map((node) => node.id).join(', ')}, but a node transaction can only write ${input.nodeId}; `
        + '配置只能改当前节点，请把这些结算放到骨架里已有的同节拍结果节点上。',
      ],
      failedPath: 'resolvesActions',
    }
  }
  const desiredNode = compact.nodes.find((node) => node.id === input.nodeId)!
  const oldEdgeIds = new Set(
    pack.graph.edges.filter((edge) => edge.source === input.nodeId).map((edge) => edge.id),
  )
  let graph = {
    nodes: removeOutgoingEvidence(structuredClone(pack.graph.nodes), oldEdgeIds),
    edges: structuredClone(pack.graph.edges),
  }
  const disconnected = executeBlueprintGraphCommands(
    graph,
    [...oldEdgeIds].map((edgeId): BlueprintGraphCommand => ({ op: 'disconnect', edgeId })),
  )
  if (!disconnected.ok) return { ok: false, errors: disconnected.errors, failedPath: 'outgoingRoutes' }
  graph = disconnected.graph
  graph.nodes = graph.nodes.map((node) => (
    node.id === input.nodeId
      ? {
          ...node,
          data: {
            ...structuredClone(desiredNode.data),
            ...(node.data.outcomeEvidence ? { outcomeEvidence: structuredClone(node.data.outcomeEvidence) } : {}),
          },
        }
      : node
  ))
  const connected = executeBlueprintGraphCommands(
    graph,
    compact.edges.map((edge): BlueprintGraphCommand => ({
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
    { requireMutation: true },
  )
  if (!connected.ok) return { ok: false, errors: connected.errors, failedPath: 'outgoingRoutes' }
  graph = connected.graph
  const newEdgeIds = new Set(compact.edges.map((edge) => edge.id))
  graph.nodes = graph.nodes.map((node) => {
    const materialized = compact.nodes.find((candidate) => candidate.id === node.id)
    const additions = (materialized?.data.outcomeEvidence ?? [])
      .filter((item) => newEdgeIds.has(item.sourceEdgeId))
    if (additions.length === 0) return node
    const retained = (node.data.outcomeEvidence ?? [])
      .filter((item) => !newEdgeIds.has(item.sourceEdgeId))
    return { ...node, data: { ...node.data, outcomeEvidence: [...retained, ...structuredClone(additions)] } }
  })
  const next = withGraph(document, blueprintId, graph)
  return {
    ok: true,
    document: next,
    blueprintId,
    nodeId: input.nodeId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    commandCount: oldEdgeIds.size + compact.edges.length + 1,
  }
}
