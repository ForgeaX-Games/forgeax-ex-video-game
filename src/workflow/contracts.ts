/** Published production-plane contracts for the video-game extension. */

export const PRODUCT_PHASES = [
  'requirements-collection',
  'planning-design',
  'feature-development',
  'asset-generation',
] as const

export type ProductPhase = typeof PRODUCT_PHASES[number]

export const VIDEO_GAME_ACTIVITIES = [
  'brief.collecting',
  'document.inquiry',
  'document.core',
  'document.pillar',
  'blueprint.outline',
  'characters.modeling',
  'characters.previewing',
  'scenes.modeling',
  'scenes.previewing',
  'rules.catalog',
  'rules.binding',
  'ui.authoring',
  'game.finalizing',
  'assets.character',
  'assets.scene',
  'video.presets.binding',
  'video.presets.validating',
  'playtest.validating',
] as const

export type VideoGameActivity = typeof VIDEO_GAME_ACTIVITIES[number]

export const MAIN_VIDEO_GAME_ACTIVITIES = [
  'brief.collecting',
  'document.inquiry',
  'document.core',
  'document.pillar',
  'blueprint.outline',
  'rules.catalog',
  'ui.authoring',
  'rules.binding',
  'game.finalizing',
  'playtest.validating',
] as const satisfies readonly VideoGameActivity[]

export const ASSET_PIPELINE_ACTIVITIES = [
  'characters.modeling',
  'characters.previewing',
  'scenes.modeling',
  'scenes.previewing',
  'assets.character',
  'assets.scene',
  'video.presets.binding',
  'video.presets.validating',
] as const satisfies readonly VideoGameActivity[]

/**
 * 已退役的活动 ID。只用于解析 schemaVersion 1 的状态文件并迁移，
 * 不再参与推进。`document.intake` 见设计 §9.10；`blueprint.graph` 被
 * `blueprint.outline` + `game.finalizing` 取代。
 */
export const LEGACY_VIDEO_GAME_ACTIVITIES = [
  'document.intake',
  'blueprint.graph',
] as const

export type LegacyVideoGameActivity = typeof LEGACY_VIDEO_GAME_ACTIVITIES[number]

/**
 * 推进单位是活动组，不是单个活动。
 *
 * 每个组由若干 track 组成：**track 内部串行，track 之间并发**。
 * 串行段自然表达为「只有一条 track、且该 track 只有一个活动」的组。
 *
 * 组完成 = 所有 track 走完；活跃活动 = 每条未走完 track 的第一个未完成活动。
 */
export interface ActivityGroupDef {
  id: string
  tracks: readonly (readonly VideoGameActivity[])[]
}

export const ACTIVITY_GROUPS: readonly ActivityGroupDef[] = [
  { id: 'brief', tracks: [['brief.collecting', 'document.inquiry']] },
  { id: 'design', tracks: [['document.core', 'document.pillar']] },
  { id: 'outline', tracks: [['blueprint.outline']] },
  { id: 'modeling', tracks: [['rules.catalog']] },
  { id: 'integration', tracks: [['ui.authoring', 'rules.binding', 'game.finalizing']] },
  { id: 'delivery', tracks: [['playtest.validating']] },
]

export const ASSET_PIPELINE_TRACKS = [
  ['characters.modeling', 'characters.previewing', 'assets.character'],
  ['scenes.modeling', 'scenes.previewing', 'assets.scene'],
  ['video.presets.binding', 'video.presets.validating'],
] as const satisfies readonly (readonly VideoGameActivity[])[]

/**
 * 每个活动允许写入的域。并发安全的基础：同一组内不同 track 的写域必须不相交。
 *
 * - `graph`：蓝图节点与边（含总脉络的声明清单）
 * - `characters` / `scenes` / `rules`：各自目录
 * - `ui`：界面与控件
 * - `assets.*`：素材清单中对应的语义根
 * - `node.media`：节点成片引用
 */
export const WRITE_SCOPES = {
  'brief.collecting': [],
  'document.inquiry': [],
  'document.core': ['documents'],
  'document.pillar': ['documents'],
  // 总脉络只写蓝图树。角色、场景、规则都是下游产物：三条线各写自己的目录，
  // 节点上的引用由汇总整装回填。这样总脉络不必等下游，下游也不必等它分配 ID。
  'blueprint.outline': ['graph'],
  'characters.modeling': ['characters'],
  'characters.previewing': ['characters', 'assets.character'],
  'scenes.modeling': ['scenes'],
  'scenes.previewing': ['scenes', 'assets.scene'],
  'rules.catalog': ['rules'],
  // Rule binding writes graph effects/conditions and may wire reactions on
  // already-mounted UI overlays created by ui.authoring.
  'rules.binding': ['graph', 'ui'],
  'ui.authoring': ['graph', 'ui'],
  'game.finalizing': ['graph', 'ui', 'rules'],
  'playtest.validating': [],
  'assets.character': ['characters', 'assets.character'],
  'assets.scene': ['scenes', 'assets.scene'],
  'video.presets.binding': ['node.media'],
  'video.presets.validating': [],
} as const satisfies Record<VideoGameActivity, readonly string[]>

export type WriteScope = typeof WRITE_SCOPES[VideoGameActivity][number]

/** 蓝图内按写域细分的修订号，用于并发写入的冲突判定。 */
export const BLUEPRINT_SCOPES = ['graph', 'characters', 'scenes', 'rules', 'ui'] as const
export type BlueprintScope = typeof BLUEPRINT_SCOPES[number]
export type ProductPhaseStatus = 'not-started' | 'working' | 'awaiting-user' | 'blocked' | 'complete'
export type ActivityStatus = ProductPhaseStatus | 'not-required'
export type ModuleAvailability = 'hidden' | 'working' | 'ready' | 'blocked'

export type PageLocation =
  | { kind: 'document'; documentType: 'intake' | 'design-options' | 'core' | 'inquiry' | 'pillar' }
  | { kind: 'blueprint'; blueprintId?: string; nodeId?: string }
  | { kind: 'rule'; section: 'entities' | 'variables' | 'formulas'; itemId?: string }
  | { kind: 'ui'; treeNodeId?: string; overlayId?: string }
  | { kind: 'asset'; root: 'character' | 'scene' | 'image' | 'video' | 'audio' | 'font'; folderId?: string; entryId?: string }
  | { kind: 'play'; nodeId?: string }

export interface ArtifactRef {
  kind: string
  id: string
  revision: number
  /** Manifest revision paired with a cross-file asset-lane commit. */
  assetRevision?: number
  /** Compound node identities covered by a node.media binding receipt. */
  nodeRefs?: Array<{ blueprintId: string; nodeId: string }>
  /** Stable replay identity of the mutation that produced this artifact. */
  idempotencyKey?: string
  /** Exact asset entities covered by an asset-lane completion receipt. */
  targetIds?: string[]
  status?: 'working' | 'ready' | 'failed'
}

export interface ValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  location?: PageLocation
  /**
   * 该由哪个活动返工。只读活动（如 `playtest.validating`）看得见问题却改不了，
   * 归属靠模型判断会判错（实测把界面缺口当成整装的活，同样的边改了三遍），
   * 所以由 Host 按码推导（见 `issue-owner.ts`）。认不出时缺省。
   */
  owner?: VideoGameActivity
}

export interface ValidationEvidence {
  schemaVersion: 1
  activity: VideoGameActivity
  activityRevision: number
  projectRevision?: number
  checkId: string
  /**
   * `warn` 是质量提示而不是失败：语言漂移这类问题应该被看见，
   * 但拦住 `complete_activity` 会把一次润色变成一次撞墙（设计 §11.4）。
   */
  status: 'pass' | 'fail' | 'not-required' | 'warn'
  observedAt: string
  details?: Record<string, unknown>
  issues?: ValidationIssue[]
}

export interface ValidationSummary {
  projectRevision: number
  structural: 'pass' | 'fail' | 'not-run'
  semantic: 'pass' | 'fail' | 'not-run'
  references: 'pass' | 'fail' | 'not-run'
  productionReadiness: 'pass' | 'fail' | 'not-required' | 'not-run'
  choices: 'pass' | 'fail' | 'not-required' | 'not-run'
  playable: 'pass' | 'fail' | 'not-run'
  issues: ValidationIssue[]
}

export interface WorkflowBlocker {
  code: string
  message: string
  retryable: boolean
  activity: VideoGameActivity
  activityRevision: number
  location?: PageLocation
  createdAt: string
}

export interface ActivityNotice {
  activity: VideoGameActivity
  activityRevision: number
  noticeRevision: number
  /**
   * `upcoming` = 上一步交付完、下一步还没开始的那段间隙。作者已经确认过支柱了，
   * 提示条还写「正在建立游戏支柱…」会让人以为流程卡住，所以这段报下一步。
   */
  kind: 'progress' | 'upcoming' | 'awaiting-user' | 'blocked' | 'retrying'
  messageKey: string
  params?: Record<string, string | number>
  location?: PageLocation
}

export interface CompletionReport {
  schemaVersion: 1
  activity: VideoGameActivity
  activityRevision: number
  artifactRefs: ArtifactRef[]
  checkIds: string[]
  notRequired?: boolean
  suggestedFocus?: PageLocation
}

export interface ActivityContract {
  schemaVersion: 1
  activity: VideoGameActivity
  objective: string
  requiredInputs: Array<{ kind: string; optional?: boolean }>
  allowedToolNames: string[]
  mutationSequence: string[]
  hardChecks: string[]
  stopConditions: string[]
  domainGuide: string
  completionSchema: 'video-game-completion-report/v1'
}

export interface ActivityRecord {
  revision: number
  status: ActivityStatus
  startedAt?: string
  completedAt?: string
  artifactRefs: ArtifactRef[]
  evidence: ValidationEvidence[]
  blocker?: WorkflowBlocker
}

export interface PhaseRecord {
  revision: number
  status: ProductPhaseStatus
  openedAt?: string
  completedAt?: string
}

/** 六维需求契约。删除 `document.intake` 后，它是需求的唯一留存形态（设计 §9.10）。 */
export interface RequirementContract {
  schemaVersion: 1
  /** 作者第一句原文，原样保留不改写。 */
  rawIntent: string
  dimensions: Record<string, {
    value: string
    source: 'author' | 'inferred' | 'default'
  }>
  visualStyle?: { id: string, name: string }
  locale: string
  collectedAt: string
  /** 超长输入被截断时置位，便于诊断而不是静默丢内容。 */
  truncated?: boolean
}

/** 核心方案生成前的一次性高影响取舍；不落文档，也不产生侧边栏入口。 */
export interface InquiryContract {
  schemaVersion: 1
  answers: Array<{
    question: string
    answer: string
  }>
  collectedAt: string
  truncated?: boolean
}

export interface ActiveGroupRecord {
  id: string
  activities: VideoGameActivity[]
  status: ProductPhaseStatus
  revision: number
}

export type AssetPipelineStatus = 'not-started' | 'working' | 'partial' | 'blocked' | 'ready'
export type AssetReadinessStatus = 'pending' | 'working' | 'ready' | 'failed'

export interface AssetPipelineState {
  schemaVersion: 1
  revision: number
  status: AssetPipelineStatus
  activeActivities: VideoGameActivity[]
  blockers: WorkflowBlocker[]
  readiness: {
    characters: AssetReadinessStatus
    scenes: AssetReadinessStatus
    videoPresets: AssetReadinessStatus
  }
}

export interface VideoGameWorkflowState {
  schemaVersion: 2
  gameId: string
  revision: number
  productPhase: ProductPhase
  phaseRevision: number
  phaseStatus: ProductPhaseStatus
  /**
   * 组内代表活动，保留给旧读取方（阶段条、旧 UI）。
   * 并发下应读 `activeGroup.activities`，不要假设只有一个活动在跑。
   */
  activity: VideoGameActivity
  activityRevision: number
  activityStatus: ActivityStatus
  activeGroup: ActiveGroupRecord
  assetPipeline: AssetPipelineState
  requirementContract?: RequirementContract
  inquiryContract?: InquiryContract
  phases: Record<ProductPhase, PhaseRecord>
  activities: Partial<Record<VideoGameActivity, ActivityRecord>>
  artifactRefs: ArtifactRef[]
  validationEvidence: ValidationEvidence[]
  blockers: WorkflowBlocker[]
  gates: Record<string, {
    status: 'pending' | 'approved' | 'rejected' | 'not-required'
    revision: number
    evidenceRef?: string
    approvedAt?: string
  }>
  productionRefs: string[]
  history: Array<{
    revision: number
    activity: VideoGameActivity
    activityRevision: number
    status: ActivityStatus
    at: string
    reason?: string
  }>
  noticeRevision: number
  focus?: {
    location: PageLocation
    reason: 'activity-started' | 'artifact-created' | 'user-action-required' | 'validation-failed'
    revision: number
  }
  updatedAt: string
}

export interface ProductionProjection {
  schemaVersion: 1
  gameId: string
  workflowRevision: number
  phase: ProductPhase
  phaseRevision: number
  phaseStatus: ProductPhaseStatus
  /** 代表活动，保留兼容；并发下请读 `activeActivities`。 */
  activity: VideoGameActivity
  activityRevision: number
  activityStatus: ActivityStatus
  /** 当前组内所有正在进行的活动。串行段长度为 1，并发段可为多个。 */
  activeActivities: VideoGameActivity[]
  group: { id: string, status: ProductPhaseStatus, revision: number }
  phases: Record<ProductPhase, PhaseRecord>
  modules: Record<string, {
    availability: ModuleAvailability
    count?: number
    blockerCode?: string
  }>
  gates: VideoGameWorkflowState['gates']
  artifacts: ArtifactRef[]
  assetPipeline?: AssetPipelineState
  validation?: ValidationSummary
  notice?: ActivityNotice
  focus?: VideoGameWorkflowState['focus']
}

export interface NodeRef {
  blueprintId: string
  nodeId: string
}
