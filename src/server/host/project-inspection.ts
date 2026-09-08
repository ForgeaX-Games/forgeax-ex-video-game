import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createHostAssetRegistry, listHostDocuments, readHostDocument, readHostManifest } from '../asset-registry'
import { languageConsistencyIssues, nodeLanguageIssues } from '@/authoring/blueprint/language-consistency'
import { eventsFromParams } from '@/runtime/core/schema/graph-schema'
import { expandNodeOverlays } from '@/runtime/core/schema/expand-overlay'
import { resolveOverlayReaction } from '@/runtime/core/schema/overlay-events'
import { collectRefs } from '@/runtime/core/engine/expr'
import { ownerForIssueCode } from './issue-owner'
import { componentContractMap, type ComponentContract } from './component-catalog'
import { SETTLEMENT_ADVANCE_HANDLE_PREFIX } from '@/authoring/graph/flow-handle-labels'
import { isCurrentCharacterPreview, requiredCharacterPreviewTargets } from '../generation/character-previews'
import { isCurrentScenePreview, requiredScenePreviewTargets } from '../generation/scene-previews'
import { validateFormulaCalls } from '@/authoring/blueprint/formula-authoring'
import type {
  CharacterDefinition,
  MediaAsset,
  SceneDefinition,
  VideoDefinition,
} from '@/authoring/assets/registry-types'
import { normalizeDocument, validateDocument } from '@/authoring/blueprint/blueprint-project'
import type { GraphLibraryDocument, GameNode } from '@/runtime/core/schema/graph-schema'
import { isPosition } from '@/runtime/core/schema/react-flow-schema'
import { validateNodeVideoGenerationPreset } from '@/runtime/core/schema/node-video-preset'
import { parseDesignOptions } from '@/authoring/documents/core-design-options'
import {
  readDocumentRevision,
  readMutationReceipts,
} from './document-revision'
import {
  EMPTY_CONTENT_INVENTORY,
  type ContentInventory,
} from './workflow-state'
import type {
  ValidationEvidence,
  ValidationIssue,
  ValidationSummary,
  VideoGameActivity,
  VideoGameWorkflowState,
  PageLocation,
} from '../../workflow/contracts'
import { assetEntityDefinitions } from './asset-entity-catalog'
import { componentLayoutIssue } from './component-layout'
import { workScaleBudgetFromContract } from '../../workflow/work-scale-budget'
import { expandCheckIds } from '../../workflow/validation-check-groups'

const decoder = new TextDecoder()
const BLUEPRINT_FILE = 'blueprint.json'

export interface ProjectInspection {
  project: GraphLibraryDocument | null
  projectRevision: number
  inventory: ContentInventory
  documentContents: Partial<Record<'intake' | 'design-options' | 'core' | 'inquiry' | 'pillar', string>>
  issues: ValidationIssue[]
  qualityMetrics: BlueprintQualityMetrics
  assetEntities: {
    characters: Record<string, CharacterDefinition>
    scenes: Record<string, SceneDefinition>
    videos: Record<string, VideoDefinition>
  }
}

export interface BlueprintQualityMetrics {
  interactionDensity: number
  maxBattlepackLoopDepth: number | null
  decisionConsequenceRate: number
  stateActivityRate: number
  formulaConsumptionRate: number
  feedbackCoverageRate: number
  differentiatedEndingCount: number
}

function parseProject(bytes: Uint8Array | null): GraphLibraryDocument | null {
  if (!bytes) return null
  try {
    return normalizeDocument(JSON.parse(decoder.decode(bytes)) as GraphLibraryDocument)
  } catch {
    return null
  }
}

function issue(code: string, message: string, location?: PageLocation): ValidationIssue {
  // owner 由码推导：只读活动要靠它决定 report_blocker 时说返工哪一步。
  const owner = ownerForIssueCode(code)
  return { level: 'error', code, message, ...(location ? { location } : {}), ...(owner ? { owner } : {}) }
}

function warningIssue(code: string, message: string, location?: PageLocation): ValidationIssue {
  return { ...issue(code, message, location), level: 'warning' }
}

export function countAuthoredUi(overlays: Record<string, unknown> | undefined): number {
  return Object.keys(overlays ?? {}).filter((overlayId) => !overlayId.startsWith('base:')).length
}

export function countConfiguredUi(project: GraphLibraryDocument | null): number {
  if (!project) return 0
  return Object.values(project.manifest.packs).reduce((count, blueprint) => (
    count + blueprint.graph.nodes.reduce((nodeCount, node) => (
      nodeCount + (node.data.overlayNodes?.length ?? 0)
    ), 0)
  ), 0)
}

const NO_CUSTOM_UI_CONTRACT = /(?:无需|不需要|不要求|不使用)(?:任何)?(?:自定义|额外)\s*(?:UI|界面)|(?:仅|只)(?:使用|保留)(?:平台|系统)?(?:内置|默认)\s*(?:UI|界面)|\bno\s+custom\s+(?:ui|interface)\b/iu

export function uiNotRequiredByPillar(inspected: ProjectInspection): boolean {
  return inspected.inventory.uiCount === 0
    && NO_CUSTOM_UI_CONTRACT.test(inspected.documentContents.pillar ?? '')
}

function collectQualityReferences(value: unknown, vars: Set<string>, formulas: Set<string>): void {
  if (value == null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item) => collectQualityReferences(item, vars, formulas))
    return
  }
  const object = value as Record<string, unknown>
  if (typeof object.expr === 'string') {
    try {
      const refs = collectRefs(object.expr)
      refs.vars.forEach((id) => vars.add(id))
      refs.formulas.forEach((id) => formulas.add(id))
    } catch {
      // Structural validation reports malformed expressions separately.
    }
  }
  if (object.type === 'var' && typeof object.varId === 'string') vars.add(object.varId)
  if ((object.kind === 'var' || object.kind === 'flag') && typeof object.varId === 'string') {
    vars.add(object.varId)
  }
  const ref = object.ref
  if (ref && typeof ref === 'object') {
    const rawRef = ref as Record<string, unknown>
    if (rawRef.kind === 'var' && typeof rawRef.varId === 'string') vars.add(rawRef.varId)
    if (rawRef.kind === 'formula' && typeof rawRef.formulaId === 'string') formulas.add(rawRef.formulaId)
  }
  Object.values(object).forEach((child) => collectQualityReferences(child, vars, formulas))
}

function graphCycleDepth(graph: { nodes: Array<{ id: string }>, edges: Array<{ source: string, target: string }> }): number | null {
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }
  let max = 0
  const visit = (id: string, path: string[]): void => {
    const index = path.indexOf(id)
    if (index >= 0) {
      max = Math.max(max, path.length - index)
      return
    }
    for (const next of outgoing.get(id) ?? []) visit(next, [...path, id])
  }
  graph.nodes.forEach((node) => visit(node.id, []))
  return max > 0 ? max : null
}

export function calculateBlueprintQualityMetrics(project: GraphLibraryDocument): BlueprintQualityMetrics {
  const nodes = allNodes(project)
  const interactive = nodes.filter(({ node }) => node.data.interaction?.beat !== undefined && node.data.interaction.beat !== 'narrative').length
  const decisionCounts = { total: 0, valid: 0 }
  const stateVars = new Set<string>()
  const formulaRefs = new Set<string>()
  let numericEventReactions = 0
  let feedbackReactions = 0
  for (const { node } of nodes) {
    for (const action of node.data.interaction?.actions ?? []) {
      const exit = action.exit ?? action.event
      if (exit === 'none') continue
      decisionCounts.total += 1
      const edgeTargets = Object.values(project.manifest.packs)
        .flatMap((pack) => pack.graph.edges)
        .filter((edge) => edge.source === node.id && (edge.sourceHandle ?? 'default') === exit)
        .map((edge) => edge.target)
      if (edgeTargets.length > 0 && new Set(edgeTargets).size > 1) decisionCounts.valid += 1
    }
    collectQualityReferences(node.data, stateVars, formulaRefs)
    for (const mount of node.data.overlayNodes ?? []) {
      for (const reaction of mount.reactions ?? []) {
        if (reaction.when.type !== 'event') continue
        const hasNumericEffect = reaction.do.some((action) => (
          action.kind === 'effect'
          && action.effects.some((effect) => effect.kind === 'attr' || effect.kind === 'var')
        ))
        if (!hasNumericEffect) continue
        numericEventReactions += 1
        if (reaction.do.some((action) => action.kind === 'spawn')) feedbackReactions += 1
      }
    }
  }
  collectQualityReferences(project.ui?.overlays ?? {}, stateVars, formulaRefs)
  collectQualityReferences(project.formulas ?? {}, stateVars, formulaRefs)
  const cycleDepths = Object.values(project.manifest.packs)
    .map((pack) => graphCycleDepth(pack.graph))
    .filter((depth): depth is number => depth !== null)
  const endingCount = nodes.filter(({ blueprintId, node }) => {
    const pack = project.manifest.packs[blueprintId]
    return !pack?.graph.edges.some((edge) => edge.source === node.id)
  }).length
  const variableCount = Object.keys(project.variables ?? {}).length
  const formulaCount = Object.keys(project.formulas ?? {}).length
  return {
    interactionDensity: nodes.length === 0 ? 0 : interactive / nodes.length,
    maxBattlepackLoopDepth: cycleDepths.length > 0 ? Math.max(...cycleDepths) : null,
    decisionConsequenceRate: decisionCounts.total === 0 ? 0 : decisionCounts.valid / decisionCounts.total,
    stateActivityRate: variableCount === 0 ? 0 : [...stateVars].filter((id) => id in (project.variables ?? {})).length / variableCount,
    formulaConsumptionRate: formulaCount === 0 ? 0 : [...formulaRefs].filter((id) => id in (project.formulas ?? {})).length / formulaCount,
    feedbackCoverageRate: numericEventReactions === 0 ? 0 : feedbackReactions / numericEventReactions,
    differentiatedEndingCount: endingCount,
  }
}

export async function inspectProject(context: ExtensionContext): Promise<ProjectInspection> {
  const [bytes, documents, assets, assetManifest] = await Promise.all([
    context.files.read(BLUEPRINT_FILE),
    listHostDocuments(context).catch(() => []),
    createHostAssetRegistry(context).list().catch(() => []),
    readHostManifest(context.files),
  ])
  const project = parseProject(bytes)
  const { characters, scenes, videos } = assetEntityDefinitions(assetManifest)
  const documentContents: ProjectInspection['documentContents'] = {}
  await Promise.all(documents.map(async (document) => {
    const value = await readHostDocument(context, document.id)
    if (value) documentContents[document.meta.documentType] = value.content
  }))
  const documentCounts: ContentInventory['documents'] = {}
  documents.forEach((document) => {
    documentCounts[document.meta.documentType] = (documentCounts[document.meta.documentType] ?? 0) + 1
  })
  const blueprints = Object.values(project?.manifest.packs ?? {})
  const inventory: ContentInventory = {
    ...EMPTY_CONTENT_INVENTORY,
    documents: documentCounts,
    blueprintCount: blueprints.length,
    blueprintNodeCount: blueprints.reduce((sum, blueprint) => sum + blueprint.graph.nodes.length, 0),
    // `base:*` definitions are seeded capabilities; an actual node mount is
    // what proves UI authoring has started.
    uiCount: countConfiguredUi(project),
    characterCount: Object.keys(characters).length,
    sceneCount: Object.keys(scenes).length,
    entityCount: Object.keys(project?.entities ?? {}).length,
    variableCount: Object.keys(project?.variables ?? {}).length,
    formulaCount: Object.keys(project?.formulas ?? {}).length,
    videoCount: Math.max(Object.keys(videos).length, assets.filter((asset) => asset.kind === 'video').length),
    imageCount: assets.filter((asset) => asset.kind === 'image').length,
    audioCount: assets.filter((asset) => asset.kind === 'audio').length,
    fontCount: 0,
  }
  const issues = project
    ? validateDocument(project).map((message) => issue('project.invalid', message))
    : [issue('project.missing', 'blueprint.json is missing or invalid')]
  return {
    project,
    projectRevision: readDocumentRevision(bytes),
    inventory,
    documentContents,
    issues,
    qualityMetrics: project ? calculateBlueprintQualityMetrics(project) : {
      interactionDensity: 0,
      maxBattlepackLoopDepth: null,
      decisionConsequenceRate: 0,
      stateActivityRate: 0,
      formulaConsumptionRate: 0,
      feedbackCoverageRate: 0,
      differentiatedEndingCount: 0,
    },
    assetEntities: { characters, scenes, videos },
  }
}

function designOptionIssues(content: string | undefined): ValidationIssue[] {
  const location: PageLocation = { kind: 'document', documentType: 'design-options' }
  if (!content?.trim()) {
    return [issue('document.design-options.missing', '核心方案候选文档尚未登记', location)]
  }
  try {
    parseDesignOptions(content)
    return []
  } catch (error) {
    return [issue(
      'document.design-options.invalid',
      error instanceof Error ? error.message : '核心方案候选文档无效',
      location,
    )]
  }
}

/**
 * 文档内容校验：只查「文件登记了」等于把门做成摆设。
 *
 * 一份只有标题的支柱文档能通过存在性检查，却无法驱动总脉络——
 * 下游拿着空壳文档继续跑，问题会在几步之后才以别的形式爆出来。
 */
function documentSubstanceIssues(
  documentType: 'core' | 'inquiry' | 'pillar',
  content: string | undefined,
): ValidationIssue[] {
  const location: PageLocation = { kind: 'document', documentType }
  const text = content?.trim() ?? ''
  if (!text) {
    return [issue(`document.${documentType}.missing`, `${DOCUMENT_LABEL[documentType]}尚未登记`, location)]
  }
  const issues: ValidationIssue[] = []
  // 去掉标题行后仍要有正文：只有一行标题的文档不算写完。
  const body = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim()
  if (body.length < DOCUMENT_MIN_BODY[documentType]) {
    issues.push(issue(
      `document.${documentType}.too-thin`,
      `${DOCUMENT_LABEL[documentType]}正文过短，无法驱动下游（当前 ${body.length} 字，至少 ${DOCUMENT_MIN_BODY[documentType]} 字）`,
      location,
    ))
  }
  const missingSections = DOCUMENT_REQUIRED_SECTIONS[documentType]
    .filter((keyword) => !text.includes(keyword))
  if (missingSections.length > 0) {
    issues.push(issue(
      `document.${documentType}.missing-section`,
      `${DOCUMENT_LABEL[documentType]}缺少必要内容：${missingSections.join('、')}`,
      location,
    ))
  }
  return issues
}

const DOCUMENT_LABEL = {
  core: '核心方向文档',
  inquiry: '关键取舍文档',
  pillar: '游戏支柱文档',
} as const

/**
 * 门槛只用来挡住「只有标题」这类空壳，不追求篇幅。
 * 一份紧凑但写清了角色、场景、主循环和数值的支柱大约百字量级，取值以此为准。
 */
const DOCUMENT_MIN_BODY = { core: 60, inquiry: 20, pillar: 90 } as const

/**
 * 必要内容用关键词判定而不是结构解析：这些文档由 Agent 自由撰写，
 * 强制结构会让它把精力花在排版上；关键词只钉住「这几件事必须谈到」。
 */
const DOCUMENT_REQUIRED_SECTIONS = {
  core: ['主循环'],
  inquiry: [],
  pillar: ['角色', '场景'],
} as const

/** 本作是否缺必要界面。支柱明确写了不需要就算合法（`not-required` 的依据）。 */
/** 声明补完检查：外观描述与出图提示词都要有内容。 */
function characterDefinitionIssues(characters: Readonly<Record<string, CharacterDefinition>>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [id, character] of Object.entries(characters)) {
    const description = character.appearance?.description?.trim() ?? ''
    const prompt = character.appearance?.previewPrompt?.trim() ?? ''
    if (description && prompt) continue
    issues.push(issue(
      'characters.definition.incomplete',
      `角色 ${character.name || id} 仍是声明：${!description ? '缺外观描述' : ''}${!description && !prompt ? '，' : ''}${!prompt ? '缺出图提示词' : ''}`,
      { kind: 'asset', root: 'character', entryId: id },
    ))
  }
  return issues
}

function characterCatalogIssues(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
): ValidationIssue[] {
  const { characterIds } = declaredReferences(project)
  const issues: ValidationIssue[] = []
  for (const characterId of [...characterIds].sort()) {
    const character = characters[characterId]
    if (!character) {
      issues.push(issue(
        'characters.catalog.undeclared',
        `节点引用了尚未建模的角色 ${characterId}`,
        { kind: 'asset', root: 'character', entryId: characterId },
      ))
      continue
    }
    issues.push(...characterDefinitionIssues({ [characterId]: character }))
  }
  return issues
}

// ── 逻辑自洽（playtest.validating）────────────────────────────────────────────
//
// 整装完成时游戏还没有成片，但 GraphSession 的路由、事件、条件、reaction 与结算语义
// 不依赖真实媒体资源。因此本活动先做结构与引用检查，再由 validate_project 补充一次
// `blueprint-logic-only` 的真实引擎推演。它验证“互动设计能否按 runtime 语义成立”，
// 不加载播放器，也不代表作者已经看过真实视频成片。

/**
 * 从某节点出发能否走到一个**停得下来的地方**。
 *
 * 判据不是「有没有结局」，而是引擎会不会停：`advanceAuto` 在没有自动出边时
 *   - 也没有事件出边 → `finishEnd()`，本局结束（这就是结局）；
 *   - 有事件出边 → 停在本节点等玩家 emit（声明式等待）。
 * 两种都算停得下来。所以「所有结局都由玩家点『再来一局』回到开头」这种无限循环设计是合法的——
 * 观众随时能停在结局画面上。只有**自动出边构成的循环**才是坏的：观众被一直拖着走，点什么都没用。
 */
function restReachability(
  nodes: readonly GameNode[],
  edges: readonly { source: string, target: string, sourceHandle?: string }[],
): { canReachRest: Set<string>, restPoints: Set<string>, endings: Set<string> } {
  const outgoing = new Map<string, string[]>()
  const autoOutgoing = new Map<string, string[]>()
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    // 自动推进只看默认出口；事件出口要玩家触发。
    if (edge.sourceHandle === undefined || edge.sourceHandle === 'default') {
      autoOutgoing.set(edge.source, [...(autoOutgoing.get(edge.source) ?? []), edge.target])
    }
  }
  const restPoints = new Set(nodes
    .filter((node) => (autoOutgoing.get(node.id) ?? []).length === 0)
    .map((node) => node.id))
  const endings = new Set(nodes
    .filter((node) => (outgoing.get(node.id) ?? []).length === 0)
    .map((node) => node.id))
  const canReachRest = new Set(restPoints)
  // 反向传播：只要有一个后继能停下来，自己就能。重复扫到不再变化为止。
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (canReachRest.has(node.id)) continue
      if ((outgoing.get(node.id) ?? []).some((next) => canReachRest.has(next))) {
        canReachRest.add(node.id)
        changed = true
      }
    }
  }
  return { canReachRest, restPoints, endings }
}

/**
 * 死循环：能从 entry 走到、但**无论怎么走都回不到任何终局**的节点。
 *
 * 环本身是合法的（回溯、重试都会成环），不合法的是「进去就出不来」。
 */
function deadLoopIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    const { nodes, edges } = blueprint.graph
    const nodeIds = new Set(nodes.map((node) => node.id))
    if (!nodeIds.has(blueprint.entry)) continue
    const reachable = new Set<string>()
    const queue = [blueprint.entry]
    while (queue.length) {
      const nodeId = queue.shift()!
      if (reachable.has(nodeId)) continue
      reachable.add(nodeId)
      edges.filter((edge) => edge.source === nodeId).forEach((edge) => queue.push(edge.target))
    }
    const { canReachRest, restPoints } = restReachability(nodes, edges)
    // 整张图都停不下来时，逐节点报「进去出不来」是噪声：全红，而问题只有一个。
    if (restPoints.size === 0) {
      issues.push(issue(
        'playtest.no-rest-point',
        `蓝图 ${blueprintId} 全部由默认出边串成循环，观众会被一直自动拖着走、无法停下。`
        + '一个节点只要没有默认出边就停得下来：没有任何出边即结局，'
        + '只有事件出边则停在那里等观众点击。'
        + '想做「玩完还能再来一轮」的循环设计，把回到开头那条边改成玩家点击触发的事件出口即可。',
        { kind: 'blueprint', blueprintId, nodeId: blueprint.entry },
      ))
      continue
    }
    for (const nodeId of [...reachable].sort()) {
      if (canReachRest.has(nodeId)) continue
      issues.push(issue(
        'playtest.dead-loop',
        `节点 ${nodeId} 进入后被默认出边一直自动带着走，永远停不下来：`
        + '这一段既到不了结局，也没有任何等观众点击的地方',
        { kind: 'blueprint', blueprintId, nodeId },
      ))
    }
  }
  return issues
}

/**
 * 孤岛与悬空出边：指向不存在节点的边、从 entry 不可达的节点、
 * 以及同一出口重复连出去（同一 handle 连了多条边，运行时只会走一条）。
 */
function orphanExitIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [...graphConnectivityIssues(project)]
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    const nodeIds = new Set(blueprint.graph.nodes.map((node) => node.id))
    const seenHandles = new Map<string, string>()
    for (const edge of blueprint.graph.edges) {
      if (!nodeIds.has(edge.target)) {
        issues.push(issue(
          'playtest.edge.dangling',
          `边 ${edge.id} 指向不存在的节点 ${edge.target}`,
          { kind: 'blueprint', blueprintId, nodeId: edge.source },
        ))
      }
      if (!nodeIds.has(edge.source)) {
        issues.push(issue(
          'playtest.edge.orphan',
          `边 ${edge.id} 的起点 ${edge.source} 不存在`,
          { kind: 'blueprint', blueprintId },
        ))
        continue
      }
      const handleKey = `${edge.source}#${edge.sourceHandle ?? 'default'}`
      const previous = seenHandles.get(handleKey)
      if (previous) {
        issues.push(issue(
          'playtest.edge.duplicate-handle',
          `节点 ${edge.source} 的出口 ${edge.sourceHandle ?? 'default'} 连了多条边（${previous}、${edge.id}）：运行时只会走一条`,
          { kind: 'blueprint', blueprintId, nodeId: edge.source },
        ))
      } else {
        seenHandles.set(handleKey, edge.id)
      }
    }
  }
  return issues
}

/** 数值设计合理性：变量与实体属性的区间、初始值。 */
function numericSanityIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [variableId, variable] of Object.entries(project.variables ?? {})) {
    const location: PageLocation = { kind: 'rule', section: 'variables', itemId: variableId }
    const min = variable.min
    const max = variable.max
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      issues.push(issue('playtest.variable.range-inverted', `变量 ${variableId} 的 min ${min} 大于 max ${max}`, location))
    }
    const initial = variable.initial
    if (typeof initial === 'number') {
      if (typeof min === 'number' && initial < min) {
        issues.push(issue('playtest.variable.initial-out-of-range', `变量 ${variableId} 的初始值 ${initial} 低于 min ${min}`, location))
      }
      if (typeof max === 'number' && initial > max) {
        issues.push(issue('playtest.variable.initial-out-of-range', `变量 ${variableId} 的初始值 ${initial} 高于 max ${max}`, location))
      }
    }
  }
  for (const [entityId, entity] of Object.entries(project.entities ?? {})) {
    for (const [attrId, meta] of Object.entries(entity.attrMeta ?? {})) {
      const location: PageLocation = { kind: 'rule', section: 'entities', itemId: entityId }
      if (typeof meta?.min === 'number' && typeof meta?.max === 'number' && meta.min > meta.max) {
        issues.push(issue(
          'playtest.attr.range-inverted',
          `实体 ${entityId} 的属性 ${attrId} 的 min ${meta.min} 大于 max ${meta.max}`,
          location,
        ))
      }
    }
  }
  return issues
}

/** 从一组 reaction 里收集监听的事件 id（含 `childId:event` 限定形式）。 */
function listenedEventIds(reactions: readonly unknown[] | undefined): Set<string> {
  const ids = new Set<string>()
  for (const reaction of reactions ?? []) {
    if (!reaction || typeof reaction !== 'object') continue
    const when = (reaction as { when?: { type?: unknown, id?: unknown } }).when
    if (when?.type === 'event' && typeof when.id === 'string') ids.add(when.id)
  }
  return ids
}

/**
 * 取输入的常量数值；未配置时回落到 manifest 默认值。
 *
 * 回落必须与运行时一致：`BattleSkill.tsx` 用解构默认值取未传的 props，manifest
 * 没写 `default` 的输入（四个 `*Resource`）在组件里是 0。绑了表达式则返回
 * undefined，交给 `resourceUpperBound` 处理。
 */
function numericInputValue(
  value: unknown,
  contract: ComponentContract,
  key: string,
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value !== undefined) return undefined
  const fallback = contract.inputs.find((input) => input.key === key)?.default
  if (fallback === undefined) return 0
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : undefined
}

/** 资源输入的静态上界：常量取自身，`var.x` / `entity.e.attr.a` 取声明的 max。 */
function resourceUpperBound(
  value: unknown,
  contract: ComponentContract,
  key: string,
  project: GraphLibraryDocument,
): number | undefined {
  const constant = numericInputValue(value, contract, key)
  if (constant !== undefined) return constant
  const expr = (value as { expr?: unknown } | undefined)?.expr
  if (typeof expr !== 'string') return undefined
  const trimmed = expr.trim()
  const varMatch = /^var\.([A-Za-z0-9_]+)$/.exec(trimmed)
  if (varMatch) return project.variables?.[varMatch[1]!]?.max
  const attrMatch = /^entity\.([A-Za-z0-9_-]+)\.attr\.([A-Za-z0-9_]+)$/.exec(trimmed)
  if (attrMatch) return project.entities?.[attrMatch[1]!]?.attrMeta?.[attrMatch[2]!]?.max
  return undefined
}

/**
 * 事件是否被「资源不足」永久置灰——这是「本节点不提供该事件」的唯一正当表达。
 *
 * 运行时判据是 `resource < cost` ⇒ 按钮 `disabled` 且 `pick()` 直接 return，
 * 永远不 emit。**未配置一律按可点处理**：真跑证据是武松打虎那局没写 medit 的
 * 任何输入，默认 `0 < 0` 为假 ⇒ 冥想按钮亮着、点得动、没人接。
 */
function eventIsDisabledByCost(
  eventId: string,
  inputs: Record<string, unknown>,
  contract: ComponentContract,
  project: GraphLibraryDocument,
): boolean {
  const costKey = `${eventId}Cost`
  const resourceKey = `${eventId}Resource`
  const hasPair = contract.inputs.some((input) => input.key === costKey)
    && contract.inputs.some((input) => input.key === resourceKey)
  if (!hasPair) return false
  const cost = numericInputValue(inputs[costKey], contract, costKey)
  const resourceMax = resourceUpperBound(inputs[resourceKey], contract, resourceKey, project)
  return cost !== undefined && resourceMax !== undefined && resourceMax < cost
}

/**
 * 界面元件接线校验：输入键必须真实存在，抛出的事件必须有人监听。
 *
 * 真跑证据：整装给 `BattleSkill` 写了 `actions` / `entityId` 两个不存在的输入键，
 * 真实输入（`lightResource` 等）全空，也没有 reaction 监听它的 `light` / `heavy`
 * 事件——血条和技能条挂在节点上，点了没有任何反应，玩法等于没配。
 */
function componentWiringIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const contracts = componentContractMap()
  const overlays = project.ui?.overlays ?? {}
  const issues: ValidationIssue[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
      // 反向判据：出边引用的出口有没有元件提供。节点的出口 = `default` + 各挂载元件的事件
      // （见 ComponentRegistry.deriveOutputs），所以「边写了 knock 但没有元件会发 knock」
      // 等于这条分支玩家走不到——第二局编出来的 choice-A/B/C 就是这种死分支。
      const availableExits = new Set<string>(['default'])
      const exitEdgeHandles = new Set(
        blueprint.graph.edges
          .filter((edge) => edge.source === node.id && edge.sourceHandle)
          .map((edge) => edge.sourceHandle as string),
      )
      let hasCustomComponent = false
      const expandedMounts = expandNodeOverlays(overlays, node)
      for (const mount of expandedMounts) {
        for (const child of mount.children) {
          const contract = contracts.get(child.component)
          // 自建控件的契约不在内置清单里，无法判断它发什么事件。
          if (!contract) { hasCustomComponent = true; continue }
          // 与 handlesOf 同一套优先级：挂载写了 inputs.events 就以它为准（多选项按钮
          // 靠这个声明每个选项的事件 id），否则用 manifest 的静态事件表。
          const declared = eventsFromParams((child as { inputs?: Record<string, unknown> }).inputs)
          const emitted = declared.length ? declared : contract.events
          for (const event of emitted) availableExits.add(event.id)
        }
      }
      if (!hasCustomComponent) {
        for (const edge of blueprint.graph.edges) {
          if (edge.source !== node.id) continue
          const handle = edge.sourceHandle ?? 'default'
          if (availableExits.has(handle)) continue
          issues.push(issue(
            'ui.exit.no-source',
            `边 ${edge.id} 从节点 ${node.id} 的出口 ${handle} 出发，`
            + `但节点上没有任何元件会发 ${handle} 事件：这条分支玩家走不到。`
            + `当前可用出口：${[...availableExits].join('、')}`,
            location,
          ))
        }
      }
      for (const mount of expandedMounts) {
        // 提示词与运行时的正式写法是挂载级 `overlayNodes[].reactions`
        // （`expandOverlayMount` 把它挂到 instance 上）；只读 `node.data.reactions`
        // 会把正确接线判成没接。
        const mountListened = listenedEventIds(mount.reactions)
        const nodeMount = (node.data.overlayNodes ?? []).find((candidate) => (
          (candidate.id ?? candidate.overlay) === mount.mountId
        ))
        const mountChildren = mount.children
        const mountContract = mountChildren
          .map((child) => contracts.get(child.component))
          .find((contract): contract is NonNullable<typeof contract> => Boolean(contract))
        const mountLayoutIssue = componentLayoutIssue(nodeMount?.layout, mountContract?.layout)
        if (mountLayoutIssue) {
          issues.push(issue(
            mountLayoutIssue.code,
            `节点 ${node.id} 的挂载 ${mount.overlayId}：${mountLayoutIssue.message}`,
            location,
          ))
        }
        for (const child of mountChildren) {
          const contract = contracts.get(child.component)
          // 项目自建控件不在内置清单里，跳过（它们的契约由 upsert_component 定义）。
          if (!contract) continue
          const layoutIssue = componentLayoutIssue(child.layout, contract.layout)
          if (layoutIssue) {
            issues.push(issue(
              layoutIssue.code,
              `节点 ${node.id} 的 ${child.component}：${layoutIssue.message}`,
              location,
            ))
          }
          const allowed = new Set(contract.inputs.map((input) => input.key))
          for (const key of Object.keys((child as { inputs?: Record<string, unknown> }).inputs ?? {})) {
            if (allowed.has(key)) continue
            issues.push(issue(
              'ui.component.unknown-input',
              `节点 ${node.id} 的 ${child.component} 写了不存在的输入 ${key}；`
              + `可用输入：${[...allowed].join('、') || '（无）'}`,
              location,
            ))
          }
          // 交互元件挂上去却没人听它的事件 = 玩家点了没反应。
          const emits = contract.events.map((event) => event.id)
          if (emits.length === 0) continue
          // 事件有两种正当消费方式：reaction 监听，或**出边的 sourceHandle 对齐**——
          // 引擎里 `selectHandleEdgeInScope` 命中 handle 就直接跳转，不需要 reaction。
          const childInputs = (child as { inputs?: Record<string, unknown> }).inputs ?? {}
          const catalogReactions = overlays[child.source.overlayId]?.reactions
          // `some` 会让「四招只接一招」满分通过——真跑证据：技能条只接了 light / heavy，
          // medit 既没接也没置灰，玩家点冥想什么都不会发生。判据必须逐事件成立。
          const unbound = emits.filter((eventId) => !(
            mountListened.has(eventId)
              || mountListened.has(`${child.source.childId}:${eventId}`)
              || Boolean(resolveOverlayReaction(catalogReactions, child.source.childId, eventId))
              || exitEdgeHandles.has(eventId)
          ))
          // QTE 的分档由组件自身在 selfSettleMs 到点结算，玩家无法回避某一档，
          // 也没有 `*Cost` 可以置灰 ⇒ 不接受豁免，三档必须全接。
          const exemptible = contract.timing?.kind !== 'windowed-qte'
          const missing = exemptible
            ? unbound.filter((eventId) => !eventIsDisabledByCost(eventId, childInputs, contract, project))
            : unbound
          if (missing.length > 0) {
            issues.push(warningIssue(
              'ui.component.event-unbound',
              `节点 ${node.id} 挂了 ${child.component}，但事件 ${missing.join(' / ')} `
              + `既没有 reaction 监听，也没有对应 sourceHandle 的出边：玩家点了不会有任何效果。`
              + (exemptible
                ? `本节点确实不提供这些事件时，把对应的 ${missing[0]}Cost 配到 ${missing[0]}Resource 的上界之上让按钮置灰，`
                  + `不要留一个点了没反应的按钮。`
                : `${child.component} 的分档由元件自身结算，玩家无法回避，必须全部接线。`),
              location,
            ))
          }
        }
      }
    }
  }
  return issues
}

const CMP_OPS = new Set(['gte', 'lte', 'gt', 'lt', 'eq', 'neq'])
const CLAUSE_TYPES = new Set([
  'var', 'flag', 'visited', 'attr', 'attrRatio', 'attrCompare', 'score', 'hasItem',
])

/**
 * L2 运行时形状：拦住会让编辑器/运行时直接崩溃或静默失效的 dialect。
 *
 * 真跑证据（2026-08-18）：AI 把出边 `edge.data.condition` 的写法并到 reaction 顶层，
 * 生成 `{ when:{type:'state'}, condition:{all:[...]}, do:[...] }`；UI 读
 * `reaction.when.condition.all` 直接 TypeError。现有 hardChecks 对此全绿。
 */
function conditionShapeIssues(
  condition: unknown,
  location: PageLocation,
  at: string,
): ValidationIssue[] {
  if (condition === undefined || condition === null) return []
  if (typeof condition === 'string') {
    return [issue(
      'condition.shape.invalid',
      `${at} 的 condition 不能是字符串方言（'${condition}'）；必须是 { all: [clause…] }`,
      location,
    )]
  }
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    return [issue('condition.shape.invalid', `${at} 的 condition 必须是对象 { all: [clause…] }`, location)]
  }
  const all = (condition as { all?: unknown }).all
  if (!Array.isArray(all)) {
    return [issue(
      'condition.shape.invalid',
      `${at} 的 condition 必须带 all 数组（禁止 any / 字符串 / 空对象）`,
      location,
    )]
  }
  const issues: ValidationIssue[] = []
  all.forEach((clause, index) => {
    if (!clause || typeof clause !== 'object' || Array.isArray(clause)) {
      issues.push(issue(
        'condition.clause.invalid',
        `${at}.all[${index}] 必须是条件子句对象`,
        location,
      ))
      return
    }
    const typed = clause as { type?: unknown, op?: unknown }
    if (typeof typed.type !== 'string' || !CLAUSE_TYPES.has(typed.type)) {
      issues.push(issue(
        'condition.clause.invalid',
        `${at}.all[${index}] 的 type 无效（${String(typed.type)}）`,
        location,
      ))
      return
    }
    if ('op' in typed && typed.op !== undefined
      && (typeof typed.op !== 'string' || !CMP_OPS.has(typed.op))) {
      issues.push(issue(
        'condition.clause.invalid',
        `${at}.all[${index}] 的 op 无效（${String(typed.op)}）`,
        location,
      ))
    }
  })
  return issues
}

function collectReactionPacks(
  node: GameNode,
  overlays: Record<string, { reactions?: unknown[] } | undefined>,
): Array<{ reactions: unknown[] | undefined, at: string }> {
  return [
    { reactions: node.data.reactions as unknown[] | undefined, at: 'reactions' },
    ...(node.data.overlayNodes ?? []).flatMap((mount, mountIndex) => [
      {
        reactions: mount.reactions as unknown[] | undefined,
        at: `overlayNodes[${mountIndex}].reactions`,
      },
      {
        reactions: overlays[mount.overlay]?.reactions,
        at: `overlay:${mount.overlay}.reactions`,
      },
    ]),
  ]
}

function runtimeShapeIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const overlays = (project.ui?.overlays ?? {}) as Record<string, { reactions?: unknown[] } | undefined>
  const issues: ValidationIssue[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
      if (!isPosition((node as { position?: unknown }).position)) {
        issues.push(issue(
          'node.position.missing',
          `节点 ${node.id} 缺少 position: { x, y }；`
          + 'add-node 必须带画布坐标，否则预览读 position.x 会崩溃',
          location,
        ))
      }
      for (const pack of collectReactionPacks(node, overlays)) {
        ;(pack.reactions ?? []).forEach((value, index) => {
          const at = `node:${node.id}.${pack.at}[${index}]`
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            issues.push(issue('reaction.shape.invalid', `${at} 必须是对象`, location))
            return
          }
          const reaction = value as Record<string, unknown>
          if ('condition' in reaction) {
            issues.push(issue(
              'reaction.condition.misplaced',
              `${at} 把 condition 写在 reaction 顶层了：state 触发器必须写成 `
              + `{ when: { type:'state', condition:{ all:[…] } }, do:[…] }，`
              + '不要与出边 edge.data.condition 的写法混用',
              location,
            ))
          }
          const when = reaction.when
          if (!when || typeof when !== 'object' || Array.isArray(when)) {
            issues.push(issue('reaction.when.invalid', `${at}.when 必须是触发器对象`, location))
            return
          }
          const trigger = when as { type?: unknown, condition?: unknown, if?: unknown, id?: unknown, ms?: unknown, of?: unknown }
          if (typeof trigger.type !== 'string') {
            issues.push(issue('reaction.when.invalid', `${at}.when.type 缺失`, location))
            return
          }
          if (trigger.type === 'state') {
            if (trigger.condition === undefined) {
              issues.push(issue(
                'reaction.when.state.condition-missing',
                `${at}.when.type=state 但缺少 when.condition；`
                + '不要把 condition 写在 reaction 顶层',
                location,
              ))
            } else {
              issues.push(...conditionShapeIssues(trigger.condition, location, `${at}.when.condition`))
            }
          }
          if (trigger.type === 'complete' && trigger.if !== undefined) {
            issues.push(...conditionShapeIssues(trigger.if, location, `${at}.when.if`))
          }
          if (trigger.type === 'event' && typeof trigger.id !== 'string') {
            issues.push(issue('reaction.when.invalid', `${at}.when.type=event 需要 string id`, location))
          }
          if (trigger.type === 'at' && typeof trigger.ms !== 'number') {
            issues.push(issue('reaction.when.invalid', `${at}.when.type=at 需要 number ms`, location))
          }
          if ((trigger.type === 'watch' || trigger.type === 'shown' || trigger.type === 'hidden')
            && typeof trigger.of !== 'string') {
            issues.push(issue(
              'reaction.when.invalid',
              `${at}.when.type=${trigger.type} 需要 string of`,
              location,
            ))
          }
          if (!Array.isArray(reaction.do)) {
            issues.push(issue('reaction.do.invalid', `${at}.do 必须是数组`, location))
          }
        })
      }
      for (const edge of blueprint.graph.edges) {
        if (edge.source !== node.id) continue
        const condition = (edge.data as { condition?: unknown } | undefined)?.condition
        if (condition === undefined) continue
        issues.push(...conditionShapeIssues(
          condition,
          location,
          `edge:${edge.id}.data.condition`,
        ))
      }
    }
  }
  return issues
}

/**
 * 出边生产者（设计 §4.2）：每条出边至少要有一种在运行时把它走通的机制，否则这条分支
 * 是死的——总脉络编出来的 `choice-A/B/C` 空出口就是这种「玩家永远走不到」的边。
 *
 * 三种合法生产者：
 * 1. `sourceHandle` 为 `default` / 缺省 → 引擎默认推进；
 * 2. handle 等于本节点某挂载元件会发出的 event id；
 * 3. 本节点（节点 / 挂载 / overlay）某 reaction 的 `do` 含 `{ kind:'advance', edgeId }` 指向这条边。
 *
 * `settlement-advance:*` 出口既不是 default 也不是元件事件，只能靠 (3)。
 * 节点挂了自建控件（契约不在内置清单）时无法判断它发什么事件，从宽跳过该节点非默认边。
 *
 * 注意：多条 `default` 出边按不同 condition 走向不同节点是合法玩法，这里不发任何 warn。
 */
function edgeProducerIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const contracts = componentContractMap()
  const overlays = project.ui?.overlays ?? {}
  const issues: ValidationIssue[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      const outgoing = blueprint.graph.edges.filter((edge) => edge.source === node.id)
      if (outgoing.length === 0) continue
      const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
      const componentEvents = new Set<string>()
      let hasCustomComponent = false
      for (const mount of node.data.overlayNodes ?? []) {
        for (const child of overlays[mount.overlay]?.children ?? []) {
          const contract = contracts.get(child.component)
          if (!contract) { hasCustomComponent = true; continue }
          const declared = eventsFromParams((child as { inputs?: Record<string, unknown> }).inputs)
          const emitted = declared.length ? declared : contract.events
          for (const event of emitted) componentEvents.add(event.id)
        }
      }
      const advancedEdgeIds = new Set<string>()
      const collectAdvance = (reactions: readonly unknown[] | undefined): void => {
        for (const value of reactions ?? []) {
          const actions = (value as { do?: unknown[] }).do ?? []
          for (const action of actions) {
            const candidate = action as { kind?: unknown, edgeId?: unknown }
            if (candidate.kind === 'advance' && typeof candidate.edgeId === 'string') {
              advancedEdgeIds.add(candidate.edgeId)
            }
          }
        }
      }
      collectAdvance(node.data.reactions)
      for (const mount of node.data.overlayNodes ?? []) {
        collectAdvance(mount.reactions)
        collectAdvance(overlays[mount.overlay]?.reactions)
      }
      for (const edge of outgoing) {
        const handle = edge.sourceHandle ?? 'default'
        const hasAdvance = advancedEdgeIds.has(edge.id)
        if (handle.startsWith(SETTLEMENT_ADVANCE_HANDLE_PREFIX)) {
          if (!hasAdvance) {
            issues.push(issue(
              'edge.no-producer',
              `结算出边 ${edge.id}（出口 ${handle}）没有任何 reaction 用 advance(${edge.id}) 推进它：`
              + '这条分支运行时永远走不到。给对应结算节点写一条 reaction，在其 do 里 advance 到这条边。',
              location,
            ))
          }
          continue
        }
        if (handle === 'default') continue
        if (componentEvents.has(handle)) continue
        if (hasAdvance) continue
        if (hasCustomComponent) continue
        issues.push(issue(
          'edge.no-producer',
          `出边 ${edge.id}（出口 ${handle}）既不是默认推进，本节点也没有挂载元件会发 ${handle} 事件，`
          + `更没有 reaction 用 advance(${edge.id}) 推进它：这条分支运行时永远走不到。`
          + `当前可用出口事件：${[...componentEvents].join('、') || '（无）'}`,
          location,
        ))
      }
    }
  }
  return issues
}

/**
 * 玩法契约的三段校验。
 *
 * 契约本身住在节点 `data.interaction`（见 `NodeInteractionPlan`）：总脉络声明、
 * 数值线只读、整装落地。这三个函数分别是三段的闸门，把「三条线各自猜」变成
 * 「对着同一份契约交付」。
 */
type PlanEntry = {
  blueprintId: string
  nodeId: string
  node: GameNode
  plan: NonNullable<GameNode['data']['interaction']>
}

function interactionPlans(project: GraphLibraryDocument): PlanEntry[] {
  const entries: PlanEntry[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      const plan = node.data.interaction
      if (plan) entries.push({ blueprintId, nodeId: node.id, node, plan })
    }
  }
  return entries
}

/** 契约的 target 语法：`entity.<id>.attr.<attr>` 或 `var.<id>`。 */
function resolvePlanTarget(project: GraphLibraryDocument, target: string): boolean {
  const entityMatch = /^entity\.([^.]+)\.attr\.(.+)$/u.exec(target)
  if (entityMatch) {
    const entity = project.entities?.[entityMatch[1]!]
    return Boolean(entity && entityMatch[2]! in (entity.attrs ?? {}))
  }
  const variableMatch = /^var\.(.+)$/u.exec(target)
  if (variableMatch) return Boolean(project.variables?.[variableMatch[1]!])
  return false
}

/** 总脉络闸门：每个节点都要表态，交互节拍必须说清元件、事件与意图，且满足篇幅战斗回合预算。 */
function outlineInteractionPlanIssues(
  project: GraphLibraryDocument,
  workflowState?: VideoGameWorkflowState | null,
): ValidationIssue[] {
  const contracts = componentContractMap()
  const issues: ValidationIssue[] = []
  const budget = workScaleBudgetFromContract(workflowState?.requirementContract)
  if (budget && (budget.minCombatCount !== undefined || budget.maxCombatCount !== undefined)) {
    const combatNodes = allNodes(project).filter(({ node }) => node.data.interaction?.beat === 'combat')
    if (budget.minCombatCount !== undefined && combatNodes.length < budget.minCombatCount) {
      issues.push(issue(
        'outline.interaction.combat-required',
        `${budget.label}必须设计至少 ${budget.minCombatCount} 个战斗回合（interaction.beat 为 combat，可配置技能条 BattleSkill 或防反 BattleParry），当前有 ${combatNodes.length} 个；互动影游必须有核心冲突与战斗交互`,
        { kind: 'blueprint', blueprintId: project.manifest.mainPackId },
      ))
    }
    if (budget.maxCombatCount !== undefined && combatNodes.length > budget.maxCombatCount) {
      issues.push(issue(
        'outline.interaction.combat-over-budget',
        `${budget.label}最多设计 ${budget.maxCombatCount} 个战斗回合，当前有 ${combatNodes.length} 个；请收敛战斗内容`,
        { kind: 'blueprint', blueprintId: project.manifest.mainPackId },
      ))
    }
  }
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
      const plan = node.data.interaction
      if (!plan) {
        issues.push(issue(
          'outline.interaction.missing',
          `节点 ${node.id} 没有声明玩法契约：请给 interaction.beat 表态`
          + '（narrative / choice / combat / check / timed），交互节拍还要写 actions',
          location,
        ))
        continue
      }
      // 反向也要拦：标成纯叙事却挂了动作，说明节拍类型填错了。
      // 实测一局 12 个节点全填 narrative，连挂着 BattleParry 的打斗节点也是——
      // 而整装靠 beat 判断该配多少玩法（prompt 明确「narrative 的节点不要硬加交互」），
      // beat 填错会让它把战斗当过场处理。
      if (plan.beat === 'narrative' && (plan.actions ?? []).length > 0) {
        const used = (plan.actions ?? []).map((action) => action.component).join('、')
        issues.push(issue(
          'outline.interaction.beat-mismatch',
          `节点 ${node.id} 标成纯叙事（narrative），却挂了 ${(plan.actions ?? []).length} 个观众动作（${used}）：`
          + '有交互就不是纯叙事，请按内容改成 choice / combat / check / timed；'
          + '确实只让观众看，就去掉 actions',
          location,
        ))
      }
      // 纯叙事是**有意留白**，允许没有动作；其余四类没动作就是漏配。
      if (plan.beat !== 'narrative' && (plan.actions ?? []).length === 0) {
        issues.push(issue(
          'outline.interaction.no-action',
          `节点 ${node.id} 声明为 ${plan.beat} 节拍却没有任何 actions：`
          + '观众在这一段什么都做不了。确实只让观众看，就把 beat 改成 narrative',
          location,
        ))
      }
      if (plan.loop && !blueprint.graph.nodes.some((candidate) => candidate.id === plan.loop?.backTo)) {
        issues.push(issue(
          'outline.interaction.loop-target-missing',
          `节点 ${node.id} 的回合契约 loop.backTo 指向不存在的节点 ${plan.loop.backTo}`,
          location,
        ))
      }
      for (const action of plan.actions ?? []) {
        const contract = contracts.get(action.component)
        if (!contract) {
          issues.push(issue(
            'outline.interaction.unknown-component',
            `节点 ${node.id} 的契约用了不存在的元件 ${action.component}；`
            + `先 list_ui_components 看清单`,
            location,
          ))
          continue
        }
        const events = contract.events.map((event) => event.id)
        if (!events.includes(action.event)) {
          issues.push(issue(
            'outline.interaction.unknown-event',
            `节点 ${node.id} 的契约写了 ${action.component} 不会发的事件 ${action.event}；`
            + `它能发：${events.join(' / ') || '（无事件，纯展示元件）'}`,
            location,
          ))
        }
        if (!action.intent?.trim()) {
          issues.push(issue(
            'outline.interaction.no-intent',
            `节点 ${node.id} 的 ${action.component}.${action.event} 没写 intent：`
            + '用一句话说明观众为什么会点它，否则整装无从判断该怎么配',
            location,
          ))
        }
        const hasEffect = Boolean(action.effect)
        const hasExit = typeof action.exit === 'string'
          && action.exit.trim().length > 0
          && action.exit !== 'none'
        if (!hasEffect && !hasExit) {
          issues.push(issue(
            'outline.interaction.no-consequence',
            `节点 ${node.id} 的 ${action.component}.${action.event} 没声明后果：`
            + '至少填写 effect（状态变化）或非 none 的 exit（分支去处），不要把玩法留给整装猜',
            location,
          ))
        }
      }
    }
  }
  return issues
}

/** 数值线闸门：契约点名的公式与目标必须真实存在。 */
function rulesPlanFormulaIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const entry of interactionPlans(project)) {
    for (const action of entry.plan.actions ?? []) {
      const effect = action.effect
      if (!effect) continue
      const location: PageLocation = { kind: 'rule', section: 'formulas', ...(effect.formulaId ? { itemId: effect.formulaId } : {}) }
      if (effect.formulaId && !project.formulas?.[effect.formulaId]) {
        issues.push(issue(
          'rules.plan.formula-missing',
          `节点 ${entry.nodeId} 的契约点名要公式 ${effect.formulaId}`
          + `（${action.component}.${action.event}：${action.intent}），但规则目录里没有它`,
          location,
        ))
      }
      if (!resolvePlanTarget(project, effect.target)) {
        issues.push(issue(
          'rules.plan.target-missing',
          `节点 ${entry.nodeId} 的契约要改 ${effect.target}，但这个实体属性或变量还不存在`,
          { kind: 'rule', section: 'entities' },
        ))
      }
    }
  }
  return issues
}

/** 整装闸门：契约里的每条动作都要在蓝图上真的接上。 */
function finalizationPlanWiringIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const overlays = project.ui?.overlays ?? {}
  const issues: ValidationIssue[] = []
  for (const entry of interactionPlans(project)) {
    const location: PageLocation = { kind: 'blueprint', blueprintId: entry.blueprintId, nodeId: entry.nodeId }
    const mounted = new Set<string>()
    for (const mount of entry.node.data.overlayNodes ?? []) {
      for (const child of overlays[mount.overlay]?.children ?? []) mounted.add(child.component)
    }
    // effect 与出边条件都可能引用公式，一次序列化后搜比逐字段遍历更耐结构演进。
    // 必须排除 `interaction` 自身：契约里就写着公式名，不排掉的话它永远「已被引用」。
    const { interaction: _plan, ...wiringData } = entry.node.data
    const wiringSurface = JSON.stringify([
      wiringData,
      Object.values(project.manifest.packs).flatMap((pack) => pack.graph.edges.filter(
        (edge) => edge.source === entry.nodeId,
      )),
    ])
    const wiringFormulaRefs = new Set<string>()
    const collectWiringFormulaRefs = (value: unknown): void => {
      if (value == null || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.forEach(collectWiringFormulaRefs)
        return
      }
      const object = value as Record<string, unknown>
      if (typeof object.expr === 'string') {
        try {
          collectRefs(object.expr).formulas.forEach((id) => wiringFormulaRefs.add(id))
        } catch {
          // expressionIssues owns parse diagnostics.
        }
      }
      Object.values(object).forEach(collectWiringFormulaRefs)
    }
    collectWiringFormulaRefs(wiringData)
    Object.values(project.manifest.packs).forEach((pack) => {
      pack.graph.edges
        .filter((edge) => edge.source === entry.nodeId)
        .forEach((edge) => collectWiringFormulaRefs(edge.data))
    })
    for (const action of entry.plan.actions ?? []) {
      if (!mounted.has(action.component)) {
        issues.push(issue(
          'finalization.plan.component-unmounted',
          `节点 ${entry.nodeId} 的契约要 ${action.component}（${action.intent}），但节点上没挂它`,
          location,
        ))
        continue
      }
      const formulaId = action.effect?.formulaId
      if (formulaId && !wiringFormulaRefs.has(formulaId)) {
        issues.push(issue(
          'finalization.plan.effect-unwired',
          `节点 ${entry.nodeId} 挂了 ${action.component}，但契约点名的公式 ${formulaId}`
          + '没有被任何 reaction 或出边引用：观众点了不会有任何变化',
          location,
        ))
      }
      const exit = action.exit ?? action.event
      if (exit !== 'none') {
        const hasExit = Object.values(project.manifest.packs).some((pack) => pack.graph.edges.some(
          (edge) => edge.source === entry.nodeId && (edge.sourceHandle ?? 'default') === exit,
        ))
        if (!hasExit) {
          issues.push(issue(
            'finalization.plan.exit-missing',
            `节点 ${entry.nodeId} 的契约说 ${action.event} 要走出口 ${exit}，但没有这条出边；`
            + '要么补这条边，要么把 exit 改成 none（只结算不离开）',
            location,
          ))
        }
      }
    }
    for (const terminal of entry.plan.terminals ?? []) {
      // 终局条件必须在图上留痕：出边条件或 state reaction 里判断过它比较的对象。
      // 按标识符匹配而不是整串：契约写 `entity.tiger.attr.hp`，图上可能是
      // `{entityId:'tiger', attr:'hp'}`（effect 结构）或 `tiger.hp <= 0`（表达式），
      // 三种写法指同一件事，比整串会永远判不通过。
      const subject = terminal.when.split(/[<>=!]/u)[0]!.trim()
      const tokens = subject.split(/[^A-Za-z0-9_]+/u)
        .filter((token) => token && !['entity', 'attr', 'var'].includes(token))
      if (tokens.length > 0 && !tokens.every((token) => wiringSurface.includes(token))) {
        issues.push(issue(
          'finalization.plan.terminal-unwired',
          `节点 ${entry.nodeId} 的契约有终局条件「${terminal.when}」，`
          + '但图上没有任何出边条件或 reaction 判断它：这局永远不会结束',
          location,
        ))
      }
    }
  }
  return issues
}

/**
 * 没有任何真正的结局（warn 级）。
 *
 * 「所有结局都能点着再玩一轮」是合法设计（判据见 `restReachability`），但一部影游连一个
 * 收尾都没有，多半是作者没意识到——所以报出来让人看见，不阻塞完成。
 */
function endingPresenceIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    const { endings } = restReachability(blueprint.graph.nodes, blueprint.graph.edges)
    if (endings.size > 0) continue
    issues.push(issue(
      'content.no-ending',
      `蓝图 ${blueprintId} 没有任何真正的结局节点（每条路径都还能回到前面）。`
      + '刻意做成一直循环的玩法可以忽略这条；否则给每个收尾留一个不再往外连边的节点。',
      { kind: 'blueprint', blueprintId, nodeId: blueprint.entry },
    ))
  }
  return issues
}

/**
 * 没人引用的公式 = 玩法没配上（warn 级）。
 *
 * 实测一局数值线写了 43 个公式，只有 3 个被边引用：伤害算得出来却没有任何 effect
 * 施加它，界面按钮点了也不会掉血。这条把「设计了但没接上」变成可见信号。
 *
 * 引用面包括：边的条件与效果、节点 reaction、overlay 挂载的输入、以及其他公式的表达式。
 * 判 warn 而不是 fail：中间公式被别的公式引用是合法的，误伤一次比卡死流程便宜。
 */
function unusedFormulaIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const formulaIds = Object.keys(project.formulas ?? {})
  if (formulaIds.length === 0) return []
  const references = new Set<string>()
  const collectFormulaRefs = (value: unknown): void => {
    if (value == null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(collectFormulaRefs)
      return
    }
    const object = value as Record<string, unknown>
    if (typeof object.expr === 'string') {
      try {
        collectRefs(object.expr).formulas.forEach((id) => references.add(id))
      } catch {
        // expressionIssues reports the parse error; this check only measures valid references.
      }
    }
    const ref = object.ref
    if (ref && typeof ref === 'object') {
      const formulaId = (ref as Record<string, unknown>).formulaId
      if ((ref as Record<string, unknown>).kind === 'formula' && typeof formulaId === 'string') {
        references.add(formulaId)
      }
    }
    Object.values(object).forEach(collectFormulaRefs)
  }
  for (const pack of Object.values(project.manifest.packs)) {
    for (const node of pack.graph.nodes) {
      const { interaction: _interaction, ...wiringData } = node.data
      collectFormulaRefs(wiringData)
    }
    pack.graph.edges.forEach((edge) => collectFormulaRefs(edge.data))
  }
  collectFormulaRefs(project.ui?.overlays ?? {})
  for (const [id, formula] of Object.entries(project.formulas ?? {})) {
    if (formula && typeof formula === 'object') {
      const { id: _id, ...definition } = formula as Record<string, unknown>
      collectFormulaRefs(definition)
    }
  }
  const issues: ValidationIssue[] = []
  for (const formulaId of formulaIds.sort()) {
    if (references.has(formulaId)) continue
    issues.push(issue(
      'content.formula-unused',
      `公式 ${formulaId} 没有被任何边、reaction 或界面输入引用：算出来的值没人用，玩法可能没接上`,
      { kind: 'rule', section: 'formulas', itemId: formulaId },
    ))
  }
  return issues
}

function requiredUiIssueList(
  project: GraphLibraryDocument | null,
): ValidationIssue[] {
  if (!project) return []
  return allNodes(project).flatMap(({ blueprintId, node }) => {
    const actions = node.data.interaction?.actions ?? []
    if (actions.length === 0 || (node.data.overlayNodes?.length ?? 0) > 0) return []
    return [issue(
      'finalization.required-ui.missing',
      `节点 ${node.id} 有 interaction.actions，但尚未挂载对应的 base:* 界面`,
      { kind: 'blueprint', blueprintId, nodeId: node.id },
    )]
  })
}

function allNodes(project: GraphLibraryDocument): Array<{ blueprintId: string; node: GameNode }> {
  return Object.entries(project.manifest.packs).flatMap(([blueprintId, blueprint]) => (
    blueprint.graph.nodes.map((node) => ({ blueprintId, node }))
  ))
}

function baseOverlayReuseIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const overlays = project.ui?.overlays ?? {}
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
    for (const mount of node.data.overlayNodes ?? []) {
      // 允许挂载目录里任何已存在的 overlay（base:* 控件 / scheme:* 自定义模板），
      // 只拦 node:*（节点私有内容容器）和目录里不存在的 id。
      if (mount.overlay.startsWith('node:')) {
        issues.push(issue(
          'ui.overlay.non-base',
          `节点 ${node.id} 挂载了节点私有内容容器 ${mount.overlay}；不得为节点引用 node:*`,
          location,
        ))
        continue
      }
      const prototype = overlays[mount.overlay]
      if (!prototype) {
        issues.push(issue(
          'ui.overlay.missing',
          `节点 ${node.id} 引用了界面目录里不存在的 overlay ${mount.overlay}`,
          location,
        ))
        continue
      }
      if (mount.added !== undefined || mount.removed !== undefined) {
        issues.push(issue(
          'ui.overlay.local-structure',
          `节点 ${node.id} 的 ${mount.overlay} 挂载含 added/removed；不得为节点增删本地控件`,
          location,
        ))
      }
      const childIds = new Set(prototype.children.map((child) => child.id))
      for (const [childId, patch] of Object.entries(mount.overrides ?? {})) {
        if (!childIds.has(childId)) {
          issues.push(issue(
            'ui.overlay.unknown-child',
            `节点 ${node.id} 配置了 ${mount.overlay} 中不存在的 childId ${childId}`,
            location,
          ))
        }
        if (patch.id !== undefined || patch.component !== undefined) {
          issues.push(issue(
            'ui.overlay.component-replaced',
            `节点 ${node.id} 不得覆盖 ${mount.overlay}/${childId} 的 id 或 component`,
            location,
          ))
        }
      }
    }
  }
  return issues
}

function componentTimingIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const contracts = componentContractMap()
  const overlays = project.ui?.overlays ?? {}
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
    for (const child of expandNodeOverlays(overlays, node).flatMap((instance) => instance.children)) {
      const timing = contracts.get(child.component)?.timing
      if (!timing) continue
      const trigger = child.trigger as { when?: string, ms?: number }
      if (trigger.when !== 'enter' && trigger.when !== 'at') {
        issues.push(issue(
          'ui.trigger.invalid',
          `节点 ${node.id} 的 ${child.component} 使用了无效 trigger.when=${String(trigger.when)}；只能是 enter 或 at`,
          location,
        ))
        continue
      }
      const start = child.window?.startMs ?? (trigger.when === 'at' ? trigger.ms ?? 0 : 0)
      if (timing.kind === 'spawn-only') {
        issues.push(issue(
          'ui.floattext.static-mount',
          `节点 ${node.id} 静态挂载了 ${child.component}；该控件只能通过 reaction.spawn 动态生成`,
          location,
        ))
        continue
      }
      if (
        timing.kind === 'persistent-hud'
        && (
          trigger.when !== 'enter'
          || (child.window?.startMs ?? 0) < 0
          || child.window?.endMs !== undefined
        )
      ) {
        issues.push(issue(
          'ui.timing.hud-window',
          `节点 ${node.id} 的 ${child.component} 是常驻 HUD，必须用 enter 且不能配置 window`,
          location,
        ))
      }
      if (timing.kind !== 'windowed-qte') continue
      if (start <= 0) {
        issues.push(issue(
          'qte.timing.premature',
          `节点 ${node.id} 的 ${child.component} 在 0ms 开场显示；应对齐视频动作高潮时刻`,
          location,
        ))
      }
      if (child.component === 'BattleParry') {
        const end = child.window?.endMs
        if (end !== undefined && end - start < 1600) {
          issues.push(issue(
            'qte.parry.window-too-short',
            `节点 ${node.id} 的 BattleParry 窗口只有 ${end - start}ms，不能短于其约 1500ms 的内部结算窗口`,
            location,
          ))
        }
      }
      if (child.component === 'InkKou' && child.window?.endMs === undefined) {
        issues.push(issue(
          'qte.inkkou.no-timeout',
          `节点 ${node.id} 的 InkKou 没有 window.endMs；它被卸载时不会自动发出失败事件，必须配置有界窗口`,
          location,
        ))
      }
    }
  }
  return issues
}

function attrRatioMetadataIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const checked = new Set<string>()
  const inspect = (value: unknown, at: string): void => {
    if (value == null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, `${at}[${index}]`))
      return
    }
    const object = value as Record<string, unknown>
    if (
      object.type === 'attrRatio'
      && typeof object.entityId === 'string'
      && typeof object.attr === 'string'
    ) {
      const key = `${object.entityId}.${object.attr}`
      if (!checked.has(key)) {
        checked.add(key)
        const max = project.entities?.[object.entityId]?.attrMeta?.[object.attr]?.max
        if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) {
          issues.push(issue(
            'rules.attr-meta.max-missing',
            `attrRatio 使用 ${key}，但未声明正数 attrMeta.${object.attr}.max；比例条件会恒为 0`,
            { kind: 'rule', section: 'entities', itemId: object.entityId },
          ))
        }
      }
    }
    Object.entries(object).forEach(([key, child]) => inspect(child, `${at}.${key}`))
  }
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    blueprint.graph.nodes.forEach((node) => inspect(node.data, `blueprint:${blueprintId}/node:${node.id}`))
    blueprint.graph.edges.forEach((edge) => inspect(edge.data, `blueprint:${blueprintId}/edge:${edge.id}`))
  }
  return issues
}

function combatPackIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    if (node.data.interaction?.beat !== 'combat') continue
    const data = node.data as unknown as Record<string, unknown>
    const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
    if (data.subProcess) {
      issues.push(issue(
        'combat.subprocess-forbidden',
        `战斗节点 ${node.id} 使用了 subProcess；战斗回合必须放在可被 Host 检查的 subFlowPack 中`,
        location,
      ))
    }
    if (!data.subFlowPack) {
      issues.push(issue(
        'combat.pack-required',
        `战斗节点 ${node.id} 没有 subFlowPack；请把 ready/attack/boss-turn 回合环放进战斗包`,
        location,
      ))
    }
  }
  return issues
}

function videoPresetIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    const location: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
    if (!node.data.chapterSummary?.trim()) issues.push(issue('node.chapter-summary.missing', `节点 ${node.id} 缺少章节概览`, location))
    if (!node.data.storyText?.trim()) issues.push(issue('node.story-text.missing', `节点 ${node.id} 缺少 storyText`, location))
    if (!Array.isArray(node.data.cast)) issues.push(issue('node.cast.missing', `节点 ${node.id} 缺少 cast`, location))
    const media = node.data.media
    if (media?.kind !== 'video' || !media.prompt?.trim()) {
      issues.push(issue('node.video-prompt.missing', `节点 ${node.id} 缺少基础视频 Prompt`, location))
      continue
    }
    if (!media.generation) {
      issues.push(issue('node.video-preset.missing', `节点 ${node.id} 缺少视频生成预设`, location))
      continue
    }
    validateNodeVideoGenerationPreset(media.generation).forEach((message) => {
      issues.push(issue('node.video-preset.invalid', `节点 ${node.id} ${message}`, location))
    })
  }
  return issues
}

function videoPresetBindingReceiptIssues(
  project: GraphLibraryDocument,
  blueprintBytes: Uint8Array | null,
): ValidationIssue[] {
  const receipts = readMutationReceipts(blueprintBytes)
    .filter((receipt) => receipt.operation === 'patch-node-media')
  if (receipts.length === 0) {
    return [issue(
      'video.presets.binding-receipt.missing',
      '节点视频预设尚未通过 patch_node_media 绑定',
      { kind: 'asset', root: 'video' },
    )]
  }
  const receiptedRefs = new Set(receipts.flatMap((receipt) => {
    const refs = receipt.payload.nodeRefs
    if (!Array.isArray(refs)) return []
    return refs.flatMap((candidate) => {
      if (
        typeof candidate !== 'object'
        || candidate === null
        || Array.isArray(candidate)
      ) return []
      const ref = candidate as Record<string, unknown>
      return typeof ref.blueprintId === 'string' && typeof ref.nodeId === 'string'
        ? [`${ref.blueprintId}\0${ref.nodeId}`]
        : []
    })
  }))
  return allNodes(project).flatMap(({ blueprintId, node }) => (
    receiptedRefs.has(`${blueprintId}\0${node.id}`)
      ? []
      : [issue(
          'video.presets.binding-receipt.node-missing',
          `节点 ${blueprintId}/${node.id} 没有 patch_node_media 绑定凭据`,
          { kind: 'blueprint', blueprintId, nodeId: node.id },
        )]
  ))
}

function videoSubmissionReferenceIssues(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
  scenes: Readonly<Record<string, SceneDefinition>>,
  assetsById: ReadonlyMap<string, MediaAsset>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const hasProviderResource = (asset: MediaAsset | undefined): boolean => {
    const upstream = asset?.provider?.upstreamResourceId
    const mapped = asset?.meta?.kinoResourceId
    return asset?.status === 'ready' && (
      (typeof upstream === 'string' && upstream.trim().length > 0)
      || (typeof mapped === 'string' && mapped.trim().length > 0)
    )
  }
  for (const { blueprintId, node } of allNodes(project)) {
    const location: PageLocation = {
      kind: 'blueprint',
      blueprintId,
      nodeId: node.id,
    }
    const referenced = new Set<string>()
    for (const cast of node.data.cast ?? []) {
      if (cast.onScreen === false) continue
      const assetId = characters[cast.characterId]?.currentAssetId
      if (assetId) referenced.add(assetId)
    }
    for (const scene of node.data.scenes ?? []) {
      if (scene.useAsVideoReference === false) continue
      const assetId = scenes[scene.sceneId]?.currentAssetId
      if (assetId) referenced.add(assetId)
    }
    const references = node.data.media?.generation?.references
    references?.sceneAssetIds?.forEach((assetId) => referenced.add(assetId))
    references?.extraImageAssetIds?.forEach((assetId) => referenced.add(assetId))
    if (references?.firstFrameAssetId) referenced.add(references.firstFrameAssetId)
    if (references?.lastFrameAssetId) referenced.add(references.lastFrameAssetId)
    for (const assetId of referenced) {
      if (!hasProviderResource(assetsById.get(assetId))) {
        issues.push(issue(
          'video.presets.reference.not-ready',
          `节点 ${node.id} 的参考资产 ${assetId} 尚无可提交的 provider resource id`,
          location,
        ))
      }
    }
  }
  return issues
}

export function choiceConsequenceIssues(
  project: GraphLibraryDocument,
  options: { requireChoice?: boolean } = {},
): ValidationIssue[] {
  let foundChoice = false
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    const outgoing = new Map<string, typeof blueprint.graph.edges>()
    blueprint.graph.edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]))
    for (const [nodeId, edges] of outgoing) {
      const branches = edges.filter((edge) => edge.sourceHandle && edge.sourceHandle !== 'default')
      const handles = new Set(branches.map((edge) => edge.sourceHandle))
      if (branches.length < 2 || handles.size < 2) continue
      foundChoice = true
      const targets = new Set(branches.map((edge) => edge.target))
      if (targets.size > 1) continue
      const node = blueprint.graph.nodes.find((candidate) => candidate.id === nodeId)
      const missingConsequences = [...handles].filter((handle) => (
        !node || !choiceHandleHasStateConsequence(project, node, handle as string)
      ))
      if (missingConsequences.length === 0) continue
      return [issue(
        'graph.choice-consequence',
        `选择节点 ${nodeId} 的分支立即合流且没有状态后果：出口 ${missingConsequences.join('、')}`,
        { kind: 'blueprint', blueprintId, nodeId },
      )]
    }
  }
  return options.requireChoice === false || foundChoice
    ? []
    : [issue('graph.choice.missing', '最小可玩结构至少需要一个具有两条选项出边的真实选择')]
}

function choiceHandleHasStateConsequence(
  project: GraphLibraryDocument,
  node: GameNode,
  handle: string,
): boolean {
  const planned = node.data.interaction?.actions?.some((action) => {
    const exit = action.exit ?? action.event
    const effect = action.effect
    return exit === handle
      && typeof effect?.target === 'string'
      && Boolean(effect.target.trim())
      && (
        (typeof effect.formulaId === 'string' && Boolean(effect.formulaId.trim()))
        || (typeof effect.value === 'number' && Number.isFinite(effect.value))
      )
  }) ?? false
  if (planned) return true

  const matchesHandle = (eventId: unknown): boolean => (
    typeof eventId === 'string'
    && (eventId === handle || eventId.endsWith(`:${handle}`))
  )
  const hasEffect = (reactions: readonly unknown[] | undefined): boolean => (
    reactions?.some((value) => {
      if (!value || typeof value !== 'object') return false
      const reaction = value as { when?: { type?: unknown, id?: unknown }, do?: unknown[] }
      return reaction.when?.type === 'event'
        && matchesHandle(reaction.when.id)
        && reaction.do?.some((action) => {
          if (!action || typeof action !== 'object') return false
          const candidate = action as { kind?: unknown, effects?: unknown[] }
          return candidate.kind === 'effect' && Boolean(candidate.effects?.length)
        }) === true
    }) ?? false
  )

  if (hasEffect(node.data.reactions)) return true
  for (const mount of node.data.overlayNodes ?? []) {
    if (hasEffect(mount.reactions)) return true
    if (hasEffect(project.ui?.overlays?.[mount.overlay]?.reactions)) return true
  }
  return false
}

function choiceIssues(project: GraphLibraryDocument): ValidationIssue[] {
  return choiceConsequenceIssues(project)
}

function graphConnectivityIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    if (!blueprint.graph.nodes.some((node) => node.id === blueprint.entry)) {
      issues.push(issue('graph.entry.missing', `蓝图 ${blueprintId} 的 entry 不存在`, { kind: 'blueprint', blueprintId }))
      continue
    }
    const visited = new Set<string>()
    const queue = [blueprint.entry]
    while (queue.length) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      blueprint.graph.edges.filter((edge) => edge.source === nodeId).forEach((edge) => queue.push(edge.target))
    }
    const unreachable = blueprint.graph.nodes.filter((node) => !visited.has(node.id))
    unreachable.forEach((node) => issues.push(issue('graph.node.unreachable', `节点 ${node.id} 从 entry 不可达`, { kind: 'blueprint', blueprintId, nodeId: node.id })))
    if (![...visited].some((nodeId) => !blueprint.graph.edges.some((edge) => edge.source === nodeId))) {
      issues.push(issue('graph.terminal.missing', `蓝图 ${blueprintId} 没有可达终点`, { kind: 'blueprint', blueprintId }))
    }
  }
  return issues
}

// ── 总脉络（blueprint.outline）──────────────────────────────────────────────
//
// 总脉络阶段的产物是「骨架 + 三张声明清单」。此时「已声明未定义」是合法中间态，
// 所以这里只查骨架完整性与声明齐全，不查角色/场景/规则的内容是否已填。

/** 节点引用的角色与场景 id（声明引用，不要求已定义）。 */
function declaredReferences(project: GraphLibraryDocument): {
  characterIds: Set<string>
  sceneIds: Set<string>
} {
  const characterIds = new Set<string>()
  const sceneIds = new Set<string>()
  for (const { node } of allNodes(project)) {
    for (const binding of node.data.cast ?? []) characterIds.add(binding.characterId)
    for (const binding of node.data.scenes ?? []) sceneIds.add(binding.sceneId)
  }
  return { characterIds, sceneIds }
}

function outlineNodeSummaryIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    if (!node.data.chapterSummary?.trim()) {
      issues.push(issue(
        'outline.node-summary.missing',
        `节点 ${node.id} 缺少章节梗概；总脉络必须让每个节点讲清演什么`,
        { kind: 'blueprint', blueprintId, nodeId: node.id },
      ))
    }
  }
  return issues
}

function workScaleNodeCountIssues(
  project: GraphLibraryDocument,
  workflowState: VideoGameWorkflowState | null | undefined,
): ValidationIssue[] {
  const value = workflowState?.requirementContract?.dimensions.work_scale?.value
  const budget = workScaleBudgetFromContract(workflowState?.requirementContract)
  if (!value?.trim()) {
    return [issue('outline.work-scale.missing', '需求契约缺少 work_scale，无法确定蓝图节点总数', { kind: 'blueprint' })]
  }
  if (!budget) {
    return [issue('outline.work-scale.invalid', `无法识别 work_scale：${value}`, { kind: 'blueprint' })]
  }
  const mainPack = project.manifest.packs[project.manifest.mainPackId]
  if (!mainPack) return [issue('outline.main-blueprint.missing', '主蓝图不存在，无法校验节点总数', { kind: 'blueprint' })]
  const actual = mainPack.graph.nodes.length
  const min = budget.minNodeCount ?? budget.nodeCount
  const max = budget.maxNodeCount ?? budget.nodeCount
  return actual >= min && actual <= max
    ? []
    : [issue(
      'outline.node-count-mismatch',
      `${budget.label}主图章节数建议为 ${budget.nodeCount} 个左右（允许 ${min}~${max} 个），当前为 ${actual} 个；战斗包内节拍不计入章节预算，所有主图终局章节都计入总数`,
      { kind: 'blueprint', blueprintId: project.manifest.mainPackId },
    )]
}

function workScaleCharacterCountIssues(
  characters: Readonly<Record<string, CharacterDefinition>>,
  workflowState: VideoGameWorkflowState | null | undefined,
): ValidationIssue[] {
  const budget = workScaleBudgetFromContract(workflowState?.requirementContract)
  if (budget?.characterCount === undefined) return []
  const actual = Object.keys(characters).length
  return actual === budget.characterCount
    ? []
    : [issue(
      'characters.count-mismatch',
      `${budget.label}必须恰好创建 ${budget.characterCount} 个角色，当前为 ${actual} 个`,
      { kind: 'asset', root: 'character' },
    )]
}

function workScaleSceneCountIssues(
  scenes: Readonly<Record<string, SceneDefinition>>,
  workflowState: VideoGameWorkflowState | null | undefined,
): ValidationIssue[] {
  const budget = workScaleBudgetFromContract(workflowState?.requirementContract)
  if (budget?.sceneCount === undefined) return []
  // 仅资产库（source=catalog）不计入总脉络规模；缺省 / outline 才计数。
  const actual = Object.values(scenes).filter((scene) => scene.source !== 'catalog').length
  return actual === budget.sceneCount
    ? []
    : [issue(
      'scenes.count-mismatch',
      `${budget.label}必须恰好创建 ${budget.sceneCount} 个场景，当前为 ${actual} 个`,
      { kind: 'asset', root: 'scene' },
    )]
}

/**
 * 声明齐全：节点引用的每个角色与场景都要在目录里有条目。
 *
 * 这里只要求「有条目」，内容可以是空壳——填内容是三条线的活。
 * 反过来说，节点引用了一个连声明都没有的 id，说明总脉络自己没写完。
 */
function outlineDeclarationIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    for (const binding of node.data.cast ?? []) {
      if (!binding.characterId.trim()) {
        issues.push(issue(
          'outline.character.invalid-id',
          `节点 ${node.id} 的 cast 声明缺少稳定 characterId`,
          { kind: 'blueprint', blueprintId, nodeId: node.id },
        ))
      }
    }
    for (const binding of node.data.scenes ?? []) {
      if (!binding.sceneId.trim()) {
        issues.push(issue(
          'outline.scene.invalid-id',
          `节点 ${node.id} 的 scenes 声明缺少稳定 sceneId`,
          { kind: 'blueprint', blueprintId, nodeId: node.id },
        ))
      }
    }
  }
  return issues
}

function characterReferenceIssues(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
  assetsById: ReadonlyMap<string, MediaAsset>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  let targets: ReturnType<typeof requiredCharacterPreviewTargets>
  try {
    targets = requiredCharacterPreviewTargets(project, characters)
  } catch (error) {
    return [issue(
      'character.preview.invalid-cast',
      error instanceof Error ? error.message : String(error),
      { kind: 'asset', root: 'character' },
    )]
  }
  for (const target of targets) {
    const character = characters[target.characterId]
    const asset = character?.currentAssetId
      ? assetsById.get(character.currentAssetId)
      : undefined
    if (!character?.currentAssetId) {
      issues.push(issue(
        'character.preview.missing',
        `角色 ${target.name} 缺少主预览参考图`,
        { kind: 'asset', root: 'character', entryId: target.characterId },
      ))
    } else if (!isCurrentCharacterPreview(asset, target.sourcePrompt, target.description)) {
      issues.push(issue(
        'character.preview.stale',
        `角色 ${target.name} 的主预览图缺失、未就绪或已随角色设定过期`,
        { kind: 'asset', root: 'character', entryId: target.characterId },
      ))
    }
  }
  return issues
}

/**
 * 规模上限：把「出图会不会爆」提前到总脉络就判定。
 *
 * 这是早失败闸门——如果等到出图阶段才发现角色/场景太多，前面几步的产出都要返工。
 */
function outlineBudgetIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  // 实体与变量不出图，但规模一样会失控：数值线要为每个实体设计属性和公式，
  // 声明爆了就是在数值线阶段才发现，而那时总脉络已经定型。
  const entityCount = Object.keys(project.entities ?? {}).length
  if (entityCount > MAX_DECLARED_ENTITIES) {
    issues.push(issue(
      'outline.entities.over-budget',
      `声明实体 ${entityCount} 个，超过系统上限 ${MAX_DECLARED_ENTITIES}；请收敛实体数量`,
      { kind: 'rule', section: 'entities' },
    ))
  }
  const variableCount = Object.keys(project.variables ?? {}).length
  if (variableCount > MAX_DECLARED_VARIABLES) {
    issues.push(issue(
      'outline.variables.over-budget',
      `声明变量 ${variableCount} 个，超过系统上限 ${MAX_DECLARED_VARIABLES}；请收敛变量数量`,
      { kind: 'rule', section: 'variables' },
    ))
  }
  return issues
}

/** 实体与变量不出图，上限按「一个人还能读懂这套数值」定，比出图上限更宽。 */
const MAX_DECLARED_ENTITIES = 80
const MAX_DECLARED_VARIABLES = 120

// ── 场景（scenes.modeling / scenes.previewing / assets.scene）────────────────

function sceneCatalogIssues(
  project: GraphLibraryDocument,
  scenes: Readonly<Record<string, SceneDefinition>>,
): ValidationIssue[] {
  const { sceneIds } = declaredReferences(project)
  const issues: ValidationIssue[] = []
  if (sceneIds.size === 0) {
    // 没有任何节点引用场景是合法的（纯对白短篇），此时场景线无事可做。
    return issues
  }
  for (const sceneId of [...sceneIds].sort()) {
    const scene = scenes[sceneId]
    const location: PageLocation = { kind: 'asset', root: 'scene', entryId: sceneId }
    if (!scene) {
      issues.push(issue('scenes.catalog.undeclared', `节点引用了未声明的场景 ${sceneId}`, location))
      continue
    }
    if (!scene.name?.trim()) issues.push(issue('scenes.catalog.name-missing', `场景 ${sceneId} 缺少名称`, location))
    if (!scene.visual?.description?.trim()) {
      issues.push(issue('scenes.catalog.description-missing', `场景 ${sceneId} 缺少视觉描述`, location))
    }
    if (!scene.visual?.previewPrompt?.trim()) {
      issues.push(issue('scenes.catalog.prompt-missing', `场景 ${sceneId} 缺少图片 Prompt`, location))
    }
  }
  return issues
}

function sceneReferenceIssues(
  project: GraphLibraryDocument,
  scenes: Readonly<Record<string, SceneDefinition>>,
  assetsById: ReadonlyMap<string, MediaAsset>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  let targets: ReturnType<typeof requiredScenePreviewTargets>
  try {
    targets = requiredScenePreviewTargets(project, scenes)
  } catch (error) {
    return [issue(
      'scene.preview.invalid-reference',
      error instanceof Error ? error.message : String(error),
      { kind: 'asset', root: 'scene' },
    )]
  }
  for (const target of targets) {
    const scene = scenes[target.sceneId]
    const location: PageLocation = { kind: 'asset', root: 'scene', entryId: target.sceneId }
    const asset = scene?.currentAssetId ? assetsById.get(scene.currentAssetId) : undefined
    if (!scene?.currentAssetId) {
      issues.push(issue('scene.preview.missing', `场景 ${target.name} 缺少主预览参考图`, location))
      continue
    }
    if (!isCurrentScenePreview(asset, target.sourcePrompt, target.description)) {
      issues.push(issue(
        'scene.preview.stale',
        `场景 ${target.name} 的主预览图缺失、未就绪或已随场景设定过期`,
        location,
      ))
    }
  }
  return issues
}

// ── 汇总整装（game.finalizing）──────────────────────────────────────────────

/** 节点与边上任何形式的状态后果配置。 */
function settlementConfigured(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false
  return Boolean(
    data.effect || data.effects || data.reaction || data.actions
    || data.settlement || data.settlements || data.routingSettlement,
  )
}

/**
 * 结算齐全：有状态可改的项目，必须至少有一处真正写回状态。
 *
 * 判据刻意宽松——不同游戏的结算形态差别很大（战斗、检定、旗标），
 * 硬性要求某种结构会误伤纯叙事作品。这里只拦「声明了规则却一处都没用上」，
 * 那种情况玩家的选择不会产生任何后果，是真正的空壳。
 */
function settlementIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const hasState = Object.keys(project.variables ?? {}).length > 0
    || Object.keys(project.entities ?? {}).length > 0
  if (!hasState) return []
  const nodeConfigured = allNodes(project).some(({ node }) => (
    settlementConfigured(node.data as unknown as Record<string, unknown>)
  ))
  const edgeConfigured = Object.values(project.manifest.packs).some((blueprint) => (
    blueprint.graph.edges.some((edge) => settlementConfigured(edge.data as unknown as Record<string, unknown>))
  ))
  if (nodeConfigured || edgeConfigured) return []
  return [issue(
    'finalization.settlements.missing',
    '项目声明了变量或实体，但没有任何节点/边写回状态；玩家的选择不会产生后果',
    { kind: 'rule', section: 'variables' },
  )]
}

/** 终局合法：每张蓝图都要有可达终点，且不存在悬空出边。 */
function terminalOutcomeIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [...graphConnectivityIssues(project)]
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    const nodeIds = new Set(blueprint.graph.nodes.map((node) => node.id))
    for (const edge of blueprint.graph.edges) {
      if (!nodeIds.has(edge.target)) {
        issues.push(issue(
          'finalization.edge.dangling',
          `蓝图 ${blueprintId} 的边指向不存在的节点 ${edge.target}`,
          { kind: 'blueprint', blueprintId, nodeId: edge.source },
        ))
      }
    }
  }
  return issues
}

/** 规则绑定引用有效：条件/效果里引用的变量与实体必须存在。 */
function ruleBindingReferenceIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const variables = new Set(Object.keys(project.variables ?? {}))
  const entities = new Set(Object.keys(project.entities ?? {}))
  const issues: ValidationIssue[] = []
  const scan = (value: unknown, where: PageLocation, label: string): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/var\.([A-Za-z_][\w-]*)/g)) {
        if (!variables.has(match[1]!)) {
          issues.push(issue('finalization.binding.unknown-variable', `${label} 引用了不存在的变量 ${match[1]}`, where))
        }
      }
      for (const match of value.matchAll(/entity\.([A-Za-z_][\w-]*)/g)) {
        if (!entities.has(match[1]!)) {
          issues.push(issue('finalization.binding.unknown-entity', `${label} 引用了不存在的实体 ${match[1]}`, where))
        }
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item) => scan(item, where, label))
      return
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach((item) => scan(item, where, label))
    }
  }
  for (const { blueprintId, node } of allNodes(project)) {
    scan(node.data, { kind: 'blueprint', blueprintId, nodeId: node.id }, `节点 ${node.id}`)
  }
  for (const [blueprintId, blueprint] of Object.entries(project.manifest.packs)) {
    blueprint.graph.edges.forEach((edge) => {
      scan(edge.data, { kind: 'blueprint', blueprintId, nodeId: edge.source }, `边 ${edge.source}→${edge.target}`)
    })
  }
  return issues
}

/** 表达式可编译：公式与条件必须能被运行时解析，并且只用白名单函数。 */
function expressionIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [formulaId, formula] of Object.entries(project.formulas ?? {})) {
    const location: PageLocation = { kind: 'rule', section: 'formulas', itemId: formulaId }
    const ast = (formula as { ast?: unknown }).ast
    if (!ast) {
      issues.push(issue('finalization.formula.empty', `公式 ${formulaId} 没有表达式`, location))
      continue
    }
    validateFormulaCalls(ast as Parameters<typeof validateFormulaCalls>[0]).forEach((callIssue) => {
      issues.push(issue(callIssue.code, `公式 ${formulaId}：${callIssue.message}`, location))
    })
  }
  return issues
}

/** 交互入口可达：节点声明的交互必须有对应 overlay。 */
function interactionReachabilityIssues(project: GraphLibraryDocument): ValidationIssue[] {
  const overlays = new Set(Object.keys(project.ui?.overlays ?? {}))
  const issues: ValidationIssue[] = []
  for (const { blueprintId, node } of allNodes(project)) {
    const overlayId = (node.data as unknown as Record<string, unknown>).overlayId
    if (typeof overlayId === 'string' && overlayId && !overlays.has(overlayId)) {
      issues.push(issue(
        'finalization.interaction.unreachable',
        `节点 ${node.id} 引用了不存在的 overlay ${overlayId}`,
        { kind: 'blueprint', blueprintId, nodeId: node.id },
      ))
    }
  }
  return issues
}

/** 未解决占位：模板残留会直接被玩家看到。 */
const PLACEHOLDER_PATTERN = /(?:TODO|TBD|FIXME|待补充|待填写|占位|XXX|\{\{[^}]*\}\}|<[^>]*待[^>]*>)/iu

function placeholderIssues(
  project: GraphLibraryDocument,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const check = (value: string | undefined, label: string, where: PageLocation): void => {
    if (value && PLACEHOLDER_PATTERN.test(value)) {
      issues.push(issue('finalization.placeholder.unresolved', `${label} 仍含未解决占位`, where))
    }
  }
  for (const { blueprintId, node } of allNodes(project)) {
    const where: PageLocation = { kind: 'blueprint', blueprintId, nodeId: node.id }
    check(node.data.chapterSummary, `节点 ${node.id} 的章节梗概`, where)
    check(node.data.storyText, `节点 ${node.id} 的剧情文案`, where)
    check(node.data.media?.kind === 'video' ? node.data.media.prompt : undefined, `节点 ${node.id} 的画面 Prompt`, where)
  }
  return issues
}

/** 声明兑现：总脉络声明的角色与场景都必须已在目录中声明（逻辑声明）。参考图缺失不阻塞蓝图。 */
function declarationsResolvedIssues(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
  scenes: Readonly<Record<string, SceneDefinition>>,
): ValidationIssue[] {
  const { characterIds, sceneIds } = declaredReferences(project)
  return [
    ...[...characterIds].filter((id) => !characters[id]).map((id) => issue(
      'outline.character.undeclared',
      `节点引用了未声明的角色 ${id}`,
      { kind: 'asset', root: 'character', entryId: id },
    )),
    ...[...sceneIds].filter((id) => !scenes[id]).map((id) => issue(
      'outline.scene.undeclared',
      `节点引用了未声明的场景 ${id}`,
      { kind: 'asset', root: 'scene', entryId: id },
    )),
  ]
}

export function inspectBlueprintLogic(project: GraphLibraryDocument): ValidationIssue[] {
  return [
    ...validateDocument(project).map((message) => issue('project.invalid', message)),
    ...terminalOutcomeIssues(project),
    ...choiceIssues(project),
    ...settlementIssues(project),
    ...ruleBindingReferenceIssues(project),
    ...expressionIssues(project),
    ...requiredUiIssueList(project),
    ...interactionReachabilityIssues(project),
    ...componentWiringIssues(project),
    ...componentTimingIssues(project),
    ...finalizationPlanWiringIssues(project),
    ...placeholderIssues(project),
  ]
}

export function inspectAssetReadiness(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
  scenes: Readonly<Record<string, SceneDefinition>>,
  assetsById: ReadonlyMap<string, MediaAsset>,
): ValidationIssue[] {
  return [
    ...characterCatalogIssues(project, characters),
    ...sceneCatalogIssues(project, scenes),
    ...characterReferenceIssues(project, characters, assetsById),
    ...sceneReferenceIssues(project, scenes, assetsById),
    ...videoPresetIssues(project),
  ]
}

export interface ProjectValidationResult {
  schemaVersion: 1
  ok: boolean
  summary: ValidationSummary
  evidence: ValidationEvidence[]
}

/**
 * 只报警不拦路的检查。
 *
 * 1. 语言漂移、公式未消费、结局缺失是质量提示，不阻塞完成；
 * 2. 角色/场景参考图生成、节点视频预设是为视频生产服务的支线资料，不阻塞蓝图本身交付；
 * 3. 基础需求维度、篇幅和章节/角色/场景规模预算是指导性指标，不一致时给出 warning 提醒，不阻塞蓝图交付。
 */
const WARNING_CHECKS = new Set([
  'content.language-consistency',
  'content.formula-usage',
  'content.ending-presence',
  'brief.required-dimensions',
  'outline.node-count-matches-scale',
  'finalization.character-references-valid',
  'finalization.scene-references-valid',
  'finalization.node-presets-complete',
  'finalization.work-scale-budget',
])

function briefDimensionIssues(
  workflowState: VideoGameWorkflowState | null | undefined,
): ValidationIssue[] {
  const contract = workflowState?.requirementContract
  if (!contract) return []
  const issues: ValidationIssue[] = []
  if (!contract.dimensions.work_scale?.value?.trim()) {
    issues.push(issue('brief.work-scale.missing', '尚未确定篇幅规模（极短/短篇/中篇/长篇），无法规划后续蓝图章节数量'))
  }
  return issues
}

export async function validateProjectForActivity(
  context: ExtensionContext,
  activity: VideoGameActivity,
  activityRevision: number,
  requestedChecks?: readonly string[],
  workflowState?: VideoGameWorkflowState | null,
): Promise<ProjectValidationResult> {
  const inspected = await inspectProject(context)
  const project = inspected.project
  const { characters, scenes, videos } = inspected.assetEntities
  const assets = await createHostAssetRegistry(context).list().catch(() => [])
  const blueprintBytes = await context.files.read(BLUEPRINT_FILE)
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]))
  const checks = new Map<string, ValidationIssue[]>()
  // 文档就绪对全部文档类型登记，而不是只对「当前活动恰好是该文档」时登记。
  // 只按当前活动登记会让 `document.inquiry.ready` 这类 check 在别的活动里
  // 变成「未知校验项」，从而误判失败——汇总整装读取上游证据时就会踩到。
  // `intake` 是退役文档，只保留可读性，不再对内容有要求（设计 §9.10）。
  const intakeRegistered = (inspected.inventory.documents.intake ?? 0) > 0
  checks.set('document.intake.ready', intakeRegistered
    ? []
    : [issue('document.intake.missing', 'intake 文档尚未登记', { kind: 'document', documentType: 'intake' })])
  for (const documentType of ['core', 'inquiry', 'pillar'] as const) {
    checks.set(
      `document.${documentType}.ready`,
      documentSubstanceIssues(documentType, inspected.documentContents[documentType]),
    )
  }
  void activity
  checks.set('brief.required-dimensions', briefDimensionIssues(workflowState))
  // 语言一致性是 warn 级：报出字段路径供润色，但不阻塞完成（设计 §11.4）。
  // warn 级：设计了但没接上的公式要被看见，但不阻塞完成。
  checks.set('content.formula-usage', project ? unusedFormulaIssues(project) : [])
  checks.set('content.ending-presence', project ? endingPresenceIssues(project) : [])
  checks.set('content.language-consistency', project
    ? [
      ...languageConsistencyIssues(project, { characters, scenes, videos }).map((item) => issue(
        'content.language-drift',
        `${item.message}（${item.path}）：${item.sample}`,
      )),
      ...Object.entries(project.manifest.packs).flatMap(([blueprintId, pack]) => (
        nodeLanguageIssues(pack.graph.nodes, blueprintId).map((item) => issue(
          'content.language-drift',
          `${item.message}（${item.path}）：${item.sample}`,
          { kind: 'blueprint', blueprintId, nodeId: item.path.split('.nodes.')[1]?.split('.')[0] },
        ))
      )),
    ]
    : [])
  const gateIssues = (gate: 'core' | 'pillar'): ValidationIssue[] => {
    const value = workflowState?.gates?.[gate]
    return value?.status === 'approved' && Boolean(value.evidenceRef)
      ? []
      : [issue(
        `gate.${gate}.pending`,
        gate === 'core' ? '核心方案尚未由作者确认' : '游戏支柱尚未由作者确认',
        { kind: 'document', documentType: gate === 'core' ? 'core' : 'pillar' },
      )]
  }
  checks.set('gate.core.approved', gateIssues('core'))
  checks.set('gate.pillar.approved', gateIssues('pillar'))
  const designOptions = designOptionIssues(inspected.documentContents['design-options'])
  checks.set('document.design-options.ready', designOptions)
  checks.set('document.design-options.options', designOptions)
  const rulesCount = inspected.inventory.entityCount + inspected.inventory.variableCount + inspected.inventory.formulaCount
  checks.set('rules.catalog.valid', [
    ...inspected.issues,
    ...(rulesCount > 0 ? [] : [issue('rules.catalog.empty', '规则目录至少需要一个实体、变量或公式', { kind: 'rule', section: 'entities' })]),
  ])
  // 声明（只有 id + name）不能算完成：角色线的活就是把声明补成完整定义。
  // 不查这一步，空壳角色会一路带到出图，然后在「缺 previewPrompt」时才炸。
  checks.set('characters.catalog.valid', project
    ? [...inspected.issues, ...characterCatalogIssues(project, characters)]
    : inspected.issues)
  checks.set('characters.count-matches-scale', workScaleCharacterCountIssues(characters, workflowState))
  checks.set('graph.connected', project ? graphConnectivityIssues(project) : inspected.issues)
  // 出边生产者：每条出边都要有能在运行时把它走通的机制，否则是死分支（设计 §4.2）。
  checks.set('edge.no-producer', project ? edgeProducerIssues(project) : inspected.issues)
  // L2 形状：拦住 reaction.when.condition 挂错层级、字符串 condition 等会炸运行时的 dialect。
  checks.set('runtime.shape.valid', project ? runtimeShapeIssues(project) : inspected.issues)
  checks.set('graph.choice-consequence', project ? choiceIssues(project) : inspected.issues)
  checks.set('node.video-preset-complete', project ? videoPresetIssues(project) : inspected.issues)
  // 活动级 check 曾经只回传通用文档问题，等于 `rules.binding` 与 `ui.authoring`
  // 的完成门形同虚设——真实逻辑一直只在汇总整装复核时才跑。
  checks.set('rules.bindings.valid', project
    ? [...settlementIssues(project), ...ruleBindingReferenceIssues(project), ...attrRatioMetadataIssues(project)]
    : inspected.issues)
  checks.set('ui.reuses-existing-overlays', project ? baseOverlayReuseIssues(project) : inspected.issues)
  checks.set('ui.interactions.reachable', project
    ? [
      ...interactionReachabilityIssues(project),
      ...requiredUiIssueList(project),
      ...componentWiringIssues(project),
      ...componentTimingIssues(project),
    ]
    : inspected.issues)
  const characterReferenceIssueList = project
    ? characterReferenceIssues(project, characters, assetsById)
    : inspected.issues
  checks.set('characters.references.ready', characterReferenceIssueList)

  // ── 总脉络：只查骨架与声明，不查三条线的内容 ──
  checks.set('outline.graph-connected', project ? graphConnectivityIssues(project) : inspected.issues)
  checks.set('outline.choice-consequence', project ? choiceIssues(project) : inspected.issues)
  checks.set('outline.node-summary-complete', project ? outlineNodeSummaryIssues(project) : inspected.issues)
  checks.set('outline.node-count-matches-scale', project
    ? workScaleNodeCountIssues(project, workflowState)
    : inspected.issues)
  checks.set('outline.declarations-complete', project ? outlineDeclarationIssues(project) : inspected.issues)
  checks.set('outline.declaration-budget', project ? outlineBudgetIssues(project) : inspected.issues)
  // 玩法契约：三条线共享的唯一设计，三段各有闸门（设计 §玩法契约）。
  checks.set('outline.interaction-plan', project ? outlineInteractionPlanIssues(project, workflowState) : inspected.issues)
  checks.set('combat.pack-required', project ? combatPackIssues(project) : inspected.issues)
  checks.set('rules.plan-formulas', project ? rulesPlanFormulaIssues(project) : inspected.issues)
  checks.set('finalization.plan-wired', project ? finalizationPlanWiringIssues(project) : inspected.issues)

  // ── 场景：与角色两项对称 ──
  const sceneReferenceIssueList = project ? sceneReferenceIssues(project, scenes, assetsById) : inspected.issues
  checks.set('scenes.catalog.valid', project ? sceneCatalogIssues(project, scenes) : inspected.issues)
  checks.set('scenes.count-matches-scale', workScaleSceneCountIssues(scenes, workflowState))
  checks.set('scenes.references.ready', sceneReferenceIssueList)
  const videoBindingIssues = project
    ? videoPresetBindingReceiptIssues(project, blueprintBytes)
    : inspected.issues
  checks.set('video.presets.bound', project ? videoPresetIssues(project) : inspected.issues)
  checks.set('video.presets.binding-receipt', videoBindingIssues)
  checks.set('video.presets.ready-to-submit', [
    ...(project ? videoPresetIssues(project) : inspected.issues),
    ...videoBindingIssues,
  ])

  // ── 汇总整装：对前面几步做齐全性复核，而不是重做 ──
  const requiredUiIssues = requiredUiIssueList(project)
  checks.set('finalization.declarations-resolved', project
    ? declarationsResolvedIssues(project, characters, scenes)
    : inspected.issues)
  checks.set('finalization.settlements-complete', project ? settlementIssues(project) : inspected.issues)
  checks.set('finalization.terminal-outcomes-valid', project ? terminalOutcomeIssues(project) : inspected.issues)
  checks.set('finalization.rule-bindings-valid', project
    ? [...ruleBindingReferenceIssues(project), ...attrRatioMetadataIssues(project)]
    : inspected.issues)
  checks.set('finalization.expressions-compile', project ? expressionIssues(project) : inspected.issues)
  checks.set('finalization.required-ui-complete', requiredUiIssues)
  checks.set('finalization.interactions-reachable', project
    ? [...interactionReachabilityIssues(project), ...componentWiringIssues(project), ...componentTimingIssues(project)]
    : inspected.issues)
  checks.set('finalization.character-references-valid', characterReferenceIssueList)
  checks.set('finalization.scene-references-valid', sceneReferenceIssueList)
  checks.set('finalization.node-presets-complete', project ? videoPresetIssues(project) : inspected.issues)
  checks.set('finalization.no-unresolved-placeholder', project ? placeholderIssues(project) : inspected.issues)
  checks.set('finalization.work-scale-budget', project
    ? [
      ...workScaleNodeCountIssues(project, workflowState),
    ]
    : inspected.issues)

  /**
   * 蓝图逻辑模拟的前置证据。`validate_project` 服务会用无媒体加载的 GraphSession
   * 路径推演替换同名 evidence；直接调用本函数时仍先给出结构判定。
   */
  const playtestPrerequisites = project
    ? [...graphConnectivityIssues(project), ...choiceIssues(project)]
    : inspected.issues
  checks.set('playtest.all-required-paths-reach-terminal', playtestPrerequisites)
  // 逻辑自洽三项：整装完成时游戏还没有成片，判据是流程设计能不能玩通。
  checks.set('playtest.no-dead-loop', project ? deadLoopIssues(project) : inspected.issues)
  checks.set('playtest.no-orphan-exit', project ? orphanExitIssues(project) : inspected.issues)
  checks.set('playtest.interactions-reachable', project
    ? [...interactionReachabilityIssues(project), ...componentWiringIssues(project), ...componentTimingIssues(project)]
    : inspected.issues)
  checks.set('playtest.rules-executable', project
    ? [...settlementIssues(project), ...ruleBindingReferenceIssues(project), ...expressionIssues(project), ...attrRatioMetadataIssues(project)]
    : inspected.issues)
  checks.set('playtest.numeric-sanity', project ? numericSanityIssues(project) : inspected.issues)
  // 路径不非法卡死（设计 §5）：可达但被默认出边一直拖着、既到不了终局也停不到等玩家的
  // 停留点，才算非法卡死；合法等待玩家事件（只有事件出边）不算。复用 deadLoopIssues 的
  // 静态可达性推演，不要求抵达终局。
  checks.set('playtest.paths-not-illegally-stuck', project ? deadLoopIssues(project) : inspected.issues)

  const targetChecks = requestedChecks !== undefined
    ? expandCheckIds(requestedChecks)
    : [...checks.keys()]
  const observedAt = new Date().toISOString()
  const evidence: ValidationEvidence[] = targetChecks.map((checkId) => {
    const issues = checks.get(checkId) ?? [issue('check.unknown', `未知校验项 ${checkId}`)]
    return {
      schemaVersion: 1,
      activity,
      activityRevision,
      projectRevision: inspected.projectRevision,
      checkId,
      status: issues.length
        ? (WARNING_CHECKS.has(checkId) || issues.every((entry) => entry.level === 'warning') ? 'warn' : 'fail')
        : 'pass',
      observedAt,
      ...(issues.length ? { issues } : {}),
    }
  })
  // warn 不进 issues 汇总：它不该把 semantic 判成 fail，也不该让 ok 变 false。
  const allIssues = evidence.filter((item) => item.status === 'fail').flatMap((item) => item.issues ?? [])
  return {
    schemaVersion: 1,
    ok: evidence.every((item) => item.status !== 'fail'),
    summary: {
      projectRevision: inspected.projectRevision,
      structural: inspected.issues.length ? 'fail' : 'pass',
      semantic: allIssues.length ? 'fail' : 'pass',
      references: inspected.issues.length ? 'fail' : 'pass',
      productionReadiness: targetChecks.some((check) => check.includes('preset')) ? (allIssues.length ? 'fail' : 'pass') : 'not-run',
      choices: targetChecks.includes('graph.choice-consequence') ? (checks.get('graph.choice-consequence')?.length ? 'fail' : 'pass') : 'not-run',
      playable: 'not-run',
      issues: allIssues,
    },
    evidence,
  }
}
