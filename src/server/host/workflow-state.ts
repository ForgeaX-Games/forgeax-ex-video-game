import { randomUUID } from 'node:crypto'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  ASSET_PIPELINE_TRACKS,
  PRODUCT_PHASES,
  MAIN_VIDEO_GAME_ACTIVITIES,
  VIDEO_GAME_ACTIVITIES,
  type ActivityRecord,
  type ActivityStatus,
  type AssetPipelineState,
  type ArtifactRef,
  type CompletionReport,
  type InquiryContract,
  type ProductionProjection,
  type ProductPhase,
  type RequirementContract,
  type ValidationEvidence,
  type VideoGameActivity,
  type VideoGameWorkflowState,
  type PageLocation,
  type WorkflowBlocker,
} from '../../workflow/contracts'
import { ACTIVITY_FOCUS, ACTIVITY_PHASE, activityContract } from '../../workflow/activity-contracts'
import { expandCheckIds } from '../../workflow/validation-check-groups'
import {
  activeActivitiesIn,
  activeAssetActivities,
  aggregateAssetPipelineStatus,
  aggregateGroupStatus,
  assetTrackForActivity,
  firstGroup,
  groupForActivity,
  groupIndex,
  isAssetPipelineActivity,
  isGroupComplete,
  isSettled,
  isWriteScopeAllowed,
  nextGroup,
  representativeActivity,
  trackForActivity,
  writeScopesFor,
} from './activity-groups'
import { listHostDocuments, readHostDocument } from '../asset-registry'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const VIDEO_GAME_WORKFLOW_FILE = '.forgeax/extensions/game-video/workflow.json'
const WORKFLOW_LOCK = 'game-video-workflow-state'

const ACTIVITY_INDEX = new Map(VIDEO_GAME_ACTIVITIES.map((activity, index) => [activity, index]))

export interface ContentInventory {
  documents: Partial<Record<'intake' | 'design-options' | 'core' | 'inquiry' | 'pillar', number>>
  blueprintCount: number
  blueprintNodeCount: number
  uiCount: number
  characterCount: number
  sceneCount: number
  videoCount: number
  imageCount: number
  audioCount: number
  fontCount: number
  entityCount: number
  variableCount: number
  formulaCount: number
}

export const EMPTY_CONTENT_INVENTORY: ContentInventory = {
  documents: {}, blueprintCount: 0, blueprintNodeCount: 0, uiCount: 0,
  characterCount: 0, sceneCount: 0, videoCount: 0, imageCount: 0, audioCount: 0, fontCount: 0,
  entityCount: 0, variableCount: 0, formulaCount: 0,
}

function now(): string {
  return new Date(Date.now()).toISOString()
}

function phaseRecord(status: VideoGameWorkflowState['phaseStatus'] = 'not-started') {
  return { revision: 0, status }
}

export function createInitialAssetPipelineState(): AssetPipelineState {
  return {
    schemaVersion: 1,
    revision: 0,
    status: 'not-started',
    activeActivities: [],
    blockers: [],
    readiness: {
      characters: 'pending',
      scenes: 'pending',
      videoPresets: 'pending',
    },
  }
}

export function createInitialWorkflowState(gameId: string): VideoGameWorkflowState {
  const at = now()
  const group = firstGroup()
  const activity = group.tracks[0]![0]!
  return {
    schemaVersion: 2,
    gameId,
    revision: 1,
    productPhase: 'requirements-collection',
    phaseRevision: 1,
    // 新项目在作者提交第一句需求之前，AI 什么都没做，所以不是 'working'。
    // 'working' 会让 projection 产出 progress notice，前端把「生成中…」常驻在顶部。
    phaseStatus: 'not-started',
    activity,
    activityRevision: 1,
    activityStatus: 'not-started',
    activeGroup: { id: group.id, activities: [activity], status: 'not-started', revision: 1 },
    assetPipeline: createInitialAssetPipelineState(),
    phases: {
      'requirements-collection': { revision: 1, status: 'not-started', openedAt: at },
      'planning-design': phaseRecord(),
      'feature-development': phaseRecord(),
      'asset-generation': phaseRecord(),
    },
    activities: {
      // 与 activityStatus 保持同一事实源：作者还没提交第一句，这个活动没在跑。
      // 早期版本把记录写成 'working' 而顶层写 'not-started'，两处打架会让
      // 「未开始也能 await_user」这类判定走偏。
      [activity]: { revision: 1, status: 'not-started', artifactRefs: [], evidence: [] },
    },
    artifactRefs: [],
    validationEvidence: [],
    blockers: [],
    gates: {
      core: { status: 'pending', revision: 0 },
      pillar: { status: 'pending', revision: 0 },
    },
    productionRefs: [],
    history: [{ revision: 1, activity, activityRevision: 1, status: 'working', at, reason: 'workflow-created' }],
    noticeRevision: 1,
    updatedAt: at,
  }
}

function isActivity(value: unknown): value is VideoGameActivity {
  return typeof value === 'string' && (VIDEO_GAME_ACTIVITIES as readonly string[]).includes(value)
}

function isPhase(value: unknown): value is ProductPhase {
  return typeof value === 'string' && (PRODUCT_PHASES as readonly string[]).includes(value)
}

/**
 * 退役活动到新流程的落点。
 *
 * `document.intake` 被删除（设计 §9.10），停在它上面的项目直接前移到
 * `document.core`；`blueprint.graph` 被 `blueprint.outline` 取代，语义上
 * 旧图已有节点但没有声明清单，所以回到 outline 补声明——已有的节点、角色、
 * 规则内容都在内容平面，不会丢。
 */
const LEGACY_ACTIVITY_TARGET: Readonly<Record<string, VideoGameActivity>> = {
  'document.intake': 'document.core',
  'blueprint.graph': 'blueprint.outline',
}

function migrateActivityId(value: unknown): VideoGameActivity | undefined {
  if (isActivity(value)) return value
  if (typeof value === 'string' && LEGACY_ACTIVITY_TARGET[value]) return LEGACY_ACTIVITY_TARGET[value]
  return undefined
}

/**
 * v1（单游标）→ v2（活动组）迁移。
 *
 * 只重定位生产平面的游标与组归属，内容平面一律不动。退役活动的历史记录按
 * ID 映射保留，避免把作者已完成的阶段判成未做。
 */
function migrateFromV1(value: Record<string, unknown>, gameId: string): VideoGameWorkflowState | null {
  const activity = migrateActivityId(value.activity)
  if (!activity || !isPhase(value.productPhase)) return null
  const legacyActivities = (value.activities ?? {}) as Record<string, ActivityRecord>
  const activities: VideoGameWorkflowState['activities'] = {}
  for (const [key, record] of Object.entries(legacyActivities)) {
    const target = migrateActivityId(key)
    if (!target) continue
    // 同一目标可能被两个旧 ID 命中（intake + core），保留更靠前的进度。
    const existing = activities[target]
    if (!existing || (record?.revision ?? 0) > existing.revision) activities[target] = record
  }
  const targetIndex = (
    MAIN_VIDEO_GAME_ACTIVITIES as readonly VideoGameActivity[]
  ).indexOf(activity)
  for (const predecessor of (
    MAIN_VIDEO_GAME_ACTIVITIES as readonly VideoGameActivity[]
  ).slice(0, targetIndex)) {
    if (activities[predecessor]) continue
    // v1 没有后来插入的主线活动。显式迁移为合法跳过，既保留旧游标语义，
    // 也让后续按 settled records 恢复游标时不会倒退到新活动。
    activities[predecessor] = {
      revision: 0,
      status: 'not-required',
      artifactRefs: [],
      evidence: [],
    }
  }
  const group = groupForActivity(activity)
  const active = activeActivitiesIn(group, activities)
  const state: VideoGameWorkflowState = {
    ...(value as unknown as VideoGameWorkflowState),
    schemaVersion: 2,
    gameId,
    activity,
    activityRevision: activities[activity]?.revision ?? 1,
    activityStatus: activities[activity]?.status ?? 'not-started',
    activities,
    assetPipeline: createInitialAssetPipelineState(),
    activeGroup: {
      id: group.id,
      activities: active.length > 0 ? active : [activity],
      status: aggregateGroupStatus(group, activities),
      revision: 1,
    },
  }
  return state
}

function normalizeAssetPipeline(value: unknown): AssetPipelineState {
  const initial = createInitialAssetPipelineState()
  if (!value || typeof value !== 'object') return initial
  const pipeline = value as Partial<AssetPipelineState>
  const readiness = pipeline.readiness && typeof pipeline.readiness === 'object'
    ? pipeline.readiness
    : initial.readiness
  const readinessValue = (
    value: unknown,
  ): AssetPipelineState['readiness']['characters'] => (
    value === 'pending' || value === 'working' || value === 'ready' || value === 'failed'
      ? value
      : 'pending'
  )
  const status = pipeline.status === 'not-started'
    || pipeline.status === 'working'
    || pipeline.status === 'partial'
    || pipeline.status === 'blocked'
    || pipeline.status === 'ready'
    ? pipeline.status
    : initial.status
  return {
    schemaVersion: 1,
    revision: Number.isSafeInteger(pipeline.revision) ? pipeline.revision! : 0,
    status,
    activeActivities: Array.isArray(pipeline.activeActivities)
      ? pipeline.activeActivities.filter(
        (activity): activity is VideoGameActivity => isActivity(activity) && isAssetPipelineActivity(activity),
      )
      : [],
    blockers: Array.isArray(pipeline.blockers) ? pipeline.blockers : [],
    readiness: {
      characters: readinessValue(readiness.characters),
      scenes: readinessValue(readiness.scenes),
      videoPresets: readinessValue(readiness.videoPresets),
    },
  }
}

function normalizeLegacyAssetPipeline(
  state: VideoGameWorkflowState,
): AssetPipelineState {
  const legacyActive = new Set([
    ...(state.activeGroup?.activities ?? []),
    ...(isAssetPipelineActivity(state.activity) ? [state.activity] : []),
  ])
  const activeActivities: VideoGameActivity[] = []
  const readiness = createInitialAssetPipelineState().readiness

  const readinessKeyForTrack = (
    track: readonly VideoGameActivity[],
  ): keyof AssetPipelineState['readiness'] => {
    const first = track[0]
    if (first?.startsWith('characters.')) return 'characters'
    if (first?.startsWith('scenes.')) return 'scenes'
    return 'videoPresets'
  }

  for (const track of ASSET_PIPELINE_TRACKS) {
    const typedTrack = track as readonly VideoGameActivity[]
    const records = typedTrack
      .map((activity) => state.activities[activity])
      .filter((record): record is ActivityRecord => record !== undefined)
    const started = records.some((record) => record.revision > 0 || record.status !== 'not-started')
      || typedTrack.some((activity) => legacyActive.has(activity))
    if (started) {
      const active = typedTrack.find((activity) => !isSettled(state.activities[activity]?.status))
      if (active) activeActivities.push(active)
    }
    const key = readinessKeyForTrack(typedTrack)
    const finalActivity = typedTrack.at(-1)!
    readiness[key] = records.some((record) => record.status === 'blocked' || record.blocker)
      ? 'failed'
      : isSettled(state.activities[finalActivity]?.status)
        ? 'ready'
        : started
          ? 'working'
          : 'pending'
  }

  const blockers = [
    ...Object.entries(state.activities)
      .filter(([activity]) => isActivity(activity) && isAssetPipelineActivity(activity))
      .map(([, record]) => record?.blocker)
      .filter((blocker): blocker is WorkflowBlocker => blocker !== undefined),
    ...(state.blockers ?? []).filter((blocker) => isAssetPipelineActivity(blocker.activity)),
  ].filter((blocker, index, all) => all.findIndex((candidate) => (
    candidate.activity === blocker.activity
    && candidate.activityRevision === blocker.activityRevision
    && candidate.code === blocker.code
  )) === index)
  const revision = Math.max(
    0,
    ...Object.entries(state.activities)
      .filter(([activity]) => isActivity(activity) && isAssetPipelineActivity(activity))
      .map(([, record]) => record?.revision ?? 0),
  )
  const pipeline: AssetPipelineState = {
    schemaVersion: 1,
    revision,
    status: 'not-started',
    activeActivities,
    blockers,
    readiness,
  }
  return {
    ...pipeline,
    status: aggregateAssetPipelineStatus({ ...state, assetPipeline: pipeline }),
  }
}

function parseState(bytes: Uint8Array | null, gameId: string): VideoGameWorkflowState | null {
  if (!bytes) return null
  try {
    const value = JSON.parse(decoder.decode(bytes)) as Record<string, unknown> & Partial<VideoGameWorkflowState>
    if (value.gameId !== gameId || !isPhase(value.productPhase)) return null
    if (!Number.isSafeInteger(value.revision)) return null
    const schemaVersion = value.schemaVersion as number | undefined
    const hasAssetPipeline = Boolean(
      value.assetPipeline
      && typeof value.assetPipeline === 'object'
      && (value.assetPipeline as { schemaVersion?: unknown }).schemaVersion === 1,
    )
    const migrated = schemaVersion === 1
      ? migrateFromV1(value as Record<string, unknown>, gameId)
      : schemaVersion === 2 && isActivity(value.activity)
        ? (() => {
          const state = {
            ...(value as VideoGameWorkflowState),
            activities: value.activities ?? {},
            assetPipeline: normalizeAssetPipeline(value.assetPipeline),
          }
          const hasLegacyAssetProgress = Object.entries(state.activities).some(([activity, record]) => (
            isActivity(activity)
            && isAssetPipelineActivity(activity)
            && (record?.revision ?? 0) > 0
          ))
          if (hasAssetPipeline && (state.assetPipeline.activeActivities.length > 0 || !hasLegacyAssetProgress)) return state
          return {
            ...state,
            assetPipeline: normalizeLegacyAssetPipeline(state),
          }
        })()
        : null
    if (!migrated) return null
    const state = !isAssetPipelineActivity(migrated.activity)
      && (!migrated.activeGroup
        || groupForActivity(migrated.activity).id !== migrated.activeGroup.id)
      ? { ...migrated, activeGroup: rebuildActiveGroup(migrated) }
      : migrated
    if (state.gates && 'character-cost' in state.gates) {
      const { 'character-cost': _obsoleteCharacterCost, ...gates } = state.gates
      return { ...state, gates }
    }
    return state
  } catch {
    return null
  }
}

function rebuildActiveGroup(state: VideoGameWorkflowState): VideoGameWorkflowState['activeGroup'] {
  const group = groupForActivity(state.activity)
  const active = activeActivitiesIn(group, state.activities)
  return {
    id: group.id,
    activities: active.length > 0 ? active : [state.activity],
    status: aggregateGroupStatus(group, state.activities),
    revision: 1,
  }
}

async function writeState(context: ExtensionContext, state: VideoGameWorkflowState): Promise<void> {
  await context.files.write(VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(state, null, 2)))
}

function wasV1(bytes: Uint8Array | null): boolean {
  if (!bytes) return false
  try {
    return (JSON.parse(decoder.decode(bytes)) as { schemaVersion?: unknown }).schemaVersion === 1
  } catch {
    return false
  }
}

/**
 * 从退役的 intake 文档回填需求契约。
 *
 * 回填不出结构化维度是正常的——旧文档是自由文本。所以只取原始意图，
 * 并把来源标成 `inferred`：宁可标明「这是推断的」，也不要假装是作者原话。
 */
async function backfillRequirementContract(
  context: ExtensionContext,
  state: VideoGameWorkflowState,
): Promise<VideoGameWorkflowState | null> {
  const documents = await listHostDocuments(context).catch(() => [])
  const intake = documents.find((document) => document.meta.documentType === 'intake')
  if (!intake) return null
  const loaded = await readHostDocument(context, intake.id).catch(() => null)
  const rawIntent = loaded?.content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'))
  if (!rawIntent) return null
  const contract = normalizeRequirementContract({
    rawIntent,
    dimensions: { legacy_intake: { value: rawIntent, source: 'inferred' } },
  })
  if (!contract) return null
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const latest = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!latest || latest.requirementContract) return latest
    // 迁移必须幂等：这里不推进 revision，只补上缺失的契约。
    const next = { ...latest, requirementContract: contract }
    await writeState(context, next)
    return next
  })
}

export async function readWorkflowState(
  context: ExtensionContext,
  options: { create?: boolean } = {},
): Promise<VideoGameWorkflowState | null> {
  const bytes = await context.files.read(VIDEO_GAME_WORKFLOW_FILE)
  const current = parseState(bytes, context.gameId)
  if (current && wasV1(bytes) && !current.requirementContract) {
    // 迁移窗口只有这一次：文件里还写着 schemaVersion 1。旧项目的需求都在
    // `<slug>_intake.md` 里，不回填就等于把作者当初的输入丢掉（设计 §12）。
    const backfilled = await backfillRequirementContract(context, current)
    if (backfilled) return backfilled
  }
  if (current || options.create !== true) return current
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const afterLock = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (afterLock) return afterLock
    const initial = createInitialWorkflowState(context.gameId)
    await writeState(context, initial)
    return initial
  })
}

/**
 * 拒绝语义三态（设计 §9.7.5）。
 *
 * 原先所有 `WorkflowStateError` 一律返回 `retryable: true`，等于在鼓励模型
 * 对「越权」「等人」这类重试一万次也不会变的错误反复重试。分类之后：
 *
 * - `retry-now`：乐观锁冲突，重读状态后重试同一意图即可
 * - `fix-then-retry`：内容不达标，必须先改内容
 * - `stop`：流程不允许或在等人，重试无意义，应交回编排者
 */
export type WorkflowRetryDisposition = 'retry-now' | 'fix-then-retry' | 'stop'

const RETRY_DISPOSITION: Readonly<Record<string, WorkflowRetryDisposition>> = {
  'workflow.revision.conflict': 'retry-now',
  'workflow.activity.stale': 'retry-now',
  'workflow.focus.stale': 'retry-now',
  'workflow.completion.rejected': 'fix-then-retry',
  'rules.variable.invalid-id': 'fix-then-retry',
  'rules.formula.unknown-function': 'fix-then-retry',
  'rules.formula.invalid-arity': 'fix-then-retry',
  'asset.generation.failed': 'fix-then-retry',
  'asset.pipeline.blocked': 'fix-then-retry',
  'workflow.gate.required': 'stop',
  'workflow.gate.external-only': 'stop',
  'workflow.gate.invalid-state': 'stop',
  'workflow.transition.invalid': 'stop',
  'workflow.capability.denied': 'stop',
  'workflow.write-scope.denied': 'stop',
  'workflow.not-required.denied': 'stop',
  'workflow.activity.invalid': 'stop',
  'workflow.not-initialized': 'retry-now',
  'workflow.missing': 'stop',
}

export function retryDispositionFor(code: string): WorkflowRetryDisposition {
  // 未登记的错误码按 stop 处理：宁可让 Agent 交回人处理，也不要让它盲目重试。
  return RETRY_DISPOSITION[code] ?? 'stop'
}

/** 拒绝时一并回传的可执行下一步，让一次失败等于一次指路而不是一次猜测。 */
export interface WorkflowErrorGuidance {
  currentActivity?: VideoGameActivity
  activeActivities?: VideoGameActivity[]
  groupId?: string
  allowedToolNames?: string[]
  writeScope?: string[]
  missingChecks?: Array<{ checkId: string; message?: string }>
  suggestedNextTool?: string
}

export class WorkflowStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision?: number,
    readonly guidance?: WorkflowErrorGuidance,
  ) {
    super(message)
    this.name = 'WorkflowStateError'
  }

  get retry(): WorkflowRetryDisposition {
    return retryDispositionFor(this.code)
  }
}

/** 由当前状态生成导航信息；调用点只需把 state 传进来。 */
export function guidanceFor(
  state: VideoGameWorkflowState | null,
  activity?: VideoGameActivity,
  missingChecks?: readonly string[],
): WorkflowErrorGuidance | undefined {
  if (!state) return undefined
  const target = activity ?? state.activity
  const contract = activityContract(target)
  const assetTarget = isAssetPipelineActivity(target)
  return {
    currentActivity: target,
    activeActivities: assetTarget
      ? [...state.assetPipeline.activeActivities]
      : [...state.activeGroup.activities],
    groupId: assetTarget ? 'asset-pipeline' : state.activeGroup.id,
    allowedToolNames: [...contract.allowedToolNames],
    writeScope: [...writeScopesFor(target)],
    ...(missingChecks?.length
      ? { missingChecks: missingChecks.map((checkId) => ({ checkId })) }
      : {}),
    suggestedNextTool: contract.allowedToolNames[0],
  }
}

function expectedRevision(input: Record<string, unknown>, current: VideoGameWorkflowState): void {
  const expected = input.expectedWorkflowRevision
  if (expected !== undefined && expected !== current.revision) {
    throw new WorkflowStateError('workflow.revision.conflict', `Workflow revision ${expected} is stale; current revision is ${current.revision}`, current.revision)
  }
}

function activityRecord(state: VideoGameWorkflowState, activity: VideoGameActivity) {
  return state.activities[activity] ?? { revision: 0, status: 'not-started' as const, artifactRefs: [], evidence: [] }
}

function nextRevisionState(
  state: VideoGameWorkflowState,
  patch: Partial<VideoGameWorkflowState>,
  reason?: string,
): VideoGameWorkflowState {
  const revision = state.revision + 1
  const updatedAt = now()
  const next = { ...state, ...patch, revision, updatedAt }
  return {
    ...next,
    history: [
      ...state.history,
      { revision, activity: next.activity, activityRevision: next.activityRevision, status: next.activityStatus, at: updatedAt, ...(reason ? { reason } : {}) },
    ].slice(-200),
  }
}

/**
 * 组模型下的可开启判定。
 *
 * 与单游标时代的区别：并发组里三条线各自 begin，彼此不算「跳步」。
 * 判定只有三种合法情形：
 *   1. 目标属于当前组，且在本 track 里轮到它（前序已交付）——组内推进；
 *   2. 目标属于下一组，且当前组已全部交付——开新组；
 *   3. rework 回退到更早的组。
 */
function canBegin(current: VideoGameWorkflowState, target: VideoGameActivity, rework: boolean): boolean {
  const targetGroup = groupForActivity(target)
  const currentGroupIndex = groupIndex(current.activeGroup.id)
  const targetGroupIndex = groupIndex(targetGroup.id)
  if (rework) return targetGroupIndex >= 0 && targetGroupIndex <= currentGroupIndex

  const status = current.activities[target]?.status
  if (isSettled(status)) return false

  if (targetGroupIndex === currentGroupIndex) {
    // 组内：必须是本 track 当前该跑的那一个，不能越过同 track 的前序活动。
    return activeActivitiesIn(targetGroup, current.activities).includes(target)
  }
  if (targetGroupIndex === currentGroupIndex + 1) {
    const currentGroup = groupForActivity(current.activity)
    if (!isGroupComplete(currentGroup, current.activities)) return false
    return activeActivitiesIn(targetGroup, current.activities).includes(target)
  }
  return false
}

/** 组内某个活动的独立修订号；缺失时按 0 处理，begin 后变成 1。 */
function activityRevisionOf(state: VideoGameWorkflowState, activity: VideoGameActivity): number {
  return state.activities[activity]?.revision ?? 0
}

type AssetReadinessKey = keyof AssetPipelineState['readiness']

function assetReadinessKey(activity: VideoGameActivity): AssetReadinessKey {
  if (activity.startsWith('characters.') || activity === 'assets.character') return 'characters'
  if (activity.startsWith('scenes.') || activity === 'assets.scene') return 'scenes'
  return 'videoPresets'
}

function withAssetPipelineStatus(
  state: VideoGameWorkflowState,
  pipeline: AssetPipelineState,
  activities: VideoGameWorkflowState['activities'] = state.activities,
): AssetPipelineState {
  const candidate = { ...state, activities, assetPipeline: pipeline }
  return { ...pipeline, status: aggregateAssetPipelineStatus(candidate) }
}

function canBeginAsset(
  state: VideoGameWorkflowState,
  activity: VideoGameActivity,
  rework: boolean,
  entityIdBindingRequested: boolean,
): boolean {
  if (!isAssetPipelineActivity(activity)) return false
  if (!isSettled(state.activities['blueprint.outline']?.status)) return false
  const status = state.activities[activity]?.status
  if (!rework && (isSettled(status) || status === 'working')) return false
  const track = assetTrackForActivity(activity)
  const index = track.indexOf(activity)
  if (index < 0) return false
  if (!rework && !track.slice(0, index).every((candidate) => isSettled(state.activities[candidate]?.status))) {
    return false
  }
  if (
    activity === 'characters.modeling'
    && entityIdBindingRequested
    && !isSettled(state.activities['rules.catalog']?.status)
  ) return false
  return true
}

/** 由活动记录重新推导组视图与兼容字段，保证「代表活动」始终与真实状态一致。 */
function groupFields(
  state: VideoGameWorkflowState,
  activities: VideoGameWorkflowState['activities'],
  group: ReturnType<typeof groupForActivity>,
): Pick<VideoGameWorkflowState, 'activity' | 'activityRevision' | 'activityStatus' | 'activeGroup'> {
  const representative = representativeActivity(group, activities)
  return {
    activity: representative,
    activityRevision: activities[representative]?.revision ?? 0,
    activityStatus: activities[representative]?.status ?? 'not-started',
    activeGroup: {
      id: group.id,
      activities: activeActivitiesIn(group, activities),
      status: aggregateGroupStatus(group, activities),
      revision: (state.activeGroup?.revision ?? 0) + 1,
    },
  }
}

function beginAssetActivityState(
  current: VideoGameWorkflowState,
  activity: VideoGameActivity,
  input: Record<string, unknown>,
): VideoGameWorkflowState {
  const rework = input.rework === true
  if (!canBeginAsset(current, activity, rework, input.entityIdBindingRequested === true)) {
    throw new WorkflowStateError(
      'workflow.transition.invalid',
      `Cannot begin asset activity ${activity}`,
      current.revision,
    )
  }
  const at = now()
  const previous = activityRecord(current, activity)
  const activityRevision = previous.revision + 1
  const track = assetTrackForActivity(activity)
  const activityIndex = track.indexOf(activity)
  const invalidated = new Set(track.slice(activityIndex))
  const activities = { ...current.activities }
  if (rework || previous.status === 'blocked') {
    for (const candidate of invalidated) {
      const prior = activities[candidate]
      if (prior) {
        activities[candidate] = {
          ...prior,
          status: 'not-started',
          blocker: undefined,
          evidence: [],
        }
      }
    }
  }
  activities[activity] = {
    revision: activityRevision,
    status: 'working',
    startedAt: at,
    artifactRefs: [],
    evidence: [],
  }
  const activeActivities = current.assetPipeline.activeActivities
    .filter((candidate) => !track.includes(candidate))
  activeActivities.push(activity)
  const readinessKey = assetReadinessKey(activity)
  const pipeline = withAssetPipelineStatus(current, {
    ...current.assetPipeline,
    revision: current.assetPipeline.revision + 1,
    activeActivities,
    blockers: current.assetPipeline.blockers.filter((blocker) => blocker.activity !== activity),
    readiness: {
      ...current.assetPipeline.readiness,
      [readinessKey]: 'working',
    },
  }, activities)
  return nextRevisionState(current, {
    activities,
    assetPipeline: pipeline,
    validationEvidence: rework
      ? current.validationEvidence.filter((item) => !invalidated.has(item.activity))
      : current.validationEvidence,
  }, rework || previous.status === 'blocked' ? 'asset-activity-retrying' : 'asset-activity-began')
}

export async function beginWorkflowActivity(
  context: ExtensionContext,
  input: Record<string, unknown>,
): Promise<VideoGameWorkflowState> {
  const activity = input.activity
  if (!isActivity(activity)) throw new WorkflowStateError('workflow.activity.invalid', 'Unknown video-game activity')
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId) ?? createInitialWorkflowState(context.gameId)
    if (isAssetPipelineActivity(activity)) {
      const next = beginAssetActivityState(current, activity, input)
      await writeState(context, next)
      return next
    }
    const rework = input.rework === true
    // 组内并发 begin 不比全局修订号。
    //
    // 三条线同时开工时，第一条落盘就会让另外两条手里的 expectedWorkflowRevision
    // 过期；而工作流修订号在 notice、focus、门凭据变化时也会跳，本来就不是组内
    // 并发的合适依据。跨组推进仍然要比：那时顺序才真正有意义。
    const withinActiveGroup = !rework
      && groupForActivity(activity).id === current.activeGroup.id
      && activeActivitiesIn(groupForActivity(activity), current.activities).includes(activity)
    if (!withinActiveGroup) expectedRevision(input, current)
    if (!canBegin(current, activity, rework)) {
      throw new WorkflowStateError('workflow.transition.invalid', `Cannot begin ${activity} from ${current.activity}:${current.activityStatus}`, current.revision)
    }
    type GateApproval = {
      gate?: unknown
      evidenceRef?: unknown
      revision?: unknown
      approvedAt?: unknown
    }
    const gateApprovals: GateApproval[] = Array.isArray(input.gateApprovals)
      ? input.gateApprovals.filter((value): value is GateApproval => Boolean(value) && typeof value === 'object')
      : input.gateApproval && typeof input.gateApproval === 'object'
        ? [input.gateApproval as GateApproval]
        : []
    if (gateApprovals.some((approval) => approval.gate === 'pillar')) {
      throw new WorkflowStateError(
        'workflow.gate.external-only',
        'pillar approval can only be recorded by the author confirmation endpoint',
        current.revision,
      )
    }
    const requiredGate = activity === 'document.pillar' ? 'core' : undefined
    const requiredGateAlreadyApproved = requiredGate
      ? current.gates[requiredGate]?.status === 'approved' && Boolean(current.gates[requiredGate]?.evidenceRef)
      : false
    if (requiredGate && !requiredGateAlreadyApproved && !gateApprovals.some((approval) => approval.gate === requiredGate)) {
      throw new WorkflowStateError('workflow.gate.required', `${requiredGate} Author Gate approval evidence is required before ${activity}`, current.revision)
    }
    // 支柱确认门守在功能开发第一步。删除 intake 并把总脉络提前后，这一步是
    // `blueprint.outline`，不再是 `rules.catalog`。
    if (activity === 'blueprint.outline') {
      const pillar = current.gates.pillar
      if (pillar?.status !== 'approved' || !pillar.evidenceRef) {
        throw new WorkflowStateError(
          'workflow.gate.required',
          'A Host-recorded pillar confirmation is required before blueprint.outline',
          current.revision,
        )
      }
    }
    let gates = gateApprovals.reduce<VideoGameWorkflowState['gates']>((all, approval) => {
      if (typeof approval.gate !== 'string') return all
      return {
        ...all,
        [approval.gate]: {
          status: 'approved' as const,
          revision: Number(approval.revision),
          evidenceRef: String(approval.evidenceRef),
          approvedAt: typeof approval.approvedAt === 'string' ? approval.approvedAt : now(),
        },
      }
    }, current.gates)
    // 支柱正文重做后，旧确认不能继续授权新内容。返工会同时清掉下游活动，
    // 并把支柱门重新打开；作者可以继续重做，也可以再次确认最新版本。
    if (rework && activity === 'document.pillar') {
      gates = {
        ...gates,
        pillar: {
          status: 'pending',
          revision: (current.gates.pillar?.revision ?? 0) + 1,
        },
      }
    }
    const at = now()
    const phase = ACTIVITY_PHASE[activity]
    const phaseChanged = phase !== current.productPhase
    const previous = activityRecord(current, activity)
    const activityRevision = previous.revision + 1
    const phaseRevision = phaseChanged || rework
      ? current.phases[phase].revision + 1
      : current.phaseRevision
    const activities = { ...current.activities }
    const targetGroup = groupForActivity(activity)
    // 返工的作用域是「这条 track 的这一步及其后续」加上「后面所有组」。
    // 同组其他 track 的成果保留：数值线返工不该让已经出完的角色图和场景图重跑一遍。
    const reworkTrack = new Set(rework
      ? trackForActivity(activity).slice(trackForActivity(activity).indexOf(activity))
      : [])
    if (rework) {
      const targetGroupIndex = groupIndex(targetGroup.id)
      for (const candidate of MAIN_VIDEO_GAME_ACTIVITIES) {
        const candidateGroupIndex = groupIndex(groupForActivity(candidate).id)
        const laterGroup = candidateGroupIndex > targetGroupIndex
        if (!laterGroup && !reworkTrack.has(candidate)) continue
        const prior = activities[candidate]
        if (prior) activities[candidate] = { ...prior, status: 'not-started', blocker: undefined, evidence: [] }
      }
    }
    activities[activity] = { revision: activityRevision, status: 'working', startedAt: at, artifactRefs: [], evidence: [] }
    const phases = { ...current.phases, [phase]: { revision: phaseRevision, status: 'working' as const, openedAt: at } }
    const next = nextRevisionState(current, {
      productPhase: phase,
      phaseRevision,
      phaseStatus: 'working',
      ...groupFields(current, activities, targetGroup),
      activities,
      phases,
      blockers: current.blockers.filter((blocker) => blocker.activity !== activity),
      gates,
      noticeRevision: current.noticeRevision + 1,
      focus: ACTIVITY_FOCUS[activity]
        ? { location: ACTIVITY_FOCUS[activity]!, reason: 'activity-started', revision: activityRevision }
        : current.focus,
      validationEvidence: rework
        ? current.validationEvidence.filter((evidence) => {
          if (isAssetPipelineActivity(evidence.activity)) return true
          if (reworkTrack.has(evidence.activity)) return false
          return groupIndex(groupForActivity(evidence.activity).id) <= groupIndex(targetGroup.id)
        })
        : current.validationEvidence,
    }, rework ? 'activity-rework' : 'activity-began')
    await writeState(context, next)
    return next
  })
}

/**
 * 隐式 begin：owner peer 第一次动手时由 Host 自动开活动（设计 §9.7.3）。
 *
 * 为什么需要：`canBegin` 是严格的，而「必须先显式 begin」是模型最容易漏的一步。
 * 文档段历史上长期卡在 `brief.collecting`，就是因为没人记得调 begin，最后不得不
 * 加 auto-advance 兜底。与其教模型记住，不如把这一步删掉。
 *
 * 它不是绕过门禁：仍然走 canBegin 与作者门校验，只是不要求调用方显式发起。
 * 返回 null 表示不需要（或不允许）隐式开启，由调用方按原有守卫报错。
 */
export async function ensureActivityStarted(
  context: ExtensionContext,
  activity: VideoGameActivity,
): Promise<VideoGameWorkflowState | null> {
  const state = await readWorkflowState(context)
  if (!state) return null
  const status = state.activities[activity]?.status
  if (status === 'working') return state
  const beginAllowed = isAssetPipelineActivity(activity)
    ? canBeginAsset(state, activity, false, false)
    : canBegin(state, activity, false)
  if (!beginAllowed) return null
  // 已记录的 core 门凭据要显式带上：开始支柱活动的契约要求调用方出示，
  // 而隐式路径没有「调用方」，只能由 Host 代为出示自己已签的凭据。
  const core = state.gates.core
  const gateApproval = activity === 'document.pillar' && core?.status === 'approved'
    ? {
      gateApproval: {
        gate: 'core',
        evidenceRef: core.evidenceRef,
        revision: core.revision,
        approvedAt: core.approvedAt,
      },
    }
    : {}
  try {
    return await beginWorkflowActivity(context, { activity, ...gateApproval })
  } catch {
    // 作者门未过、并发抢先等都是合法失败；交回调用方走正常拒绝路径。
    return null
  }
}

/**
 * 生产写入的统一入口：读状态，必要时隐式 begin（设计 §9.7.3 L3）。
 *
 * 返回的 `activityRevision` 是守卫应当采信的值。如果活动是 Host 在这次调用里
 * 刚刚隐式开启的，调用方无从得知新的修订号——继续要求它匹配，等于把刚删掉的
 * 易错步骤换个错误码再撞一次。
 */
export async function readWorkflowStateForMutation(
  context: ExtensionContext,
  allowedActivities: readonly VideoGameActivity[],
  callerRevision: unknown,
): Promise<{ state: VideoGameWorkflowState | null, activityRevision: unknown }> {
  const state = await readWorkflowState(context)
  if (!state) return { state, activityRevision: callerRevision }
  if (
    state.phaseStatus === 'complete'
    && allowedActivities.every(isAssetPipelineActivity)
  ) {
    return { state, activityRevision: callerRevision }
  }
  const openable = allowedActivities.filter(
    (activity) => isAssetPipelineActivity(activity)
      ? state.assetPipeline.activeActivities.includes(activity)
        || canBeginAsset(state, activity, false, false)
      : state.activeGroup.activities.includes(activity),
  )
  if (openable.some((activity) => state.activities[activity]?.status === 'working')) {
    return { state, activityRevision: callerRevision }
  }
  for (const activity of openable) {
    const started = await ensureActivityStarted(context, activity)
    if (!started) continue
    return { state: started, activityRevision: activityRevisionOf(started, activity) }
  }
  return { state, activityRevision: callerRevision }
}

export async function confirmPillarAuthorGate(
  context: ExtensionContext,
  input: {
    /** @deprecated Author confirmation is revision-independent and idempotent. */
    expectedWorkflowRevision?: number
    productionId: string
  },
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) {
      throw new WorkflowStateError('workflow.missing', 'Video-game workflow has not been initialized')
    }
    // 作者确认是幂等意图，不是基于旧状态写内容。第一次确认已经落盘后，无论流程是否
    // 刚好推进，都应返回同一份凭据；不能让网络重试变成“确认失败”。
    if (current.gates.pillar?.status === 'approved' && current.gates.pillar.evidenceRef) {
      return current
    }
    if (current.activities['document.pillar']?.status !== 'complete') {
      throw new WorkflowStateError(
        'workflow.gate.invalid-state',
        'Pillar confirmation requires document.pillar to be complete',
        current.revision,
      )
    }
    const approvedAt = now()
    const evidenceRef = `author:pillar:${randomUUID()}`
    const gateRevision = (current.gates.pillar?.revision ?? 0) + 1
    const next = nextRevisionState(current, {
      gates: {
        ...current.gates,
        pillar: {
          status: 'approved',
          revision: gateRevision,
          evidenceRef,
          approvedAt,
        },
      },
      noticeRevision: current.noticeRevision + 1,
      focus: {
        location: { kind: 'document', documentType: 'pillar' },
        reason: 'user-action-required',
        revision: current.activityRevision,
      },
    }, `author-gate-approved:${input.productionId}`)
    await writeState(context, next)
    return next
  })
}

/**
 * 作者在三方案里选定方向 = core 门通过。凭据由 Host 生成,因为这是作者经由 Host
 * 端点做出的真实动作;此前只有 Agent 能通过 `begin_activity` 的 gateApproval 记录
 * 它，而 Agent 从不调那个工具，于是 core 门永远 pending、`document.pillar` 永远
 * 开不了、支柱确认永远 400。
 */
export async function recordCoreSelectionGate(
  context: ExtensionContext,
  input: { optionId: string },
): Promise<VideoGameWorkflowState | null> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) return null
    if (current.gates.core?.status === 'approved') return current
    const next = nextRevisionState(current, {
      gates: {
        ...current.gates,
        core: {
          status: 'approved',
          revision: (current.gates.core?.revision ?? 0) + 1,
          evidenceRef: `author:core:${randomUUID()}`,
          approvedAt: now(),
        },
      },
      noticeRevision: current.noticeRevision + 1,
    }, `author-gate-approved:core:${input.optionId}`)
    await writeState(context, next)
    return next
  })
}

function mergeArtifacts(current: readonly ArtifactRef[], additions: readonly ArtifactRef[]): ArtifactRef[] {
  const byKey = new Map(current.map((ref) => [`${ref.kind}:${ref.id}`, ref]))
  additions.forEach((ref) => byKey.set(`${ref.kind}:${ref.id}`, ref))
  return [...byKey.values()]
}

/** 需求契约的长度上限：它是生产输入记录，不是第二份策划文档（设计 §9.10.3）。 */
const RAW_INTENT_MAX = 2000
const DIMENSION_VALUE_MAX = 500
const DIMENSION_MAX = 12
const INQUIRY_ANSWER_COUNT = 5
const INQUIRY_QUESTION_MAX = 300
const INQUIRY_ANSWER_MAX = 500

/**
 * 归一化需求契约：只留结构化字段与原始首句，超长截断并置位 `truncated`。
 *
 * 编排者收集答案但不获得写文档能力，所以规范化与截断都由 Host 做，
 * 避免同一份需求在不同会话里长成不同形状。
 */
export function normalizeRequirementContract(input: unknown): RequirementContract | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  const rawIntentValue = typeof source.rawIntent === 'string' ? source.rawIntent.trim() : ''
  if (!rawIntentValue) return null
  let truncated = rawIntentValue.length > RAW_INTENT_MAX
  const dimensions: RequirementContract['dimensions'] = {}
  const entries = source.dimensions && typeof source.dimensions === 'object'
    ? Object.entries(source.dimensions as Record<string, unknown>).slice(0, DIMENSION_MAX)
    : []
  if (Object.keys(source.dimensions ?? {}).length > DIMENSION_MAX) truncated = true
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue
    const dimension = value as Record<string, unknown>
    const text = typeof dimension.value === 'string' ? dimension.value : ''
    if (text.length > DIMENSION_VALUE_MAX) truncated = true
    dimensions[key] = {
      value: text.slice(0, DIMENSION_VALUE_MAX),
      source: dimension.source === 'author' || dimension.source === 'inferred' || dimension.source === 'default'
        ? dimension.source
        : 'inferred',
    }
  }
  const style = source.visualStyle && typeof source.visualStyle === 'object'
    ? source.visualStyle as Record<string, unknown>
    : null
  return {
    schemaVersion: 1,
    rawIntent: rawIntentValue.slice(0, RAW_INTENT_MAX),
    dimensions,
    ...(style && typeof style.id === 'string' && typeof style.name === 'string'
      ? { visualStyle: { id: style.id, name: style.name } }
      : {}),
    locale: typeof source.locale === 'string' && source.locale ? source.locale : 'zh-CN',
    collectedAt: now(),
    ...(truncated ? { truncated: true } : {}),
  }
}

/**
 * 归一化核心方案前的补充问询。它与基础需求分开保存，避免重排时序时误删
 * 原问询，也避免为了留存答案重新引入没有作者入口的 inquiry 文档。
 */
export function normalizeInquiryContract(input: unknown): InquiryContract | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Record<string, unknown>
  if (!Array.isArray(source.answers) || source.answers.length !== INQUIRY_ANSWER_COUNT) return null

  let truncated = false
  const answers: InquiryContract['answers'] = []
  for (const item of source.answers) {
    if (!item || typeof item !== 'object') return null
    const answer = item as Record<string, unknown>
    const question = typeof answer.question === 'string' ? answer.question.trim() : ''
    const value = typeof answer.answer === 'string' ? answer.answer.trim() : ''
    if (!question || !value) return null
    if (question.length > INQUIRY_QUESTION_MAX || value.length > INQUIRY_ANSWER_MAX) truncated = true
    answers.push({
      question: question.slice(0, INQUIRY_QUESTION_MAX),
      answer: value.slice(0, INQUIRY_ANSWER_MAX),
    })
  }

  return {
    schemaVersion: 1,
    answers,
    collectedAt: now(),
    ...(truncated ? { truncated: true } : {}),
  }
}

function completeAssetActivityState(
  current: VideoGameWorkflowState,
  report: CompletionReport,
  evidence: ValidationEvidence[],
  notRequiredAuthorized: boolean,
): VideoGameWorkflowState {
  const completing = report.activity
  if (!current.assetPipeline.activeActivities.includes(completing)) {
    throw new WorkflowStateError(
      'workflow.activity.stale',
      `${completing} is not active in the asset pipeline`,
      current.revision,
    )
  }
  if (report.activityRevision !== activityRevisionOf(current, completing)) {
    throw new WorkflowStateError(
      'workflow.activity.stale',
      'Completion report does not match the current asset activity revision',
      current.revision,
    )
  }
  if (report.notRequired && !notRequiredAuthorized) {
    throw new WorkflowStateError('workflow.not-required.denied', `${completing} cannot be skipped`, current.revision)
  }
  const contract = activityContract(completing)
  const passed = new Set(evidence
    .filter((item) => item.status === 'pass' || item.status === 'not-required' || item.status === 'warn')
    .map((item) => item.checkId))
  const missing = expandCheckIds(contract.hardChecks).filter((check) => !passed.has(check))
  if (!report.notRequired && missing.length > 0) {
    throw new WorkflowStateError(
      'workflow.completion.rejected',
      `Missing passing evidence: ${missing.join(', ')}`,
      current.revision,
      guidanceFor(current, completing, missing),
    )
  }
  const at = now()
  const status: ActivityStatus = report.notRequired ? 'not-required' : 'complete'
  const activities = {
    ...current.activities,
    [completing]: {
      ...activityRecord(current, completing),
      status,
      completedAt: at,
      artifactRefs: report.artifactRefs,
      evidence,
      blocker: undefined,
    },
  }
  const track = assetTrackForActivity(completing)
  const index = track.indexOf(completing)
  const following = track[index + 1]
  const activeActivities = current.assetPipeline.activeActivities
    .filter((activity) => activity !== completing)
  if (following && !isSettled(activities[following]?.status)) activeActivities.push(following)
  const readinessKey = assetReadinessKey(completing)
  const pipeline = withAssetPipelineStatus(current, {
    ...current.assetPipeline,
    revision: current.assetPipeline.revision + 1,
    activeActivities: [...new Set(activeActivities)],
    blockers: current.assetPipeline.blockers.filter((blocker) => blocker.activity !== completing),
    readiness: {
      ...current.assetPipeline.readiness,
      [readinessKey]: following ? 'working' : 'ready',
    },
  }, activities)
  return nextRevisionState(current, {
    activities,
    assetPipeline: pipeline,
    artifactRefs: mergeArtifacts(current.artifactRefs, report.artifactRefs),
    validationEvidence: [...current.validationEvidence, ...evidence].slice(-500),
  }, 'asset-activity-completed')
}

export async function completeWorkflowActivity(
  context: ExtensionContext,
  report: CompletionReport,
  evidence: ValidationEvidence[],
  options: {
    notRequiredAuthorized?: boolean
    requirementContract?: unknown
    inquiryContract?: unknown
  } = {},
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) throw new WorkflowStateError('workflow.not-initialized', 'Call get-workflow-state first')
    // Host 在 upsert 时可能已经把活动 complete。peer 按 prompt 再打一次
    // complete_activity 时，活动已不在活跃集合里——那是重放，不是过期。
    if (isSettled(current.activities[report.activity]?.status)) return current
    if (isAssetPipelineActivity(report.activity)) {
      const next = completeAssetActivityState(
        current,
        report,
        evidence,
        options.notRequiredAuthorized === true,
      )
      await writeState(context, next)
      return next
    }
    // 并发下修订号下沉到活动：一条线完成不会让另一条线手里的修订号变 stale。
    if (!current.activeGroup.activities.includes(report.activity)) {
      throw new WorkflowStateError(
        'workflow.activity.stale',
        `${report.activity} is not active in group ${current.activeGroup.id}`,
        current.revision,
      )
    }
    if (report.activityRevision !== activityRevisionOf(current, report.activity)) {
      throw new WorkflowStateError('workflow.activity.stale', 'Completion report does not match the current activity revision', current.revision)
    }
    const completing = report.activity
    const contract = activityContract(completing)
    if (report.notRequired && !options.notRequiredAuthorized) {
      throw new WorkflowStateError('workflow.not-required.denied', `${completing} cannot be skipped`, current.revision)
    }
    const passed = new Set(evidence
      .filter((item) => item.status === 'pass' || item.status === 'not-required' || item.status === 'warn')
      .map((item) => item.checkId))
    const requiredLeafChecks = expandCheckIds(contract.hardChecks)
    const missing = requiredLeafChecks.filter((check) => !passed.has(check))
    if (!report.notRequired && missing.length) {
      // 缺哪些检查要结构化回传，不能只塞在 message 里让模型去猜。
      throw new WorkflowStateError(
        'workflow.completion.rejected',
        `Missing passing evidence: ${missing.join(', ')}`,
        current.revision,
        guidanceFor(current, completing, missing),
      )
    }
    const at = now()
    const status: ActivityStatus = report.notRequired ? 'not-required' : 'complete'
    const artifacts = mergeArtifacts(current.artifactRefs, report.artifactRefs)
    const activities = {
      ...current.activities,
      [completing]: {
        ...activityRecord(current, completing),
        status,
        completedAt: at,
        artifactRefs: report.artifactRefs,
        evidence,
        blocker: undefined,
      },
    }
    // 组内还有别的 track 在跑时，阶段不能算完；只有整组交付才推进阶段。
    const group = groupForActivity(completing)
    const groupDone = isGroupComplete(group, activities)
    const following = groupDone ? nextGroup(group.id) : undefined
    const followingActivity = following?.tracks[0]?.[0]
    const phaseCompletes = groupDone
      && (!followingActivity || ACTIVITY_PHASE[followingActivity] !== current.productPhase)
    const phaseStatus = phaseCompletes ? 'complete' : 'working'
    const phases = {
      ...current.phases,
      [current.productPhase]: {
        ...current.phases[current.productPhase],
        status: phaseStatus,
        ...(phaseCompletes ? { completedAt: at } : {}),
      },
    }
    // 需求契约在 `brief.collecting` 完成时落到生产平面：删除 intake 文档后，
    // 它是需求唯一的留存形态，也是跨会话返工的依据（设计 §9.10.3）。
    const requirementContract = completing === 'brief.collecting'
      ? normalizeRequirementContract(options.requirementContract)
      : null
    const inquiryContract = completing === 'document.inquiry'
      ? normalizeInquiryContract(options.inquiryContract)
      : null
    if (completing === 'document.inquiry' && !inquiryContract) {
      throw new WorkflowStateError(
        'workflow.inquiry.invalid',
        'document.inquiry requires exactly five non-empty question and answer pairs',
        current.revision,
      )
    }
    // 蓝图可玩性审查不是视频试玩。即使模型在 completion report 里误填 play focus，
    // Host 也必须把作者留在蓝图，而不是把逻辑模拟解释成打开试玩页。
    const completionFocus = completing === 'playtest.validating'
      ? ACTIVITY_FOCUS[completing]
      : report.suggestedFocus
    const next = nextRevisionState(current, {
      ...groupFields(current, activities, group),
      phaseStatus,
      phases,
      activities,
      artifactRefs: artifacts,
      validationEvidence: [...current.validationEvidence, ...evidence].slice(-500),
      blockers: current.blockers.filter((blocker) => blocker.activity !== completing),
      noticeRevision: current.noticeRevision + 1,
      ...(requirementContract ? { requirementContract } : {}),
      ...(inquiryContract ? { inquiryContract } : {}),
      ...(completionFocus ? { focus: { location: completionFocus, reason: 'artifact-created', revision: report.activityRevision } } : {}),
    }, 'activity-completed')
    await writeState(context, next)
    return next
  })
}

/**
 * 并发下「当前活动」不再唯一，所以需要解析调用方指的是哪条线。
 * 显式给了 activity 就用它（必须在活跃集合内），否则回落到代表活动。
 */
export function activeActivityOf(
  state: VideoGameWorkflowState,
  activity: unknown,
  activityRevision?: unknown,
): VideoGameActivity {
  if (!isActivity(activity) && Number.isSafeInteger(activityRevision)) {
    const candidates = [
      ...state.activeGroup.activities,
      ...state.assetPipeline.activeActivities,
    ].filter((candidate) => activityRevisionOf(state, candidate) === activityRevision)
    if (candidates.length === 1) return candidates[0]!
  }
  return resolveActiveActivity(state, activity)
}

/**
 * 已交付（complete / not-required）的活动。
 *
 * upsert 后 Host 会自己 complete；peer 仍会带着这个活动名来 validate / complete。
 * 调用方用它短路成幂等成功，而不是走「不在活跃集合 → stale」。
 */
export function settledActivityOf(
  state: VideoGameWorkflowState,
  activity: unknown,
): VideoGameActivity | null {
  const target = isActivity(activity) ? activity : state.activity
  return isSettled(state.activities[target]?.status) ? target : null
}

function resolveActiveActivity(
  current: VideoGameWorkflowState,
  activity: unknown,
): VideoGameActivity {
  if (isActivity(activity)) {
    const active = isAssetPipelineActivity(activity)
      ? current.assetPipeline.activeActivities.includes(activity)
      : current.activeGroup.activities.includes(activity)
    if (!active) {
      throw new WorkflowStateError(
        'workflow.activity.stale',
        `${activity} is not active in its workflow lane`,
        current.revision,
      )
    }
    return activity
  }
  return current.activity
}

export async function reportWorkflowBlocker(
  context: ExtensionContext,
  input: { activityRevision: number; code: string; message: string; retryable: boolean; location?: PageLocation; activity?: VideoGameActivity },
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) throw new WorkflowStateError('workflow.not-initialized', 'Call get-workflow-state first')
    const target = resolveActiveActivity(current, input.activity)
    if (input.activityRevision !== activityRevisionOf(current, target)) throw new WorkflowStateError('workflow.activity.stale', 'Blocker targets a stale activity revision', current.revision)
    const { activity: _ignored, ...blockerInput } = input
    const blocker: WorkflowBlocker = { ...blockerInput, activity: target, createdAt: now() }
    const activities = {
      ...current.activities,
      [target]: { ...activityRecord(current, target), status: 'blocked' as const, blocker },
    }
    if (isAssetPipelineActivity(target)) {
      const readinessKey = assetReadinessKey(target)
      const pipeline = withAssetPipelineStatus(current, {
        ...current.assetPipeline,
        revision: current.assetPipeline.revision + 1,
        blockers: [
          ...current.assetPipeline.blockers.filter((item) => item.activity !== target),
          blocker,
        ],
        readiness: {
          ...current.assetPipeline.readiness,
          [readinessKey]: 'failed',
        },
      }, activities)
      const next = nextRevisionState(current, {
        activities,
        assetPipeline: pipeline,
      }, 'asset-activity-blocked')
      await writeState(context, next)
      return next
    }
    const phases = { ...current.phases, [current.productPhase]: { ...current.phases[current.productPhase], status: 'blocked' as const } }
    const next = nextRevisionState(current, {
      ...groupFields(current, activities, groupForActivity(target)),
      // 一条线受阻即整组受阻：其他 track 可以跑完手上的活动，但不得开下一组。
      activityStatus: 'blocked', phaseStatus: 'blocked', activities, phases,
      blockers: [...current.blockers.filter((item) => item.activity !== target), blocker],
      noticeRevision: current.noticeRevision + 1,
      ...(input.location ? { focus: { location: input.location, reason: 'validation-failed', revision: activityRevisionOf(current, target) } } : {}),
    }, 'activity-blocked')
    await writeState(context, next)
    return next
  })
}

/**
 * Reconcile a terminal business-side peer failure without coupling the Host
 * to a particular Agent kernel. A peer can mutate the Host without creating
 * files, so this path is intentionally keyed by the opaque production id and
 * the Host's current workflow state.
 *
 * The operation is idempotent: once the target activity is complete, awaiting
 * user, or blocked, a late lifecycle event cannot regress it or create another
 * blocker revision.
 */
export async function reconcileProductionFailure(
  context: ExtensionContext,
  input: {
    productionId: string
    reason: string
    retryable?: boolean
    activity?: VideoGameActivity
    activityRevision?: number
  },
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) throw new WorkflowStateError('workflow.not-initialized', 'Call get-workflow-state first')

    // The current adapter has a reliable correlation for the integration peer
    // only. Do not let a late terminal event from an older modeling/assets peer
    // block an unrelated current activity until that product adds an explicit
    // activity correlation.
    if (!input.activity && current.activity !== 'game.finalizing') return current
    const target = input.activity ?? current.activity
    const assetTarget = isAssetPipelineActivity(target)
    if (assetTarget) {
      if (input.activityRevision !== activityRevisionOf(current, target)) return current
      if (!current.assetPipeline.activeActivities.includes(target)) return current
    } else if (!current.activeGroup.activities.includes(target)) {
      return current
    }
    const record = activityRecord(current, target)
    if (record.status !== 'working') return current
    if (
      !assetTarget
      &&
      current.productionRefs.length > 0
      && !current.productionRefs.includes(input.productionId)
    ) {
      return current
    }

    const activityRevision = activityRevisionOf(current, target)
    const blocker: WorkflowBlocker = {
      code: 'production.peer.rejected',
      message: `Production ${input.productionId} failed: ${input.reason}`,
      retryable: input.retryable ?? true,
      activity: target,
      activityRevision,
      createdAt: now(),
    }
    const activities = {
      ...current.activities,
      [target]: { ...record, status: 'blocked' as const, blocker },
    }
    if (assetTarget) {
      const readinessKey = assetReadinessKey(target)
      const pipeline = withAssetPipelineStatus(current, {
        ...current.assetPipeline,
        revision: current.assetPipeline.revision + 1,
        blockers: [
          ...current.assetPipeline.blockers.filter((item) => item.activity !== target),
          blocker,
        ],
        readiness: {
          ...current.assetPipeline.readiness,
          [readinessKey]: 'failed',
        },
      }, activities)
      const next = nextRevisionState(current, {
        activities,
        assetPipeline: pipeline,
        productionRefs: [...new Set([...current.productionRefs, input.productionId])],
      }, 'asset-production-peer-rejected')
      await writeState(context, next)
      return next
    }
    const phases = {
      ...current.phases,
      [current.productPhase]: {
        ...current.phases[current.productPhase],
        status: 'blocked' as const,
      },
    }
    const next = nextRevisionState(current, {
      ...groupFields(current, activities, groupForActivity(target)),
      activityStatus: 'blocked',
      phaseStatus: 'blocked',
      activities,
      phases,
      productionRefs: [...new Set([...current.productionRefs, input.productionId])],
      blockers: [
        ...current.blockers.filter((item) => item.activity !== target),
        blocker,
      ],
      noticeRevision: current.noticeRevision + 1,
    }, 'production-peer-rejected')
    await writeState(context, next)
    return next
  })
}

/**
 * Reconcile a peer-abandonment situation: the peer that owned `activity` has
 * ended (agentic_os `sub_agent subtype=done`) but the activity is still in
 * `working` state, meaning the peer left without calling `complete_activity`
 * or `report_blocker`. This is the defense-in-depth against the workflow
 * deadlock reproduced in bug 01a01e46 (2026-08-20): integration peer exited
 * mid-way, leaving `rules.binding / working / revision=74` frozen for 6 min.
 *
 * Idempotent: only writes a blocker when the target activity is still
 * `working`. Concurrent or late events on the same activity revision become
 * no-ops. Circuit breaker: if the same activity has already accumulated
 * >= `MAX_PEER_ABANDONED_RETRIES` blockers with this code, subsequent calls
 * force `retryable=false` so the main agent routes to `report_blocker` instead
 * of an infinite retry loop.
 *
 * Deliberately does NOT extend the ActivityStatus enum (no `failed` state).
 * Reusing `blocked + WorkflowBlocker` keeps downstream consumers
 * (aggregateGroupStatus / isSettled / projectWorkflowState / RETRY_DISPOSITION)
 * intact.
 */
export async function markPeerAbandonedActivity(
  context: ExtensionContext,
  input: {
    peerId: string
    activity: VideoGameActivity
    reason?: string
    lastToolName?: string
    activityRevision?: number
  },
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) throw new WorkflowStateError('workflow.not-initialized', 'Call get-workflow-state first')

    const target = input.activity
    const assetTarget = isAssetPipelineActivity(target)
    if (assetTarget) {
      if (
        input.activityRevision !== undefined
        && input.activityRevision !== activityRevisionOf(current, target)
      ) {
        return current
      }
      if (!current.assetPipeline.activeActivities.includes(target)) return current
    } else if (!current.activeGroup.activities.includes(target)) {
      return current
    }

    const record = activityRecord(current, target)
    if (record.status !== 'working') return current

    if (
      input.activityRevision !== undefined
      && input.activityRevision !== activityRevisionOf(current, target)
    ) {
      return current
    }

    const activityRevision = activityRevisionOf(current, target)
    const existingBlockers = assetTarget ? current.assetPipeline.blockers : current.blockers
    // Circuit-break based on cumulative peer.completed-without-progress blockers
    // for this activity across revisions. Do NOT filter by activityRevision:
    // each retry gets a new revision, so history would always look like 1.
    const priorAbandonedCount = existingBlockers.filter(
      (b) => b.activity === target && b.code === 'peer.completed-without-progress',
    ).length
    const shouldSuppressRetry = priorAbandonedCount + 1 >= MAX_PEER_ABANDONED_RETRIES

    const reason = input.reason?.trim() || 'peer exited without completing or reporting the activity'
    const lastToolFragment = input.lastToolName ? ` (last tool: ${input.lastToolName})` : ''
    const blocker: WorkflowBlocker = {
      code: 'peer.completed-without-progress',
      message: `Peer ${input.peerId} abandoned ${target}: ${reason}${lastToolFragment}`,
      retryable: !shouldSuppressRetry,
      activity: target,
      activityRevision,
      createdAt: now(),
    }
    const activities = {
      ...current.activities,
      [target]: { ...record, status: 'blocked' as const, blocker },
    }

    // Dedup by (activity, activityRevision): the same peer/turn may fire the
    // reconcile event more than once (retry, replay). Older blockers on the
    // same activity but earlier activityRevision are retained for the counter.
    const filterKey = (item: WorkflowBlocker) =>
      !(item.activity === target && item.activityRevision === activityRevision)

    if (assetTarget) {
      const readinessKey = assetReadinessKey(target)
      const pipeline = withAssetPipelineStatus(current, {
        ...current.assetPipeline,
        revision: current.assetPipeline.revision + 1,
        blockers: [
          ...current.assetPipeline.blockers.filter(filterKey),
          blocker,
        ],
        readiness: {
          ...current.assetPipeline.readiness,
          [readinessKey]: 'failed',
        },
      }, activities)
      const next = nextRevisionState(current, {
        activities,
        assetPipeline: pipeline,
      }, 'asset-peer-abandoned')
      await writeState(context, next)
      return next
    }

    const phases = {
      ...current.phases,
      [current.productPhase]: {
        ...current.phases[current.productPhase],
        status: 'blocked' as const,
      },
    }
    const next = nextRevisionState(current, {
      ...groupFields(current, activities, groupForActivity(target)),
      activityStatus: 'blocked',
      phaseStatus: 'blocked',
      activities,
      phases,
      blockers: [
        ...current.blockers.filter(filterKey),
        blocker,
      ],
      noticeRevision: current.noticeRevision + 1,
    }, 'peer-abandoned')
    await writeState(context, next)
    return next
  })
}

const MAX_PEER_ABANDONED_RETRIES = 3

export async function awaitWorkflowUser(
  context: ExtensionContext,
  input: { activityRevision: number; reason: string; location?: PageLocation; activity?: VideoGameActivity },
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) throw new WorkflowStateError('workflow.not-initialized', 'Call get-workflow-state first')
    const target = resolveActiveActivity(current, input.activity)
    if (isAssetPipelineActivity(target)) {
      throw new WorkflowStateError(
        'workflow.transition.invalid',
        'Asset-pipeline activities cannot await author input',
        current.revision,
      )
    }
    if (input.activityRevision !== activityRevisionOf(current, target)) {
      throw new WorkflowStateError(
        'workflow.activity.stale',
        'Await-user intent targets a stale activity revision',
        current.revision,
      )
    }
    if (current.activities[target]?.status !== 'working') {
      throw new WorkflowStateError(
        'workflow.transition.invalid',
        `Cannot await user from ${target}:${current.activities[target]?.status ?? 'not-started'}`,
        current.revision,
      )
    }
    const activities = {
      ...current.activities,
      [target]: {
        ...activityRecord(current, target),
        status: 'awaiting-user' as const,
      },
    }
    const phases = {
      ...current.phases,
      [current.productPhase]: {
        ...current.phases[current.productPhase],
        status: 'awaiting-user' as const,
      },
    }
    const next = nextRevisionState(current, {
      ...groupFields(current, activities, groupForActivity(target)),
      activityStatus: 'awaiting-user',
      phaseStatus: 'awaiting-user',
      activities,
      phases,
      noticeRevision: current.noticeRevision + 1,
      ...(input.location
        ? { focus: { location: input.location, reason: 'user-action-required' as const, revision: activityRevisionOf(current, target) } }
        : {}),
    }, input.reason)
    await writeState(context, next)
    return next
  })
}

export async function setWorkflowFocus(
  context: ExtensionContext,
  input: { activityRevision: number; location: PageLocation; reason?: NonNullable<VideoGameWorkflowState['focus']>['reason'] },
): Promise<VideoGameWorkflowState> {
  return context.files.withLocks([WORKFLOW_LOCK], async () => {
    const current = parseState(await context.files.read(VIDEO_GAME_WORKFLOW_FILE), context.gameId)
    if (!current) throw new WorkflowStateError('workflow.not-initialized', 'Call get-workflow-state first')
    // Asset-lane navigation is intentionally not the main workflow focus.
    // Persisting it here would make a late preview/repair steal the author's
    // blueprint/rules location after the playable blueprint was delivered.
    if (input.location.kind === 'asset') return current
    if (input.activityRevision !== current.activityRevision) throw new WorkflowStateError('workflow.focus.stale', 'Focus intent targets a stale activity revision', current.revision)
    if (
      current.activeGroup.activities.includes('playtest.validating')
      && input.location.kind === 'play'
    ) {
      throw new WorkflowStateError(
        'workflow.focus.playtest-denied',
        'Blueprint playability review cannot open Play; keep focus on the blueprint',
        current.revision,
      )
    }
    const next = nextRevisionState(current, {
      focus: { location: input.location, reason: input.reason ?? 'artifact-created', revision: input.activityRevision },
    }, 'focus-updated')
    await writeState(context, next)
    return next
  })
}

function activityModule(activity: VideoGameActivity): string | undefined {
  if (activity.startsWith('document.')) return activity
  if (activity === 'rules.catalog') return 'rules'
  if (activity === 'rules.binding') return 'blueprint'
  if (activity === 'characters.modeling' || activity === 'characters.previewing' || activity === 'assets.character') return 'character'
  if (activity === 'scenes.modeling' || activity === 'scenes.previewing' || activity === 'assets.scene') return 'scene'
  if (activity === 'blueprint.outline' || activity === 'ui.authoring' || activity === 'game.finalizing' || activity === 'playtest.validating') return 'blueprint'
  if (activity.startsWith('video.')) return 'video'
  return undefined
}

/**
 * 下一步还缺哪道作者门。活动本身已经 complete，但流程其实停着等人点按钮——
 * 不把这件事表达出来，提示条就会一直显示「生成中…」，让作者以为 AI 在干活。
 * 这也是为什么在聊天里打字说「确认支柱」不会让状态推进:支柱门按设计只能由
 * 作者经 Host 端点确认（Agent 不得自签策划结论），所以正确的反馈
 * 是把「在等你」显式说出来。
 *
 * 这里的门禁规则必须与 beginWorkflowActivity 一致；有测试同时断言两侧，
 * 避免两处各写一遍后走散。
 */
/** 组内下一批未交付活动；本组交付完则取下一组每条并行 track 的第一个。 */
function nextActivitiesOf(state: VideoGameWorkflowState): VideoGameActivity[] {
  if (isAssetPipelineActivity(state.activity)) return []
  const group = groupForActivity(state.activity)
  const pending = activeActivitiesIn(group, state.activities)
    .filter((activity) => activity !== state.activity)
  if (pending.length > 0) return pending
  if (!isGroupComplete(group, state.activities)) return []
  return (nextGroup(group.id)?.tracks ?? [])
    .map((track) => track[0])
    .filter((activity): activity is VideoGameActivity => activity !== undefined)
}

/** Notice 协议仍保留一个代表活动；并行组开始后另由 activeActivities 表达全部轨道。 */
function nextActivityOf(state: VideoGameWorkflowState): VideoGameActivity | undefined {
  return nextActivitiesOf(state)[0]
}

function pendingAuthorGate(
  state: VideoGameWorkflowState,
): 'core' | 'pillar' | undefined {
  if (isAssetPipelineActivity(state.activity)) return undefined
  const group = groupForActivity(state.activity)
  const next = activeActivitiesIn(group, state.activities)[0]
    ?? (isGroupComplete(group, state.activities) ? nextGroup(group.id)?.tracks[0]?.[0] : undefined)
  if (next === 'document.pillar') {
    return state.gates.core?.status === 'approved' ? undefined : 'core'
  }
  if (next === 'blueprint.outline') {
    const pillar = state.gates.pillar
    return pillar?.status === 'approved' ? undefined : 'pillar'
  }
  return undefined
}

export function projectWorkflowState(
  state: VideoGameWorkflowState,
  inventory: ContentInventory = EMPTY_CONTENT_INVENTORY,
): ProductionProjection {
  const blocked = state.activityStatus === 'blocked'
  const awaitingGate = pendingAuthorGate(state)
  const settledNow = state.activityStatus === 'complete' || state.activityStatus === 'not-required'
  // 侧栏按活动历史单调解锁：到达过的模块即使当前为空、等待作者或发生返工也继续可见；
  // 尚未真正 begin 的 upcoming 活动不提前露出入口。策划文档的二级菜单由各自活动解锁；
  // 功能开发的蓝图/规则/界面/资产库按产品阶段整组解锁；资产库内部始终整体展示。
  const activityReached = (activity: VideoGameActivity): boolean => {
    const record = state.activities[activity]
    if (activity === 'brief.collecting') return !!record && record.status !== 'not-started'
    return (record?.revision ?? 0) > 0
  }
  const currentPhaseIndex = PRODUCT_PHASES.indexOf(state.productPhase)
  const phaseReached = (phase: ProductPhase): boolean => state.phases[phase].status !== 'not-started'
    || (state.phaseStatus !== 'not-started' && currentPhaseIndex >= PRODUCT_PHASES.indexOf(phase))
  const featureDevelopmentReached = phaseReached('feature-development')
  const workflowComplete = state.phaseStatus === 'complete'
    && (isAssetPipelineActivity(state.activity)
      || (isGroupComplete(groupForActivity(state.activity), state.activities)
        && nextGroup(groupForActivity(state.activity).id) === undefined))
  // activeGroup 在活动间隙也可能预告下一活动；只有活动记录真的进入执行/等待/阻塞态，
  // 才能把对应侧栏入口标成 working/blocked。首句前的 brief 不能把空文档目录标成生成中。
  const activeProductionActivities = state.activeGroup.activities.filter((activity) => {
    const status = activityRecord(state, activity).status
    return status === 'working' || status === 'awaiting-user' || status === 'blocked'
  })
  // 并发下同时可能有三个模块在跑，不能假设只有一个 workingModule。
  const workingModules = new Set(
    activeProductionActivities.map((activity) => activityModule(activity)).filter(Boolean) as string[],
  )
  const activeAssetProductionActivities = state.assetPipeline.activeActivities.filter((activity) => {
    const status = activityRecord(state, activity).status
    return status === 'working' || status === 'blocked'
  })
  const activeAssetModules = new Set(
    activeAssetProductionActivities
      .map((activity) => activityModule(activity))
      .filter(Boolean) as string[],
  )
  const assetBlockerFor = (key?: 'character' | 'scene' | 'video'): WorkflowBlocker | undefined => (
    [...state.assetPipeline.blockers].reverse().find((blocker) => (
      key === undefined || activityModule(blocker.activity) === key
    ))
  )
  const assetAvailability = (
    key: 'character' | 'scene' | 'video',
  ): ProductionProjection['modules'][string]['availability'] | undefined => {
    const readiness = key === 'character'
      ? state.assetPipeline.readiness.characters
      : key === 'scene'
        ? state.assetPipeline.readiness.scenes
        : state.assetPipeline.readiness.videoPresets
    if (readiness === 'failed' || assetBlockerFor(key)) return 'blocked'
    if (readiness === 'working' || activeAssetModules.has(key)) return 'working'
    if (readiness === 'ready') return 'ready'
    return undefined
  }
  const aggregateAssetAvailability = (): ProductionProjection['modules'][string]['availability'] | undefined => {
    if (state.assetPipeline.blockers.length > 0 || state.assetPipeline.status === 'blocked') return 'blocked'
    if (state.assetPipeline.status === 'working' || state.assetPipeline.status === 'partial') return 'working'
    if (state.assetPipeline.status === 'ready') return 'ready'
    return undefined
  }
  const module = (
    key: string,
    count: number,
    forceWorking = workingModules.has(key),
    revealed = false,
    revealFromContent = true,
  ) => ({
    availability: (blocked && forceWorking
      ? 'blocked'
      : forceWorking
        ? 'working'
        : (revealFromContent && count > 0) || revealed
          ? 'ready'
          : 'hidden') as ProductionProjection['modules'][string]['availability'],
    ...(count > 0 ? { count } : {}),
    ...(blocked && forceWorking && state.blockers.at(-1) ? { blockerCode: state.blockers.at(-1)!.code } : {}),
  })
  const assetModule = (
    key: 'assets' | 'character' | 'scene' | 'video',
    count: number,
    revealed: boolean,
  ) => {
    const availability = key === 'assets'
      ? aggregateAssetAvailability()
      : assetAvailability(key)
    const blocker = key === 'assets' ? assetBlockerFor() : assetBlockerFor(key)
    return {
      availability: availability
        ?? (revealed || count > 0 ? 'ready' : 'hidden'),
      ...(count > 0 ? { count } : {}),
      ...(availability === 'blocked' && blocker ? { blockerCode: blocker.code } : {}),
    } satisfies ProductionProjection['modules'][string]
  }
  const documentCount = Object.values(inventory.documents).reduce((sum, count) => sum + (count ?? 0), 0)
  const rulesWorking = activeProductionActivities.includes('rules.catalog')
  const modules: ProductionProjection['modules'] = {
    documents: module('documents', documentCount, activeProductionActivities.some(
      (activity) => activity === 'brief.collecting' || activity.startsWith('document.'),
    ), true),
    'document.core': module('document.core', inventory.documents.core ?? 0, undefined, activityReached('document.core')),
    'document.pillar': module('document.pillar', inventory.documents.pillar ?? 0, undefined, activityReached('document.pillar')),
    blueprint: module('blueprint', inventory.blueprintNodeCount > 1 ? inventory.blueprintCount : 0, undefined,
      featureDevelopmentReached),
    ui: module('ui', inventory.uiCount, undefined, featureDevelopmentReached),
    assets: assetModule(
      'assets',
      inventory.characterCount + inventory.sceneCount + inventory.videoCount
        + inventory.imageCount + inventory.audioCount + inventory.fontCount,
      featureDevelopmentReached,
    ),
    character: assetModule('character', inventory.characterCount, featureDevelopmentReached),
    scene: assetModule('scene', inventory.sceneCount, featureDevelopmentReached),
    video: assetModule('video', inventory.videoCount, featureDevelopmentReached),
    image: module('image', inventory.imageCount, undefined, featureDevelopmentReached),
    audio: module('audio', inventory.audioCount, undefined, featureDevelopmentReached),
    font: module('font', inventory.fontCount, undefined, featureDevelopmentReached),
    rules: module('rules', inventory.entityCount + inventory.variableCount + inventory.formulaCount, undefined,
      featureDevelopmentReached),
    entities: module('entities', inventory.entityCount, rulesWorking, featureDevelopmentReached),
    variables: module('variables', inventory.variableCount, rulesWorking, featureDevelopmentReached),
    formulas: module('formulas', inventory.formulaCount, rulesWorking, featureDevelopmentReached),
    play: module('play', 0),
  }
  // 未开始 = 等作者输入，没有进度可报；notice 缺省时前端不渲染提示条。
  // 交付完但下一步还没开始的那段间隙，报「即将做什么」而不是「正在做上一步」。
  // 作者已经确认过支柱了，提示条还写「正在建立游戏支柱…」会让人以为流程卡住。
  const upcoming = settledNow && !awaitingGate ? nextActivityOf(state) : undefined
  // 作者输入由右侧问卷或中间内容区的专用确认面承接。Toast 只描述二级菜单
  // 对应对象正在生产什么，不重复发布“等待确认”。
  const noticeKind = workflowComplete || awaitingGate || state.activityStatus === 'awaiting-user'
    ? undefined
    : state.activityStatus === 'not-started'
      ? undefined
      : state.activityStatus === 'blocked'
        ? 'blocked'
        : upcoming
          ? 'upcoming'
          : 'progress' as const
  // 并发组进行时用组级文案，避免三条线的单活动提示互相刷屏。
  const concurrent = state.activeGroup.activities.length > 1
  const noticeActivity = awaitingGate === 'core'
    ? 'document.core'
    : awaitingGate === 'pillar'
      ? 'document.pillar'
      : noticeKind === 'upcoming' && upcoming
        ? upcoming
        : state.activity
  const messageKey = concurrent
    ? `videoGame.group.${state.activeGroup.id}.${noticeKind}`
    : `videoGame.activity.${noticeActivity}.${noticeKind}`
  return {
    schemaVersion: 1,
    gameId: state.gameId,
    workflowRevision: state.revision,
    phase: state.productPhase,
    phaseRevision: state.phaseRevision,
    phaseStatus: state.phaseStatus,
    activity: state.activity,
    activityRevision: state.activityRevision,
    activityStatus: state.activityStatus,
    activeActivities: [...state.activeGroup.activities],
    group: {
      id: state.activeGroup.id,
      status: state.activeGroup.status,
      revision: state.activeGroup.revision,
    },
    phases: state.phases,
    modules,
    gates: state.gates,
    artifacts: state.artifactRefs,
    assetPipeline: state.assetPipeline,
    ...(noticeKind
      ? {
        notice: {
          activity: noticeActivity,
          activityRevision: state.activityRevision,
          noticeRevision: state.noticeRevision,
          kind: noticeKind,
          messageKey,
          ...(awaitingGate ? { params: { gate: awaitingGate } } : {}),
          ...(state.focus ? { location: state.focus.location } : {}),
        },
      }
      : {}),
    ...(state.focus ? { focus: state.focus } : {}),
  }
}

/**
 * 生产写入的四步守卫（设计 §9.8.3）。
 *
 * 与单游标时代的区别：判定针对**具体活动**而不是全局游标，
 * 所以一条线推进不会让另一条线手里的修订号变 stale。
 *
 * `writeScope` 省略时按活动声明的全部写域处理——只读式调用与不落盘的
 * 校验类工具本来就不需要指定。
 */
export function assertWorkflowMutationAllowed(
  state: VideoGameWorkflowState | null,
  activityRevision: unknown,
  allowedActivities: readonly VideoGameActivity[],
  writeScope?: readonly string[],
): void {
  // Backward-compatible rollout: projects that have never entered the new
  // workflow keep the old tool behavior. Once get-workflow-state creates the
  // state file, every production mutation is revision/activity guarded.
  if (!state) return
  const candidates = allowedActivities.filter((activity) => (
    isAssetPipelineActivity(activity)
      ? state.assetPipeline.activeActivities.includes(activity)
      : state.activeGroup.activities.includes(activity)
  ))
  if (candidates.length === 0) {
    throw new WorkflowStateError(
      'workflow.capability.denied',
      `Tool is not allowed during group ${state.activeGroup.id} (active: ${state.activeGroup.activities.join(', ') || 'none'})`,
      state.revision,
      guidanceFor(state),
    )
  }
  // L4：省略 activityRevision 的幂等写与只读调用由 Host 取当前值。
  // 让模型复述一个它无从核对的数字，只是多给它一次填错的机会（设计 §9.7.4）。
  const target = activityRevision === undefined
    ? candidates[0]
    : candidates.find((activity) => activityRevisionOf(state, activity) === activityRevision)
  if (target === undefined) {
    throw new WorkflowStateError(
      'workflow.activity.stale',
      'Mutation must carry the current activityRevision',
      state.revision,
      guidanceFor(state, candidates[0]),
    )
  }
  if (state.activities[target]?.status !== 'working') {
    throw new WorkflowStateError(
      'workflow.transition.invalid',
      `Tool is not allowed during ${target}:${state.activities[target]?.status ?? 'not-started'}`,
      state.revision,
      guidanceFor(state, target),
    )
  }
  if (writeScope && !isWriteScopeAllowed(target, writeScope)) {
    throw new WorkflowStateError(
      'workflow.write-scope.denied',
      `${target} may only write ${writeScopesFor(target).join(', ') || '(nothing)'}; requested ${writeScope.join(', ')}`,
      state.revision,
      guidanceFor(state, target),
    )
  }
}

/**
 * Delivery complete (`phaseStatus === 'complete'`): scene catalog / preview tools
 * may run without reopening `assets.scene` (rework would wipe playtest evidence).
 */
export function isPostDeliveryCatalogMaintenance(state: VideoGameWorkflowState | null): boolean {
  return state?.phaseStatus === 'complete'
}

/** Character/scene patch and preview writes: normal lane gate, or post-delivery maintenance. */
export function assertAssetCatalogMutationAllowed(
  state: VideoGameWorkflowState | null,
  activityRevision: unknown,
  allowedActivities: readonly VideoGameActivity[],
  writeScope?: readonly string[],
): void {
  if (!state) return
  if (isPostDeliveryCatalogMaintenance(state)) return
  assertWorkflowMutationAllowed(state, activityRevision, allowedActivities, writeScope)
}

/** @deprecated Use the symmetric character/scene maintenance guard. */
export const assertSceneCatalogMutationAllowed = assertAssetCatalogMutationAllowed

/**
 * New undeclared scene ids → `source: 'catalog'`.
 * Allowed only during working `assets.scene` or after delivery.
 */
export function canCreateCatalogAdHocScenes(state: VideoGameWorkflowState | null): boolean {
  if (!state) return false
  if (isPostDeliveryCatalogMaintenance(state)) return true
  return state.assetPipeline.activeActivities.includes('assets.scene')
    && state.activities['assets.scene']?.status === 'working'
}
