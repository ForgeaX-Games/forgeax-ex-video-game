/**
 * 把 design peer 的紧凑创作面补成可编译 v4 IR。
 *
 * peer 一次写完整 v4（effect / triggerSpec / 配对 settlement）会把
 * upsert_document 的 JSON 撑过 zaohua-pro 的真实输出上限。机械字段是确定性
 * 的：出口默认下一拍或终局，结算默认配对动作，数值默认战斗生命。peer 只填
 * 节拍意图、角色和（可选的）显式出口。
 */
import type {
  PillarExitContract,
  PillarFeedbackContract,
  PillarInteractionActionContract,
  PillarInteractionBeatContract,
  PillarInteractionContract,
  PillarSettlementContract,
  PillarVariableContract,
} from './pillar-interaction-contract'

const DEFAULT_ENDING_ID = 'ending-main'

export function beatOrderKey(id: string): number {
  const match = /^B(\d+)$/u.exec(id)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

export function nextBeatId(
  currentId: string,
  beats: readonly { id: string }[],
): string | undefined {
  const key = beatOrderKey(currentId)
  return [...beats]
    .filter((beat) => beatOrderKey(beat.id) > key)
    .sort((left, right) => beatOrderKey(left.id) - beatOrderKey(right.id))[0]?.id
}

function defaultExit(
  currentId: string,
  beats: readonly { id: string }[],
  endingId: string,
): PillarExitContract {
  const next = nextBeatId(currentId, beats)
  if (!next) return { kind: 'ending', endingId }
  return { kind: 'beat', toBeatId: next }
}

function isFailLikeSettlement(settlement: Pick<PillarSettlementContract, 'id' | 'intent' | 'exitIntent'>): boolean {
  return /失败|fail|lose|归零|沉没|功亏/iu.test(`${settlement.id} ${settlement.intent} ${settlement.exitIntent}`)
}

function defaultSystemSettlementExit(
  settlement: Pick<PillarSettlementContract, 'id' | 'intent' | 'exitIntent'>,
  beatId: string,
  beats: readonly { id: string }[],
  endings: readonly { id: string }[],
): PillarExitContract {
  if (isFailLikeSettlement(settlement)) {
    const fail = endings.find((ending) => /fail|lose|bad/i.test(ending.id))
      ?? endings.find((_, index) => index > 0)
    if (fail) return { kind: 'ending', endingId: fail.id }
  }
  const next = nextBeatId(beatId, beats)
  if (next) return { kind: 'beat', toBeatId: next }
  return { kind: 'ending', endingId: endings[0]?.id ?? DEFAULT_ENDING_ID }
}

function defaultEffect(
  action: PillarInteractionActionContract,
  variables: readonly PillarVariableContract[],
): NonNullable<PillarInteractionActionContract['effect']> {
  const ids = variables.map((variable) => variable.id)
  if (action.requiredRole === 'combat-command') {
    const target = ids.find((id) => id === 'enemyHp')
      ?? ids.find((id) => /hp/i.test(id))
      ?? ids[0]
      ?? 'enemyHp'
    return { target: `var.${target}`, op: 'sub', value: 20 }
  }
  const target = ids.find((id) => id === 'progress') ?? ids[0] ?? 'progress'
  return { target: `var.${target}`, op: 'add', value: 1 }
}

function defaultSettlement(action: PillarInteractionActionContract): PillarSettlementContract {
  return {
    id: `${action.id}-result`,
    sourceActionId: action.id,
    trigger: 'at',
    triggerSpec: { type: 'at', ms: 900 },
    feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
    source: `${action.intent}命中帧`,
    intent: `结算${action.intent}`,
    feedback: action.immediateFeedback,
    exitIntent: '继续结果演出',
  }
}

function hydrateAction(
  action: PillarInteractionActionContract,
  fallbackExit: PillarExitContract,
  variables: readonly PillarVariableContract[],
): PillarInteractionActionContract {
  const intent = action.intent
  const exit = action.exit ?? fallbackExit
  // 没声明反馈的动作默认收起本拍界面；数值动作真正被看见的那一下由配对结算兑现，
  // 该由编译器按目录能力盖章（见 pillar-compiler 的 settledFeedbackSpec），
  // 创作面这里不猜元件。
  const feedbackSpec: PillarFeedbackContract = action.feedbackSpec ?? { kind: 'hide-interface' }
  return {
    ...action,
    stateChange: action.stateChange || intent,
    immediateFeedback: action.immediateFeedback || intent,
    downstreamPayoff: action.downstreamPayoff || intent,
    exitIntent: action.exitIntent || intent,
    feedbackSpec,
    exit,
    ...(action.stateMutationOwner === 'settlement'
      ? { effect: action.effect ?? defaultEffect(action, variables) }
      : {}),
  }
}

const DEFAULT_COMBAT_LOOP = {
  progress: '每回合消耗双方生命',
  exitConditions: ['敌方生命归零', '玩家生命归零'],
}

function hydrateBeat(
  beat: PillarInteractionBeatContract,
  beats: readonly PillarInteractionBeatContract[],
  endings: readonly { id: string }[],
  variables: readonly PillarVariableContract[],
): PillarInteractionBeatContract {
  const fallbackExit = defaultExit(beat.id, beats, endings[0]?.id ?? DEFAULT_ENDING_ID)
  const actions = beat.actions.map((action) => hydrateAction(action, fallbackExit, variables))
  const settlements: PillarSettlementContract[] = beat.settlements.map((settlement) => {
    const hydrated: PillarSettlementContract = {
      ...settlement,
      triggerSpec: settlement.triggerSpec ?? (
        settlement.trigger === 'watch' ? { type: 'watch' as const, of: 'var.progress' }
          : settlement.trigger === 'state' ? { type: 'state' as const, condition: { all: [{ type: 'score', op: 'gte', value: 1 }] } }
            : { type: 'at' as const, ms: 900 }
      ),
      feedbackSpec: settlement.feedbackSpec ?? { kind: 'transient-component', component: 'StatusNotice' },
    }
    if (settlement.sourceActionId || settlement.exit) return hydrated
    return {
      ...hydrated,
      exit: defaultSystemSettlementExit(settlement, beat.id, beats, endings),
    }
  })
  for (const action of actions) {
    if (action.stateMutationOwner !== 'settlement') continue
    if (settlements.some((settlement) => settlement.sourceActionId === action.id)) continue
    settlements.push(defaultSettlement(action))
  }
  const combat = actions.some((action) => action.requiredRole === 'combat-command')
  return {
    ...beat,
    playerInformation: beat.playerInformation.length > 0 ? beat.playerInformation : [beat.narrativeIntent],
    uiCapabilities: beat.uiCapabilities.length > 0
      ? beat.uiCapabilities
      : actions.map((action) => action.requiredRole ?? action.intent),
    actions,
    settlements,
    ...(combat
      ? {
        loop: {
          progress: beat.loop?.progress || DEFAULT_COMBAT_LOOP.progress,
          exitConditions: beat.loop?.exitConditions.length
            ? beat.loop.exitConditions
            : DEFAULT_COMBAT_LOOP.exitConditions,
        },
      }
      : {}),
  }
}

function defaultVariables(beats: readonly PillarInteractionBeatContract[]): PillarVariableContract[] {
  const combat = beats.some((beat) => beat.actions.some((action) => action.requiredRole === 'combat-command'))
  if (combat) {
    return [
      { id: 'playerHp', initial: 100, min: 0, max: 100 },
      { id: 'enemyHp', initial: 100, min: 0, max: 100 },
    ]
  }
  return [{ id: 'progress', initial: 0, min: 0, max: 100 }]
}

function withHpRange(variables: readonly PillarVariableContract[]): PillarVariableContract[] {
  return variables.map((variable) => {
    if (!/hp/i.test(variable.id) || variable.max !== undefined) return variable
    const max = typeof variable.initial === 'number' && variable.initial > 0 ? variable.initial : 100
    return { ...variable, max }
  })
}

export function hydratePillarContract(contract: PillarInteractionContract): PillarInteractionContract {
  const orderedBeats = [...contract.beats].sort((left, right) => (
    beatOrderKey(left.id) - beatOrderKey(right.id)
  ))
  const endings = contract.endings && contract.endings.length > 0
    ? contract.endings
    : [{
        id: DEFAULT_ENDING_ID,
        title: orderedBeats.at(-1)?.narrativeIntent || DEFAULT_ENDING_ID,
        summary: orderedBeats.at(-1)?.narrativeIntent || DEFAULT_ENDING_ID,
      }]
  const variables = withHpRange(
    contract.variables && contract.variables.length > 0
      ? contract.variables
      : defaultVariables(orderedBeats),
  )
  const beats = orderedBeats.map((beat) => (
    hydrateBeat(beat, orderedBeats, endings, variables)
  ))
  return {
    ...contract,
    beats,
    endings,
    variables,
    ...(contract.formulas ? { formulas: contract.formulas } : {}),
  }
}
