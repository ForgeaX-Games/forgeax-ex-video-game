import type {
  PillarEffectContract,
  PillarEndingContract,
  PillarEntityContract,
  PillarFeedbackContract,
  PillarFormulaContract,
  PillarInteractionActionContract,
  PillarInteractionBeatContract,
  PillarInteractionContract,
  PillarNamedEntry,
  PillarSettlementContract,
  PillarTriggerSpecContract,
  PillarVariableContract,
} from './pillar-interaction-contract'
import { fencePillarContract } from './pillar-interaction-contract'
import { hydratePillarContract } from './pillar-hydrate'
import { collectBeatOverlayPlan } from './pillar-overlay-plan'

const ROLE_LABEL = {
  'player-choice': '剧情选择',
  'combat-command': '战斗指令',
  'timed-input': '限时输入',
} as const

const OP_LABEL = { add: '增加', sub: '减少', set: '设为' } as const

function namedList(entries: readonly PillarNamedEntry[] | undefined, empty: string): string {
  if (!entries || entries.length === 0) return empty
  return entries.map((entry) => (
    entry.summary ? `- **${entry.name}**：${entry.summary}` : `- **${entry.name}**`
  )).join('\n')
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return ''
  const head = `| ${headers.map(cell).join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

function variableLabel(
  variables: readonly PillarVariableContract[],
  id: string,
): string {
  const found = variables.find((variable) => variable.id === id)
  return found?.label?.trim() || id
}

function formulaLabel(
  formulas: readonly PillarFormulaContract[],
  id: string,
): string {
  const found = formulas.find((formula) => formula.id === id)
  return found?.summary?.trim() || id
}

function endingLabel(
  endings: readonly PillarEndingContract[],
  id: string,
): string {
  const found = endings.find((ending) => ending.id === id)
  return found ? `${found.title}（${id}）` : id
}

function describeTarget(
  target: string,
  variables: readonly PillarVariableContract[],
  entities: readonly PillarEntityContract[] = [],
): string {
  const variable = /^var\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (variable) return `变量「${variableLabel(variables, variable[1]!)}」`
  const entity = /^entity\.([A-Za-z_][A-Za-z0-9_]*)\.attr\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(target)
  if (entity) {
    const declared = entities.find((entry) => entry.id === entity[1])
    const attr = declared?.attrs.find((entry) => entry.id === entity[2])
    const object = declared?.label?.trim() || entity[1]!
    const field = attr?.label?.trim() || entity[2]!
    return `实体「${object}」的 ${field}`
  }
  return target
}

function collectRefs(text: string | undefined): { variables: string[]; entities: string[] } {
  const variables = new Set<string>()
  const entities = new Set<string>()
  if (!text) return { variables: [], entities: [] }
  for (const match of text.matchAll(/var\.([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    variables.add(match[1]!)
  }
  for (const match of text.matchAll(/entity\.([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    entities.add(match[1]!)
  }
  return { variables: [...variables], entities: [...entities] }
}

function describeEffect(
  effect: PillarEffectContract | undefined,
  variables: readonly PillarVariableContract[],
  formulas: readonly PillarFormulaContract[],
  entities: readonly PillarEntityContract[] = [],
): string {
  if (!effect) return '不改数值'
  const amount = effect.formulaId
    ? `公式「${formulaLabel(formulas, effect.formulaId)}」`
    : String(effect.value ?? '')
  return `${describeTarget(effect.target, variables, entities)} ${OP_LABEL[effect.op]} ${amount}`.trim()
}

function describeFeedback(spec: PillarFeedbackContract | undefined): string {
  if (!spec) return '（未指定，编译时按缺省）'
  if (spec.kind === 'hide-interface') return '收起本拍界面'
  if (spec.kind === 'transient-component') return `瞬时反馈：${spec.component}`
  return `常驻绑定 ${spec.component} ← ${spec.target}`
}

function describeSettlementExit(
  settlement: PillarSettlementContract,
  endings: readonly PillarEndingContract[],
): string {
  const exit = settlement.exit
  if (!exit) return settlement.exitIntent || '继续演出'
  if (exit.kind === 'stay') return '留在本拍（战斗回合继续）'
  if (exit.kind === 'ending') return `进入结局「${endingLabel(endings, exit.endingId)}」`
  return `进入节拍 ${exit.toBeatId}`
}

function describeExit(
  action: PillarInteractionActionContract,
  endings: readonly PillarEndingContract[],
): string {
  const exit = action.exit
  if (!exit) return action.exitIntent || '默认下一拍'
  if (exit.kind === 'stay') return '留在本拍（战斗回合继续）'
  if (exit.kind === 'ending') return `进入结局「${endingLabel(endings, exit.endingId)}」`
  return `进入节拍 ${exit.toBeatId}`
}

function describeTrigger(spec: PillarTriggerSpecContract | undefined, trigger: string): string {
  if (!spec) {
    if (trigger === 'at') return '动作命中后结算'
    if (trigger === 'watch') return '监视数值变化'
    return '条件成立时结算'
  }
  if (spec.type === 'at') return `动作命中后 ${spec.ms}ms`
  if (spec.type === 'watch') {
    const when = spec.on === 'inc' ? '上升' : spec.on === 'dec' ? '下降' : '变化'
    return `监视 ${spec.of} ${when}`
  }
  return `条件：${JSON.stringify(spec.condition)}`
}

const OVERLAY_ROLE_LABEL = {
  input: '玩家输入',
  hud: '常驻覆盖',
  transient: '瞬时反馈',
} as const

function renderOverlayPlan(beat: PillarInteractionBeatContract): string {
  const rows = collectBeatOverlayPlan(beat).map((row) => [
    OVERLAY_ROLE_LABEL[row.role],
    row.component,
    row.target ?? '—',
  ])
  if (rows.length === 0) return '（无覆盖物；过场可只靠点击推进）'
  return [
    table(['用途', '覆盖物组件', '绑定'], rows),
    '',
    '同一节点通常不挂两份相同组件的覆盖物；多个动作共用一个输入覆盖物的不同事件。瞬时飘字不算常驻挂载。',
  ].join('\n')
}

function describeUi(
  action: PillarInteractionActionContract,
): string {
  const role = action.requiredRole ? ROLE_LABEL[action.requiredRole] : '剧情选择'
  if (action.carrier) return `${role} · ${action.carrier.component}（${action.carrier.event}）`
  if (action.capabilityGap) return `目录缺口：${action.capabilityGap.need}`
  return `${role}（按目录自动挂载）`
}

function beatKindLabel(beat: PillarInteractionBeatContract): string {
  if (beat.actions.some((action) => action.requiredRole === 'combat-command')) return '战斗'
  if (beat.actions.some((action) => action.requiredRole === 'timed-input')) return '限时'
  if (beat.actions.length > 1) return '分叉'
  if (beat.actions.length === 0) return '过场'
  return '推进'
}

function beatResourceRows(
  beat: PillarInteractionBeatContract,
  variables: readonly PillarVariableContract[],
  formulas: readonly PillarFormulaContract[],
  declaredEntities: readonly PillarEntityContract[] = [],
): string[][] {
  const variableIds = new Set<string>()
  const formulaIds = new Set<string>()
  const entities = new Set<string>()
  const absorb = (text: string | undefined, effect?: PillarEffectContract) => {
    const refs = collectRefs(text)
    for (const id of refs.variables) variableIds.add(id)
    for (const id of refs.entities) entities.add(id)
    if (effect) {
      const fromTarget = collectRefs(effect.target)
      for (const id of fromTarget.variables) variableIds.add(id)
      for (const id of fromTarget.entities) entities.add(id)
      if (effect.formulaId) formulaIds.add(effect.formulaId)
    }
  }
  for (const action of beat.actions) {
    absorb(action.effect?.target, action.effect)
    absorb(action.feedbackSpec && action.feedbackSpec.kind === 'state-binding' ? action.feedbackSpec.target : undefined)
  }
  for (const settlement of beat.settlements) {
    absorb(settlement.source)
    if (settlement.triggerSpec?.type === 'watch') absorb(settlement.triggerSpec.of)
    if (settlement.triggerSpec?.type === 'state') absorb(JSON.stringify(settlement.triggerSpec.condition))
  }
  const rows: string[][] = []
  for (const id of variableIds) {
    const variable = variables.find((entry) => entry.id === id)
    const range = variable
      ? `初值 ${variable.initial}`
        + (variable.min !== undefined ? `，最小 ${variable.min}` : '')
        + (variable.max !== undefined ? `，最大 ${variable.max}` : '')
      : '本节拍引用'
    rows.push(['变量', variableLabel(variables, id), range])
  }
  for (const id of formulaIds) {
    const formula = formulas.find((entry) => entry.id === id)
    rows.push(['公式', formulaLabel(formulas, id), formula?.expression || id])
  }
  for (const id of entities) {
    const entity = declaredEntities.find((entry) => entry.id === id)
    rows.push(['实体', entity?.label?.trim() || id, entity ? entity.attrs.map((attr) => attr.label || attr.id).join('、') : '本节拍效果或条件引用'])
  }
  return rows
}

function renderBeat(
  beat: PillarInteractionBeatContract,
  variables: readonly PillarVariableContract[],
  formulas: readonly PillarFormulaContract[],
  endings: readonly PillarEndingContract[],
  entities: readonly PillarEntityContract[] = [],
): string {
  const seen = beat.playerInformation.length > 0
    ? beat.playerInformation.map((item) => `- ${item}`).join('\n')
    : `- ${beat.narrativeIntent}`
  const actionRows = beat.actions.map((action) => [
    action.intent,
    describeUi(action),
    describeEffect(action.effect, variables, formulas, entities),
    describeFeedback(action.feedbackSpec),
    describeExit(action, endings),
  ])
  const settlementRows = beat.settlements.map((settlement) => [
    settlement.intent,
    settlement.sourceActionId ? `承接动作「${
      beat.actions.find((action) => action.id === settlement.sourceActionId)?.intent || settlement.sourceActionId
    }」` : '系统判定',
    describeTrigger(settlement.triggerSpec, settlement.trigger),
    describeFeedback(settlement.feedbackSpec),
    describeSettlementExit(settlement, endings),
  ])
  const resourceRows = beatResourceRows(beat, variables, formulas, entities)
  const loop = beat.loop
    ? `\n\n本拍是战斗回合：每回合「${beat.loop.progress}」。离开条件：${beat.loop.exitConditions.join('；')}。`
    : ''
  return [
    `### ${beat.id} ${beat.narrativeIntent}（${beatKindLabel(beat)}）`,
    '',
    '玩家此时知道：',
    seen,
    ...(beat.staging
      ? ['', '**场面调度**', beat.staging]
      : []),
    '',
    '**界面运用**',
    renderOverlayPlan(beat),
    '',
    '**界面配置**',
    actionRows.length > 0
      ? table(
        ['玩家能做什么', '界面 / 输入', '状态变化', '玩家怎么看见', '去向'],
        actionRows,
      )
      : '（无玩家输入，纯演出）',
    '',
    '**条件结算**',
    settlementRows.length > 0
      ? table(
        ['结算在做什么', '来源', '何时触发', '反馈', '之后'],
        settlementRows,
      )
      : '（无独立结算；过场不改数值、出口走默认下一拍）',
    ...(resourceRows.length > 0
      ? ['', '**本拍用到的变量 / 公式 / 实体**', table(['类型', '名称', '说明'], resourceRows)]
      : []),
    loop,
  ].join('\n')
}

function renderVariableTable(variables: readonly PillarVariableContract[]): string {
  if (variables.length === 0) return '（未声明数值；编译时会按是否有战斗补缺省生命或进度）'
  return table(
    ['名称', '初值', '最小', '最大', '说明'],
    variables.map((variable) => [
      variableLabel(variables, variable.id),
      String(variable.initial),
      variable.min === undefined ? '—' : String(variable.min),
      variable.max === undefined ? '—' : String(variable.max),
      variable.label && variable.label !== variable.id ? variable.id : '玩法数值',
    ]),
  )
}

function renderEntityTable(entities: readonly PillarEntityContract[]): string {
  if (entities.length === 0) return '（未声明规则实体；全局进度、旗标用上方变量即可）'
  return table(
    ['实体', '属性', '初值', '最小', '最大'],
    entities.flatMap((entity) => entity.attrs.map((attr, index) => [
      index === 0 ? (entity.label?.trim() || entity.id) : '',
      attr.label?.trim() || attr.id,
      String(attr.initial),
      attr.min === undefined ? '—' : String(attr.min),
      attr.max === undefined ? '—' : String(attr.max),
    ])),
  )
}

function renderFormulaTable(formulas: readonly PillarFormulaContract[]): string {
  if (formulas.length === 0) return '（无公式；数值变化用固定增减）'
  return table(
    ['名称', '表达式', '用在哪'],
    formulas.map((formula) => [
      formulaLabel([formula], formula.id),
      formula.expression,
      formula.summary || formula.id,
    ]),
  )
}

function renderEndingTable(endings: readonly PillarEndingContract[]): string {
  if (endings.length === 0) return '（未声明结局）'
  return table(
    ['结局', '何时进入', '带走什么'],
    endings.map((ending) => [
      ending.title,
      ending.when?.trim() || '由节拍出口直接到达（兜底）',
      ending.summary,
    ]),
  )
}

/**
 * 作者可读层：只从 IR 渲染。JSON 契约不进这一层。
 * 界面、结算、变量、公式是玩法本身，必须出现在表格里，不能只剩节拍标题。
 */
export function renderAuthorPillarMarkdown(contract: PillarInteractionContract): string {
  const view = contract.schemaVersion >= 4 ? hydratePillarContract(contract) : contract
  const variables = view.variables ?? []
  const entities = view.entities ?? []
  const formulas = view.formulas ?? []
  const endings = view.endings ?? []
  const beats = view.beats.map((beat) => renderBeat(beat, variables, formulas, endings, entities)).join('\n\n')
  return [
    `# ${view.title?.trim() || '支柱设计'}`,
    '',
    '## 角色',
    namedList(view.cast, '（待补）'),
    '',
    '## 场景',
    namedList(view.settings, '（待补）'),
    '',
    '## 主循环',
    view.mainLoop?.trim() || '（待补）',
    '',
    '## 数值',
    renderVariableTable(variables),
    '',
    '## 实体',
    renderEntityTable(entities),
    '',
    '## 公式',
    renderFormulaTable(formulas),
    '',
    '## 结局',
    renderEndingTable(endings),
    '',
    '## 互动节拍',
    '每一拍对应蓝图上的一个互动节点。表里的界面运用、结算和数值就是编译进蓝图的那份，不是散文摘要。',
    '',
    beats || '（待补）',
  ].join('\n')
}

export function composePillarDocument(contract: PillarInteractionContract): string {
  return `${renderAuthorPillarMarkdown(contract).trim()}\n\n${fencePillarContract(contract)}\n`
}
