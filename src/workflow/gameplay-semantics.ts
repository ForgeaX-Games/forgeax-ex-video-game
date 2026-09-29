export type GameplayComponentRole =
  | 'narrative-display'
  | 'player-choice'
  | 'combat-command'
  | 'timed-input'
  | 'state-feedback'
  | 'transient-feedback'

export interface GameplayStateBinding {
  input: string
  meaning: string
  required: boolean
}

export interface GameplayEventSemantics {
  event: string
  intent: string
  requiredConsequences: ReadonlyArray<'effect' | 'feedback' | 'advance'>
  /** 数值状态的持久化 owner。互动影游的输入事件负责选路，命中/恢复数值在结果视频结算。 */
  stateMutationOwner: 'settlement'
  downstreamPayoff: string
}

export interface ComponentGameplaySemantics {
  roles: readonly GameplayComponentRole[]
  purpose: string
  stateBindings: readonly GameplayStateBinding[]
  eventSemantics: readonly GameplayEventSemantics[]
  requiredCompanions: readonly string[]
  recommendedSettlements: readonly string[]
  requiredFeedback: readonly string[]
  antiPatterns: readonly string[]
}

const choiceConsequences = ['feedback', 'advance'] as const
const settlementOwned = { stateMutationOwner: 'settlement' } as const

export const COMPONENT_GAMEPLAY_SEMANTICS: Readonly<Record<string, ComponentGameplaySemantics>> = {
  BattleEnemyHpBar: {
    roles: ['state-feedback'],
    purpose: '让玩家持续感知敌方生命、攻击效果和战斗进度。',
    stateBindings: [
      { input: 'current', meaning: '敌方当前生命值', required: true },
      { input: 'max', meaning: '敌方生命上限', required: true },
    ],
    eventSemantics: [],
    requiredCompanions: ['BattlePlayerHpBar'],
    recommendedSettlements: ['health-terminal'],
    requiredFeedback: ['伤害发生后血条必须可见下降', '生命归零后必须进入胜利或阶段切换'],
    antiPatterns: ['挂载血条但没有任何动作修改同一生命属性', '只扣血但下游视频不呈现命中结果'],
  },
  BattlePlayerHpBar: {
    roles: ['state-feedback'],
    purpose: '展示玩家生命与战斗资源，让风险和技能可用性可判断。',
    stateBindings: [
      { input: 'current', meaning: '玩家当前生命值', required: true },
      { input: 'max', meaning: '玩家生命上限', required: true },
      { input: 'qi', meaning: '玩家当前技能资源', required: false },
      { input: 'qiMax', meaning: '玩家技能资源上限', required: false },
    ],
    eventSemantics: [],
    requiredCompanions: ['BattleEnemyHpBar'],
    recommendedSettlements: ['health-terminal', 'resource-threshold'],
    requiredFeedback: ['受击或恢复后数值必须立即变化', '资源满值时必须给出技能可用反馈'],
    antiPatterns: ['界面绑定的资源与技能条消费的资源不是同一个状态', '生命归零后仍能继续回合'],
  },
  BattleSkill: {
    roles: ['combat-command'],
    purpose: '承载回合制战斗的风险收益选择，每个技能必须产生不同的状态与视频后果。',
    stateBindings: [
      { input: 'lightResource', meaning: '轻攻击可用资源', required: false },
      { input: 'heavyResource', meaning: '重攻击可用资源', required: false },
      { input: 'meditResource', meaning: '冥想可用资源', required: false },
      { input: 'ultResource', meaning: '必杀技可用资源', required: false },
    ],
    eventSemantics: ['light', 'heavy', 'medit', 'ult'].map((event) => ({
      event,
      intent: `玩家选择${event}战斗动作`,
      requiredConsequences: ['advance'] as const,
      ...settlementOwned,
      downstreamPayoff: '下游视频必须呈现该技能命中、蓄力或恢复的独特结果。',
    })),
    requiredCompanions: ['BattlePlayerHpBar', 'BattleEnemyHpBar'],
    recommendedSettlements: ['timeline-hit-sync', 'health-terminal', 'resource-threshold'],
    requiredFeedback: ['技能消耗和伤害必须可见', '不可用技能必须真实置灰'],
    antiPatterns: ['多个技能进入同一视频且没有持久状态差异', '按钮可点击但事件没有 reaction'],
  },
  BattleParry: {
    roles: ['timed-input'],
    purpose: '在敌方攻击高潮提供实时判定，并把三档结果转换为不同风险后果。',
    stateBindings: [],
    eventSemantics: [
      { event: 'greatSuccess', intent: '完美防反', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游呈现反击重创。' },
      { event: 'success', intent: '普通格挡', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游呈现减伤或僵持。' },
      { event: 'fail', intent: '防反失败', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游呈现完整受击。' },
    ],
    requiredCompanions: ['BattlePlayerHpBar'],
    recommendedSettlements: ['timeline-hit-sync', 'health-terminal'],
    requiredFeedback: ['三档判定都必须有即时结果和下游演出'],
    antiPatterns: ['三档事件无差异合流', 'QTE 窗口与视频攻击帧不一致'],
  },
  InkYingMo: {
    roles: ['player-choice'],
    purpose: '承载二选一价值判断，让两种态度推动不同剧情或持续状态。',
    stateBindings: [],
    eventSemantics: [
      { event: 'ying', intent: '玩家选择回应', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游呈现回应带来的关系或剧情变化。' },
      { event: 'mo', intent: '玩家选择沉默', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游呈现沉默造成的不同后果。' },
    ],
    requiredCompanions: [],
    recommendedSettlements: [],
    requiredFeedback: ['选择后必须立刻锁定并进入可辨别的结果'],
    antiPatterns: ['應与默进入同一视频且没有状态差异'],
  },
  InkKou: {
    roles: ['timed-input'],
    purpose: '承载有时间压力的单次叩击/QTE，并明确成功或超时后果。',
    stateBindings: [],
    eventSemantics: [
      { event: 'kou', intent: '玩家在窗口内完成叩击', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游呈现成功触发的动作。' },
    ],
    requiredCompanions: [],
    recommendedSettlements: ['timeline-hit-sync', 'qte-timeout'],
    requiredFeedback: ['成功与超时都必须有明确反馈'],
    antiPatterns: ['只配置成功边，没有超时结算', '窗口从 0ms 开始且与视频动作无关'],
  },
  TextOption: {
    roles: ['player-choice'],
    purpose: '承载单个文本选择入口；多个实例共同组成分支选择。',
    stateBindings: [],
    eventSemantics: [
      { event: 'activate', intent: '玩家选择该文本选项', requiredConsequences: choiceConsequences, ...settlementOwned, downstreamPayoff: '下游视频或后续状态必须体现选择内容。' },
    ],
    requiredCompanions: [],
    recommendedSettlements: [],
    requiredFeedback: ['选项被选中后必须有可辨认后果'],
    antiPatterns: ['多个选项立即无差异合流', '文案描述风险但实际状态不改变'],
  },
  Dialogue: {
    roles: ['narrative-display'],
    purpose: '传递对白和剧情信息，为玩家决策提供上下文，但不单独构成玩法。',
    stateBindings: [],
    eventSemantics: [],
    requiredCompanions: [],
    recommendedSettlements: [],
    requiredFeedback: ['互动节点不能只挂对白而没有输入或状态反馈组件'],
    antiPatterns: ['把字幕出现误认为已经完成互动设计'],
  },
  DamageFloatText: {
    roles: ['transient-feedback'],
    purpose: '在伤害发生时提供即时数值反馈。',
    stateBindings: [{ input: 'parameter', meaning: '本次伤害数值或公式', required: true }],
    eventSemantics: [],
    requiredCompanions: ['BattleEnemyHpBar'],
    recommendedSettlements: ['timeline-hit-sync'],
    requiredFeedback: ['必须与同一时刻的扣血和受击视频对齐'],
    antiPatterns: ['静态挂载', '出现飘字但没有对应生命变化'],
  },
  GainFloatText: {
    roles: ['transient-feedback'],
    purpose: '在恢复、回气或获得资源时提供即时正反馈。',
    stateBindings: [{ input: 'parameter', meaning: '本次增益数值或公式', required: true }],
    eventSemantics: [],
    requiredCompanions: [],
    recommendedSettlements: ['timeline-hit-sync', 'resource-threshold'],
    requiredFeedback: ['必须与同一时刻的状态增加对齐'],
    antiPatterns: ['出现增益提示但状态没有变化'],
  },
  StatusNotice: {
    roles: ['transient-feedback'],
    purpose: '反馈旗标、关系、道具或状态变化。',
    stateBindings: [],
    eventSemantics: [],
    requiredCompanions: [],
    recommendedSettlements: ['watch-state-feedback'],
    requiredFeedback: ['提示文案必须解释刚刚发生的状态变化'],
    antiPatterns: ['提示与实际状态变化不一致'],
  },
}

export interface SettlementGameplayPattern {
  id: string
  trigger: 'at' | 'watch' | 'state'
  purpose: string
  requiredActions: readonly string[]
  feedbackRule: string
  branchRule: string
  antiPatterns: readonly string[]
}

export const SETTLEMENT_GAMEPLAY_PATTERNS: readonly SettlementGameplayPattern[] = [
  {
    id: 'timeline-hit-sync',
    trigger: 'at',
    purpose: '把视频中的命中、恢复或道具获得时刻与状态变化同步。',
    requiredActions: ['修改状态', '生成即时反馈'],
    feedbackRule: 'effect、飘字/提示和视频动作应发生在同一语义时刻。',
    branchRule: '只有该时刻同时结束当前节拍时才 advance。',
    antiPatterns: ['画面尚未命中就先扣血', '只改状态没有反馈'],
  },
  {
    id: 'health-terminal',
    trigger: 'state',
    purpose: '生命归零时结束战斗或切换阶段。',
    requiredActions: ['隐藏或冻结战斗输入', '进入胜利/失败目标节点'],
    feedbackRule: '最后一次生命变化必须先可见，再进入终局演出。',
    branchRule: '胜利、失败条件必须互斥或声明明确优先级。',
    antiPatterns: ['双方归零同时命中两条边', '归零后仍返回下一回合'],
  },
  {
    id: 'resource-threshold',
    trigger: 'state',
    purpose: '怒气、气力或关系值达到阈值后解锁动作或剧情。',
    requiredActions: ['更新可见资源反馈', '解锁选择或进入明确分支'],
    feedbackRule: '玩家必须知道资源为何变化、距离阈值还有多少。',
    branchRule: '若资源可消费，分支执行后必须扣除或重置。',
    antiPatterns: ['达到阈值后自动跳走，玩家没有决策机会', '资源只增长不消费'],
  },
  {
    id: 'watch-state-feedback',
    trigger: 'watch',
    purpose: '在属性或变量变化时刷新提示、可用状态或局部界面。',
    requiredActions: ['生成与变化方向一致的反馈'],
    feedbackRule: 'inc/dec 必须使用不同语义反馈。',
    branchRule: '普通变化不应无条件打断当前视频；需要跳转时另用 state 条件。',
    antiPatterns: ['每次微小变化都切换视频节点'],
  },
  {
    id: 'qte-timeout',
    trigger: 'at',
    purpose: '在没有内部失败事件的 QTE 窗口结束时进入超时后果。',
    requiredActions: ['关闭输入界面', '生成失败反馈', '进入超时目标节点'],
    feedbackRule: '超时反馈必须与窗口消失同时发生。',
    branchRule: '成功事件已经触发时不得再次执行超时边。',
    antiPatterns: ['只有成功路径没有超时路径', '成功后仍被延迟超时结算覆盖'],
  },
]

export interface InteractionGameplayPattern {
  id: string
  purpose: string
  requiredInformation: readonly string[]
  requiredSystems: readonly string[]
  causalChain: readonly string[]
  qualityRules: readonly string[]
}

export const INTERACTION_GAMEPLAY_PATTERNS: readonly InteractionGameplayPattern[] = [
  {
    id: 'choice-branch',
    purpose: '用多个明确选项推动不同剧情或持久状态。',
    requiredInformation: ['玩家理解每个选项的语义或风险'],
    requiredSystems: ['player-choice component', 'event reaction', 'differentiated target or persistent state'],
    causalChain: ['展示选择', '玩家触发事件', '写入状态/锁定选择', '即时反馈', '进入差异化下游视频'],
    qualityRules: ['不同选项不得无后果立即合流', '下游视频必须呈现选择结果'],
  },
  {
    id: 'qte-outcome',
    purpose: '让实时输入结果影响伤害、资源或剧情分支。',
    requiredInformation: ['清晰按键提示', '与视频动作一致的时间窗'],
    requiredSystems: ['timed-input component', 'success/fail routes', 'timeout settlement'],
    causalChain: ['敌方动作预兆', '开放输入窗口', '判定结果', '状态变化与反馈', '播放对应结果视频'],
    qualityRules: ['成功和失败都可达', '判定档位必须产生可感知差异'],
  },
  {
    id: 'health-combat-loop',
    purpose: '以双方生命与回合决策构成可结束的战斗循环。',
    requiredInformation: ['双方生命', '敌方意图', '可选动作与成本'],
    requiredSystems: ['player/enemy hp feedback', 'combat command or QTE', 'damage effects', 'health terminals'],
    causalChain: ['敌方意图', '玩家决策', '状态结算', '即时反馈', '结果视频', '胜负判断', '下一回合或终局'],
    qualityRules: ['循环每轮必须有进展', '胜利失败条件必须可达且不冲突'],
  },
  {
    id: 'resource-skill',
    purpose: '让怒气、气力等资源形成积累、可见阈值、消费和爆发。',
    requiredInformation: ['当前值', '上限', '技能成本'],
    requiredSystems: ['state feedback', 'resource writers', 'threshold settlement', 'resource consumer'],
    causalChain: ['动作积累资源', '界面更新', '阈值反馈', '玩家选择技能', '消费资源', '播放爆发结果'],
    qualityRules: ['资源不能只增长不消费', '达到阈值后必须让玩家理解新机会'],
  },
  {
    id: 'timed-decision',
    purpose: '在视频事件到来前给玩家有限时间作出决策。',
    requiredInformation: ['剩余时间', '选择后果'],
    requiredSystems: ['windowed input', 'timeout settlement', 'choice routes'],
    causalChain: ['展示风险', '开放限时输入', '玩家选择或超时', '即时反馈', '进入对应视频'],
    qualityRules: ['超时路径必须可达', '时间窗必须与视频节奏一致'],
  },
  {
    id: 'relationship-branch',
    purpose: '让态度选择累积为后续关系变化和剧情分支。',
    requiredInformation: ['当前关系状态或人物反应'],
    requiredSystems: ['choice component', 'relationship variable', 'state feedback', 'later condition consumer'],
    causalChain: ['态度选择', '关系值变化', '人物即时反应', '状态保留', '后续条件分支消费'],
    qualityRules: ['关系值必须在后续被读取', '人物视频反应应与选择一致'],
  },
  {
    id: 'item-gate',
    purpose: '让前置探索或选择获得的道具改变后续可选路径。',
    requiredInformation: ['是否持有道具', '道具用途线索'],
    requiredSystems: ['item writer', 'inventory feedback', 'hasItem condition', 'alternate route'],
    causalChain: ['获得道具', '即时提示', '状态保留', '后续门槛读取', '开放特殊视频分支'],
    qualityRules: ['道具必须有获得来源和消费位置', '没有道具时仍需存在合理路径'],
  },
]

export function gameplaySemanticsForComponent(id: string): ComponentGameplaySemantics | undefined {
  return COMPONENT_GAMEPLAY_SEMANTICS[id]
}
