import type { ExtensionContext } from '@forgeax/extension-host/node'
import type {
  GraphLibraryDocument,
  NodeRef,
  NodeVideoGenerationPreset,
  NodeVideoMedia,
} from '@/runtime/core/schema/graph-schema'
import type {
  AssetManifest,
  CharacterDefinition,
  MediaAsset,
  MediaKind,
  MediaProductionType,
  StyleAxes,
  DocumentType,
} from '@/authoring/assets/registry-types'
import {
  normalizeDocument,
  validateDocument,
} from '@/authoring/blueprint/blueprint-project'
import {
  createHostAssetRegistry,
  HOST_MANIFEST_LOCK,
  listHostDocuments,
  readHostManifest,
  readHostManifestSnapshot,
  readHostDocument,
  sanitizePublicText,
  upsertHostDocument,
  writeHostManifestRevision,
  type AssetFilter,
} from '../asset-registry'
import {
  materializeCoreMarkdown,
  parseDesignOptions,
  type DesignOptionId,
} from '@/authoring/documents/core-design-options'
import {
  createHostGenerationOrchestrator,
  type KeyframeInput,
  type VideoGenInput,
} from '../generation/orchestrate'
import { generateVideoClip, type GenerateVideoClipArgs } from '../generation/clip'
import { listVideoVisualStyles } from '../generation/visual-styles'
import {
  polishOverlayPromptWithModel,
  OVERLAY_PROMPT_MAX_LENGTH,
  polishVideoPromptWithModel,
  VIDEO_PROMPT_MAX_LENGTH,
} from '../generation/prompt-polish'
import {
  importCharacterRefsFromHost,
  importSceneRefsFromHost,
} from '../intake'
import {
  validateServiceInput,
  type ServiceSchemaName,
} from './service-validation'
import { NODIA_ASSETS_MANIFEST } from './nodia-assets'
import { applyPatchGraphOps, agentUiPatchErrors, graphOpTouchesUi } from './patch-graph-ops'
import {
  appendMutationReceipt,
  assetManifestScopedRevisionConflict,
  readScopeRevisions,
  scopedRevisionConflict,
  mutationFingerprint,
  nextDocumentRevision,
  readDocumentRevision,
  readMutationReceipts,
  resolveMutationReceipt,
  revisionConflict,
  stampDocumentRevision,
  type IdempotencyConflict,
  type MutationReceipt,
  type RevisionConflict,
} from './document-revision'
import {
  applyRuleOps,
  type RuleOp,
  type RuleOpOutcome,
} from '@/authoring/rules/rule-authoring'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { recompileFormulaUsages } from '@/authoring/formulas/formula-apply'
import { activityContract } from '../../workflow/activity-contracts'
import {
  VIDEO_GAME_ACTIVITIES,
  type CompletionReport,
  type PageLocation,
  type ValidationEvidence,
  type VideoGameActivity,
  type VideoGameWorkflowState,
} from '../../workflow/contracts'
import {
  assertWorkflowMutationAllowed,
  assertAssetCatalogMutationAllowed,
  canCreateCatalogAdHocScenes,
  isPostDeliveryCatalogMaintenance,
  readWorkflowStateForMutation,
  awaitWorkflowUser,
  beginWorkflowActivity,
  activeActivityOf,
  settledActivityOf,
  completeWorkflowActivity,
  confirmPillarAuthorGate as recordPillarAuthorGate,
  normalizeRequirementContract,
  projectWorkflowState,
  readWorkflowState,
  recordCoreSelectionGate,
  reconcileProductionFailure,
  markPeerAbandonedActivity,
  reportWorkflowBlocker,
  setWorkflowFocus,
  WorkflowStateError,
} from './workflow-state'
import { autoAdvanceWorkflowForDocument } from './workflow-auto-advance'
import { choiceConsequenceIssues, inspectProject, uiNotRequiredByPillar, validateProjectForActivity } from './project-inspection'
import { simulatePassA } from './runtime-simulation'
import { getNodeProductionContext } from './node-production-context'
import { validateNodeVideoGenerationPreset } from '@/runtime/core/schema/node-video-preset'
import { preflightActivity } from './activity-preflight'
import { componentContracts, authoredComponentContracts } from './component-catalog'
import {
  knownComponentIds,
  listAuthoredComponentManifests,
  parseComposedOverlay,
  upsertAuthoredComponent,
  writeComposedOverlay,
} from './component-authoring'
import {
  clearRejections,
  PLAYTEST_VALIDATING_BYPASS_AFTER_FAILURES,
  recordRejection,
} from './retry-ledger'
import { runGenerateCharacterPreviews } from './character-preview-service'
import { runScenePreviewBatch } from './scene-preview-service'
import { applySceneOps, type SceneOp } from '@/authoring/scenes/scene-authoring'
import { characterPreviewSourceHash } from '../generation/character-previews'
import { scenePreviewSourceHash } from '../generation/scene-previews'
import {
  CHARACTER_PREVIEW_DEFAULT_MODE,
  type CharacterPreviewMode,
} from '@/runtime/core/schema/character-preview'
import {
  SCENE_PREVIEW_DEFAULT_MODE,
  scenePreviewShapeKey,
  type ScenePreviewMode,
} from '@/runtime/core/schema/scene-preview'
import {
  assetEntityDefinitions,
  mergeAssetEntityDefinitions,
  normalizeAssetCatalogState,
  syncProjectVideoPresets,
} from './asset-entity-catalog'
import { ensureFinalBlueprintPlaceholderVideos } from './final-blueprint-placeholder'
import {
  graphSnapshotToken,
  projectGraphShard,
  type GraphProjectionField,
} from './graph-projection'

/**
 * 幂等键由 Host 从 (活动, 活动修订号, 目标) 推导（设计 §9.7.4）。
 *
 * 让模型自己编一个稳定键，是「同一批重放」这件事最容易出错的地方：
 * 键编重了会误判成重复批次，键编散了会重复出图并重复计费。
 */
function derivedIdempotencyKey(
  provided: unknown,
  activity: string,
  activityRevision: number,
  targets: readonly string[] | undefined,
  shape?: string,
): string {
  const explicit = typeof provided === 'string' ? provided.trim() : ''
  if (explicit) return explicit
  // 目标集合必须进 key：重试时缩小到「只补失败那一张」是另一批写入，
  // 沿用整批的 key 会被判成 `idempotency.conflict`（实测踩到过）。
  const scope = targets && targets.length > 0 ? [...targets].sort().join(',') : 'all'
  // 出图形态同理：同一活动里从单幅换成多机位是另一批写入，共用键会撞冲突。
  return `${activity}@${activityRevision}:${scope}${shape ? `#${shape}` : ''}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BLUEPRINT_FILE = 'blueprint.json'
const PROJECT_FILE = 'project.json'
const ASSETS_MANIFEST_FILE = 'assets/manifest.json'
import { GRAPH_SAVE_LOCK } from './locks'
export { GRAPH_SAVE_LOCK } from './locks'

/** 仅供测试：幂等键推导是并发正确性的一部分，值得单独钉住。 */
export const derivedIdempotencyKeyForTest = (
  provided: unknown,
  activity: string,
  activityRevision: number,
  targets?: readonly string[],
  shape?: string,
): string => derivedIdempotencyKey(provided, activity, activityRevision, targets, shape)

export class ExtensionServiceInputError extends TypeError {
  readonly code = 'invalid_input'
}

export interface GameVideoService {
  getGraph(input?: unknown): Promise<unknown>
  saveGraph(input: unknown): Promise<unknown>
  patchGraph(input: unknown): Promise<unknown>
  patchNodeMedia(input: unknown): Promise<unknown>
  patchRules(input: unknown): Promise<unknown>
  patchCharacters(input: unknown): Promise<unknown>
  generateCharacterPreviews(input: unknown): Promise<unknown>
  patchScenes(input: unknown): Promise<unknown>
  generateScenePreviews(input: unknown): Promise<unknown>
  getWorkflowState(input?: unknown): Promise<unknown>
  getPillarAuthorGateProposal(input?: unknown): Promise<unknown>
  confirmPillarAuthorGate(input: unknown): Promise<unknown>
  beginActivity(input: unknown): Promise<unknown>
  awaitUser(input: unknown): Promise<unknown>
  completeActivity(input: unknown): Promise<unknown>
  reconcileProductionFailure(input: unknown): Promise<unknown>
  markPeerAbandonedActivity(input: unknown): Promise<unknown>
  reportBlocker(input: unknown): Promise<unknown>
  focusPage(input: unknown): Promise<unknown>
  inspectProject(input?: unknown): Promise<unknown>
  validateProject(input: unknown): Promise<unknown>
  simulatePassA(input: unknown): Promise<unknown>
  getNodeProductionContext(input: unknown): Promise<unknown>
  preflightActivity(input: unknown): Promise<unknown>
  listUiComponents(input?: unknown): Promise<unknown>
  listVideos(input: unknown): Promise<unknown>
  listAssets(query: unknown): Promise<unknown>
  getAsset(assetId: string): Promise<unknown>
  deleteAsset(assetId: string): Promise<unknown>
  importCharacterRefs(input: unknown): Promise<unknown>
  importSceneRefs(input: unknown): Promise<unknown>
  registerKinoReference(input: unknown): Promise<unknown>
  polishVideoPrompt(input: unknown): Promise<{ prompt: string }>
  polishOverlayPrompt(input: unknown): Promise<{ prompt: string }>
  generateShotScript(input: unknown): Promise<unknown>
  generateKeyframe(input: unknown): Promise<unknown>
  generateVideo(input: unknown): Promise<unknown>
  generateVideoClip(input: unknown): Promise<unknown>
  listVideoVisualStyles(input?: unknown): Promise<unknown>
  generateNodeVideo(input: unknown): Promise<unknown>
  upsertDocument(input: unknown): Promise<unknown>
  importStageArtifacts(input: unknown): Promise<unknown>
  applyDesignOptions(input: unknown): Promise<unknown>
  upsertComponent(input: unknown): Promise<unknown>
}

function assertSchema(schema: ServiceSchemaName, value: unknown): void {
  const errors = validateServiceInput(schema, value)
  if (errors.length) throw new ExtensionServiceInputError(errors.join('; '))
}

/** Outcome of a blueprint write that may be refused by the optimistic lock. */
type WriteOutcome =
  | { ok: true; revision: number; replayed?: boolean }
  | { ok: false; conflict: RevisionConflict | IdempotencyConflict }
  | { ok: false; errors: string[]; errorCode: 'validation.failed' }

/** Args schema already constrains this to a non-negative integer. */
function optionalRevision(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function optionalIdempotencyKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const IMPORTED_STAGE_ARTIFACT_MAX_CHARS = 500_000

type ImportedStageArtifacts = {
  slug: string
  core: string
  pillar?: string
}

function importedStageArtifacts(value: unknown): ImportedStageArtifacts {
  const input = record(value)
  assertOnlyKeys(input, ['slug', 'artifacts'])
  const slug = stringValue(input.slug, 'slug', true)!
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(slug)) {
    throw new ExtensionServiceInputError('slug must be a safe document filename prefix')
  }
  const artifacts = record(input.artifacts)
  assertOnlyKeys(artifacts, ['core', 'pillar'])
  if (typeof artifacts.core !== 'string' || artifacts.core.trim().length === 0) {
    throw new ExtensionServiceInputError('core artifact is required')
  }
  const core = stringValue(artifacts.core, 'artifacts.core', true)!
  const pillar = stringValue(artifacts.pillar, 'artifacts.pillar')
  if (core.length > IMPORTED_STAGE_ARTIFACT_MAX_CHARS) {
    throw new ExtensionServiceInputError('core artifact is too large')
  }
  if (pillar && pillar.length > IMPORTED_STAGE_ARTIFACT_MAX_CHARS) {
    throw new ExtensionServiceInputError('pillar artifact is too large')
  }
  return { slug, core, ...(pillar ? { pillar } : {}) }
}

function importedEvidence(
  state: VideoGameWorkflowState,
  activity: VideoGameActivity,
): ValidationEvidence[] {
  const activityRevision = state.activities[activity]?.revision ?? state.activityRevision
  return activityContract(activity).hardChecks.map((checkId) => ({
    schemaVersion: 1,
    activity,
    activityRevision,
    checkId,
    status: 'pass',
    observedAt: new Date(Date.now()).toISOString(),
    details: { source: 'local-stage-artifact-import', acceptedByAuthor: true },
  }))
}

async function completeImportedActivity(
  context: ExtensionContext,
  activity: VideoGameActivity,
  options: { requirementContract?: unknown; inquiryContract?: unknown } = {},
): Promise<VideoGameWorkflowState> {
  let state = (await readWorkflowState(context, { create: true }))!
  const existing = state.activities[activity]
  if (existing?.status === 'complete' || existing?.status === 'not-required') return state

  if (existing?.status !== 'working') {
    state = await beginWorkflowActivity(context, {
      activity,
      expectedWorkflowRevision: state.revision,
    })
  }
  const activityRevision = state.activities[activity]?.revision ?? state.activityRevision
  const evidence = importedEvidence(state, activity)
  return completeWorkflowActivity(context, {
    schemaVersion: 1,
    activity,
    activityRevision,
    artifactRefs: activity === 'document.core' || activity === 'document.pillar'
      ? [{ kind: 'document', id: `doc-${activity.split('.')[1]}`, revision: 1, status: 'ready' }]
      : [],
    checkIds: evidence.map((item) => item.checkId),
  }, evidence, options)
}

async function importAcceptedStageArtifacts(
  context: ExtensionContext,
  input: ImportedStageArtifacts,
) {
  const initial = (await readWorkflowState(context, { create: true }))!
  const latestImportedActivity = input.pillar ? 'document.pillar' : 'document.core'
  const workflowOrder = ['brief.collecting', 'document.inquiry', 'document.core', 'document.pillar'] as const
  const currentIndex = workflowOrder.indexOf(initial.activity as typeof workflowOrder[number])
  if (currentIndex < 0 || currentIndex > workflowOrder.indexOf(latestImportedActivity)) {
    throw new ExtensionServiceInputError(`workflow has already advanced beyond ${latestImportedActivity}`)
  }

  await upsertHostDocument(context, {
    documentType: 'core',
    slug: input.slug,
    content: input.core,
    name: '核心',
  })
  if (input.pillar) {
    await upsertHostDocument(context, {
      documentType: 'pillar',
      slug: input.slug,
      content: input.pillar,
      name: '支柱',
    })
  }

  await completeImportedActivity(context, 'brief.collecting', {
    requirementContract: {
      rawIntent: `Imported accepted core artifact for ${input.slug}`,
      dimensions: {
        imported_checkpoint: { value: 'core', source: 'author' },
      },
      locale: 'zh-CN',
    },
  })
  await completeImportedActivity(context, 'document.inquiry', {
    inquiryContract: {
      answers: Array.from({ length: 5 }, (_, index) => ({
        question: `Imported checkpoint decision ${index + 1}`,
        answer: 'Accepted in the imported stage artifact.',
      })),
    },
  })
  await completeImportedActivity(context, 'document.core')
  await recordCoreSelectionGate(context, { optionId: 'imported' })

  let state = (await readWorkflowState(context))!
  if (state.activity !== 'document.pillar' || state.activityStatus !== 'working') {
    state = await beginWorkflowActivity(context, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      gateApproval: state.gates.core,
    })
  }
  if (!input.pillar) {
    return { state, imported: ['core'], resumeActivity: 'document.pillar' as const }
  }

  state = await completeImportedActivity(context, 'document.pillar')
  state = await recordPillarAuthorGate(context, {
    productionId: `local-stage-artifact-import:${input.slug}`,
  })
  state = await beginWorkflowActivity(context, {
    activity: 'blueprint.outline',
    expectedWorkflowRevision: state.revision,
  })
  return { state, imported: ['core', 'pillar'], resumeActivity: 'blueprint.outline' as const }
}

/**
 * A conflict is a normal, retryable outcome rather than an exception: the
 * caller is expected to re-read and rebase, so it needs the current revision.
 */
function conflictResult(
  conflict: RevisionConflict | IdempotencyConflict,
  gameSlug: string,
) {
  return {
    schemaVersion: 1,
    ok: false as const,
    errors: [conflict.message],
    errorCode: conflict.code,
    revision: conflict.currentRevision,
    gameSlug,
  }
}

function validationSummary(revision: number) {
  return {
    schemaVersion: 1,
    projectRevision: revision,
    structural: 'pass' as const,
    semantic: 'not-run' as const,
    references: 'pass' as const,
    productionReadiness: 'not-run' as const,
    choices: 'not-run' as const,
    playable: 'not-run' as const,
    issues: [],
  }
}

function artifactRef(id: string, revision: number) {
  return { kind: 'blueprint', id, revision }
}

function mutationReceipt(
  key: string | undefined,
  operation: string,
  fingerprint: string,
  revision: number,
  payload: Record<string, unknown>,
): MutationReceipt | undefined {
  return key ? { key, operation, fingerprint, revision, payload } : undefined
}

function graphUiHint(
  blueprintId: string,
  ops: Array<Record<string, unknown>>,
) {
  const last = ops.at(-1)
  const nodeId = typeof last?.nodeId === 'string'
    ? last.nodeId
    : typeof last?.afterId === 'string'
      ? last.afterId
      : undefined
  return {
    location: nodeId
      ? { kind: 'blueprint-node', blueprintId, nodeId }
      : { kind: 'blueprint', blueprintId },
    reveal: 'select-and-expand' as const,
  }
}

function rulesUiHint(ops: readonly RuleOp[], results: readonly RuleOpOutcome[]) {
  const lastOp = ops.at(-1)
  const lastResult = results.at(-1)
  const section = lastOp?.op.includes('entity')
    ? 'entities'
    : lastOp?.op.includes('variable')
      ? 'variables'
      : 'formulas'
  const removed = lastOp?.op.startsWith('remove-') === true
  return {
    location: {
      kind: 'rule',
      section,
      ...(!removed && lastResult ? { itemId: lastResult.id } : {}),
    },
    reveal: 'select-and-expand' as const,
  }
}

function ruleValidationErrorCode(ops: readonly RuleOp[], errors: readonly string[]): string {
  const text = errors.join('\n')
  if (ops.some((op) => op.op === 'remove-entity' || op.op === 'remove-entity-attr')
    && /未知实体|不存在的实体/.test(text)) return 'rules.entity.in-use'
  if (ops.some((op) => op.op === 'remove-variable')
    && /未知变量|不存在的变量/.test(text)) return 'rules.variable.in-use'
  if (ops.some((op) => op.op === 'remove-formula')
    && /不存在的公式/.test(text)) return 'rules.formula.in-use'
  return 'validation.failed'
}

function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error && typeof error.message === 'string'
    ? error.message
    : 'Operation failed'
  return sanitizePublicText(raw).slice(0, 400)
}

function record(value: unknown, label = 'Input'): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExtensionServiceInputError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(
  value: unknown,
  name: string,
  required = false,
): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ExtensionServiceInputError(`${name} must be a non-empty string`)
  }
  return value
}

function numberValue(
  value: unknown,
  name: string,
  fallback: number,
  maximum = Number.POSITIVE_INFINITY,
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ExtensionServiceInputError(`${name} must be a positive number`)
  }
  if (value > maximum) {
    throw new ExtensionServiceInputError(`${name} must be at most ${maximum}`)
  }
  return value
}

function stringArray(value: unknown, name: string, minimum = 0): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ExtensionServiceInputError(`${name} must be an array of strings`)
  }
  const result = value.filter(Boolean)
  if (result.length < minimum) {
    throw new ExtensionServiceInputError(`${name} must contain at least ${minimum} item`)
  }
  return result
}

function assertLogicalIdentifier(value: string, label: string): string {
  if (
    value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || /^(?:\/|[A-Za-z]:[\\/])/.test(value)
  ) {
    throw new ExtensionServiceInputError(`${label} must be a relative identifier`)
  }
  return value
}

async function readPillarAuthorGateProposal(context: ExtensionContext) {
  const state = await readWorkflowState(context)
  if (!state) throw new ExtensionServiceInputError('Video-game workflow has not been initialized')
  const alreadyApproved = state.gates.pillar?.status === 'approved'
    && Boolean(state.gates.pillar.evidenceRef)
  if (!alreadyApproved && (state.activity !== 'document.pillar' || state.activityStatus !== 'complete')) {
    throw new ExtensionServiceInputError('Pillar confirmation requires document.pillar to be complete')
  }
  const pillar = (await listHostDocuments(context)).find((entry) => entry.meta.documentType === 'pillar')
  if (!pillar) throw new ExtensionServiceInputError('Pillar document is missing')
  return {
    schemaVersion: 1,
    // 旧 UI 仍会回传这个值，但 confirm 明确忽略它；保留只为请求形状平滑过渡。
    workflowRevision: state.revision,
    gateRevision: state.gates.pillar?.revision ?? 0,
    documentId: pillar.id,
    documentUpdatedAt: pillar.updatedAt,
    alreadyApproved,
  }
}

/**
 * Tool/router adapter for the published get-asset object schema. The business
 * service itself keeps the established `getAsset(assetId)` interface.
 */
export function getAssetIdFromArgs(value: unknown): string {
  assertSchema('getAsset', value)
  const input = record(value)
  return assertLogicalIdentifier(
    stringValue(input.id, 'id', true)!,
    'assetId',
  )
}

function assertOnlyKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed)
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new ExtensionServiceInputError('Input contains unsupported path or selector fields')
  }
}

function graphOpTouchesNodeMedia(op: Record<string, unknown>): boolean {
  if (op.op === 'set-node-data') {
    return Object.prototype.hasOwnProperty.call(record(op.patch, 'patch'), 'media')
  }
  if (op.op === 'add-node' || op.op === 'insert-node-after') {
    const node = op.node
    if (node === undefined) return false
    return Object.prototype.hasOwnProperty.call(
      record(record(node, 'node').data, 'node.data'),
      'media',
    )
  }
  return false
}

function optionalStyleAxes(value: unknown): StyleAxes | undefined {
  if (value === undefined) return undefined
  const input = record(value, 'styleAxes')
  assertOnlyKeys(input, ['artMedia', 'director', 'filmLook'])
  const axes: StyleAxes = {}
  const artMedia = stringValue(input.artMedia, 'styleAxes.artMedia')
  const director = stringValue(input.director, 'styleAxes.director')
  const filmLook = stringValue(input.filmLook, 'styleAxes.filmLook')
  if (artMedia !== undefined) axes.artMedia = artMedia
  if (director !== undefined) axes.director = director
  if (filmLook !== undefined) axes.filmLook = filmLook
  return Object.keys(axes).length > 0 ? axes : undefined
}

function perspective(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === 'first') return '第一人称'
  if (value === 'third') return '第三人称'
  throw new ExtensionServiceInputError('perspective must be first or third')
}

function characters(value: unknown): Array<{ name: string; appearance?: string }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new ExtensionServiceInputError('characters must be an array')
  }
  return value.map((item) => {
    const input = record(item, 'character')
    assertOnlyKeys(input, ['name', 'desc'])
    const name = stringValue(input.name, 'character.name', true)!
    const description = stringValue(input.desc, 'character.desc')
    return description ? { name, appearance: description } : { name }
  })
}

function projectMetadata(gameId: string): Record<string, unknown> {
  return {
    id: gameId,
    title: gameId,
    platform: 'game-video',
    platformVersion: '1',
    entry: {
      blueprint: BLUEPRINT_FILE,
      components: 'dist/components',
    },
  }
}

function parseGraph(bytes: Uint8Array | null): GraphLibraryDocument | null {
  if (!bytes) return null
  try {
    return normalizeDocument(
      JSON.parse(decoder.decode(bytes)) as GraphLibraryDocument,
    )
  } catch {
    return null
  }
}

type NodeMediaBinding = {
  nodeRef: NodeRef
  media: NodeVideoMedia & { generation: NodeVideoGenerationPreset }
}

function nodeRefKey(ref: NodeRef): string {
  return `${ref.blueprintId}\0${ref.nodeId}`
}

function referenceIds(
  generation: NodeVideoGenerationPreset,
): string[] {
  const references = generation.references
  return [
    ...(references?.sceneAssetIds ?? []),
    ...(references?.extraImageAssetIds ?? []),
    ...(references?.firstFrameAssetId ? [references.firstFrameAssetId] : []),
    ...(references?.lastFrameAssetId ? [references.lastFrameAssetId] : []),
  ]
}

function nodeMediaBindingErrors(
  project: GraphLibraryDocument,
  manifest: AssetManifest,
  binding: NodeMediaBinding,
): string[] {
  const pack = project.manifest.packs[binding.nodeRef.blueprintId]
  if (!pack) return [`Unknown blueprint: ${binding.nodeRef.blueprintId}`]
  const node = pack.graph.nodes.find((candidate) => candidate.id === binding.nodeRef.nodeId)
  if (!node) {
    return [
      `Unknown node: ${binding.nodeRef.blueprintId}/${binding.nodeRef.nodeId}`,
    ]
  }

  const errors = validateNodeVideoGenerationPreset(binding.media.generation)
  const assetsById = new Map(
    manifest.assets
      .filter((asset): asset is MediaAsset => (
        typeof asset === 'object'
        && asset !== null
        && 'id' in asset
        && typeof asset.id === 'string'
      ))
      .map((asset) => [asset.id, asset]),
  )
  const suppliedReferences = new Set(referenceIds(binding.media.generation))
  for (const assetId of suppliedReferences) {
    const asset = assetsById.get(assetId)
    if (!asset) {
      errors.push(`Reference asset does not exist: ${assetId}`)
    } else if (asset.kind !== 'image' || asset.status !== 'ready') {
      errors.push(`Reference asset is not a ready image: ${assetId}`)
    }
  }

  const { characters, scenes } = assetEntityDefinitions(manifest)
  for (const cast of node.data.cast ?? []) {
    if (cast.onScreen === false) continue
    const assetId = characters[cast.characterId]?.currentAssetId
    if (!assetId) {
      errors.push(`Character ${cast.characterId} has no stable current reference`)
    } else if (!suppliedReferences.has(assetId)) {
      errors.push(`Character reference is not bound for ${cast.characterId}: ${assetId}`)
    }
  }
  const sceneReferences = new Set(
    binding.media.generation.references?.sceneAssetIds ?? [],
  )
  for (const sceneBinding of node.data.scenes ?? []) {
    if (sceneBinding.useAsVideoReference === false) continue
    const assetId = scenes[sceneBinding.sceneId]?.currentAssetId
    if (!assetId) {
      errors.push(`Scene ${sceneBinding.sceneId} has no stable current reference`)
    } else if (!sceneReferences.has(assetId)) {
      errors.push(`Scene reference is not bound for ${sceneBinding.sceneId}: ${assetId}`)
    }
  }
  return errors
}

function validateAssetEntityReferences(
  project: GraphLibraryDocument,
  manifest: Awaited<ReturnType<typeof readHostManifest>>,
): string[] {
  const { characters, scenes } = assetEntityDefinitions(manifest)
  const errors: string[] = []
  for (const pack of Object.values(project.manifest.packs)) {
    for (const node of pack.graph.nodes) {
      for (const binding of node.data.cast ?? []) {
        if (!characters[binding.characterId]) {
          errors.push(`节点 ${node.id} 引用了不存在的角色 '${binding.characterId}'`)
        }
      }
      for (const binding of node.data.scenes ?? []) {
        if (!scenes[binding.sceneId]) {
          errors.push(`节点 ${node.id} 引用了不存在的场景 '${binding.sceneId}'`)
        }
      }
    }
  }
  return [...new Set(errors)]
}

function outlineAssetDetailPaths(ops: readonly Record<string, unknown>[]): string[] {
  const forbiddenTopLevel = new Set([
    'appearance',
    'visual',
    'visualDescription',
    'previewPrompt',
    'currentAssetId',
    'primaryPreviewAssetId',
    'currentVideoAssetId',
  ])
  const paths: string[] = []
  ops.forEach((op, index) => {
    const source = op as { node?: unknown, patch?: unknown }
    const dataBags = [
      (source.node as { data?: Record<string, unknown> } | undefined)?.data,
      source.patch as Record<string, unknown> | undefined,
    ]
    for (const data of dataBags) {
      if (!data) continue
      for (const field of forbiddenTopLevel) {
        if (data[field] !== undefined) paths.push(`ops[${index}].${field}`)
      }
      const media = data.media
      if (!media || typeof media !== 'object' || Array.isArray(media)) continue
      const mediaRecord = media as Record<string, unknown>
      if (mediaRecord.ref !== undefined) paths.push(`ops[${index}].media.ref`)
      if (mediaRecord.meta !== undefined) paths.push(`ops[${index}].media.meta`)
      if (mediaRecord.generation !== undefined) paths.push(`ops[${index}].media.generation`)
    }
  })
  return [...new Set(paths)]
}

function shotScriptInput(value: unknown) {
  const input = record(value)
  assertOnlyKeys(input, [
    'sceneNodeId', 'nodeName', 'storyText', 'durationSeconds',
    'artStyle', 'styleKeywords', 'perspective', 'tone', 'characters',
    'location', 'interactive', 'choiceCount', 'styleAxes',
  ])
  if (input.interactive !== undefined && typeof input.interactive !== 'boolean') {
    throw new ExtensionServiceInputError('interactive must be a boolean')
  }
  return {
    nodeName: stringValue(input.nodeName, 'nodeName', true)!,
    storyText: stringValue(input.storyText, 'storyText', true)!,
    durationSeconds: numberValue(input.durationSeconds, 'durationSeconds', 8, 60),
    artStyle: stringValue(input.artStyle, 'artStyle'),
    styleKeywords: stringArray(input.styleKeywords, 'styleKeywords'),
    perspective: perspective(input.perspective),
    tone: stringValue(input.tone, 'tone'),
    characters: characters(input.characters),
    location: stringValue(input.location, 'location'),
    choicesLength: input.choiceCount === undefined
      ? input.interactive === true ? 2 : undefined
      : numberValue(input.choiceCount, 'choiceCount', 2),
    styleAxes: optionalStyleAxes(input.styleAxes),
  }
}

function promptPolishInput(value: unknown): string {
  const input = record(value)
  assertOnlyKeys(input, ['prompt'])
  const prompt = stringValue(input.prompt, 'prompt', true)!.trim()
  if (prompt.length > VIDEO_PROMPT_MAX_LENGTH) {
    throw new ExtensionServiceInputError(`prompt must be at most ${VIDEO_PROMPT_MAX_LENGTH} characters`)
  }
  return prompt
}

function overlayPromptPolishInput(value: unknown): { prompt: string; title: string } {
  const input = record(value)
  assertOnlyKeys(input, ['prompt', 'title'])
  // 摆放提示可为空（作者还没写时由模型从标题推断默认位置），但非字符串一律拒绝。
  if (input.prompt !== undefined && typeof input.prompt !== 'string') {
    throw new ExtensionServiceInputError('prompt must be a string')
  }
  const prompt = (input.prompt ?? '').trim()
  const title = stringValue(input.title, 'title', false)?.trim() ?? ''
  if (prompt.length > OVERLAY_PROMPT_MAX_LENGTH) {
    throw new ExtensionServiceInputError(`prompt must be at most ${OVERLAY_PROMPT_MAX_LENGTH} characters`)
  }
  return { prompt, title }
}

function keyframeInput(value: unknown): KeyframeInput {
  const input = record(value)
  assertOnlyKeys(input, [
    'sceneNodeId', 'nodeName', 'beat', 'variant', 'perspective',
    'characters', 'location', 'refAssetIds', 'label', 'styleAxes', 'mode', 'grid',
  ])
  const mode = input.mode
  if (mode !== undefined && mode !== 'keyframe' && mode !== 'grid_storyboard') {
    throw new ExtensionServiceInputError('mode must be keyframe or grid_storyboard')
  }
  const variant = input.variant
  if (
    variant !== undefined
    && variant !== 'video_first_frame'
    && variant !== 'choice_pressure_frame'
  ) {
    throw new ExtensionServiceInputError('variant is invalid')
  }
  return {
    sceneNodeId: stringValue(input.sceneNodeId, 'sceneNodeId', true)!,
    nodeName: stringValue(input.nodeName, 'nodeName', true)!,
    beat: stringValue(input.beat, 'beat', true)!,
    variant,
    perspective: perspective(input.perspective),
    characters: characters(input.characters),
    location: stringValue(input.location, 'location'),
    refAssetIds: stringArray(input.refAssetIds, 'refAssetIds')
      .map((id) => assertLogicalIdentifier(id, 'refAssetIds item')),
    label: stringValue(input.label, 'label'),
    styleAxes: optionalStyleAxes(input.styleAxes),
    mode,
    grid: input.grid === undefined ? undefined : (() => {
      const grid = record(input.grid, 'grid')
      assertOnlyKeys(grid, [
        'panelLabels', 'nodeRole', 'endingKind', 'choiceRevealMoment',
        'atmosphereOverride', 'nodeTimeOfDay',
      ])
      if (grid.panelLabels !== undefined && typeof grid.panelLabels !== 'boolean') {
        throw new ExtensionServiceInputError('grid.panelLabels must be a boolean')
      }
      return grid as KeyframeInput['grid']
    })(),
  }
}

function videoClipInput(value: unknown): GenerateVideoClipArgs {
  const input = record(value)
  assertOnlyKeys(input, [
    'prompt', 'durationSeconds', 'generateAudio', 'mode',
    'firstFrameAssetId', 'lastFrameAssetId', 'referenceImageAssetIds',
    'size', 'resolution', 'model', 'label', 'requestId', 'visualStyleKey',
  ])
  return {
    prompt: stringValue(input.prompt, 'prompt', true)!,
    durationSeconds: numberValue(input.durationSeconds, 'durationSeconds', 8, 15),
    generateAudio: input.generateAudio === true,
    mode: input.mode as GenerateVideoClipArgs['mode'],
    firstFrameAssetId: stringValue(input.firstFrameAssetId, 'firstFrameAssetId'),
    lastFrameAssetId: stringValue(input.lastFrameAssetId, 'lastFrameAssetId'),
    referenceImageAssetIds: input.referenceImageAssetIds === undefined
      ? undefined
      : stringArray(input.referenceImageAssetIds, 'referenceImageAssetIds'),
    size: stringValue(input.size, 'size') as GenerateVideoClipArgs['size'],
    resolution: stringValue(input.resolution, 'resolution') as GenerateVideoClipArgs['resolution'],
    model: stringValue(input.model, 'model'),
    label: stringValue(input.label, 'label'),
    requestId: stringValue(input.requestId, 'requestId'),
    visualStyleKey: stringValue(input.visualStyleKey, 'visualStyleKey'),
  }
}

function videoInput(value: unknown, maximumDuration: number): VideoGenInput {
  const input = record(value)
  assertOnlyKeys(input, [
    'sceneNodeId', 'nodeName', 'seedancePrompt', 'storyText',
    'durationSeconds', 'artStyle', 'styleKeywords', 'characterRefIds',
    'sceneRefIds', 'continuityFirstFrameId', 'label', 'generateAudio',
    'styleAxes', 'extend', 'transitionHint',
  ])
  for (const name of ['generateAudio', 'extend'] as const) {
    if (input[name] !== undefined && typeof input[name] !== 'boolean') {
      throw new ExtensionServiceInputError(`${name} must be a boolean`)
    }
  }
  return {
    sceneNodeId: stringValue(input.sceneNodeId, 'sceneNodeId', true)!,
    nodeName: stringValue(input.nodeName, 'nodeName', true)!,
    seedancePrompt: stringValue(input.seedancePrompt, 'seedancePrompt'),
    storyText: stringValue(input.storyText, 'storyText'),
    durationSeconds: numberValue(
      input.durationSeconds,
      'durationSeconds',
      8,
      maximumDuration,
    ),
    artStyle: stringValue(input.artStyle, 'artStyle'),
    styleKeywords: stringArray(input.styleKeywords, 'styleKeywords'),
    characterRefIds: stringArray(input.characterRefIds, 'characterRefIds', 1)
      .map((id) => assertLogicalIdentifier(id, 'characterRefIds item')),
    sceneRefIds: stringArray(input.sceneRefIds, 'sceneRefIds', 1)
      .map((id) => assertLogicalIdentifier(id, 'sceneRefIds item')),
    continuityFirstFrameId: input.continuityFirstFrameId === undefined
      ? undefined
      : assertLogicalIdentifier(
          stringValue(input.continuityFirstFrameId, 'continuityFirstFrameId', true)!,
          'continuityFirstFrameId',
        ),
    label: stringValue(input.label, 'label'),
    generateAudio: input.generateAudio === true,
    styleAxes: optionalStyleAxes(input.styleAxes),
    extend: input.extend === true,
    transitionHint: stringValue(input.transitionHint, 'transitionHint'),
  }
}

export function createGameVideoService(
  context: ExtensionContext,
): GameVideoService {
  const registry = createHostAssetRegistry(context)
  const generation = createHostGenerationOrchestrator(context, registry)

  return {
    async getWorkflowState(value = {}) {
      assertSchema('getWorkflowState', value)
      const state = (await readWorkflowState(context, { create: true }))!
      const inspected = await inspectProject(context)
      return {
        schemaVersion: 1,
        state,
        activityContract: activityContract(state.activity),
        projection: projectWorkflowState(state, inspected.inventory),
      }
    },
    async importStageArtifacts(value) {
      const input = importedStageArtifacts(value)
      const imported = await importAcceptedStageArtifacts(context, input)
      const inspected = await inspectProject(context)
      return {
        schemaVersion: 1,
        accepted: true,
        imported: imported.imported,
        resumeActivity: imported.resumeActivity,
        state: imported.state,
        projection: projectWorkflowState(imported.state, inspected.inventory),
      }
    },
    async getPillarAuthorGateProposal(value = {}) {
      if (Object.keys(record(value)).length > 0) {
        throw new ExtensionServiceInputError('Pillar author-gate proposal does not accept input')
      }
      return readPillarAuthorGateProposal(context)
    },
    async confirmPillarAuthorGate(value) {
      const input = record(value)
      const allowed = new Set(['expectedWorkflowRevision', 'productionId'])
      const unsupported = Object.keys(input).find((key) => !allowed.has(key))
      if (unsupported) throw new ExtensionServiceInputError(`Unsupported pillar confirmation field: ${unsupported}`)
      const proposal = await readPillarAuthorGateProposal(context)
      const productionId = stringValue(input.productionId, 'productionId', true)!
      if (productionId.length > 240) throw new ExtensionServiceInputError('productionId must be at most 240 characters')
      const state = await recordPillarAuthorGate(context, {
        productionId,
      })
      const inspected = await inspectProject(context)
      return {
        schemaVersion: 1,
        accepted: true,
        alreadyApproved: proposal.alreadyApproved,
        evidenceRef: state.gates.pillar?.evidenceRef,
        state,
        projection: projectWorkflowState(state, inspected.inventory),
      }
    },
    async beginActivity(value) {
      assertSchema('beginActivity', value)
      const input = record(value)
      const activity = input.activity as VideoGameActivity
      const state = await beginWorkflowActivity(context, input)
      const inspected = await inspectProject(context)
      return {
        schemaVersion: 1,
        state,
        activityContract: activityContract(activity),
        projection: projectWorkflowState(state, inspected.inventory),
      }
    },
    async awaitUser(value) {
      assertSchema('awaitUser', value)
      const input = record(value)
      const state = await awaitWorkflowUser(context, input as unknown as Parameters<typeof awaitWorkflowUser>[1])
      const inspected = await inspectProject(context)
      return { schemaVersion: 1, state, projection: projectWorkflowState(state, inspected.inventory) }
    },
    async completeActivity(value) {
      assertSchema('completeActivity', value)
      const input = record(value)
      const current = await readWorkflowState(context)
      if (!current) throw new ExtensionServiceInputError('Call get-workflow-state before complete-activity')
      const alreadyDone = settledActivityOf(current, input.activity)
      if (alreadyDone) {
        const inspected = await inspectProject(context)
        const activityRecord = current.activities[alreadyDone]
        return {
          schemaVersion: 1,
          accepted: true,
          alreadyComplete: true,
          state: current,
          projection: projectWorkflowState(current, inspected.inventory),
          evidence: activityRecord?.evidence ?? [],
        }
      }
      // 并发组里「当前活动」不唯一：完成必须落到调用方那条线，
      // 否则场景线的完成会被记到代表活动头上。
      const completing = activeActivityOf(current, input.activity, input.activityRevision)
      const report: CompletionReport = {
        schemaVersion: 1,
        activity: completing,
        activityRevision: input.activityRevision as number,
        artifactRefs: input.artifactRefs as CompletionReport['artifactRefs'],
        checkIds: input.checkIds as string[],
        ...(input.notRequired === true ? { notRequired: true } : {}),
        ...(input.suggestedFocus ? { suggestedFocus: input.suggestedFocus as PageLocation } : {}),
      }
      const inspectedForSkip = report.notRequired ? await inspectProject(context) : null
      const notRequiredAuthorized = report.notRequired === true
        && completing === 'ui.authoring'
        && inspectedForSkip !== null
        && uiNotRequiredByPillar(inspectedForSkip)
      const requiredChecks = report.notRequired ? [] : activityContract(completing).hardChecks
      const needsRuntimeSimulation = requiredChecks.includes('playtest.all-required-paths-reach-terminal')
      const completingRevision = current.activities[completing]?.revision ?? current.activityRevision
      const reqContract = input.requirementContract
        ? normalizeRequirementContract(input.requirementContract)
        : current.requirementContract
      const stateForValidation = reqContract ? { ...current, requirementContract: reqContract } : current
      let validation = await validateProjectForActivity(
        context,
        completing,
        completingRevision,
        requiredChecks.filter((check) => check !== 'playtest.all-required-paths-reach-terminal'),
        stateForValidation,
      )
      if (needsRuntimeSimulation) {
        const simulation = await simulatePassA(context, completingRevision, completing)
        validation.evidence.push({
          ...simulation.evidence,
          status: 'pass',
        })
        validation.ok = true
        validation.summary.playable = 'pass'
      }
      // 成片由作者后续逐节点触发。整装通过后先把缺失绑定落成项目内占位资产，
      // 再基于新 revision 重验，保证活动证据描述的就是最终交付蓝图。
      if (!report.notRequired && validation.ok && completing === 'game.finalizing') {
        const placeholder = await ensureFinalBlueprintPlaceholderVideos(context)
        if (placeholder.changed) {
          validation = await validateProjectForActivity(
            context,
            completing,
            completingRevision,
            requiredChecks,
            stateForValidation,
          )
        }
      }
      let waivedAfterRetries = false
      let waiverAttempts: number | undefined
      if (!report.notRequired && !validation.ok) {
        const failedChecks = validation.evidence
          .filter((item) => item.status === 'fail')
          .map((item) => item.checkId)
        // playtest 硬门：连续失败超过阈值后放行，避免卡死后续验证；其它活动仍严格拦截。
        if (completing === 'playtest.validating') {
          const rejection = await recordRejection(context, {
            activity: completing,
            activityRevision: completingRevision,
            code: 'workflow.completion.rejected',
            retry: 'fix-then-retry',
          }).catch(() => ({
            attempts: 0,
            retry: 'fix-then-retry' as const,
            budgetExhausted: false,
          }))
          if (rejection.attempts > PLAYTEST_VALIDATING_BYPASS_AFTER_FAILURES) {
            waivedAfterRetries = true
            waiverAttempts = rejection.attempts
            // completeWorkflowActivity 要求 hardChecks 有 pass/warn 证据；放行时把 fail 降为 warn，
            // 保留 issues，方便下游看见缺口，同时不再拦截完成。
            validation = {
              ...validation,
              ok: true,
              evidence: validation.evidence.map((item) => (
                item.status === 'fail' ? { ...item, status: 'warn' as const } : item
              )),
            }
          } else {
            const inspected = await inspectProject(context)
            return {
              schemaVersion: 1,
              accepted: false,
              errorCode: 'workflow.completion.rejected',
              disposition: 'retryable',
              activity: completing,
              activityRevision: completingRevision,
              currentRevision: current.revision,
              failedChecks,
              attempts: rejection.attempts,
              retry: 'retry',
              guidance: `根据 failedChecks 修复当前活动负责的缺口；修复后重新读取并提交 complete_activity。`
                + `（已连续失败 ${rejection.attempts}/${PLAYTEST_VALIDATING_BYPASS_AFTER_FAILURES} 次；`
                + `超过 ${PLAYTEST_VALIDATING_BYPASS_AFTER_FAILURES} 次后 Host 将放行以便下游继续验证）`,
              state: current,
              projection: { ...projectWorkflowState(current, inspected.inventory), validation: validation.summary },
              evidence: validation.evidence,
            }
          }
        } else {
          const inspected = await inspectProject(context)
          return {
            schemaVersion: 1,
            accepted: false,
            errorCode: 'workflow.completion.rejected',
            disposition: 'retryable',
            activity: completing,
            activityRevision: completingRevision,
            currentRevision: current.revision,
            failedChecks,
            retry: 'retry',
            guidance: '根据 failedChecks 修复当前活动负责的缺口；修复后重新读取并提交 complete_activity。',
            state: current,
            projection: { ...projectWorkflowState(current, inspected.inventory), validation: validation.summary },
            evidence: validation.evidence,
          }
        }
      }
      const state = await completeWorkflowActivity(context, report, validation.evidence, {
        notRequiredAuthorized,
        ...(input.requirementContract ? { requirementContract: input.requirementContract } : {}),
        ...(input.inquiryContract ? { inquiryContract: input.inquiryContract } : {}),
      })
      // 活动交付了，上一轮的失败计数就没有意义了，别让它拖累后续返工。
      await clearRejections(context, completing)
      const inspected = await inspectProject(context)
      return {
        schemaVersion: 1,
        accepted: true,
        ...(waivedAfterRetries
          ? {
            waivedAfterRetries: true,
            attempts: waiverAttempts,
            guidance: `playtest.validating 校验已连续失败 ${waiverAttempts} 次（超过阈值 `
              + `${PLAYTEST_VALIDATING_BYPASS_AFTER_FAILURES}），本次放行以便下游继续验证；`
              + 'evidence 中仍保留未通过的硬门，勿声称蓝图已完全合法。',
          }
          : {}),
        state,
        projection: { ...projectWorkflowState(state, inspected.inventory), validation: validation.summary },
        evidence: validation.evidence,
      }
    },
    async reportBlocker(value) {
      assertSchema('reportBlocker', value)
      const input = record(value)
      const state = await reportWorkflowBlocker(context, input as unknown as Parameters<typeof reportWorkflowBlocker>[1])
      const inspected = await inspectProject(context)
      return { schemaVersion: 1, state, projection: projectWorkflowState(state, inspected.inventory) }
    },
    async reconcileProductionFailure(value) {
      const input = record(value)
      if (typeof input.productionId !== 'string' || input.productionId.trim().length === 0) {
        throw new ExtensionServiceInputError('productionId must be a non-empty string')
      }
      if (typeof input.reason !== 'string' || input.reason.trim().length === 0) {
        throw new ExtensionServiceInputError('reason must be a non-empty string')
      }
      if (input.retryable !== undefined && typeof input.retryable !== 'boolean') {
        throw new ExtensionServiceInputError('retryable must be a boolean')
      }
      if (
        input.activity !== undefined
        && (
          typeof input.activity !== 'string'
          || !(VIDEO_GAME_ACTIVITIES as readonly string[]).includes(input.activity)
        )
      ) {
        throw new ExtensionServiceInputError('activity must be a known video-game activity')
      }
      if (
        input.activityRevision !== undefined
        && (!Number.isSafeInteger(input.activityRevision) || Number(input.activityRevision) < 1)
      ) {
        throw new ExtensionServiceInputError('activityRevision must be a positive integer')
      }
      const state = await reconcileProductionFailure(context, {
        productionId: input.productionId,
        reason: input.reason,
        ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
        ...(input.activity === undefined ? {} : { activity: input.activity as VideoGameActivity }),
        ...(input.activityRevision === undefined ? {} : { activityRevision: Number(input.activityRevision) }),
      })
      return {
        schemaVersion: 1,
        ok: true,
        state,
        projection: projectWorkflowState(state),
      }
    },
    async focusPage(value) {
      assertSchema('focusPage', value)
      const input = record(value)
      const state = await setWorkflowFocus(context, input as unknown as Parameters<typeof setWorkflowFocus>[1])
      const inspected = await inspectProject(context)
      return { schemaVersion: 1, ok: true, state, projection: projectWorkflowState(state, inspected.inventory) }
    },
    async markPeerAbandonedActivity(value) {
      const input = record(value)
      if (typeof input.peerId !== 'string' || input.peerId.trim().length === 0) {
        throw new ExtensionServiceInputError('peerId must be a non-empty string')
      }
      if (
        typeof input.activity !== 'string'
        || !(VIDEO_GAME_ACTIVITIES as readonly string[]).includes(input.activity)
      ) {
        throw new ExtensionServiceInputError('activity must be a known video-game activity')
      }
      if (input.reason !== undefined && typeof input.reason !== 'string') {
        throw new ExtensionServiceInputError('reason must be a string when provided')
      }
      if (input.lastToolName !== undefined && typeof input.lastToolName !== 'string') {
        throw new ExtensionServiceInputError('lastToolName must be a string when provided')
      }
      if (
        input.activityRevision !== undefined
        && (!Number.isSafeInteger(input.activityRevision) || Number(input.activityRevision) < 1)
      ) {
        throw new ExtensionServiceInputError('activityRevision must be a positive integer')
      }
      const state = await markPeerAbandonedActivity(context, {
        peerId: input.peerId,
        activity: input.activity as VideoGameActivity,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
        ...(input.lastToolName === undefined ? {} : { lastToolName: input.lastToolName }),
        ...(input.activityRevision === undefined ? {} : { activityRevision: Number(input.activityRevision) }),
      })
      return {
        schemaVersion: 1,
        ok: true,
        state,
        projection: projectWorkflowState(state),
      }
    },
    async inspectProject(value = {}) {
      assertSchema('inspectProject', value)
      const inspected = await inspectProject(context)
      return {
        schemaVersion: 1,
        projectRevision: inspected.projectRevision,
        inventory: inspected.inventory,
        issues: inspected.issues,
        qualityMetrics: inspected.qualityMetrics,
      }
    },
    /**
     * 派发前预检（设计 §9.7.2）。只读，不开启活动，不改状态。
     * 前置不齐时返回缺口和「该找谁补」，让编排者别把一次子 Agent 启动浪费在必失败的委派上。
     */
    async preflightActivity(value) {
      assertSchema('preflightActivity', value)
      const input = record(value)
      const state = await readWorkflowState(context)
      if (!state) throw new ExtensionServiceInputError('Call get-workflow-state before preflight-activity')
      const activity = input.activity as VideoGameActivity
      const inspected = await inspectProject(context)
      const result = preflightActivity(state, inspected.inventory, activity, {
        entityIdBindingRequested: input.entityIdBindingRequested === true,
      })
      return { schemaVersion: 1, ...result }
    },
    /**
     * 界面元件契约（只读）。配界面与结算前先查这个，别猜输入键与事件名——
     * 实测猜出来的 `actions` / `entityId` 不存在，按钮挂上去点了没反应。
     * 返回「内置组件 + 游戏已 authored 组件」：agent 造完控件后下次调用就能读到，
     * 避免重复造同功能控件或组装模板时引用未知组件。
     */
    async listUiComponents(value = {}) {
      assertSchema('listUiComponents', value)
      const authored = authoredComponentContracts(await listAuthoredComponentManifests(context))
      return { schemaVersion: 1, components: [...componentContracts(), ...authored] }
    },
    async validateProject(value) {
      assertSchema('validateProject', value)
      const input = record(value)
      const state = await readWorkflowState(context)
      if (!state) throw new ExtensionServiceInputError('Call get-workflow-state before validate-project')
      const alreadyDone = settledActivityOf(state, input.activity)
      if (alreadyDone) {
        const activityRecord = state.activities[alreadyDone]
        const evidence = activityRecord?.evidence ?? []
        return {
          schemaVersion: 1,
          ok: true,
          alreadyComplete: true,
          summary: {
            projectRevision: evidence[0]?.projectRevision ?? 0,
            structural: 'pass',
            semantic: 'pass',
            references: 'pass',
            productionReadiness: 'not-run',
            choices: 'not-run',
            playable: 'not-run',
            issues: [],
          },
          evidence,
        }
      }
      // 并发组里每条线校验自己的活动契约，不能都去校验代表活动的 hard checks。
      const target = activeActivityOf(state, input.activity, input.activityRevision)
      const targetRevision = state.activities[target]?.revision ?? state.activityRevision
      // 省略即由 Host 取当前值（设计 §9.7.4）。只读校验没有冲突检测的必要，
      // 而 `undefined !== 1` 会把「没填」误判成「填错了」——实测让 peer 卡在这里
      // 反复读状态、猜修订号。
      if (input.activityRevision !== undefined && input.activityRevision !== targetRevision) {
        throw new ExtensionServiceInputError(
          `activityRevision ${String(input.activityRevision)} 与 ${target} 的当前修订号 ${targetRevision} 不一致；省略该参数即可由 Host 取当前值`,
        )
      }
      // 不给 checkIds 时只校验**本活动的完成门**，而不是全部检查。
      // 校验全部会把下游还没做的检查一并报成 fail（实测每条线中途 validate 都看到
       // `semantic: fail`），peer 很容易据此以为自己没做完而反复补。
      const requestedChecks = (input.checkIds as string[] | undefined)
        ?? [...activityContract(target).hardChecks]
      const needsRuntimeSimulation = requestedChecks?.includes('playtest.all-required-paths-reach-terminal') === true
      const validation = await validateProjectForActivity(
        context,
        target,
        targetRevision,
        requestedChecks?.filter((check) => check !== 'playtest.all-required-paths-reach-terminal'),
        state,
      )
      if (needsRuntimeSimulation) {
        const simulation = await simulatePassA(context, targetRevision, target)
        validation.evidence.push(simulation.evidence)
        validation.ok = validation.ok && simulation.ok
        validation.summary.playable = simulation.ok ? 'pass' : 'fail'
        if (!simulation.ok) validation.summary.issues.push(...(simulation.evidence.issues ?? []))
      }
      return validation
    },
    async simulatePassA(value) {
      assertSchema('simulatePassA', value)
      const input = record(value)
      const state = await readWorkflowState(context)
      if (!state) throw new ExtensionServiceInputError('Call get-workflow-state before simulate-pass-a')
      if (input.activityRevision !== undefined && input.activityRevision !== state.activityRevision) {
        throw new ExtensionServiceInputError(
          `activityRevision ${String(input.activityRevision)} 与当前修订号 ${state.activityRevision} 不一致；省略该参数即可由 Host 取当前值`,
        )
      }
      if (state.activity !== 'playtest.validating') {
        throw new ExtensionServiceInputError(`simulate-pass-a is not allowed during ${state.activity}`)
      }
      return simulatePassA(context, state.activityRevision, state.activity)
    },
    async getNodeProductionContext(value) {
      assertSchema('getNodeProductionContext', value)
      const input = record(value)
      try {
        return await getNodeProductionContext(context, {
          blueprintId: String(input.blueprintId),
          nodeId: String(input.nodeId),
        })
      } catch (cause) {
        throw new ExtensionServiceInputError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    async patchCharacters(value) {
      assertSchema('patchCharacters', value)
      const input = record(value)
      // 出图线也能写 manifest 角色资产实体：它的写域本来就含 `characters`。实测场景线因为拿不到
      // `patch_scenes`，只能为「改写一个被拒的提示词」报 blocker 绕一趟编排者，
      // 白花 6 分钟；而这件事就在它自己的写域里。
      const characterWriters = ['characters.modeling', 'characters.previewing', 'assets.character'] as const
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        characterWriters,
        input.activityRevision,
      )
      assertAssetCatalogMutationAllowed(workflow, activityRevision, characterWriters, ['characters'])
      const expectedRevision = optionalRevision(input.expectedRevision)
      const ops = input.ops as Array<
        | { op: 'upsert-character'; character: CharacterDefinition }
        | { op: 'remove-character'; characterId: string }
      >
      const outcome = await context.files.withLocks<
        | { ok: true; revision: number; results: Array<{ op: string; id: string }> }
        | { ok: false; errors: string[]; revision: number }
        | { ok: false; conflict: RevisionConflict }
      >([HOST_MANIFEST_LOCK], async () => {
        const [bytes, snapshot] = await Promise.all([
          context.files.read(BLUEPRINT_FILE),
          readHostManifestSnapshot(context.files),
        ])
        const { manifest, revision: currentRevision, scopeRevisions } = snapshot
        const conflict = assetManifestScopedRevisionConflict(
          expectedRevision,
          currentRevision,
          scopeRevisions,
          ['characters'],
        )
        if (conflict) return { ok: false, conflict }
        const current = parseGraph(bytes)
        if (!current) return { ok: false, errors: ['缺少 blueprint.json'], revision: currentRevision }
        const characters = { ...assetEntityDefinitions(manifest).characters }
        const removed = new Set<string>()
        const results: Array<{ op: string; id: string }> = []
        for (const op of ops) {
          if (op.op === 'upsert-character') {
            if (op.character.entityId && !current.entities?.[op.character.entityId]) {
              return { ok: false, errors: [`角色 ${op.character.id} 引用了不存在的实体 ${op.character.entityId}`], revision: currentRevision }
            }
            // 声明期只给 id 与 name：补上空外观让文档结构保持合法，
            // 内容由角色线在 characters.modeling 填，完成门会要求它非空。
            const declared = structuredClone(op.character)
            const previous = characters[op.character.id]
            characters[op.character.id] = {
              ...declared,
              appearance: declared.appearance
                ?? previous?.appearance
                ?? { description: '', previewPrompt: '' },
            }
            results.push({ op: op.op, id: op.character.id })
            continue
          }
          const usedBy = Object.entries(current.manifest.packs).flatMap(([blueprintId, pack]) => (
            pack.graph.nodes
              .filter((node) => node.data.cast?.some((binding) => binding.characterId === op.characterId))
              .map((node) => `${blueprintId}/${node.id}`)
          ))
          if (usedBy.length) return {
            ok: false,
            errors: [`角色 ${op.characterId} 仍被节点引用: ${usedBy.join(', ')}`],
            revision: currentRevision,
          }
          delete characters[op.characterId]
          removed.add(op.characterId)
          results.push({ op: op.op, id: op.characterId })
        }
        const nextManifest = mergeAssetEntityDefinitions(manifest, { characters })
        const assetCatalog = normalizeAssetCatalogState(nextManifest.assetCatalog)
        for (const characterId of removed) {
          delete assetCatalog.entities.character[characterId]
          delete assetCatalog.placements[`character:${characterId}`]
        }
        const revision = await writeHostManifestRevision(
          context.files,
          { ...nextManifest, assetCatalog },
          { touchedScopes: ['characters'] },
        )
        return { ok: true, revision, results }
      })
      if (!outcome.ok && 'conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
      if (!outcome.ok) return { schemaVersion: 1, ...outcome, gameSlug: context.gameId }
      return {
        schemaVersion: 1,
        ok: true,
        revision: outcome.revision,
        results: outcome.results,
        artifactRef: {
          kind: 'characters',
          id: 'characters',
          revision: outcome.revision,
          targetIds: outcome.results.map((result) => result.id),
          status: 'ready',
        },
        uiHint: { location: { kind: 'asset', root: 'character' }, reveal: 'select-and-expand' },
        gameSlug: context.gameId,
      }
    },
    async generateCharacterPreviews(value) {
      assertSchema('generateCharacterPreviews', value)
      const input = record(value)
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        ['characters.previewing', 'assets.character'],
        input.activityRevision,
      )
      assertAssetCatalogMutationAllowed(
        workflow,
        activityRevision,
        ['characters.previewing', 'assets.character'],
        ['characters', 'assets.character'],
      )
      if (!workflow) throw new ExtensionServiceInputError('Character preview generation requires an initialized workflow')
      const characterIds = input.characterIds as string[] | undefined
      const characterMode = (input.mode ?? CHARACTER_PREVIEW_DEFAULT_MODE) as CharacterPreviewMode
      const postDelivery = isPostDeliveryCatalogMaintenance(workflow)
      const idempotencyActivity = postDelivery
        || workflow.activities['assets.character']?.status === 'working'
        ? 'assets.character'
        : 'characters.previewing'
      const outcome = await runGenerateCharacterPreviews(context, {
        activityRevision: postDelivery
          ? (workflow.activities['assets.character']?.revision
            ?? workflow.activities['characters.previewing']?.revision
            ?? workflow.activityRevision)
          : Number(activityRevision),
        expectedRevision: Number(input.expectedRevision),
        idempotencyKey: derivedIdempotencyKey(
          input.idempotencyKey,
          idempotencyActivity,
          workflow.activities[idempotencyActivity]?.revision ?? 1,
          input.characterIds as string[] | undefined,
          characterMode,
        ),
        ...(characterIds ? { characterIds } : {}),
        mode: characterMode,
        skipReady: input.skipReady !== false,
      })
      if (!outcome.ok && 'conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
      if ('errorCode' in outcome) return { schemaVersion: 1, ...outcome, gameSlug: context.gameId }
      return {
        schemaVersion: 1,
        ...outcome,
        artifactRef: {
          kind: 'character-previews',
          id: 'characters',
          revision: outcome.revision,
          targetIds: outcome.results.map((result) => result.characterId),
          status: outcome.ok ? 'ready' : 'failed',
        },
        uiHint: { location: { kind: 'asset', root: 'character' }, reveal: 'select-and-expand' },
        gameSlug: context.gameId,
      }
    },
    /**
     * Manifest 场景资产实体写入，与 patchCharacters 对称：写域只有场景资产子树。
     *
     * 声明范围由总脉络决定——`applySceneOps` 拿到蓝图里已声明的场景 id 作为白名单，
     * 场景线不能自行新增场景。
     */
    async patchScenes(value) {
      assertSchema('patchScenes', value)
      const input = record(value)
      const sceneWriters = ['scenes.modeling', 'scenes.previewing', 'assets.scene'] as const
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        sceneWriters,
        input.activityRevision,
      )
      assertAssetCatalogMutationAllowed(workflow, activityRevision, sceneWriters, ['scenes'])
      const allowCatalogAdHoc = canCreateCatalogAdHocScenes(workflow)
      const expectedRevision = optionalRevision(input.expectedRevision)
      const ops = input.ops as SceneOp[]
      const outcome = await context.files.withLocks<
        | { ok: true, revision: number, results: Array<{ op: string, id: string }> }
        | { ok: false, errors: string[], errorCode?: string, revision: number }
        | { ok: false, conflict: RevisionConflict }
      >([HOST_MANIFEST_LOCK], async () => {
        const [bytes, snapshot] = await Promise.all([
          context.files.read(BLUEPRINT_FILE),
          readHostManifestSnapshot(context.files),
        ])
        const { manifest, revision: currentRevision, scopeRevisions } = snapshot
        const conflict = assetManifestScopedRevisionConflict(
          expectedRevision,
          currentRevision,
          scopeRevisions,
          ['scenes'],
        )
        if (conflict) return { ok: false, conflict }
        const current = parseGraph(bytes)
        if (!current) return { ok: false, errors: ['缺少 blueprint.json'], revision: currentRevision }
        // 已声明的场景 = 目录里已有的 + 节点已引用的。
        const currentScenes = assetEntityDefinitions(manifest).scenes
        const declared = new Set<string>([
          ...Object.keys(currentScenes),
          ...Object.values(current.manifest.packs).flatMap((pack) => (
            pack.graph.nodes.flatMap((node) => (node.data.scenes ?? []).map((binding) => binding.sceneId))
          )),
        ])
        // 场景线不能自行扩大范围：只能命中已在目录里、或已被节点引用的场景。
        // 目录为空时（还没有任何场景）允许首次建立，否则场景线无从下手。
        // assets.scene / 交付后：allowCatalogAdHoc 允许新建仅资产库场景。
        const applied = applySceneOps(
          currentScenes,
          ops,
          {
            ...(declared.size > 0 ? { declaredSceneIds: [...declared] } : {}),
            ...(allowCatalogAdHoc ? { allowCatalogAdHoc: true } : {}),
          },
        )
        if (!applied.ok) {
          return {
            ok: false,
            errors: applied.errors.map((error) => error.message),
            errorCode: applied.errors[0]?.code,
            revision: currentRevision,
          }
        }
        for (const op of ops) {
          if (op.op !== 'remove-scene') continue
          const usedBy = Object.entries(current.manifest.packs).flatMap(([blueprintId, pack]) => (
            pack.graph.nodes
              .filter((node) => node.data.scenes?.some((binding) => binding.sceneId === op.sceneId))
              .map((node) => `${blueprintId}/${node.id}`)
          ))
          if (usedBy.length) return {
            ok: false,
            errors: [`场景 ${op.sceneId} 仍被节点引用: ${usedBy.join(', ')}`],
            errorCode: 'scenes.scene.in-use',
            revision: currentRevision,
          }
        }
        const nextManifest = mergeAssetEntityDefinitions(manifest, { scenes: applied.scenes })
        const assetCatalog = normalizeAssetCatalogState(nextManifest.assetCatalog)
        for (const op of ops) {
          if (op.op !== 'remove-scene') continue
          delete assetCatalog.entities.scene[op.sceneId]
          delete assetCatalog.placements[`scene:${op.sceneId}`]
        }
        const revision = await writeHostManifestRevision(
          context.files,
          { ...nextManifest, assetCatalog },
          { touchedScopes: ['scenes'] },
        )
        return { ok: true, revision, results: applied.results }
      })
      if (!outcome.ok && 'conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
      if (!outcome.ok) return { schemaVersion: 1, ...outcome, gameSlug: context.gameId }
      return {
        schemaVersion: 1,
        ...outcome,
        artifactRef: {
          kind: 'scenes',
          id: 'scenes',
          revision: outcome.revision,
          targetIds: outcome.results.map((result) => result.id),
          status: 'ready',
        },
        uiHint: { location: { kind: 'asset', root: 'scene' }, reveal: 'select-and-expand' },
        gameSlug: context.gameId,
      }
    },
    async generateScenePreviews(value) {
      assertSchema('generateScenePreviews', value)
      const input = record(value)
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        ['scenes.previewing', 'assets.scene'],
        input.activityRevision,
      )
      assertAssetCatalogMutationAllowed(
        workflow,
        activityRevision,
        ['scenes.previewing', 'assets.scene'],
        ['scenes', 'assets.scene'],
      )
      if (!workflow) throw new ExtensionServiceInputError('Scene preview generation requires an initialized workflow')
      const sceneIds = input.sceneIds as string[] | undefined
      const sceneMode = (input.mode ?? SCENE_PREVIEW_DEFAULT_MODE) as ScenePreviewMode
      const sceneAngleCount = input.angleCount === undefined ? undefined : Number(input.angleCount)
      const postDelivery = isPostDeliveryCatalogMaintenance(workflow)
      const idempotencyActivity = postDelivery
        || workflow.activities['assets.scene']?.status === 'working'
        ? 'assets.scene'
        : 'scenes.previewing'
      const outcome = await runScenePreviewBatch(context, {
        activityRevision: postDelivery
          ? (workflow.activities['assets.scene']?.revision
            ?? workflow.activities['scenes.previewing']?.revision
            ?? workflow.activityRevision)
          : Number(activityRevision),
        expectedRevision: Number(input.expectedRevision),
        idempotencyKey: derivedIdempotencyKey(
          input.idempotencyKey,
          idempotencyActivity,
          workflow.activities[idempotencyActivity]?.revision ?? 1,
          sceneIds,
          scenePreviewShapeKey({ mode: sceneMode, angleCount: sceneAngleCount }),
        ),
        ...(sceneIds ? { sceneIds } : {}),
        mode: sceneMode,
        ...(sceneAngleCount === undefined ? {} : { angleCount: sceneAngleCount }),
        skipReady: input.skipReady !== false,
      })
      if (!outcome.ok && 'conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
      if ('errorCode' in outcome) return { schemaVersion: 1, ...outcome, gameSlug: context.gameId }
      return {
        schemaVersion: 1,
        ...outcome,
        artifactRef: {
          kind: 'scene-previews',
          id: 'scenes',
          revision: outcome.revision,
          targetIds: outcome.results.map((result) => result.sceneId),
          status: outcome.ok ? 'ready' : 'failed',
        },
        uiHint: { location: { kind: 'asset', root: 'scene' }, reveal: 'select-and-expand' },
        gameSlug: context.gameId,
      }
    },
    async getGraph(value = {}) {
      assertSchema('getGraph', value)
      const input = record(value)
      assertOnlyKeys(input, ['blueprintId', 'nodeIds', 'fields'])
      const blueprintId = input.blueprintId === undefined
        ? undefined
        : assertLogicalIdentifier(stringValue(input.blueprintId, 'blueprintId', true)!, 'blueprintId')
      const nodeIds = stringArray(input.nodeIds, 'nodeIds')
      const rawFields = stringArray(input.fields, 'fields')
      const allowedFields = new Set<GraphProjectionField>([
        'summary', 'interaction', 'storyText', 'overlays', 'edges',
      ])
      if (rawFields.some((field) => !allowedFields.has(field as GraphProjectionField))) {
        throw new ExtensionServiceInputError(
          'fields must contain only summary, interaction, storyText, overlays, or edges',
        )
      }
      const isShard = blueprintId !== undefined || nodeIds.length > 0 || rawFields.length > 0
      const [blueprint, assetSnapshot] = await Promise.all([
        context.files.read(BLUEPRINT_FILE),
        readHostManifestSnapshot(context.files),
      ])
      const project = parseGraph(blueprint)
      const revision = readDocumentRevision(blueprint)
      let shard: ReturnType<typeof projectGraphShard> | null = null
      if (project && isShard) {
        try {
          shard = projectGraphShard(project, {
            ...(blueprintId ? { blueprintId } : {}),
            ...(nodeIds.length > 0 ? { nodeIds } : {}),
            ...(rawFields.length > 0 ? { fields: rawFields as GraphProjectionField[] } : {}),
          })
        } catch (error) {
          throw new ExtensionServiceInputError(publicErrorMessage(error))
        }
      }
      return {
        project: shard ?? project,
        assetEntities: assetEntityDefinitions(assetSnapshot.manifest),
        // Read off the raw bytes: `parseGraph` normalizes, which drops it.
        revision,
        assetRevision: assetSnapshot.revision,
        ...(isShard ? {
          snapshot: {
            token: graphSnapshotToken(context.gameId, revision),
            revision,
            blueprintId: shard?.blueprintId ?? blueprintId ?? project?.manifest.mainPackId,
            nodeIds,
            fields: rawFields,
          },
        } : {}),
        gameSlug: context.gameId,
      }
    },
    async saveGraph(value) {
      assertSchema('saveGraph', value)
      const input = record(value)
      if (input.project === undefined) {
        return { ok: false, errors: ['缺少 project'] }
      }
      let project: GraphLibraryDocument
      try {
        project = normalizeDocument(input.project as GraphLibraryDocument)
      } catch (error) {
        return { ok: false, errors: [(error as Error).message], gameSlug: context.gameId }
      }
      const errors = validateDocument(project)
      if (errors.length) {
        return {
          schemaVersion: 1,
          ok: false,
          errorCode: 'validation.failed',
          errors,
          gameSlug: context.gameId,
        }
      }
      const expectedRevision = optionalRevision(input.expectedRevision)
      const idempotencyKey = optionalIdempotencyKey(input.idempotencyKey)
      const fingerprint = mutationFingerprint({ project })
      // The revision check has to share the write lock with the write itself,
      // otherwise two savers can both pass the check and then clobber.
      const outcome = await context.files.withLocks<WriteOutcome>(
        [GRAPH_SAVE_LOCK, HOST_MANIFEST_LOCK],
        async () => {
        const [bytes, manifest] = await Promise.all([
          context.files.read(BLUEPRINT_FILE),
          readHostManifest(context.files),
        ])
        const currentRevision = readDocumentRevision(bytes)
        const receipts = readMutationReceipts(bytes)
        const prior = resolveMutationReceipt(receipts, {
          key: idempotencyKey,
          operation: 'save-graph',
          fingerprint,
          currentRevision,
        })
        if (prior && 'code' in prior) return { ok: false, conflict: prior }
        if (prior) return { ok: true, revision: prior.revision, replayed: true }
        const conflict = revisionConflict(expectedRevision, currentRevision)
        if (conflict) return { ok: false, conflict }
        const referenceErrors = validateAssetEntityReferences(project, manifest)
        if (referenceErrors.length) {
          return { ok: false, errors: referenceErrors, errorCode: 'validation.failed' }
        }
        const revision = nextDocumentRevision(currentRevision)
        const nextReceipts = appendMutationReceipt(receipts, mutationReceipt(
          idempotencyKey,
          'save-graph',
          fingerprint,
          revision,
          {},
        ))
        await context.files.write(
          BLUEPRINT_FILE,
          encoder.encode(JSON.stringify(stampDocumentRevision(project, revision, nextReceipts), null, 2)),
        )
        const nextManifest = syncProjectVideoPresets(manifest, project)
        await writeHostManifestRevision(
          context.files,
          nextManifest,
          { touchedScopes: ['videos'] },
        )
        if (!await context.files.read(PROJECT_FILE)) {
          await context.files.write(
            PROJECT_FILE,
            encoder.encode(JSON.stringify(projectMetadata(context.gameId), null, 2)),
          )
        }
        // project.json / blueprint.json / assets/manifest.json are the Extension
        // Host package-status set; back-filling all three on first save lets a
        // host report `initialized` for agent-authored games instead of
        // stranding them at `inconsistent`.
        if (!await context.files.read(ASSETS_MANIFEST_FILE)) {
          await context.files.write(
            ASSETS_MANIFEST_FILE,
            encoder.encode(JSON.stringify({ version: 2, assets: [] }, null, 2)),
          )
        }
        return { ok: true, revision }
        },
      )
      if (!outcome.ok) {
        if ('conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
        return { schemaVersion: 1, ...outcome, gameSlug: context.gameId }
      }
      return {
        schemaVersion: 1,
        ok: true,
        revision: outcome.revision,
        replayed: outcome.replayed ?? false,
        artifactRef: artifactRef(project.manifest.mainPackId, outcome.revision),
        validation: validationSummary(outcome.revision),
        versions: [],
        gameSlug: context.gameId,
      }
    },
    async patchGraph(value) {
      assertSchema('patchGraph', value)
      const input = record(value)
      const graphActivities = [
        'blueprint.outline', 'rules.binding', 'ui.authoring', 'game.finalizing',
      ] as const
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        graphActivities,
        input.activityRevision,
      )
      // `patch_graph` 里混着公式 op（`set-formula` / `remove-formula`），而公式属于
      // 规则目录。不按 op 推导写域，总脉络就能用 patch_graph 绕过工具面去写规则——
      // 实测它真的这么干了，写进 3 个公式却留下空的 entities / variables。
      const graphOps = (input.ops ?? []) as Array<Record<string, unknown>>
      const touchesFormulas = graphOps.some((op) => (
        op.op === 'set-formula' || op.op === 'remove-formula'
      ))
      // 同理，overlay op 挂的是界面，写域属于 `ui`。总脉络只有 `graph`：它需要知道有哪些
      // 元件才能规划出边（出口 handle 来自元件事件），但挂载与绑数据是整装的活。
      const touchesOverlays = graphOps.some(graphOpTouchesUi)
      const activeActivity = workflow ? activeActivityOf(workflow, undefined) : undefined
      const ops = input.ops as Array<Record<string, unknown>>
      const touchedScopes = [
        'graph' as const,
        ...(touchesFormulas ? ['rules' as const] : []),
        ...(touchesOverlays ? ['ui' as const] : []),
      ]
      assertWorkflowMutationAllowed(
        workflow,
        activityRevision,
        graphActivities,
        touchedScopes,
      )
      if (activeActivity === 'blueprint.outline') {
        const forbiddenPaths = outlineAssetDetailPaths(graphOps)
        if (forbiddenPaths.length > 0) {
          return {
            ok: false,
            errors: [
              `总脉络只能写稳定 ID 级 cast/scenes 声明；以下资产定义或就绪字段属于资产支线：`
              + forbiddenPaths.join('、'),
            ],
            errorCode: 'workflow.outline.asset-detail-not-allowed',
          }
        }
      }
      if (graphOps.some(graphOpTouchesNodeMedia)) {
        return {
          schemaVersion: 1,
          ok: false,
          errors: [
            'Node media presets may not be written through patch_graph; use patch_node_media during video.presets.binding.',
          ],
          errorCode: 'workflow.node-media.dedicated-operation-required',
          gameSlug: context.gameId,
        }
      }
      // 整个 read→apply→validate→write 必须在同一把锁里：增量补丁基于读到的那份文档，
      // 锁外读会让并发批次各自基于旧快照覆盖对方。
      type PatchOutcome =
        | { ok: true; applied: number; revision: number; blueprintId: string; replayed?: boolean }
        | { ok: false; errors: string[]; errorCode?: string; failedOpIndex?: number }
        | { ok: false; conflict: RevisionConflict | IdempotencyConflict }
      const expectedRevision = optionalRevision(input.expectedRevision)
      const idempotencyKey = optionalIdempotencyKey(input.idempotencyKey)
      const fingerprint = mutationFingerprint({ blueprintId: input.blueprintId, ops })
      const outcome = await context.files.withLocks<PatchOutcome>(
        [GRAPH_SAVE_LOCK, HOST_MANIFEST_LOCK],
        async () => {
        const bytes = await context.files.read(BLUEPRINT_FILE)
        const current = parseGraph(bytes)
        if (!current) {
          return { ok: false, errors: ['缺少 blueprint.json'] }
        }
        if (activeActivity === 'ui.authoring') {
          const policyErrors = agentUiPatchErrors(current, ops)
          if (policyErrors.length > 0) {
            return {
              ok: false,
              errors: policyErrors,
              errorCode: 'workflow.ui.catalog-overlays-only',
            }
          }
        }
        const currentRevision = readDocumentRevision(bytes)
        if (
          typeof input.snapshotToken === 'string'
          && input.snapshotToken !== graphSnapshotToken(context.gameId, currentRevision)
        ) {
          return {
            ok: false,
            errors: [
              'snapshot.stale：分片读取对应的 blueprint revision 已过期，请重新读取同一节点 shard。',
            ],
            errorCode: 'snapshot.stale',
          }
        }
        const receipts = readMutationReceipts(bytes)
        const prior = resolveMutationReceipt(receipts, {
          key: idempotencyKey,
          operation: 'patch-graph',
          fingerprint,
          currentRevision,
        })
        if (prior && 'code' in prior) return { ok: false, conflict: prior }
        if (prior) {
          return {
            ok: true,
            applied: Number(prior.payload.applied ?? 0),
            revision: prior.revision,
            blueprintId: String(prior.payload.blueprintId ?? current.manifest.mainPackId),
            replayed: true,
          }
        }
        const conflict = scopedRevisionConflict(
          expectedRevision,
          currentRevision,
          readScopeRevisions(bytes),
          touchedScopes,
        )
        if (conflict) return { ok: false, conflict }
        const blueprintId = typeof input.blueprintId === 'string'
          ? input.blueprintId
          : current.manifest.mainPackId
        const applied = applyPatchGraphOps(current, {
          blueprintId,
          ops,
        })
        if (!applied.ok) {
          return { ok: false, errors: applied.errors, failedOpIndex: applied.failedOpIndex }
        }
        const errors = [
          ...validateDocument(applied.document),
          ...choiceConsequenceIssues(applied.document, { requireChoice: false }).map((entry) => entry.message),
          ...choiceConsequenceIssues(applied.document, { requireChoice: false }).map((entry) => entry.message),
        ]
        if (errors.length) {
          return { ok: false, errors, errorCode: 'validation.failed' }
        }
        const revision = nextDocumentRevision(currentRevision)
        const nextReceipts = appendMutationReceipt(receipts, mutationReceipt(
          idempotencyKey,
          'patch-graph',
          fingerprint,
          revision,
          { applied: applied.applied, blueprintId },
        ))
        await context.files.write(
          BLUEPRINT_FILE,
          encoder.encode(JSON.stringify(stampDocumentRevision(applied.document, revision, nextReceipts, { previous: readScopeRevisions(bytes), touched: touchedScopes }), null, 2)),
        )
        const currentManifest = await readHostManifest(context.files)
        const nextManifest = syncProjectVideoPresets(currentManifest, applied.document)
        await writeHostManifestRevision(
          context.files,
          nextManifest,
          { touchedScopes: ['videos'] },
        )
        if (!await context.files.read(PROJECT_FILE)) {
          await context.files.write(
            PROJECT_FILE,
            encoder.encode(JSON.stringify(projectMetadata(context.gameId), null, 2)),
          )
        }
        return { ok: true, applied: applied.applied, revision, blueprintId }
        },
      )
      if (!outcome.ok) {
        if ('conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
        return {
          schemaVersion: 1,
          ok: false,
          errors: outcome.errors,
          ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
          failedOpIndex: outcome.failedOpIndex,
          gameSlug: context.gameId,
        }
      }
      const result = {
        schemaVersion: 1,
        ok: true,
        applied: outcome.applied,
        revision: outcome.revision,
        replayed: outcome.replayed ?? false,
        data: { applied: outcome.applied },
        artifactRef: artifactRef(outcome.blueprintId, outcome.revision),
        validation: validationSummary(outcome.revision),
        uiHint: graphUiHint(outcome.blueprintId, ops),
        versions: [],
        gameSlug: context.gameId,
      }
      if (workflow) {
        await setWorkflowFocus(context, {
          activityRevision: workflow.activityRevision,
          location: result.uiHint.location as PageLocation,
          reason: 'artifact-created',
        }).catch(() => undefined)
      }
      return result
    },
    async patchNodeMedia(value) {
      assertSchema('patchNodeMedia', value)
      const input = record(value)
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        ['video.presets.binding'],
        input.activityRevision,
      )
      assertWorkflowMutationAllowed(
        workflow,
        activityRevision,
        ['video.presets.binding'],
        ['node.media'],
      )

      const bindings = input.bindings as NodeMediaBinding[]
      const nodeRefs = bindings.map((binding) => binding.nodeRef)
      const duplicateRef = nodeRefs.find((ref, index) => (
        nodeRefs.findIndex((candidate) => nodeRefKey(candidate) === nodeRefKey(ref)) !== index
      ))
      if (duplicateRef) {
        throw new ExtensionServiceInputError(
          `bindings contains duplicate NodeRef ${duplicateRef.blueprintId}/${duplicateRef.nodeId}`,
        )
      }
      const idempotencyKey = String(input.idempotencyKey)
      const fingerprint = mutationFingerprint({
        expectedGraphRevision: input.expectedGraphRevision,
        graphSnapshotToken: input.graphSnapshotToken,
        expectedAssetRevision: input.expectedAssetRevision,
        bindings,
      })
      type NodeMediaOutcome =
        | {
          ok: true
          graphRevision: number
          assetRevision: number
          nodeRefs: NodeRef[]
          replayed?: boolean
        }
        | {
          ok: false
          errorCode: string
          errors: string[]
          graphRevision: number
          assetRevision: number
        }

      const outcome = await context.files.withLocks<NodeMediaOutcome>(
        [GRAPH_SAVE_LOCK, HOST_MANIFEST_LOCK],
        async () => {
          const [bytes, assetSnapshot] = await Promise.all([
            context.files.read(BLUEPRINT_FILE),
            readHostManifestSnapshot(context.files),
          ])
          const current = parseGraph(bytes)
          const currentGraphRevision = readDocumentRevision(bytes)
          const currentAssetRevision = assetSnapshot.revision
          const failed = (
            errorCode: string,
            errors: string[],
          ): NodeMediaOutcome => ({
            ok: false,
            errorCode,
            errors,
            graphRevision: currentGraphRevision,
            assetRevision: currentAssetRevision,
          })
          if (!current) return failed('project.missing', ['缺少 blueprint.json'])

          const prior = resolveMutationReceipt(readMutationReceipts(bytes), {
            key: idempotencyKey,
            operation: 'patch-node-media',
            fingerprint,
            currentRevision: currentGraphRevision,
          })
          if (prior && 'code' in prior) {
            return failed(prior.code, [prior.message])
          }
          if (prior) {
            return {
              ok: true,
              graphRevision: Number(prior.payload.graphRevision ?? prior.revision),
              assetRevision: Number(prior.payload.assetRevision ?? currentAssetRevision),
              nodeRefs,
              replayed: true,
            }
          }

          if (
            input.graphSnapshotToken
            !== graphSnapshotToken(context.gameId, currentGraphRevision)
          ) {
            return failed('snapshot.stale', [
              'snapshot.stale：节点媒体绑定所依据的 blueprint snapshot 已过期，请重新 get_graph 读取目标节点。',
            ])
          }
          const graphConflict = revisionConflict(
            input.expectedGraphRevision as number,
            currentGraphRevision,
          )
          if (graphConflict) {
            return failed(graphConflict.code, [graphConflict.message])
          }
          const assetConflict = revisionConflict(
            input.expectedAssetRevision as number,
            currentAssetRevision,
          )
          if (assetConflict) {
            return failed(assetConflict.code, [
              assetConflict.message.replace('蓝图', '资产清单'),
            ])
          }

          const bindingErrors = bindings.flatMap((binding) => (
            nodeMediaBindingErrors(current, assetSnapshot.manifest, binding)
              .map((message) => (
                `${binding.nodeRef.blueprintId}/${binding.nodeRef.nodeId}: ${message}`
              ))
          ))
          if (bindingErrors.length > 0) {
            return failed('validation.failed', bindingErrors)
          }

          const next = structuredClone(current)
          for (const binding of bindings) {
            const pack = next.manifest.packs[binding.nodeRef.blueprintId]!
            const node = pack.graph.nodes.find(
              (candidate) => candidate.id === binding.nodeRef.nodeId,
            )!
            node.data = {
              ...node.data,
              media: structuredClone(binding.media),
            }
          }
          next.graph = next.manifest.packs[next.manifest.mainPackId]!.graph
          const validationErrors = validateDocument(next)
          if (validationErrors.length > 0) {
            return failed('validation.failed', validationErrors)
          }

          const graphRevision = nextDocumentRevision(currentGraphRevision)
          const assetRevision = currentAssetRevision + 1
          const receipt = mutationReceipt(
            idempotencyKey,
            'patch-node-media',
            fingerprint,
            graphRevision,
            {
              graphRevision,
              assetRevision,
              nodeRefs,
            },
          )!
          const graphReceipts = appendMutationReceipt(
            readMutationReceipts(bytes),
            receipt,
          )
          const stamped = stampDocumentRevision(
            next,
            graphRevision,
            graphReceipts,
            {
              previous: readScopeRevisions(bytes),
              touched: ['node.media'],
            },
          )
          const nextManifest = syncProjectVideoPresets(
            assetSnapshot.manifest,
            next,
          )

          await context.files.write(
            BLUEPRINT_FILE,
            encoder.encode(JSON.stringify(stamped, null, 2)),
          )
          const writtenAssetRevision = await writeHostManifestRevision(
            context.files,
            nextManifest,
            {
              touchedScopes: ['videos'],
              receipt,
            },
          )
          return {
            ok: true,
            graphRevision,
            assetRevision: writtenAssetRevision,
            nodeRefs,
          }
        },
      )

      if (!outcome.ok) {
        return {
          schemaVersion: 1,
          ...outcome,
          nodeRefs: [],
          replayed: false,
          idempotency: { key: idempotencyKey, replayed: false },
          gameSlug: context.gameId,
        }
      }
      const replayed = outcome.replayed ?? false
      return {
        schemaVersion: 1,
        ok: true,
        graphRevision: outcome.graphRevision,
        assetRevision: outcome.assetRevision,
        nodeRefs: outcome.nodeRefs,
        replayed,
        idempotency: { key: idempotencyKey, replayed },
        artifactRef: {
          kind: 'node-media-bindings',
          id: idempotencyKey,
          revision: outcome.graphRevision,
          assetRevision: outcome.assetRevision,
          nodeRefs: outcome.nodeRefs,
          idempotencyKey,
          status: 'ready',
        },
        gameSlug: context.gameId,
      }
    },
    async patchRules(value) {
      assertSchema('patchRules', value)
      const input = record(value)
      const { state: workflow, activityRevision } = await readWorkflowStateForMutation(
        context,
        ['rules.catalog', 'game.finalizing'],
        input.activityRevision,
      )
      assertWorkflowMutationAllowed(workflow, activityRevision, ['rules.catalog', 'game.finalizing'], ['rules'])
      const expectedRevision = optionalRevision(input.expectedRevision)
      const idempotencyKey = optionalIdempotencyKey(input.idempotencyKey)
      const ops = input.ops as RuleOp[]
      const fingerprint = mutationFingerprint({ ops })
      // Shares GRAPH_SAVE_LOCK with patch-graph: the rule catalog and the graph
      // topology live in the same document, so they must not interleave writes.
      type RulesOutcome =
        | { ok: true; revision: number; results: RuleOpOutcome[]; blueprintId: string; replayed?: boolean }
        | { ok: false; errors: string[]; errorCode?: string; failedOpIndex?: number }
        | { ok: false; conflict: RevisionConflict | IdempotencyConflict }
      const outcome = await context.files.withLocks<RulesOutcome>([GRAPH_SAVE_LOCK], async () => {
        const bytes = await context.files.read(BLUEPRINT_FILE)
        const current = parseGraph(bytes)
        if (!current) return { ok: false, errors: ['缺少 blueprint.json'] }
        const currentRevision = readDocumentRevision(bytes)
        const receipts = readMutationReceipts(bytes)
        const prior = resolveMutationReceipt(receipts, {
          key: idempotencyKey,
          operation: 'patch-rules',
          fingerprint,
          currentRevision,
        })
        if (prior && 'code' in prior) return { ok: false, conflict: prior }
        if (prior) {
          return {
            ok: true,
            revision: prior.revision,
            results: (prior.payload.results ?? []) as RuleOpOutcome[],
            blueprintId: String(prior.payload.blueprintId ?? current.manifest.mainPackId),
            replayed: true,
          }
        }
        const conflict = scopedRevisionConflict(
          expectedRevision,
          currentRevision,
          readScopeRevisions(bytes),
          ['rules'],
        )
        if (conflict) return { ok: false, conflict }

        const applied = applyRuleOps(
          {
            entities: current.entities,
            variables: current.variables,
            formulas: current.formulas as Record<string, Formula> | undefined,
          },
          ops,
        )
        if (!applied.ok) {
          return {
            ok: false,
            errors: applied.errors.map((error) => error.message),
            errorCode: applied.errors[0]?.code,
            ...(applied.failedOpIndex !== undefined && applied.failedOpIndex >= 0
              ? { failedOpIndex: applied.failedOpIndex }
              : {}),
          }
        }

        const nextMeta: GraphLibraryDocument = {
          ...current,
          entities: applied.meta.entities,
          variables: applied.meta.variables,
          formulas: applied.meta.formulas,
        }
        const formulasChanged = ops.some((op) => op.op === 'upsert-formula' || op.op === 'remove-formula')
        const next = formulasChanged
          ? recompileFormulaUsages(
              nextMeta,
              applied.meta.formulas,
              applied.meta.entities,
            )
          : nextMeta
        const errors = validateDocument(next)
        if (errors.length) {
          return { ok: false, errors, errorCode: ruleValidationErrorCode(ops, errors) }
        }
        const revision = nextDocumentRevision(currentRevision)
        const blueprintId = current.manifest.mainPackId
        const nextReceipts = appendMutationReceipt(receipts, mutationReceipt(
          idempotencyKey,
          'patch-rules',
          fingerprint,
          revision,
          { results: applied.results, blueprintId },
        ))
        await context.files.write(
          BLUEPRINT_FILE,
          encoder.encode(JSON.stringify(stampDocumentRevision(next, revision, nextReceipts, { previous: readScopeRevisions(bytes), touched: ['rules'] }), null, 2)),
        )
        return { ok: true, revision, results: applied.results, blueprintId }
      })
      if (!outcome.ok) {
        if ('conflict' in outcome) return conflictResult(outcome.conflict, context.gameId)
        return {
          schemaVersion: 1,
          ok: false,
          errors: outcome.errors,
          ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
          ...(outcome.failedOpIndex !== undefined ? { failedOpIndex: outcome.failedOpIndex } : {}),
          gameSlug: context.gameId,
        }
      }
      const result = {
        schemaVersion: 1,
        ok: true,
        revision: outcome.revision,
        results: outcome.results,
        replayed: outcome.replayed ?? false,
        data: { results: outcome.results },
        artifactRef: artifactRef(outcome.blueprintId, outcome.revision),
        validation: validationSummary(outcome.revision),
        uiHint: rulesUiHint(ops, outcome.results),
        gameSlug: context.gameId,
      }
      if (workflow) {
        await setWorkflowFocus(context, {
          activityRevision: workflow.activityRevision,
          location: result.uiHint.location as PageLocation,
          reason: 'artifact-created',
        }).catch(() => undefined)
      }
      return result
    },
    async listVideos(value) {
      assertSchema('listVideos', value)
      record(value)
      return {
        videos: NODIA_ASSETS_MANIFEST.assets.map((asset) => asset.id),
      }
    },
    async listAssets(value) {
      assertSchema('listAssets', value)
      const input = record(value)
      const filter: AssetFilter = {}
      if (input.kind !== undefined) {
        if (!['image', 'video', 'audio'].includes(String(input.kind))) {
          throw new ExtensionServiceInputError('kind is invalid')
        }
        filter.kind = input.kind as MediaKind
      }
      if (input.productionType !== undefined) {
        if (![
          'character_ref',
          'scene_ref',
          'shot_image',
          'grid_storyboard',
          'video_clip',
          'audio_track',
        ].includes(String(input.productionType))) {
          throw new ExtensionServiceInputError('productionType is invalid')
        }
        filter.productionType = input.productionType as MediaProductionType
      }
      if (input.sceneNodeId !== undefined) {
        filter.sceneNodeId = stringValue(input.sceneNodeId, 'sceneNodeId', true)
      }
      return { assets: await registry.list(filter) }
    },
    async getAsset(value) {
      const id = assertLogicalIdentifier(
        stringValue(value, 'assetId', true)!,
        'assetId',
      )
      return { asset: await registry.get(id) }
    },
    async deleteAsset(value) {
      const id = assertLogicalIdentifier(
        stringValue(value, 'assetId', true)!,
        'assetId',
      )
      return registry.remove(id)
    },
    async importCharacterRefs(value) {
      assertSchema('importCharacterRefs', value)
      const input = record(value)
      assertOnlyKeys(input, [])
      try {
        return { refs: await importCharacterRefsFromHost(context, registry) }
      } catch (error) {
        return { refs: [], error: publicErrorMessage(error) }
      }
    },
    async importSceneRefs(value) {
      assertSchema('importSceneRefs', value)
      const input = record(value)
      assertOnlyKeys(input, [])
      try {
        return { refs: await importSceneRefsFromHost(context, registry) }
      } catch (error) {
        return { refs: [], error: publicErrorMessage(error) }
      }
    },
    async registerKinoReference(value) {
      assertSchema('registerKinoReference', value)
      const input = record(value)
      const expectedRevision = optionalRevision(input.expectedRevision)
      const registryId = assertLogicalIdentifier(stringValue(input.registryId, 'registryId', true)!, 'registryId')
      let hostMediaAssetId = stringValue(input.hostMediaAssetId, 'hostMediaAssetId')
      const kinoResourceId = stringValue(input.kinoResourceId, 'kinoResourceId', true)!
      const kinoGenerationId = stringValue(input.kinoGenerationId, 'kinoGenerationId', true)!
      const productionType = input.productionType as 'character_ref' | 'scene_ref'
      const characterId = stringValue(input.characterId, 'characterId')
      const sceneId = stringValue(input.sceneId, 'sceneId')
      const prompt = stringValue(input.prompt, 'prompt', true)!
      const model = stringValue(input.model, 'model', true)!
      const size = stringValue(input.size, 'size')
      const visualStyleKey = stringValue(input.visualStyleKey, 'visualStyleKey')
      type PreviewSnapshot = { name: string; sourcePrompt: string; sourcePromptHash: string }
      let characterSnapshot: PreviewSnapshot | undefined
      // 场景与角色对称：不写快照的话，作者手动重出的图不带 sourcePromptHash，
      // `isCurrentScenePreview` 判它不当前，下一轮出图会直接盖掉作者刚修好的图。
      let sceneSnapshot: PreviewSnapshot | undefined

      if (productionType === 'character_ref' && characterId) {
        characterSnapshot = await context.files.withLocks([HOST_MANIFEST_LOCK], async () => {
          const character = assetEntityDefinitions(await readHostManifest(context.files)).characters[characterId]
          if (!character) throw new ExtensionServiceInputError(`characterId does not exist: ${characterId}`)
          const sourcePrompt = character.appearance.previewPrompt
          return {
            name: character.name,
            sourcePrompt,
            sourcePromptHash: characterPreviewSourceHash(character.appearance.description, sourcePrompt),
          }
        })
      }

      if (productionType === 'scene_ref' && sceneId) {
        sceneSnapshot = await context.files.withLocks([HOST_MANIFEST_LOCK], async () => {
          const scene = assetEntityDefinitions(await readHostManifest(context.files)).scenes[sceneId]
          if (!scene) throw new ExtensionServiceInputError(`sceneId does not exist: ${sceneId}`)
          const sourcePrompt = scene.visual.previewPrompt
          return {
            name: scene.name,
            sourcePrompt,
            sourcePromptHash: scenePreviewSourceHash(scene.visual.description, sourcePrompt),
          }
        })
      }

      if (!hostMediaAssetId) {
        const materialized = await context.capabilities.invoke(
          'media.kino.image.materialize',
          1,
          { resourceId: kinoResourceId, generationId: kinoGenerationId, registryId },
          { requestId: `kino-reference:${kinoGenerationId}` },
        ) as { image?: { hostMediaAssetId?: unknown } }
        hostMediaAssetId = typeof materialized.image?.hostMediaAssetId === 'string'
          ? materialized.image.hostMediaAssetId
          : undefined
      }
      if (!hostMediaAssetId) throw new ExtensionServiceInputError('Kino image materialization did not return host media')
      hostMediaAssetId = assertLogicalIdentifier(hostMediaAssetId, 'hostMediaAssetId')

      const hosted = (await context.media.list(context.gameId)).find((asset) => asset.id === hostMediaAssetId)
      if (!hosted || hosted.type !== 'image' || !hosted.contentType.startsWith('image/')) {
        throw new ExtensionServiceInputError('hostMediaAssetId must identify an image in the current game')
      }
      const hostedMeta = hosted.metadata
      if (
        !hostedMeta
        || hostedMeta.source !== 'game-video-generation'
        || hostedMeta.registryId !== registryId
        || hostedMeta.kinoResourceId !== kinoResourceId
      ) {
        throw new ExtensionServiceInputError('host media metadata does not match the Kino registration')
      }
      const existing = await registry.get(registryId)
      const existingKinoResourceId = typeof existing?.meta?.kinoResourceId === 'string'
        && existing.meta.kinoResourceId.trim()
        ? existing.meta.kinoResourceId.trim()
        : undefined
      if (existingKinoResourceId && existingKinoResourceId !== kinoResourceId) {
        throw new ExtensionServiceInputError('registryId is already bound to another Kino resource')
      }

      const now = Date.now()
      const asset = await registry.upsert({
        id: registryId,
        kind: 'image',
        productionType,
        status: 'ready',
        label: characterSnapshot?.name ?? (productionType === 'scene_ref' ? '场景参考图' : '角色参考图'),
        prompt,
        sourceModule: 'game-video',
        mime: hosted.contentType,
        ...(hosted.sizeBytes === undefined ? {} : { bytes: hosted.sizeBytes }),
        provider: { kind: 'local', ref: hosted.id },
        createdAt: now,
        updatedAt: now,
        meta: {
          kinoResourceId,
          kinoGenerationId,
          kinoModel: model,
          ...(characterId && characterSnapshot ? {
            characterPreview: {
              characterId,
              sourcePrompt: characterSnapshot.sourcePrompt,
              sourcePromptHash: characterSnapshot.sourcePromptHash,
              mode: 'manual',
            },
          } : {}),
          ...(sceneId && sceneSnapshot ? {
            scenePreview: {
              sceneId,
              sourcePrompt: sceneSnapshot.sourcePrompt,
              sourcePromptHash: sceneSnapshot.sourcePromptHash,
              mode: 'manual',
            },
          } : {}),
          hostMedia: {
            provenance: 'extension-media-capability',
            assetId: hosted.id,
            locator: hosted.url,
          },
        },
        provenance: {
          origin: 'generation',
          recipe: {
            version: 1,
            parameters: {
              model,
              ...(size ? { size } : {}),
              ...(visualStyleKey ? { visualStyleKey } : {}),
              mode: 'manual',
            },
          },
        },
      })

      const bindsCharacter = Boolean(characterId && characterSnapshot)
      const bindsScene = Boolean(sceneId && sceneSnapshot)
      try {
        const committed = await context.files.withLocks<
          | { revision: number }
          | { conflict: RevisionConflict }
        >([HOST_MANIFEST_LOCK], async () => {
          const assetSnapshot = await readHostManifestSnapshot(context.files)
          const {
            manifest: assetManifest,
            revision: currentRevision,
            scopeRevisions,
          } = assetSnapshot
          const touchedScopes = [
            'assets',
            ...(bindsCharacter ? ['characters'] : []),
            ...(bindsScene ? ['scenes'] : []),
          ]
          const conflict = assetManifestScopedRevisionConflict(
            expectedRevision,
            currentRevision,
            scopeRevisions,
            touchedScopes,
          )
          if (conflict) return { conflict }
          const definitions = assetEntityDefinitions(assetManifest)
          const assetCatalog = normalizeAssetCatalogState(assetManifest.assetCatalog)
          const bindScene = (): void => {
            const current = definitions.scenes[sceneId!]
            const entity = assetCatalog.entities.scene[sceneId!]
            if (!current || !entity) throw new ExtensionServiceInputError(`sceneId does not exist: ${sceneId!}`)
            const currentHash = scenePreviewSourceHash(
              current.visual.description,
              current.visual.previewPrompt,
            )
            if (currentHash !== sceneSnapshot!.sourcePromptHash) {
              throw new ExtensionServiceInputError('scene changed while the image was being registered')
            }
            assetCatalog.entities.scene[sceneId!] = {
              ...entity,
              current: { assetId: registryId },
              history: entity.history.some((entry) => entry.assetId === registryId)
                ? entity.history
                : [...entity.history, { assetId: registryId, appliedAt: Date.now(), source: 'generate' }],
              updatedAt: Date.now(),
            }
          }
          const bindCharacter = (): void => {
            const current = definitions.characters[characterId!]
            const entity = assetCatalog.entities.character[characterId!]
            if (!current || !entity) throw new ExtensionServiceInputError(`characterId does not exist: ${characterId!}`)
            const currentHash = characterPreviewSourceHash(
              current.appearance.description,
              current.appearance.previewPrompt,
            )
            if (currentHash !== characterSnapshot!.sourcePromptHash) {
              throw new ExtensionServiceInputError('character changed while the image was being registered')
            }
            assetCatalog.entities.character[characterId!] = {
              ...entity,
              current: { assetId: registryId },
              history: entity.history.some((entry) => entry.assetId === registryId)
                ? entity.history
                : [...entity.history, { assetId: registryId, appliedAt: Date.now(), source: 'generate' }],
              updatedAt: Date.now(),
            }
          }
          if (bindsCharacter) bindCharacter()
          if (bindsScene) bindScene()
          const revision = await writeHostManifestRevision(
            context.files,
            { ...assetManifest, assetCatalog },
            { touchedScopes },
          )
          return { revision }
        })
        if ('conflict' in committed) {
          if (!existing) await registry.remove(registryId).catch(() => undefined)
          return conflictResult(committed.conflict, context.gameId)
        }
        return { ok: true, asset, revision: committed.revision }
      } catch (error) {
        if (!existing) await registry.remove(registryId).catch(() => undefined)
        throw error
      }
    },
    async polishVideoPrompt(value) {
      const prompt = promptPolishInput(value)
      return { prompt: await polishVideoPromptWithModel(context, prompt) }
    },
    async polishOverlayPrompt(value) {
      const input = overlayPromptPolishInput(value)
      return { prompt: await polishOverlayPromptWithModel(context, input.prompt, input.title) }
    },
    async generateShotScript(value) {
      assertSchema('generateShotScript', value)
      const input = shotScriptInput(value)
      try {
        return { shots: await generation.generateShotScript(input) }
      } catch (error) {
        return { shots: [], error: publicErrorMessage(error) }
      }
    },
    async generateKeyframe(value) {
      assertSchema('generateKeyframe', value)
      const input = keyframeInput(value)
      try {
        return { asset: await generation.generateKeyframe(input) }
      } catch (error) {
        return { asset: null, error: publicErrorMessage(error) }
      }
    },
    async generateVideo(value) {
      assertSchema('generateVideo', value)
      const input = videoInput(value, 60)
      try {
        return { asset: await generation.generateVideo(input) }
      } catch (error) {
        return { asset: null, error: publicErrorMessage(error) }
      }
    },
    async generateVideoClip(value) {
      assertSchema('generateVideoClip', value)
      return generateVideoClip(context, videoClipInput(value), registry)
    },
    async listVideoVisualStyles(value = {}) {
      const input = record(value)
      assertOnlyKeys(input, [])
      return listVideoVisualStyles(context)
    },
    async generateNodeVideo(value) {
      assertSchema('generateNodeVideo', value)
      const input = videoInput(value, 120)
      try {
        return { assets: await generation.generateNodeVideo(input) }
      } catch (error) {
        return { assets: [], error: publicErrorMessage(error) }
      }
    },
    async upsertDocument(value) {
      assertSchema('upsertDocument', value)
      const input = record(value)
      const documentType = input.documentType
      if (
        documentType !== 'intake'
        && documentType !== 'design-options'
        && documentType !== 'core'
        && documentType !== 'inquiry'
        && documentType !== 'pillar'
      ) {
        throw new ExtensionServiceInputError('documentType is invalid')
      }
      const slug = stringValue(input.slug, 'slug', true)!
      try {
        const previous = await readHostDocument(context, `doc-${documentType}`)
        const nextContent = input.content === undefined ? undefined : String(input.content)
        const document = await upsertHostDocument(context, {
          documentType: documentType as DocumentType,
          slug,
          ...(nextContent === undefined ? {} : { content: nextContent }),
          ...(input.name === undefined ? {} : { name: stringValue(input.name, 'name') }),
        })
        // 产物落盘即凭据:阶段推进不依赖 Agent 记得单独调 begin_activity。
        await autoAdvanceWorkflowForDocument(context, document.meta.documentType, {
          reworkCompletedTarget: documentType === 'pillar'
            && nextContent !== undefined
            && previous?.content !== nextContent,
        })
        return {
          document: {
            id: document.id,
            name: document.name,
            documentType: document.meta.documentType,
            updatedAt: document.updatedAt,
          },
        }
      } catch (error) {
        return { document: null, error: publicErrorMessage(error) }
      }
    },
    async applyDesignOptions(value) {
      assertSchema('applyDesignOptions', value)
      const input = record(value)
      const optionId = input.optionId as DesignOptionId
      const source = await readHostDocument(context, 'doc-design-options')
      if (!source) throw new ExtensionServiceInputError('design-options document is missing')
      const match = /^docs\/(.+)_design_options\.md$/i.exec(source.document.provider.ref)
      if (!match) throw new ExtensionServiceInputError('design-options document path is invalid')
      const slug = match[1]!
      try {
        const options = parseDesignOptions(source.content)
        const content = materializeCoreMarkdown(options, optionId)
        const document = await upsertHostDocument(context, {
          documentType: 'core',
          slug,
          content,
          name: '核心',
        })
        // 作者选定方向就是 core 门通过，之后再按产物推进阶段。
        await recordCoreSelectionGate(context, { optionId })
        await autoAdvanceWorkflowForDocument(context, document.meta.documentType)
        return {
          selectedOptionId: optionId,
          document: {
            id: document.id,
            name: document.name,
            documentType: document.meta.documentType,
            updatedAt: document.updatedAt,
          },
        }
      } catch (error) {
        return { selectedOptionId: null, document: null, error: publicErrorMessage(error) }
      }
    },
    async upsertComponent(value) {
      // upsert-component 同时承担两条职责：
      //   1. 单控件：不带 compose → 造一个控件（base:<id> 归控件目录）。
      //   2. 多组件界面：带 compose → 可选先造一个新控件，再把 children 组装成模板
      //      （ui.overlays 里的 scheme-*，归模板目录）。
      const input = record(value)

      // 先造新控件（若本调用带 id/events/implementation），让 compose.children
      // 能在同一批里引用它。compose 不属于控件定义，剥掉后再交给控件 authoring。
      let componentResult: Awaited<ReturnType<typeof upsertAuthoredComponent>> | undefined
      if (input.id !== undefined || input.implementation !== undefined || input.events !== undefined) {
        const { compose: _compose, ...componentInput } = input
        componentResult = await upsertAuthoredComponent(context, componentInput)
      }

      const compose = input.compose === undefined
        ? undefined
        : parseComposedOverlay(
            input.compose,
            await knownComponentIds(context),
            componentResult?.componentId,
          )

      let overlayId: string | undefined
      let overlayTitle: string | undefined
      if (compose) {
        const written = await writeComposedOverlay(context, compose)
        overlayId = written.overlayId
        overlayTitle = written.title
      }

      if (!componentResult && !overlayId) {
        throw new ExtensionServiceInputError('upsert-component requires either a single control or a compose block')
      }

      return {
        ok: true,
        ...(componentResult
          ? {
              componentId: componentResult.componentId,
              created: componentResult.created,
              componentCount: componentResult.componentCount,
              definitionPath: componentResult.definitionPath,
              modulePath: componentResult.modulePath,
              revision: componentResult.revision,
            }
          : {}),
        ...(overlayId ? { overlayId, ...(overlayTitle ? { overlayTitle } : {}) } : {}),
      }
    },
  }
}
