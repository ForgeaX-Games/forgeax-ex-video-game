/**
 * 支柱编译的「整装」半边：把玩法工单照单施工成可玩蓝图。
 *
 * 总脉络那半边只**下订单**——它在 `node.data.interaction` 里写清「这个动作由
 * `BattleSkill.light` 承载、改 `var.liubeiWill`、命中帧在 900ms」，但按当年的
 * 分工「你只声明，不落地：不挂元件、不绑数据、不写公式」。挂载、绑血量、接
 * 结算是整装的活。
 *
 * 编译器最初只搬来了下订单那半边，于是产出的图里 `overlayNodes` 恒为空：
 * 没有任何元件会发出 `B01-ying`，总脉络写好的 advance reaction 永远不触发，
 * 结算也只剩一条不会被触发的事件 reaction。图看着有节点有边，实际不可玩。
 *
 * 这里补上另一半，且同样是确定性的——工单里每个字段都已由支柱定稿，施工不需
 * 要再做创作判断。
 */
import { configureBlueprintNode } from '@/authoring/commands/configure-blueprint-node'
import type {
  EventResponseConfiguration,
  InterfaceConfiguration,
  SettlementConfiguration,
  SpawnInterfaceConfiguration,
} from '@/authoring/commands/configure-blueprint-node'
import type {
  GraphClause,
  GraphCondition,
  GraphEffect,
  GraphLibraryDocument,
} from '@/runtime/core/schema/graph-schema'
import type { PillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import { componentContractMap } from './component-catalog'

export interface PillarIntegrationIssue {
  code: 'document.pillar.not-buildable' | 'document.pillar.compiler-error'
  message: string
}

export type PillarIntegrationResult =
  | { ok: true; document: GraphLibraryDocument }
  | { ok: false; issues: PillarIntegrationIssue[] }

/** 出厂空库为目录里每个组件都备了一份 `base:<id>` 单组件方案。 */
function baseOverlayId(component: string): string {
  return `base:${component}`
}

function baseChildId(component: string): string {
  return `${component}-0`
}

/** 支柱的 `var.<id>` / `entity.<id>.attr.<attr>` 目标 → 运行时 effect。 */
function effectFrom(target: string, op: 'add' | 'sub' | 'set', expr: string): GraphEffect | null {
  // 运行时没有 `sub`：减法是「加一个负数」。写成 `op:'sub'` 会静默不生效。
  const negate = op === 'sub'
  const runtimeOp = negate ? 'add' : op
  const value = negate ? { expr: `-${expr}` } : { expr }
  const variable = /^var\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (variable) return { kind: 'var', varId: variable[1]!, op: runtimeOp, value }
  const attr = /^entity\.([A-Za-z_][A-Za-z0-9_]*)\.attr\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (attr) return { kind: 'attr', entityId: attr[1]!, attr: attr[2]!, op: runtimeOp, value }
  return null
}

/**
 * 公式引用必须写成 `formula.<id>`；裸公式名会被当成未知符号，玩家点下去时
 * 结算失败。常量直接写字面量。
 */
function effectExpr(effect: { formulaId?: string; value?: number }): string | null {
  if (effect.formulaId) return `formula.${effect.formulaId}`
  if (typeof effect.value === 'number') return String(effect.value)
  return null
}

interface PillarActionLike {
  effect?: { target: string; op: 'add' | 'sub' | 'set'; formulaId?: string; value?: number }
  feedbackSpec?: { kind: string; component?: string; target?: string }
}

function graphEffectFor(action: PillarActionLike): GraphEffect | null {
  if (!action.effect) return null
  const expr = effectExpr(action.effect)
  if (!expr) return null
  return effectFrom(action.effect.target, action.effect.op, expr)
}

/** 血条的 `max` 需要一个确定数值，绑表达式会让空条或满条。 */
function bindingMax(pillar: PillarInteractionContract, target: string): number | undefined {
  const variable = /^var\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (variable) {
    return (pillar.variables ?? []).find((entry) => entry.id === variable[1])?.max
  }
  const attr = /^entity\.([A-Za-z_][A-Za-z0-9_]*)\.attr\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (!attr) return undefined
  return (pillar.entities ?? [])
    .find((entity) => entity.id === attr[1])
    ?.attrs.find((entry) => entry.id === attr[2])
    ?.max
}

/**
 * 元件输入绑定。只绑该元件契约里真实存在的键——空挂（挂上却不接线）等于让
 * 玩家看见一个点了没反应的控件。
 */
function inputsForCarrier(
  component: string,
  group: readonly NodeInteractionAction[],
): Record<string, unknown> | undefined {
  const contract = componentContractMap().get(component)
  if (!contract) return undefined
  const keys = new Set(contract.inputs.map((input) => input.key))
  const inputs: Record<string, unknown> = {}
  // 选项类控件的文案就是动作意图；不填的话玩家看到的是占位符「摁F交互」。
  const intent = group.map((action) => action.intent ?? '').find(Boolean)
  if (keys.has('text') && intent) inputs.text = intent
  // BattleSkill 这类多招控件：没用到的事件必须永久置灰。缺省 cost=0/resource=0
  // 会让按钮亮着、点了没人接——审查就会报「点了不会有任何效果」。
  const used = new Set(group.map((action) => action.event).filter((event): event is string => Boolean(event)))
  for (const event of contract.events) {
    if (used.has(event.id)) continue
    const costKey = `${event.id}Cost`
    const resourceKey = `${event.id}Resource`
    if (!keys.has(costKey) || !keys.has(resourceKey)) continue
    inputs[costKey] = 1
    inputs[resourceKey] = 0
  }
  return Object.keys(inputs).length > 0 ? inputs : undefined
}

/**
 * 状态绑定值的落盘形状。
 *
 * 裸字符串只在数值型 numberExpr 上凑巧能求值；文本型输入（飘字/状态提示的
 * `parameter`）会被 `resolveTextValue` 原样显示成字面量「var.trust」，玩家看不到
 * 数值。而且所有校验器只认 `{ expr }` / `{ ref }`，裸字符串绑了也等于没绑：
 * 生命周期审查会把「结算已经把数值弹给玩家看」判成没有可见反馈。
 */
function stateBindingValue(valueType: string | undefined, target: string): Record<string, string> {
  return valueType === 'string' ? { ref: target } : { expr: target }
}

function stateBindingInputs(
  component: string,
  target: string,
  max: number | undefined,
): Record<string, unknown> | undefined {
  const contract = componentContractMap().get(component)
  if (!contract) return undefined
  const inputs: Record<string, unknown> = {}
  for (const input of contract.inputs) {
    if (input.key === 'max') {
      if (max !== undefined) inputs.max = max
      continue
    }
    if (input.key !== 'current' && input.key !== 'parameter') continue
    inputs[input.key] = stateBindingValue(input.valueType, target)
  }
  return Object.keys(inputs).length > 0 ? inputs : undefined
}

interface NodeInteractionAction {
  pillarActionId?: string
  component?: string
  event?: string
  intent?: string
  targetNodeId?: string
  effect?: { target: string; op: 'add' | 'sub' | 'set'; formulaId?: string; value?: number }
  feedbackSpec?: { kind: string; component?: string; target?: string }
}

interface NodeInteractionSettlement {
  id?: string
  sourcePillarActionId?: string
  triggerSpec?: { type: 'at'; ms: number } | { type: 'watch'; of: string; on?: string } | { type: 'state'; condition: unknown }
  feedbackSpec?: { kind: string; component?: string; target?: string }
  targetNodeId?: string
  exit?: string
}

interface NodeInteraction {
  actions?: NodeInteractionAction[]
  settlements?: NodeInteractionSettlement[]
}

/** 支柱里所有动作的索引：结果节点要靠 `sourcePillarActionId` 找回它的 effect。 */
function actionIndex(pillar: PillarInteractionContract): Map<string, PillarActionLike> {
  const index = new Map<string, PillarActionLike>()
  for (const beat of pillar.beats) {
    for (const action of beat.actions) index.set(action.id, action)
  }
  return index
}

function spawnFor(
  feedbackSpec: { kind: string; component?: string; target?: string } | undefined,
  parameter: string | undefined,
): SpawnInterfaceConfiguration | null {
  if (feedbackSpec?.kind !== 'transient-component' || !feedbackSpec.component) return null
  const component = feedbackSpec.component
  const inputs = parameter ? stateBindingInputs(component, parameter, undefined) : undefined
  return {
    overlayId: baseOverlayId(component),
    childId: baseChildId(component),
    ...(inputs ? { inputs } : {}),
  }
}


/**
 * 为一个节点算出整装事务。返回 `null` 表示这个节点没有要施工的东西
 * （纯叙事节点既没有元件也没有结算）。
 */
function transactionFor(
  document: GraphLibraryDocument,
  nodeId: string,
  interaction: NodeInteraction,
  pillar: PillarInteractionContract,
  actions: Map<string, PillarActionLike>,
): { interfaces: InterfaceConfiguration[]; settlements: SettlementConfiguration[] } | null {
  const interfaces: InterfaceConfiguration[] = []
  const settlements: SettlementConfiguration[] = []

  // ── 承载元件：同一个组件在一个节点上只挂一次，多个动作共用它的不同事件 ──
  const byComponent = new Map<string, NodeInteractionAction[]>()
  for (const action of interaction.actions ?? []) {
    if (!action.component || !action.event) continue
    const bucket = byComponent.get(action.component) ?? []
    bucket.push(action)
    byComponent.set(action.component, bucket)
  }

  for (const [component, group] of byComponent) {
    if (!document.ui?.overlays?.[baseOverlayId(component)]) continue
    const childId = baseChildId(component)
    const inputs = inputsForCarrier(component, group)
    // 挂载级 reaction 必须精确匹配契约事件：只做沿边跳转，不在点击里改数值。
    // 数值留给结果节点的时间轴结算，否则审查会报 effect-owned-by-event。
    const eventResponses: EventResponseConfiguration[] = group.flatMap((action) => {
      if (!action.event || !action.targetNodeId || action.targetNodeId === nodeId) return []
      return [{ childId, eventId: action.event, targetNodeId: action.targetNodeId }]
    })
    interfaces.push({
      overlayId: baseOverlayId(component),
      components: [{ childId, ...(inputs ? { inputs } : {}) }],
      ...(eventResponses.length > 0 ? { eventResponses } : {}),
    })
  }

  // ── 状态反馈元件：血条之类必须挂上并绑到真实变量，否则玩家看不到数值变化 ──
  // 已作为玩家输入挂上的组件不再复挂一份同类覆盖物。
  // 结果节点也要挂：数值是在它的时间轴上变的，玩家正是在这段结果视频里看血条掉下去。
  const bound = new Set<string>(byComponent.keys())
  const stateBindings = [
    ...(interaction.actions ?? []).map((action) => action.feedbackSpec),
    ...(interaction.settlements ?? []).map((settlement) => (
      settlement.sourcePillarActionId
        ? actions.get(settlement.sourcePillarActionId)?.feedbackSpec
        : undefined
    )),
  ]
  for (const feedback of stateBindings) {
    if (feedback?.kind !== 'state-binding' || !feedback.component || !feedback.target) continue
    if (bound.has(feedback.component)) continue
    // 飘字与状态提示只能由 reaction.spawn 产生：静态挂上去会被
    // `ui.floattext.static-mount` 拦下，整份支柱以「节点静态挂载了 StatusNotice」失败。
    if (componentContractMap().get(feedback.component)?.timing?.kind === 'spawn-only') continue
    if (!document.ui?.overlays?.[baseOverlayId(feedback.component)]) continue
    bound.add(feedback.component)
    const inputs = stateBindingInputs(
      feedback.component,
      feedback.target,
      bindingMax(pillar, feedback.target),
    )
    interfaces.push({
      overlayId: baseOverlayId(feedback.component),
      components: [{ childId: baseChildId(feedback.component), ...(inputs ? { inputs } : {}) }],
    })
  }

  // ── 结算：把工单的 triggerSpec 落成真实结算，并把数值 effect 应用上去 ──
  for (const settlement of interaction.settlements ?? []) {
    const trigger = settlement.triggerSpec
    if (!trigger) continue
    const source = settlement.sourcePillarActionId
      ? actions.get(settlement.sourcePillarActionId)
      : undefined
    const effect = source ? graphEffectFor(source) : null
    const spawn = spawnFor(settlement.feedbackSpec, source?.effect?.target)
    // 没有数值变化也没有反馈的结算不必落地：它的出口已经由总脉络的边承接。
    if (!effect && !spawn && !settlement.targetNodeId) continue
    // 复用总脉络已规划的那条边要连 `targetNodeId` 一起给：只给 edgeId 会被
    // 事务拒绝，而临时造边会丢掉支柱 trace 与 producer。
    const edgeId = settlement.targetNodeId
      ? edgeIdFor(document, nodeId, settlement.exit)
      : undefined
    settlements.push({
      trigger: normalizeStateTrigger(trigger) as SettlementConfiguration['trigger'],
      ...(effect ? { effects: [effect] } : {}),
      ...(spawn ? { spawns: [spawn] } : {}),
      ...(settlement.targetNodeId ? { targetNodeId: settlement.targetNodeId } : {}),
      ...(edgeId ? { edgeId } : {}),
    })
  }

  if (interfaces.length === 0 && settlements.length === 0) return null
  return { interfaces, settlements }
}

const CMP_OPS: Record<string, GraphClause extends { op: infer O } ? O : never> = {
  '>=': 'gte',
  '<=': 'lte',
  '>': 'gt',
  '<': 'lt',
  '==': 'eq',
  '=': 'eq',
  '!=': 'neq',
} as never

/**
 * 终局判定条件 → 出边条件。
 *
 * 跨节拍终局必须写在出边 `data.condition` 上：`state` reaction 只在当前节点
 * 驻留期间由 false 变 true 时触发，而上一拍就已经成立的终局条件在进入下一拍时
 * 会直接以 true 建基线，于是永远不触发。
 */
/**
 * 策划把状态条件写成 `"entity.enemy.attr.hp <= 0"` 这样的表达式子句是很自然的，
 * 但运行时要的是结构化子句。不归一化就会产出一条 `condition.all` 全是字符串的
 * reaction：运行时读不懂，可玩性审查报 `condition.shape.invalid`，而这是编译器
 * 的锅——策划改 IR 也修不掉，只会把支柱门堵死。
 */
export function normalizeStateTrigger<T>(trigger: T): T {
  if (!trigger || typeof trigger !== 'object' || (trigger as { type?: string }).type !== 'state') return trigger
  const condition = (trigger as { condition?: unknown }).condition
  if (!condition || typeof condition !== 'object') return trigger
  const all = (condition as { all?: unknown }).all
  if (!Array.isArray(all)) return trigger
  const clauses = all.flatMap((clause) => {
    if (typeof clause === 'string') return conditionFrom(clause)?.all ?? []
    const record = clause as Record<string, unknown>
    if (typeof record?.expr === 'string') return conditionFrom(record.expr)?.all ?? []
    // 创作面把表达式解析成 `{type:'field', field, op, value}` 这类比较子句，运行时
    // 只认 var / attr 子句。按 field + op 识别而不是认某个 type 名：转换是纯查表，
    // 该由编译器做，不该让策划去猜运行时的内部形状。
    if (typeof record?.field === 'string' && typeof record.op === 'string') {
      return conditionFrom(`${record.field} ${record.op} ${String(record.value)}`)?.all ?? []
    }
    return [clause]
  })
  return { ...trigger, condition: { all: clauses } } as T
}

function conditionFrom(when: string): GraphCondition | null {
  const match = /^\s*(\S+)\s*(>=|<=|!=|==|=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$/u.exec(when)
  if (!match) return null
  const [, left, symbol, rawValue] = match
  const op = CMP_OPS[symbol!]
  if (!op) return null
  const value = Number(rawValue)
  const variable = /^var\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(left!)
  if (variable) return { all: [{ type: 'var', varId: variable[1]!, op, value }] }
  const attr = /^entity\.([A-Za-z_][A-Za-z0-9_]*)\.attr\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(left!)
  if (attr) return { all: [{ type: 'attr', entityId: attr[1]!, attr: attr[2]!, op, value }] }
  return null
}

/**
 * 把每个带 `when` 的终局条件写到通往它的每条边上。
 *
 * 没有 `when` 的终局保持无条件，充当兜底出口——否则所有路径都带条件时，
 * 条件都不满足的那一局会走不到任何终局。
 */
function applyEndingConditions(
  document: GraphLibraryDocument,
  pillar: PillarInteractionContract,
  endingNodeIds: Readonly<Record<string, string>>,
): GraphLibraryDocument {
  const next = structuredClone(document)
  const pack = next.manifest.packs[next.manifest.mainPackId]
  if (!pack) return next
  for (const ending of pillar.endings ?? []) {
    if (!ending.when) continue
    const condition = conditionFrom(ending.when)
    const nodeId = endingNodeIds[ending.id]
    if (!condition || !nodeId) continue
    for (const edge of pack.graph.edges) {
      if (edge.target !== nodeId) continue
      edge.data = { ...edge.data, condition }
    }
  }
  return next
}

/** 复用总脉络已规划的那条边；临时造边会丢掉支柱 trace 与 producer。 */
function edgeIdFor(
  document: GraphLibraryDocument,
  nodeId: string,
  exit: string | undefined,
): string | undefined {
  if (!exit) return undefined
  const pack = document.manifest.packs[document.manifest.mainPackId]
  const edge = pack?.graph.edges.find((candidate) => (
    candidate.source === nodeId && candidate.sourceHandle === exit
  ))
  return edge?.id
}

/**
 * 把编译出的工单整装成可玩蓝图。
 *
 * 失败关闭：任何一个节点装不上都返回问题，不留一张「有节点没界面」的半成品。
 */
export function integrateCompiledPillar(
  inputDocument: GraphLibraryDocument,
  pillar: PillarInteractionContract,
  endingNodeIds: Readonly<Record<string, string>> = {},
): PillarIntegrationResult {
  const contracts = componentContractMap()
  const actions = actionIndex(pillar)
  let document = inputDocument

  try {
    const pack = document.manifest.packs[document.manifest.mainPackId]
    const nodeIds = (pack?.graph.nodes ?? []).map((node) => node.id)
    for (const nodeId of nodeIds) {
      const current = document.manifest.packs[document.manifest.mainPackId]
      const node = current?.graph.nodes.find((candidate) => candidate.id === nodeId)
      const interaction = node?.data.interaction as NodeInteraction | undefined
      if (!interaction) continue
      const transaction = transactionFor(document, nodeId, interaction, pillar, actions)
      if (!transaction) continue
      const configured = configureBlueprintNode(
        document,
        {
          nodeId,
          ...(transaction.interfaces.length > 0 ? { interfaces: transaction.interfaces } : {}),
          ...(transaction.settlements.length > 0 ? { settlements: transaction.settlements } : {}),
        },
        contracts,
      )
      if (!configured.ok) {
        return {
          ok: false,
          issues: configured.errors.map((message) => ({
            code: 'document.pillar.not-buildable' as const,
            message: `节点 ${nodeId} 整装失败：${message}`,
          })),
        }
      }
      document = configured.document
    }
    return { ok: true, document: applyEndingConditions(document, pillar, endingNodeIds) }
  } catch (error) {
    return {
      ok: false,
      issues: [{
        code: 'document.pillar.compiler-error',
        message: `支柱整装异常：${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
}
