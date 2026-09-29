import { checkFormulaCall } from '@/runtime/core/engine/formula-registry'
import { hydratePillarContract } from './pillar-hydrate'
import { duplicateMountedOverlayComponents } from './pillar-overlay-plan'

/**
 * 承载玩家动作的组件必须具备的角色。
 *
 * 这是 GameplayComponentRole 的输入子集：输出类角色（narrative-display /
 * state-feedback / transient-feedback）由反馈组件承担，动作永远是玩家输入，
 * 因此"动作不得声明输出角色"由该类型本身兑现。
 */
export type PillarActionRequiredRole = 'player-choice' | 'combat-command' | 'timed-input'

export interface PillarActionCapabilityGap {
  need: string
  why: string
}

/**
 * v4：把支柱从「半散文文档」升级为可编译 IR。
 *
 * v1–v3 里 `stateChange` / `exitIntent` / `source` / `feedback` 都是自然语言，
 * 下游必须把它们再解释成结构化值——那不是编译，是二次创作，而二次创作的产物
 * 不在支柱期可执行性证明的覆盖范围内。v4 为每个参与编译的语义补一个结构化字段；
 * 自然语言字段保留，但只作展示，不再参与推导。
 */
export interface PillarEffectContract {
  /** `entity.<id>.attr.<attr>` 或 `var.<id>`。 */
  target: string
  op: 'add' | 'sub' | 'set'
  formulaId?: string
  value?: number
}

export type PillarFeedbackContract =
  | { kind: 'transient-component'; component: string }
  | { kind: 'state-binding'; component: string; target: string }
  | { kind: 'hide-interface' }

export type PillarTriggerSpecContract =
  | { type: 'at'; ms: number }
  | { type: 'watch'; of: string; on?: 'change' | 'inc' | 'dec' }
  | { type: 'state'; condition: Record<string, unknown> }

/** 承载动作的具体元件与事件；省略时编译器按 `requiredRole` 从目录里选。 */
export interface PillarCarrierContract {
  component: string
  event: string
}

/**
 * 动作的出口。终局是一等公民而非「一条指向某节点的边」——
 * 终局节点必须有出边、而指向任何已有节点都会成环，这个死结从类型层面消失。
 */
export type PillarExitContract =
  | { kind: 'beat'; toBeatId: string }
  | { kind: 'ending'; endingId: string }
  | { kind: 'stay' }

export interface PillarVariableContract {
  id: string
  label?: string
  initial: number
  min?: number
  max?: number
}

export interface PillarFormulaContract {
  id: string
  expression: string
  summary?: string
}

export interface PillarEntityAttrContract {
  id: string
  label?: string
  initial: number
  min?: number
  max?: number
}

/** 规则实体：有独立对象、多属性时用（角色/敌人生命），效果写 `entity.<id>.attr.<attr>`。 */
export interface PillarEntityContract {
  id: string
  label?: string
  kind?: string
  attrs: PillarEntityAttrContract[]
}

export interface PillarEndingContract {
  id: string
  title: string
  /** 终局的机器判定条件；由路由直接抵达的终局可以省略。 */
  when?: string
  summary: string
}

export interface PillarInteractionActionContract {
  id: string
  intent: string
  /** v2：none 表示纯剧情分流；settlement 表示持久状态必须由结果节点结算。 */
  stateMutationOwner?: 'none' | 'settlement'
  /** v3：承载该动作的组件必须具备的角色，与 capabilityGap 互斥。 */
  requiredRole?: PillarActionRequiredRole
  /** v3：目录里没有任何角色能承载该动作时的显式缺口，与 requiredRole 互斥。 */
  capabilityGap?: PillarActionCapabilityGap
  /** v4：承载元件与事件；省略时由编译器按 requiredRole 从目录选。 */
  carrier?: PillarCarrierContract
  /** v4：`stateMutationOwner=settlement` 时必填，取代自然语言 stateChange 的推导职责。 */
  effect?: PillarEffectContract
  /** v4：取代自然语言 immediateFeedback 的推导职责。 */
  feedbackSpec?: PillarFeedbackContract
  /** v4：结构化出口，取代自然语言 exitIntent 的推导职责。 */
  exit?: PillarExitContract
  stateChange: string
  immediateFeedback: string
  downstreamPayoff: string
  exitIntent: string
}

export interface PillarSettlementContract {
  id: string
  /** 该结算承接的玩家动作；省略表示独立的系统结算，例如生命归零。 */
  sourceActionId?: string
  trigger: 'at' | 'watch' | 'state'
  /** v4：机器触发器，取代自然语言 source 的推导职责。 */
  triggerSpec?: PillarTriggerSpecContract
  /** v4：取代自然语言 feedback 的推导职责。 */
  feedbackSpec?: PillarFeedbackContract
  source: string
  intent: string
  feedback: string
  exitIntent: string
  /** 系统结算（无 sourceActionId）离开本拍的出口；省略时 Host 按下一拍 / 失败结局补。 */
  exit?: PillarExitContract
}

export interface PillarInteractionBeatContract {
  id: string
  narrativeIntent: string
  /**
   * 这一拍的场面调度：谁在场、发生什么、镜头与气氛。
   * 下游节点 storyText 与视频 prompt 的策划源，不是章节标题的复述。
   */
  staging?: string
  playerInformation: string[]
  uiCapabilities: string[]
  actions: PillarInteractionActionContract[]
  settlements: PillarSettlementContract[]
  loop?: {
    progress: string
    exitConditions: string[]
  }
  /**
   * 默认同类覆盖物在一拍只挂一份。确需两份相同组件时才打开。
   * 瞬时 spawn 不算常驻挂载。
   */
  allowDuplicateOverlays?: boolean
}

/** 角色 / 场景策划摘要的最短长度：下游预设直接引用，四个字不够拍。 */
export const MIN_PILLAR_CREATIVE_BRIEF_LENGTH = 20

export interface PillarNamedEntry {
  name: string
  summary?: string
}

export interface PillarInteractionContract {
  schemaVersion: 1 | 2 | 3 | 4
  beats: PillarInteractionBeatContract[]
  /** v4：数值即设计，变量、实体与公式在支柱里定稿，下游不再现编。 */
  variables?: PillarVariableContract[]
  entities?: PillarEntityContract[]
  formulas?: PillarFormulaContract[]
  endings?: PillarEndingContract[]
  /** 作者文档由 Host 从这些字段渲染；peer 不必再写 Markdown 章节。 */
  title?: string
  cast?: PillarNamedEntry[]
  settings?: PillarNamedEntry[]
  mainLoop?: string
}

const REQUIRED_ROLES: readonly PillarActionRequiredRole[] = ['player-choice', 'combat-command', 'timed-input']

/**
 * 契约解析失败。`issues` 收集了**全部**校验问题（而非第一条），
 * `message` 沿用历史行为取 `issues[0]`，保证调用方 `.toThrow(...)` 兼容。
 */
export class PillarContractError extends Error {
  constructor(readonly issues: string[]) {
    super(issues[0] ?? '支柱互动契约无效')
    this.name = 'PillarContractError'
  }
}

interface Collector {
  issues: string[]
}

function fail(collector: Collector, message: string): void {
  collector.issues.push(message)
}

function collectString(collector: Collector, value: unknown, path: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    fail(collector, `${path} 必须是非空字符串`)
    return undefined
  }
  return value.trim()
}

/** 创作面允许省略结算/出口散文；空字符串不当成契约错误。 */
function collectLooseString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function collectStringArray(
  collector: Collector,
  value: unknown,
  path: string,
  allowEmpty = false,
  skipBlanks = false,
): string[] | undefined {
  if (!Array.isArray(value)) {
    fail(collector, `${path} 必须是字符串数组`)
    return undefined
  }
  const result: string[] = []
  let invalid = false
  for (let index = 0; index < value.length; index++) {
    if (skipBlanks && (typeof value[index] !== 'string' || !value[index].trim())) continue
    const item = collectString(collector, value[index], `${path}[${index}]`)
    if (item === undefined) {
      invalid = true
      continue
    }
    result.push(item)
  }
  if (invalid) return undefined
  if (!allowEmpty && result.length === 0) {
    fail(collector, `${path} 不能为空`)
    return undefined
  }
  return result
}

function collectRecord(collector: Collector, value: unknown, path: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(collector, `${path} 必须是对象`)
    return undefined
  }
  return value as Record<string, unknown>
}

function collectNumber(collector: Collector, value: unknown, path: string): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(collector, `${path} 必须是数字`)
    return undefined
  }
  return value
}

/** 运行时可寻址的 ID：字母或下划线开头，其后字母、数字、下划线。 */
const RUNTIME_ID = /^[A-Za-z_][A-Za-z0-9_]*$/u

function collectFeedbackSpec(
  collector: Collector,
  value: unknown,
  path: string,
): PillarFeedbackContract | undefined {
  const raw = collectRecord(collector, value, path)
  if (!raw) return undefined
  const kind = collectString(collector, raw.kind, `${path}.kind`)
  if (kind === undefined) return undefined
  if (kind === 'hide-interface') return { kind }
  if (kind === 'transient-component') {
    const component = collectString(collector, raw.component, `${path}.component`)
    return component === undefined ? undefined : { kind, component }
  }
  if (kind === 'state-binding') {
    const component = collectString(collector, raw.component, `${path}.component`)
    const target = collectString(collector, raw.target, `${path}.target`)
    return component === undefined || target === undefined ? undefined : { kind, component, target }
  }
  fail(collector, `${path}.kind 必须是 transient-component/state-binding/hide-interface`)
  return undefined
}

function collectTriggerSpec(
  collector: Collector,
  value: unknown,
  path: string,
): PillarTriggerSpecContract | undefined {
  const raw = collectRecord(collector, value, path)
  if (!raw) return undefined
  const type = collectString(collector, raw.type, `${path}.type`)
  if (type === undefined) return undefined
  if (type === 'at') {
    const ms = collectNumber(collector, raw.ms, `${path}.ms`)
    return ms === undefined ? undefined : { type, ms }
  }
  if (type === 'watch') {
    const of = collectString(collector, raw.of, `${path}.of`)
    if (of === undefined) return undefined
    const on = raw.on === undefined ? undefined : collectString(collector, raw.on, `${path}.on`)
    if (on !== undefined && !['change', 'inc', 'dec'].includes(on)) {
      fail(collector, `${path}.on 必须是 change/inc/dec`)
      return undefined
    }
    return { type, of, ...(on ? { on: on as 'change' | 'inc' | 'dec' } : {}) }
  }
  if (type === 'state') {
    // 条件表达式的语义由编译器求值时校验；这里只保证形状，避免两处规则漂移。
    const condition = collectRecord(collector, raw.condition, `${path}.condition`)
    return condition === undefined ? undefined : { type, condition }
  }
  fail(collector, `${path}.type 必须是 at/watch/state`)
  return undefined
}

function collectEffect(
  collector: Collector,
  value: unknown,
  path: string,
): PillarEffectContract | undefined {
  const raw = collectRecord(collector, value, path)
  if (!raw) return undefined
  const target = collectString(collector, raw.target, `${path}.target`)
  const op = collectString(collector, raw.op, `${path}.op`)
  if (target === undefined || op === undefined) return undefined
  if (!['add', 'sub', 'set'].includes(op)) {
    fail(collector, `${path}.op 必须是 add/sub/set`)
    return undefined
  }
  const formulaId = raw.formulaId === undefined
    ? undefined
    : collectString(collector, raw.formulaId, `${path}.formulaId`)
  const numeric = raw.value === undefined
    ? undefined
    : collectNumber(collector, raw.value, `${path}.value`)
  if (formulaId === undefined && numeric === undefined) {
    fail(collector, `${path} 必须给出 formulaId 或 value`)
    return undefined
  }
  return {
    target,
    op: op as PillarEffectContract['op'],
    ...(formulaId ? { formulaId } : {}),
    ...(numeric === undefined ? {} : { value: numeric }),
  }
}

function collectExit(
  collector: Collector,
  value: unknown,
  path: string,
): PillarExitContract | undefined {
  const raw = collectRecord(collector, value, path)
  if (!raw) return undefined
  const kind = collectString(collector, raw.kind, `${path}.kind`)
  if (kind === undefined) return undefined
  if (kind === 'stay') return { kind }
  if (kind === 'beat') {
    const toBeatId = collectString(collector, raw.toBeatId, `${path}.toBeatId`)
    return toBeatId === undefined ? undefined : { kind, toBeatId }
  }
  if (kind === 'ending') {
    const endingId = collectString(collector, raw.endingId, `${path}.endingId`)
    return endingId === undefined ? undefined : { kind, endingId }
  }
  fail(collector, `${path}.kind 必须是 beat/ending/stay`)
  return undefined
}

function collectAction(
  collector: Collector,
  rawAction: unknown,
  actionPath: string,
  beatPath: string,
  schemaVersion: PillarInteractionContract['schemaVersion'],
  memberIds: Set<string>,
): PillarInteractionActionContract | null {
  const action = collectRecord(collector, rawAction, actionPath)
  if (!action) return null
  const actionId = collectString(collector, action.id, `${actionPath}.id`)
  if (actionId === undefined) return null
  if (memberIds.has(actionId)) {
    // 历史消息用 beat path 定位，测试只匹配子串，保持一致即可。
    fail(collector, `${beatPath} 动作/结算 ID 重复：${actionId}`)
    return null
  }
  memberIds.add(actionId)

  const stateMutationOwner = action.stateMutationOwner === undefined
    ? undefined
    : collectString(collector, action.stateMutationOwner, `${actionPath}.stateMutationOwner`)
  // v2+ 要求显式声明 owner：缺省（undefined）同样非法，`?? ''` 与历史行为一致。
  if (schemaVersion >= 2 && !['none', 'settlement'].includes(stateMutationOwner ?? '')) {
    fail(collector, `${actionPath}.stateMutationOwner 必须是 none/settlement`)
    return null
  }
  const hasRole = action.requiredRole !== undefined
  const hasGap = action.capabilityGap !== undefined
  if (schemaVersion >= 3) {
    if (hasRole && hasGap) {
      fail(collector, `${actionPath} 不能同时声明 requiredRole 和 capabilityGap`)
      return null
    }
    if (!hasRole && !hasGap) {
      fail(collector, `${actionPath} 必须声明 requiredRole 或 capabilityGap`)
      return null
    }
  }
  const requiredRole = hasRole
    ? collectString(collector, action.requiredRole, `${actionPath}.requiredRole`)
    : undefined
  if (requiredRole !== undefined && !REQUIRED_ROLES.includes(requiredRole as PillarActionRequiredRole)) {
    fail(collector, `${actionPath}.requiredRole 必须是 ${REQUIRED_ROLES.join('/')}`)
    return null
  }
  const capabilityGap = hasGap
    ? (() => {
        const gap = collectRecord(collector, action.capabilityGap, `${actionPath}.capabilityGap`)
        if (!gap) return null
        const need = collectString(collector, gap.need, `${actionPath}.capabilityGap.need`)
        const why = collectString(collector, gap.why, `${actionPath}.capabilityGap.why`)
        if (need === undefined || why === undefined) return null
        return { need, why }
      })()
    : undefined
  if (hasGap && capabilityGap === null) return null

  const intent = collectString(collector, action.intent, `${actionPath}.intent`)
  if (intent === undefined) return null
  const stateChange = typeof action.stateChange === 'string' && action.stateChange.trim()
    ? action.stateChange.trim()
    : intent
  const immediateFeedback = typeof action.immediateFeedback === 'string' && action.immediateFeedback.trim()
    ? action.immediateFeedback.trim()
    : intent
  const downstreamPayoff = typeof action.downstreamPayoff === 'string' && action.downstreamPayoff.trim()
    ? action.downstreamPayoff.trim()
    : intent
  if (/下一幕|下一拍|下一章|后续章节|下一节拍/u.test(downstreamPayoff)) {
    fail(collector, `${actionPath}.downstreamPayoff 把结果指到了下一节拍章节；结果节点必须与源动作同 beatId`)
  }
  const exitIntent = typeof action.exitIntent === 'string' && action.exitIntent.trim()
    ? action.exitIntent.trim()
    : intent

  // v4：编译所需的每个语义都必须是结构化值。缺一个，编译器就得回到猜测，
  // 而猜测出来的方案不在支柱期可执行性证明的覆盖范围内。
  const carrier = action.carrier === undefined
    ? undefined
    : (() => {
        const raw = collectRecord(collector, action.carrier, `${actionPath}.carrier`)
        if (!raw) return undefined
        const component = collectString(collector, raw.component, `${actionPath}.carrier.component`)
        const event = collectString(collector, raw.event, `${actionPath}.carrier.event`)
        return component === undefined || event === undefined ? undefined : { component, event }
      })()
  const effect = action.effect === undefined
    ? undefined
    : collectEffect(collector, action.effect, `${actionPath}.effect`)
  const feedbackSpec = action.feedbackSpec === undefined
    ? undefined
    : collectFeedbackSpec(collector, action.feedbackSpec, `${actionPath}.feedbackSpec`)
  const exit = action.exit === undefined
    ? undefined
    : collectExit(collector, action.exit, `${actionPath}.exit`)

  if (schemaVersion >= 4 && stateMutationOwner === 'none' && action.effect !== undefined) {
    fail(collector, `${actionPath}.effect 不该出现在纯剧情分流动作上`)
  }

  return {
    id: actionId,
    intent,
    ...(stateMutationOwner ? { stateMutationOwner: stateMutationOwner as PillarInteractionActionContract['stateMutationOwner'] } : {}),
    ...(requiredRole ? { requiredRole: requiredRole as PillarActionRequiredRole } : {}),
    ...(capabilityGap ? { capabilityGap } : {}),
    ...(carrier ? { carrier } : {}),
    ...(effect ? { effect } : {}),
    ...(feedbackSpec ? { feedbackSpec } : {}),
    ...(exit ? { exit } : {}),
    stateChange,
    immediateFeedback,
    downstreamPayoff,
    exitIntent,
  }
}

function collectSettlement(
  collector: Collector,
  rawSettlement: unknown,
  settlementPath: string,
  beatPath: string,
  memberIds: Set<string>,
  actions: PillarInteractionActionContract[],
  schemaVersion: PillarInteractionContract['schemaVersion'],
): PillarSettlementContract | null {
  const settlement = collectRecord(collector, rawSettlement, settlementPath)
  if (!settlement) return null
  const trigger = collectString(collector, settlement.trigger, `${settlementPath}.trigger`)
  if (trigger !== undefined && !['at', 'watch', 'state'].includes(trigger)) {
    fail(collector, `${settlementPath}.trigger 必须是 at/watch/state`)
    return null
  }
  const settlementId = collectString(collector, settlement.id, `${settlementPath}.id`)
  if (settlementId === undefined) return null
  if (memberIds.has(settlementId)) {
    fail(collector, `${beatPath} 动作/结算 ID 重复：${settlementId}`)
    return null
  }
  memberIds.add(settlementId)
  const sourceActionId = settlement.sourceActionId === undefined
    ? undefined
    : collectString(collector, settlement.sourceActionId, `${settlementPath}.sourceActionId`)
  if (sourceActionId !== undefined && !actions.some((action) => action.id === sourceActionId)) {
    fail(collector, `${settlementPath}.sourceActionId 未命中同一节拍动作：${sourceActionId}`)
    return null
  }
  const intent = collectLooseString(settlement.intent) ?? settlementId
  const source = collectLooseString(settlement.source) ?? intent
  const feedback = collectLooseString(settlement.feedback) ?? intent
  const exitIntent = collectLooseString(settlement.exitIntent) ?? intent
  if (trigger === undefined) {
    return null
  }
  const triggerSpec = settlement.triggerSpec === undefined
    ? undefined
    : collectTriggerSpec(collector, settlement.triggerSpec, `${settlementPath}.triggerSpec`)
  const feedbackSpec = settlement.feedbackSpec === undefined
    ? undefined
    : collectFeedbackSpec(collector, settlement.feedbackSpec, `${settlementPath}.feedbackSpec`)
  if (schemaVersion >= 4 && triggerSpec && triggerSpec.type !== trigger) {
    fail(collector, `${settlementPath}.triggerSpec.type 必须与 trigger 一致：${trigger}`)
  }
  const exit = settlement.exit === undefined
    ? undefined
    : collectExit(collector, settlement.exit, `${settlementPath}.exit`)
  return {
    id: settlementId,
    ...(sourceActionId ? { sourceActionId } : {}),
    trigger: trigger as PillarSettlementContract['trigger'],
    ...(triggerSpec ? { triggerSpec } : {}),
    ...(feedbackSpec ? { feedbackSpec } : {}),
    source,
    intent,
    feedback,
    exitIntent,
    ...(exit ? { exit } : {}),
  }
}

function collectBeat(
  collector: Collector,
  rawBeat: unknown,
  beatIndex: number,
  schemaVersion: PillarInteractionContract['schemaVersion'],
  ids: Set<string>,
): PillarInteractionBeatContract | null {
  const path = `pillarInteractionContract.beats[${beatIndex}]`
  const beat = collectRecord(collector, rawBeat, path)
  if (!beat) return null
  const id = collectString(collector, beat.id, `${path}.id`)
  if (id === undefined) return null
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/u.test(id)) {
    fail(collector, `${path}.id 格式无效：${id}`)
    return null
  }
  if (ids.has(id)) {
    fail(collector, `互动节拍 ID 重复：${id}`)
    return null
  }
  ids.add(id)

  const memberIds = new Set<string>()
  const actions: PillarInteractionActionContract[] = []
  const rawActions = Array.isArray(beat.actions) ? beat.actions : []
  for (let actionIndex = 0; actionIndex < rawActions.length; actionIndex++) {
    const action = collectAction(
      collector,
      rawActions[actionIndex],
      `${path}.actions[${actionIndex}]`,
      path,
      schemaVersion,
      memberIds,
    )
    if (action) actions.push(action)
  }
  const settlements: PillarSettlementContract[] = []
  const rawSettlements = Array.isArray(beat.settlements) ? beat.settlements : []
  for (let settlementIndex = 0; settlementIndex < rawSettlements.length; settlementIndex++) {
    const settlement = collectSettlement(
      collector,
      rawSettlements[settlementIndex],
      `${path}.settlements[${settlementIndex}]`,
      path,
      memberIds,
      actions,
      schemaVersion,
    )
    if (settlement) settlements.push(settlement)
  }

  if (schemaVersion >= 2) {
    for (const action of actions) {
      const paired = settlements.some((settlement) => settlement.sourceActionId === action.id)
      if (action.stateMutationOwner === 'none' && paired) {
        fail(collector, `${path}.actions[${action.id}] 是纯剧情分流，却带了 sourceActionId 配对结算`)
      }
    }
  }
  if (actions.length === 0 && settlements.length === 0) {
    fail(collector, `${path} 至少需要一个玩家动作或系统结算`)
  }

  const loop = beat.loop === undefined ? undefined : (() => {
    const value = collectRecord(collector, beat.loop, `${path}.loop`)
    if (!value) return undefined
    const progress = collectString(collector, value.progress, `${path}.loop.progress`)
    const exitConditions = collectStringArray(
      collector,
      value.exitConditions,
      `${path}.loop.exitConditions`,
      true,
      true,
    )
    if (progress === undefined || exitConditions === undefined) return undefined
    return { progress, exitConditions }
  })()

  const narrativeIntent = collectString(collector, beat.narrativeIntent, `${path}.narrativeIntent`)
  if (narrativeIntent === undefined) return null
  const staging = beat.staging === undefined
    ? undefined
    : collectString(collector, beat.staging, `${path}.staging`)
  if (schemaVersion >= 4) {
    if (!staging) {
      fail(collector, `${path}.staging 必须写清这一拍的场面：谁在场、发生什么、镜头与气氛`)
    } else if (staging.length < MIN_PILLAR_CREATIVE_BRIEF_LENGTH) {
      fail(
        collector,
        `${path}.staging 太短（至少 ${MIN_PILLAR_CREATIVE_BRIEF_LENGTH} 字），下游视频 prompt 需要可拍摄的场面而不是章节名`,
      )
    }
  }
  const playerInformation = beat.playerInformation === undefined
    ? [narrativeIntent]
    : collectStringArray(collector, beat.playerInformation, `${path}.playerInformation`)
  const uiCapabilities = beat.uiCapabilities === undefined
    ? []
    : collectStringArray(collector, beat.uiCapabilities, `${path}.uiCapabilities`, schemaVersion >= 3)
  if (playerInformation === undefined || uiCapabilities === undefined) {
    return null
  }

  return {
    id,
    narrativeIntent,
    ...(staging ? { staging } : {}),
    playerInformation,
    uiCapabilities,
    actions,
    settlements,
    ...(loop ? { loop } : {}),
    ...(beat.allowDuplicateOverlays === true ? { allowDuplicateOverlays: true } : {}),
  }
}

interface ParsedRoot {
  schemaVersion: PillarInteractionContract['schemaVersion']
  beats: unknown[]
  variables?: unknown[]
  entities?: unknown[]
  formulas?: unknown[]
  endings?: unknown[]
  title?: unknown
  cast?: unknown
  settings?: unknown
  mainLoop?: unknown
}

function collectVariables(collector: Collector, value: unknown): PillarVariableContract[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    fail(collector, 'pillarInteractionContract.variables 必须是数组')
    return []
  }
  const result: PillarVariableContract[] = []
  for (const [index, raw] of value.entries()) {
    const path = `pillarInteractionContract.variables[${index}]`
    const entry = collectRecord(collector, raw, path)
    if (!entry) continue
    const id = collectString(collector, entry.id, `${path}.id`)
    if (id === undefined) continue
    if (!RUNTIME_ID.test(id)) {
      fail(collector, `${path}.id 格式无效：${id}`)
      continue
    }
    const initial = collectNumber(collector, entry.initial, `${path}.initial`)
    if (initial === undefined) continue
    const label = entry.label === undefined ? undefined : collectString(collector, entry.label, `${path}.label`)
    const min = entry.min === undefined ? undefined : collectNumber(collector, entry.min, `${path}.min`)
    const max = entry.max === undefined ? undefined : collectNumber(collector, entry.max, `${path}.max`)
    result.push({
      id,
      ...(label ? { label } : {}),
      initial,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    })
  }
  return result
}

function collectEntityAttrs(
  collector: Collector,
  value: unknown,
  path: string,
): PillarEntityAttrContract[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(collector, `${path} 至少需要一个属性`)
    return []
  }
  const result: PillarEntityAttrContract[] = []
  for (const [index, raw] of value.entries()) {
    const attrPath = `${path}[${index}]`
    const entry = collectRecord(collector, raw, attrPath)
    if (!entry) continue
    const id = collectString(collector, entry.id, `${attrPath}.id`)
    if (id === undefined) continue
    if (!RUNTIME_ID.test(id)) {
      fail(collector, `${attrPath}.id 格式无效：${id}`)
      continue
    }
    const initial = collectNumber(collector, entry.initial, `${attrPath}.initial`)
    if (initial === undefined) continue
    const label = entry.label === undefined ? undefined : collectString(collector, entry.label, `${attrPath}.label`)
    const min = entry.min === undefined ? undefined : collectNumber(collector, entry.min, `${attrPath}.min`)
    const max = entry.max === undefined ? undefined : collectNumber(collector, entry.max, `${attrPath}.max`)
    result.push({
      id,
      ...(label ? { label } : {}),
      initial,
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    })
  }
  return result
}

function collectEntities(collector: Collector, value: unknown): PillarEntityContract[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    fail(collector, 'pillarInteractionContract.entities 必须是数组')
    return []
  }
  const result: PillarEntityContract[] = []
  const ids = new Set<string>()
  for (const [index, raw] of value.entries()) {
    const path = `pillarInteractionContract.entities[${index}]`
    const entry = collectRecord(collector, raw, path)
    if (!entry) continue
    const id = collectString(collector, entry.id, `${path}.id`)
    if (id === undefined) continue
    if (!RUNTIME_ID.test(id)) {
      fail(collector, `${path}.id 格式无效：${id}`)
      continue
    }
    if (ids.has(id)) {
      fail(collector, `规则实体 ID 重复：${id}`)
      continue
    }
    ids.add(id)
    const label = entry.label === undefined ? undefined : collectString(collector, entry.label, `${path}.label`)
    const kind = entry.kind === undefined ? undefined : collectString(collector, entry.kind, `${path}.kind`)
    const attrs = collectEntityAttrs(collector, entry.attrs, `${path}.attrs`)
    result.push({
      id,
      ...(label ? { label } : {}),
      ...(kind ? { kind } : {}),
      attrs,
    })
  }
  return result
}

function collectFormulas(collector: Collector, value: unknown): PillarFormulaContract[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    fail(collector, 'pillarInteractionContract.formulas 必须是数组')
    return []
  }
  const result: PillarFormulaContract[] = []
  for (const [index, raw] of value.entries()) {
    const path = `pillarInteractionContract.formulas[${index}]`
    const entry = collectRecord(collector, raw, path)
    if (!entry) continue
    const id = collectString(collector, entry.id, `${path}.id`)
    const expression = collectString(collector, entry.expression, `${path}.expression`)
    if (id === undefined || expression === undefined) continue
    if (!RUNTIME_ID.test(id)) {
      fail(collector, `${path}.id 格式无效：${id}`)
      continue
    }
    // 只有运行时求值器认识的函数才允许写进支柱，否则「写得进去、跑不起来」
    // 会一路漂到 GraphSession 求值时才炸。
    for (const call of expression.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/gu)) {
      const name = call[1]!
      const issue = checkFormulaCall(name, 0)
      if (issue?.code === 'rules.formula.unknown-function') {
        fail(collector, `${path}.expression ${issue.message}`)
      }
    }
    const summary = entry.summary === undefined ? undefined : collectString(collector, entry.summary, `${path}.summary`)
    result.push({ id, expression, ...(summary ? { summary } : {}) })
  }
  return result
}

function collectEndings(collector: Collector, value: unknown): PillarEndingContract[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    fail(collector, 'pillarInteractionContract.endings 必须是数组')
    return []
  }
  const result: PillarEndingContract[] = []
  for (const [index, raw] of value.entries()) {
    const path = `pillarInteractionContract.endings[${index}]`
    const entry = collectRecord(collector, raw, path)
    if (!entry) continue
    const id = collectString(collector, entry.id, `${path}.id`)
    const title = collectString(collector, entry.title, `${path}.title`)
    const summary = collectString(collector, entry.summary, `${path}.summary`)
    if (id === undefined || title === undefined || summary === undefined) continue
    const when = entry.when === undefined ? undefined : collectString(collector, entry.when, `${path}.when`)
    result.push({ id, title, ...(when ? { when } : {}), summary })
  }
  return result
}

/**
 * v4 的跨引用闭合：exit 指向的节拍/终局、effect 引用的公式都必须真实存在。
 * 悬空引用在 v1–v3 里要等下游画图时才暴露，那时已经离作者确认过去几十分钟。
 */
function exitKey(exit: PillarInteractionActionContract['exit']): string {
  if (!exit || exit.kind === 'stay') return 'stay'
  if (exit.kind === 'beat') return `beat:${exit.toBeatId}`
  return `ending:${exit.endingId}`
}

function effectKey(action: PillarInteractionActionContract): string | null {
  if (!action.effect) return null
  return `${action.effect.target}|${action.effect.op}|${action.effect.formulaId ?? action.effect.value ?? ''}`
}

/**
 * hydrate 会把省略的出口填成「下一拍」。过场可以；分叉如果也这样填，
 * 两个选项就变成假选择。这里在闭合校验之后拦住，逼 peer 写后果。
 */
function collectPlayabilityIssues(
  collector: Collector,
  beats: PillarInteractionBeatContract[],
): void {
  for (const [beatIndex, beat] of beats.entries()) {
    if (beat.actions.length < 2) continue
    const exits = new Set(beat.actions.map((action) => exitKey(action.exit)))
    const effects = new Set(
      beat.actions.map(effectKey).filter((key): key is string => key !== null),
    )
    if (exits.size < 2 && effects.size < 2) {
      fail(
        collector,
        `pillarInteractionContract.beats[${beatIndex}] (${beat.id}) 有多个选项，`
          + '但出口相同且数值后果无差异；不同选项必须走向不同节拍/终局，或改相反方向的数值',
      )
    }
  }
}

function collectStateTargetIssues(
  collector: Collector,
  target: string | undefined,
  path: string,
  entityAttrs: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  if (!target) return
  const variable = /^var\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (variable) return
  const attr = /^entity\.([A-Za-z_][A-Za-z0-9_]*)\.attr\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (attr) {
    const attrs = entityAttrs.get(attr[1]!)
    if (!attrs) {
      fail(collector, `${path} 未命中 entities：${attr[1]}`)
      return
    }
    if (!attrs.has(attr[2]!)) {
      fail(collector, `${path} 未命中 entity.${attr[1]} 的属性：${attr[2]}`)
    }
    return
  }
  fail(collector, `${path} 必须是 var.<id> 或 entity.<id>.attr.<attr>：${target}`)
}

function collectOverlayUniquenessIssues(
  collector: Collector,
  beats: PillarInteractionBeatContract[],
): void {
  for (const [beatIndex, beat] of beats.entries()) {
    if (beat.allowDuplicateOverlays) continue
    const duplicates = duplicateMountedOverlayComponents(beat)
    if (duplicates.length === 0) continue
    fail(
      collector,
      `pillarInteractionContract.beats[${beatIndex}] (${beat.id}) 同一节点重复使用覆盖物组件 ${duplicates.join('、')}；`
        + '一个节点通常只挂一份该组件，多个动作共用同一覆盖物的不同事件。'
        + '确需两份时声明 allowDuplicateOverlays: true',
    )
  }
}

function collectCrossReferenceIssues(
  collector: Collector,
  beats: PillarInteractionBeatContract[],
  entities: PillarEntityContract[],
  formulas: PillarFormulaContract[],
  endings: PillarEndingContract[],
): void {
  const beatIds = new Set(beats.map((beat) => beat.id))
  const formulaIds = new Set(formulas.map((formula) => formula.id))
  const endingIds = new Set(endings.map((ending) => ending.id))
  const entityAttrs = new Map(
    entities.map((entity) => [entity.id, new Set(entity.attrs.map((attr) => attr.id))] as const),
  )
  for (const [beatIndex, beat] of beats.entries()) {
    const beatPath = `pillarInteractionContract.beats[${beatIndex}]`
    for (const [actionIndex, action] of beat.actions.entries()) {
      const actionPath = `${beatPath}.actions[${actionIndex}]`
      if (action.exit?.kind === 'beat' && !beatIds.has(action.exit.toBeatId)) {
        fail(collector, `${actionPath}.exit.toBeatId 未命中节拍：${action.exit.toBeatId}`)
      }
      if (action.exit?.kind === 'ending' && !endingIds.has(action.exit.endingId)) {
        fail(collector, `${actionPath}.exit.endingId 未命中 endings：${action.exit.endingId}`)
      }
      const formulaId = action.effect?.formulaId
      if (formulaId && !formulaIds.has(formulaId)) {
        fail(collector, `${actionPath}.effect.formulaId 未命中 formulas：${formulaId}`)
      }
      collectStateTargetIssues(
        collector,
        action.effect?.target,
        `${actionPath}.effect.target`,
        entityAttrs,
      )
      if (action.feedbackSpec?.kind === 'state-binding') {
        collectStateTargetIssues(
          collector,
          action.feedbackSpec.target,
          `${actionPath}.feedbackSpec.target`,
          entityAttrs,
        )
      }
    }
    for (const [settlementIndex, settlement] of beat.settlements.entries()) {
      const settlementPath = `${beatPath}.settlements[${settlementIndex}]`
      if (settlement.exit?.kind === 'beat' && !beatIds.has(settlement.exit.toBeatId)) {
        fail(collector, `${settlementPath}.exit.toBeatId 未命中节拍：${settlement.exit.toBeatId}`)
      }
      if (settlement.exit?.kind === 'ending' && !endingIds.has(settlement.exit.endingId)) {
        fail(collector, `${settlementPath}.exit.endingId 未命中 endings：${settlement.exit.endingId}`)
      }
      if (settlement.triggerSpec?.type !== 'watch') continue
      collectStateTargetIssues(
        collector,
        settlement.triggerSpec.of,
        `${settlementPath}.triggerSpec.of`,
        entityAttrs,
      )
    }
  }
  for (const [endingIndex, ending] of endings.entries()) {
    if (!ending.when) continue
    const left = /^\s*(\S+)/u.exec(ending.when)?.[1]
    collectStateTargetIssues(
      collector,
      left,
      `pillarInteractionContract.endings[${endingIndex}].when`,
      entityAttrs,
    )
  }
}

function extractContractBlocks(markdown: string): string[] {
  // Accept both the canonical machine fence and the author-facing collapsed
  // details form emitted by the design peer. The language tag is presentation
  // only; the summary remains the stable contract marker. A long pillar may
  // split its beats across multiple blocks, so every matching block is part of
  // the same contract rather than silently dropping all but the first one.
  const canonicalBlocks = Array.from(
    markdown.matchAll(/```pillar-interaction-contract\s*([\s\S]*?)```/gu),
    (match) => match[1]!,
  )
  if (canonicalBlocks.length > 0) return canonicalBlocks
  const detailBlocks = Array.from(
    markdown.matchAll(/<summary>\s*pillar-interaction-contract\s*<\/summary>[\s\S]*?```(?:jsonc|json)?\s*([\s\S]*?)```/giu),
    (match) => match[1]!,
  )
  if (detailBlocks.length > 0) return detailBlocks
  const trimmed = markdown.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return [trimmed]
  return []
}

function collectNamedEntries(
  collector: Collector,
  value: unknown,
  path: string,
  requireBrief = false,
): PillarNamedEntry[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    fail(collector, `${path} 必须是对象数组`)
    return undefined
  }
  const entries: PillarNamedEntry[] = []
  for (let index = 0; index < value.length; index++) {
    const item = collectRecord(collector, value[index], `${path}[${index}]`)
    if (!item) continue
    const name = collectString(collector, item.name, `${path}[${index}].name`)
    if (name === undefined) continue
    const summary = item.summary === undefined
      ? undefined
      : collectString(collector, item.summary, `${path}[${index}].summary`)
    if (requireBrief) {
      if (!summary) {
        fail(collector, `${path}[${index}].summary 必须写清外形或场景视觉，下游角色 / 视频预设会直接引用`)
        continue
      }
      if (summary.length < MIN_PILLAR_CREATIVE_BRIEF_LENGTH) {
        fail(
          collector,
          `${path}[${index}].summary 太短（至少 ${MIN_PILLAR_CREATIVE_BRIEF_LENGTH} 字），四个字的身份标签不够给下游出图`,
        )
      }
    }
    entries.push(summary ? { name, summary } : { name })
  }
  return entries
}

export interface ParsePillarOptions {
  /** 分批写入：只验证节拍形状，不 hydrate、不闭合引用。合并完成后再走默认闭合解析。 */
  authoring?: boolean
}

/**
 * 收集全部契约问题并尝试解析。返回 `contract` 仅在契约完全合法时非空；
 * `issues` 始终是「这次能发现的所有问题」，供校验反馈一次性回给 peer，
 * 而不是像历史实现那样遇到第一个错就 throw、让 peer 来回猜 17 次。
 */
function parseInternal(
  markdown: string,
  options: ParsePillarOptions = {},
): { contract: PillarInteractionContract | null; issues: string[] } {
  const collector: Collector = { issues: [] }
  const blocks = extractContractBlocks(markdown)
  if (blocks.length === 0 || blocks.every((block) => !block.trim())) {
    fail(collector, '支柱缺少 ```pillar-interaction-contract 机器契约块')
    return { contract: null, issues: collector.issues }
  }

  const roots: ParsedRoot[] = []
  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block)
    } catch (error) {
      fail(collector, `支柱互动契约 JSON 无效：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const root = collectRecord(collector, parsed, 'pillarInteractionContract')
    if (!root) continue
    const schemaVersion = [1, 2, 3, 4].includes(root.schemaVersion as number)
      ? root.schemaVersion as number
      : (options.authoring ? 4 : null)
    if (schemaVersion == null) {
      fail(collector, 'pillarInteractionContract.schemaVersion 必须是 1、2、3 或 4')
      continue
    }
    if (!Array.isArray(root.beats) || root.beats.length === 0) {
      fail(collector, 'pillarInteractionContract.beats 至少需要一个互动节拍')
      continue
    }
    roots.push({
      schemaVersion: schemaVersion as PillarInteractionContract['schemaVersion'],
      beats: root.beats,
      ...(root.variables === undefined ? {} : { variables: root.variables as unknown[] }),
      ...(root.entities === undefined ? {} : { entities: root.entities as unknown[] }),
      ...(root.formulas === undefined ? {} : { formulas: root.formulas as unknown[] }),
      ...(root.endings === undefined ? {} : { endings: root.endings as unknown[] }),
      ...(root.title === undefined ? {} : { title: root.title }),
      ...(root.cast === undefined ? {} : { cast: root.cast }),
      ...(root.settings === undefined ? {} : { settings: root.settings }),
      ...(root.mainLoop === undefined ? {} : { mainLoop: root.mainLoop }),
    })
  }
  if (roots.length === 0) {
    return { contract: null, issues: collector.issues }
  }

  const schemaVersion = roots[0]!.schemaVersion
  if (roots.some((root) => root.schemaVersion !== schemaVersion)) {
    fail(collector, 'pillarInteractionContract.schemaVersion 在多个契约块之间必须一致')
  }

  const rawBeats = roots.flatMap((root) => root.beats ?? [])
  if (rawBeats.length === 0) {
    fail(collector, 'pillarInteractionContract.beats 至少需要一个互动节拍')
    return { contract: null, issues: collector.issues }
  }
  const ids = new Set<string>()
  const beats: PillarInteractionBeatContract[] = []
  for (let beatIndex = 0; beatIndex < rawBeats.length; beatIndex++) {
    const beat = collectBeat(collector, rawBeats[beatIndex], beatIndex, schemaVersion, ids)
    if (beat) beats.push(beat)
  }

  const rootWithTables = roots.find((root) => (
    root.variables ?? root.entities ?? root.formulas ?? root.endings ?? root.cast ?? root.settings ?? root.mainLoop ?? root.title
  )) ?? roots[0]
  const variables = collectVariables(collector, rootWithTables?.variables)
  const entities = collectEntities(collector, rootWithTables?.entities)
  const formulas = collectFormulas(collector, rootWithTables?.formulas)
  const endings = collectEndings(collector, rootWithTables?.endings)
  const title = rootWithTables?.title === undefined
    ? undefined
    : collectString(collector, rootWithTables.title, 'pillarInteractionContract.title')
  const cast = collectNamedEntries(
    collector,
    rootWithTables?.cast,
    'pillarInteractionContract.cast',
    schemaVersion >= 4,
  )
  const settings = collectNamedEntries(
    collector,
    rootWithTables?.settings,
    'pillarInteractionContract.settings',
    schemaVersion >= 4,
  )
  const mainLoop = rootWithTables?.mainLoop === undefined
    ? undefined
    : collectString(collector, rootWithTables.mainLoop, 'pillarInteractionContract.mainLoop')
  if (beats.length === 0) {
    return { contract: null, issues: collector.issues }
  }
  if (collector.issues.length > 0) {
    return { contract: null, issues: collector.issues }
  }

  const parsed: PillarInteractionContract = {
    schemaVersion,
    beats,
    ...(variables.length > 0 ? { variables } : {}),
    ...(entities.length > 0 ? { entities } : {}),
    ...(formulas.length > 0 ? { formulas } : {}),
    ...(endings.length > 0 ? { endings } : {}),
    ...(title ? { title } : {}),
    ...(cast && cast.length > 0 ? { cast } : {}),
    ...(settings && settings.length > 0 ? { settings } : {}),
    ...(mainLoop ? { mainLoop } : {}),
  }
  if (options.authoring) {
    return { contract: parsed, issues: [] }
  }
  // v4 创作面允许省略机械字段；Host 在校验闭合引用前补全。v1–v3 保持原样，
  // 避免把旧文档的配对错误悄悄填成合法契约。
  const contract = schemaVersion >= 4 ? hydratePillarContract(parsed) : parsed
  if (schemaVersion >= 2) {
    for (const [beatIndex, beat] of contract.beats.entries()) {
      const path = `pillarInteractionContract.beats[${beatIndex}]`
      for (const action of beat.actions) {
        const paired = beat.settlements.some((settlement) => settlement.sourceActionId === action.id)
        if (action.stateMutationOwner === 'settlement' && !paired) {
          fail(collector, `${path}.actions[${action.id}] 声明由 settlement 修改状态，但没有 sourceActionId 配对结算`)
        }
      }
    }
  }
  if (schemaVersion >= 4) {
    collectCrossReferenceIssues(
      collector,
      contract.beats,
      contract.entities ?? [],
      contract.formulas ?? [],
      contract.endings ?? [],
    )
    collectPlayabilityIssues(collector, contract.beats)
    collectOverlayUniquenessIssues(collector, contract.beats)
  }

  if (collector.issues.length > 0) {
    return { contract: null, issues: collector.issues }
  }
  return { contract, issues: [] }
}

export function parsePillarInteractionContract(
  markdown: string,
  options: ParsePillarOptions = {},
): PillarInteractionContract {
  const { contract, issues } = parseInternal(markdown, options)
  if (!contract) throw new PillarContractError(issues)
  return contract
}

/**
 * 校验入口：返回这一次能发现的**全部**契约问题（而非第一条）。
 *
 * 用于 `documentSubstanceIssues` 一次性把 `document.pillar.interaction-contract-invalid`
 * 的所有成因反馈给 peer，消除「报一条 → 整篇重传 → 再报下一条」的返工循环。
 */
export function collectPillarInteractionContractIssues(
  markdown: string,
  options: ParsePillarOptions = {},
): string[] {
  return parseInternal(markdown, options).issues
}

export function fencePillarContract(contract: PillarInteractionContract): string {
  return `\`\`\`pillar-interaction-contract\n${JSON.stringify(contract)}\n\`\`\``
}
