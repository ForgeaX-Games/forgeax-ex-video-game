/**
 * 派发前预检（设计 §9.7.2 L2）。
 *
 * 撞墙治理的重心是「让越权调用根本不发生」。守卫在 mutation 时拒绝已经太晚：
 * 一个子 Agent 已经启动、读过状态、想好了要写什么，才被告知前置不齐，
 * 这一整轮的启动与重试预算都白花了。
 *
 * 预检把同一批判断提前到 `dispatch_peer` 之前，而且比删掉的 intake 文件门更准——
 * 它检的是语义前置（有没有支柱、有没有总脉络声明），不是某个文件在不在。
 */
import type { VideoGameActivity, VideoGameWorkflowState } from '../../workflow/contracts'
import { activityContract } from '../../workflow/activity-contracts'
import {
  assetTrackForActivity,
  conflictingScopesInGroup,
  groupForActivity,
  isAssetPipelineActivity,
  isGroupComplete,
  isSettled,
  mainCursorGroup,
  writeScopesFor,
} from './activity-groups'
import type { ContentInventory } from './workflow-state'

export interface PreflightGap {
  /** 机器可判定的缺口类别，Prompt 不需要解析 message。 */
  kind: 'required-input' | 'author-gate' | 'group' | 'write-scope'
  detail: string
  /** 该缺口应该由谁去补：作者、还是某个活动的 owner。 */
  resolveWith: 'author' | VideoGameActivity | 'unknown'
}

export interface PreflightResult {
  activity: VideoGameActivity
  ready: boolean
  gaps: PreflightGap[]
  /** 就绪时给出派发载荷所需的字段，省得编排者再自己拼。 */
  dispatch?: {
    activity: VideoGameActivity
    activityRevision: number
    workflowRevision: number
    objective: string
    hardChecks: string[]
    requiredInputs: string[]
    stopConditions: string[]
    writeScope: string[]
  }
}

/** 需求输入 → 怎么算「已就绪」。这是 `requiredInputs` 第一次真正被求值。 */
function inputSatisfied(
  kind: string,
  state: VideoGameWorkflowState,
  inventory: ContentInventory,
): boolean {
  switch (kind) {
    // 删掉 intake 文档后，需求以契约形态存在生产平面（设计 §9.10.3）。
    case 'brief': return Boolean(state.requirementContract)
    case 'inquiry': return Boolean(state.inquiryContract)
    case 'core': return (inventory.documents.core ?? 0) > 0
    case 'pillar': return (inventory.documents.pillar ?? 0) > 0
    case 'outline': return state.activities['blueprint.outline']?.status === 'complete'
    case 'blueprint': return inventory.blueprintNodeCount > 0
    case 'characters': return state.activities['characters.modeling']?.status === 'complete'
      || inventory.characterCount > 0
    case 'scenes': return state.activities['scenes.modeling']?.status === 'complete'
      || inventory.sceneCount > 0
    case 'rules': return state.activities['rules.catalog']?.status === 'complete'
      || inventory.entityCount + inventory.variableCount > 0
    case 'ui': return inventory.uiCount > 0
    case 'playtest': return state.activities['playtest.validating']?.status === 'complete'
    case 'assets': return inventory.characterCount + inventory.sceneCount > 0
    case 'video-presets': return state.activities['video.presets.validating']?.status === 'complete'
    case 'finalization': return isSettled(state.activities['game.finalizing']?.status)
    case 'video-preset-bindings': return isSettled(state.activities['video.presets.binding']?.status)
    // 未知 kind 不做假设：宁可放过也不要凭空造一道拦不住真问题的门。
    default: return true
  }
}

/** 产出某个 requiredInput 的活动，用来告诉编排者该重派谁。 */
const PRODUCER: Partial<Record<string, VideoGameActivity>> = {
  brief: 'brief.collecting',
  inquiry: 'document.inquiry',
  core: 'document.core',
  pillar: 'document.pillar',
  outline: 'blueprint.outline',
  blueprint: 'blueprint.outline',
  characters: 'characters.modeling',
  scenes: 'scenes.modeling',
  rules: 'rules.catalog',
  ui: 'ui.authoring',
  playtest: 'playtest.validating',
  finalization: 'game.finalizing',
  'video-preset-bindings': 'video.presets.binding',
  'video-presets': 'video.presets.validating',
}

/** 活动开始前必须已记录的作者门凭据。 */
const REQUIRED_GATE: Partial<Record<VideoGameActivity, 'core' | 'pillar'>> = {
  'document.pillar': 'core',
  'blueprint.outline': 'pillar',
}

export function preflightActivity(
  state: VideoGameWorkflowState,
  inventory: ContentInventory,
  activity: VideoGameActivity,
  options: { entityIdBindingRequested?: boolean } = {},
): PreflightResult {
  if (isAssetPipelineActivity(activity)) {
    return preflightAssetActivity(state, inventory, activity, options)
  }
  const contract = activityContract(activity)
  const gaps: PreflightGap[] = []

  for (const input of contract.requiredInputs) {
    if (input.optional) continue
    if (inputSatisfied(input.kind, state, inventory)) continue
    gaps.push({
      kind: 'required-input',
      detail: `缺少前置产物：${input.kind}`,
      resolveWith: PRODUCER[input.kind] ?? 'unknown',
    })
  }

  const gate = REQUIRED_GATE[activity]
  if (gate && state.gates[gate]?.status !== 'approved') {
    gaps.push({
      kind: 'author-gate',
      detail: `作者门 ${gate} 尚未通过`,
      resolveWith: 'author',
    })
  }

  const group = groupForActivity(activity)
  const current = mainCursorGroup(state)
  const inActiveGroup = current.id === group.id
  if (!inActiveGroup) {
    if (!isGroupComplete(current, state.activities)) {
      gaps.push({
        kind: 'group',
        detail: `当前组 ${current.id} 未全绿，不能开启 ${group.id}`,
        resolveWith: 'unknown',
      })
    }
  } else if (state.activities[activity]?.status === 'complete') {
    gaps.push({
      kind: 'group',
      detail: `${activity} 已完成，重做需要显式 rework`,
      resolveWith: 'unknown',
    })
  }

  // 组内写域必须互不相交，否则并发写就不安全。当前组划分是静态互斥的，
  // 这里兜住的是「以后有人改了组划分却没发现写域撞了」。
  const conflicts = conflictingScopesInGroup(group)
  if (conflicts.length > 0) {
    gaps.push({
      kind: 'write-scope',
      detail: `组 ${group.id} 的写域存在交叉：${conflicts.join(', ')}`,
      resolveWith: 'unknown',
    })
  }

  if (gaps.length > 0) return { activity, ready: false, gaps }
  return {
    activity,
    ready: true,
    gaps: [],
    dispatch: {
      activity,
      activityRevision: state.activities[activity]?.revision ?? 1,
      workflowRevision: state.revision,
      objective: contract.objective,
      hardChecks: [...contract.hardChecks],
      requiredInputs: contract.requiredInputs.map((input) => input.kind),
      stopConditions: [...contract.stopConditions],
      writeScope: [...writeScopesFor(activity)],
    },
  }
}

export function preflightAssetActivity(
  state: VideoGameWorkflowState,
  inventory: ContentInventory,
  activity: VideoGameActivity,
  options: { entityIdBindingRequested?: boolean } = {},
): PreflightResult {
  const contract = activityContract(activity)
  const gaps: PreflightGap[] = []
  if (!isAssetPipelineActivity(activity)) {
    return {
      activity,
      ready: false,
      gaps: [{
        kind: 'group',
        detail: `${activity} 不属于资产支线`,
        resolveWith: 'unknown',
      }],
    }
  }

  for (const input of contract.requiredInputs) {
    if (input.optional) continue
    if (inputSatisfied(input.kind, state, inventory)) continue
    gaps.push({
      kind: 'required-input',
      detail: `缺少前置产物：${input.kind}`,
      resolveWith: PRODUCER[input.kind] ?? 'unknown',
    })
  }

  if (
    activity === 'characters.modeling'
    && options.entityIdBindingRequested === true
    && !inputSatisfied('rules', state, inventory)
  ) {
    gaps.push({
      kind: 'required-input',
      detail: '缺少前置产物：rules',
      resolveWith: 'rules.catalog',
    })
  }

  const track = assetTrackForActivity(activity)
  const index = track.indexOf(activity)
  for (const previous of track.slice(0, index)) {
    if (isSettled(state.activities[previous]?.status)) continue
    gaps.push({
      kind: 'group',
      detail: `资产轨道前置活动 ${previous} 尚未完成`,
      resolveWith: previous,
    })
  }
  if (isSettled(state.activities[activity]?.status)) {
    gaps.push({
      kind: 'group',
      detail: `${activity} 已完成，重做需要显式 rework`,
      resolveWith: 'unknown',
    })
  }

  if (gaps.length > 0) return { activity, ready: false, gaps }
  return {
    activity,
    ready: true,
    gaps: [],
    dispatch: {
      activity,
      activityRevision: state.activities[activity]?.revision ?? 1,
      workflowRevision: state.revision,
      objective: contract.objective,
      hardChecks: [...contract.hardChecks],
      requiredInputs: contract.requiredInputs.map((input) => input.kind),
      stopConditions: [...contract.stopConditions],
      writeScope: [...writeScopesFor(activity)],
    },
  }
}
