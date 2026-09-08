/**
 * 活动组引擎（纯函数）。
 *
 * 推进单位是组，不是单个活动：组内 track 之间并发、track 内部串行。
 * 把这套判定抽成纯函数，是因为并发语义最容易出错的地方（谁在跑、组算不算完、
 * 一条线失败时另外两条能不能继续）必须能被单元测试直接钉住，
 * 而不是埋在带文件锁的 Host 事务里。
 */

import {
  ACTIVITY_GROUPS,
  ASSET_PIPELINE_ACTIVITIES,
  ASSET_PIPELINE_TRACKS,
  MAIN_VIDEO_GAME_ACTIVITIES,
  WRITE_SCOPES,
  type ActivityGroupDef,
  type ActivityRecord,
  type ActivityStatus,
  type AssetPipelineStatus,
  type ProductPhaseStatus,
  type VideoGameActivity,
  type VideoGameWorkflowState,
} from '../../workflow/contracts'

type ActivityRecords = Partial<Record<VideoGameActivity, ActivityRecord>>

const GROUP_BY_ACTIVITY = new Map<VideoGameActivity, ActivityGroupDef>()
const GROUP_INDEX_BY_ID = new Map<string, number>()

ACTIVITY_GROUPS.forEach((group, index) => {
  GROUP_INDEX_BY_ID.set(group.id, index)
  for (const track of group.tracks) {
    for (const activity of track) GROUP_BY_ACTIVITY.set(activity, group)
  }
})

/** 活动已经交付完毕（含合法跳过）。 */
export function isSettled(status: ActivityStatus | undefined): boolean {
  return status === 'complete' || status === 'not-required'
}

export function isMainVideoGameActivity(activity: VideoGameActivity): boolean {
  return (MAIN_VIDEO_GAME_ACTIVITIES as readonly VideoGameActivity[]).includes(activity)
}

export function isAssetPipelineActivity(activity: VideoGameActivity): boolean {
  return (ASSET_PIPELINE_ACTIVITIES as readonly VideoGameActivity[]).includes(activity)
}

export function assetTrackForActivity(activity: VideoGameActivity): readonly VideoGameActivity[] {
  const track = ASSET_PIPELINE_TRACKS.find(
    (candidate) => (candidate as readonly VideoGameActivity[]).includes(activity),
  )
  if (!track) throw new Error(`activity ${activity} is not assigned to any asset pipeline track`)
  return track
}

export function groupForActivity(activity: VideoGameActivity): ActivityGroupDef {
  const group = GROUP_BY_ACTIVITY.get(activity)
  if (!group) throw new Error(`activity ${activity} is not assigned to any group`)
  return group
}

export function groupById(id: string): ActivityGroupDef | undefined {
  const index = GROUP_INDEX_BY_ID.get(id)
  return index === undefined ? undefined : ACTIVITY_GROUPS[index]
}

export function groupIndex(id: string): number {
  return GROUP_INDEX_BY_ID.get(id) ?? -1
}

export function nextGroup(id: string): ActivityGroupDef | undefined {
  const index = groupIndex(id)
  return index < 0 ? undefined : ACTIVITY_GROUPS[index + 1]
}

export function firstGroup(): ActivityGroupDef {
  return ACTIVITY_GROUPS[0]!
}

/**
 * 从主线活动记录恢复当前游标。
 *
 * 旧测试/旧状态可能只保存了一个较晚的已完成检查点，前面的活动记录为空；
 * 从最早有实际进度的主线组开始恢复，随后必须停在第一个未完成组，避免更晚
 * 的孤立记录把游标越过尚未完成的主线前置。
 */
export function mainCursorGroup(state: VideoGameWorkflowState): ActivityGroupDef {
  const pillarIndex = (MAIN_VIDEO_GAME_ACTIVITIES as readonly VideoGameActivity[])
    .indexOf('document.pillar')
  const hasProgressAfterPillar = (
    MAIN_VIDEO_GAME_ACTIVITIES as readonly VideoGameActivity[]
  ).slice(pillarIndex + 1).some((activity) => {
    const status = state.activities[activity]?.status
    return status !== undefined && status !== 'not-started'
  })
  if (
    isSettled(state.activities['document.pillar']?.status)
    && state.gates.pillar?.status !== 'approved'
    && !hasProgressAfterPillar
  ) {
    return groupById('design')!
  }
  const firstRecordedGroupIndex = ACTIVITY_GROUPS.findIndex((group) => (
    group.tracks.flat().some((activity) => {
      const status = state.activities[activity]?.status
      return status !== undefined && status !== 'not-started'
    })
  ))
  const startIndex = firstRecordedGroupIndex < 0 ? 0 : firstRecordedGroupIndex
  return ACTIVITY_GROUPS.slice(startIndex).find(
    (group) => !isGroupComplete(group, state.activities),
  ) ?? ACTIVITY_GROUPS.at(-1)!
}

/**
 * 组内当前应该在跑的活动：每条未走完 track 的第一个未交付活动。
 *
 * 串行组只会返回一个；G2 这种三 track 组在开组时返回三个，
 * 这正是「三条线同时 working」的形式化定义。
 */
export function activeActivitiesIn(
  group: ActivityGroupDef,
  activities: ActivityRecords,
): VideoGameActivity[] {
  const active: VideoGameActivity[] = []
  for (const track of group.tracks) {
    const pending = track.find((activity) => !isSettled(activities[activity]?.status))
    if (pending) active.push(pending)
  }
  return active
}

export function isGroupComplete(group: ActivityGroupDef, activities: ActivityRecords): boolean {
  return group.tracks.every((track) => track.every((activity) => isSettled(activities[activity]?.status)))
}

/**
 * 活动所在的那条 track。
 *
 * 返工需要它：一条线失败时只该重跑这条线，同组另外两条线的成果必须保留——
 * 否则数值线出问题会把已经出完的角色图和场景图一起清掉，一次失败变三次重跑。
 */
export function trackForActivity(activity: VideoGameActivity): readonly VideoGameActivity[] {
  const group = groupForActivity(activity)
  const track = group.tracks.find((candidate) => candidate.includes(activity))
  if (!track) throw new Error(`activity ${activity} is not on any track of group ${group.id}`)
  return track
}

/**
 * 组状态由成员状态聚合而来，不由某个 Agent 声明。
 *
 * blocked 优先级最高：一条线受阻就必须把整组标成 blocked，否则前端会显示
 * 「还在生成」而实际上已经卡住；但这不阻止其他 track 跑完手上的活动
 * （由 assertWorkflowMutationAllowed 逐活动判定），只阻止开下一组。
 */
export function aggregateGroupStatus(
  group: ActivityGroupDef,
  activities: ActivityRecords,
): ProductPhaseStatus {
  const members = group.tracks.flat()
  const statuses = members.map((activity) => activities[activity]?.status)
  if (statuses.some((status) => status === 'blocked')) return 'blocked'
  if (isGroupComplete(group, activities)) return 'complete'
  if (statuses.some((status) => status === 'awaiting-user')) return 'awaiting-user'
  if (statuses.some((status) => status === 'working')) return 'working'
  return 'not-started'
}

/**
 * 代表活动：给只能显示一个活动的旧读取方（阶段条、旧投影字段）用。
 * 取活跃集合里组内顺序最靠前的那个，保证同一状态下结果稳定。
 */
export function representativeActivity(
  group: ActivityGroupDef,
  activities: ActivityRecords,
): VideoGameActivity {
  const active = activeActivitiesIn(group, activities)
  if (active.length > 0) {
    const order = group.tracks.flat()
    return [...active].sort((left, right) => order.indexOf(left) - order.indexOf(right))[0]!
  }
  // 组已全部交付：用最后一条 track 的末位活动代表，语义上是「这组做完了」。
  const members = group.tracks.flat()
  return members[members.length - 1]!
}

/** 该活动被授权写入的域。 */
export function writeScopesFor(activity: VideoGameActivity): readonly string[] {
  return WRITE_SCOPES[activity]
}

/** 请求写入的域是否都在该活动的授权范围内。 */
export function isWriteScopeAllowed(
  activity: VideoGameActivity,
  requested: readonly string[],
): boolean {
  const allowed = new Set<string>(writeScopesFor(activity))
  return requested.every((scope) => allowed.has(scope))
}

/**
 * 同一组内不同 track 的写域必须互不相交——这是并发正确性的前置条件，
 * 由测试对全部组做断言，防止后续往 G2 里塞一条会写 graph 的线。
 */
export function conflictingScopesInGroup(group: ActivityGroupDef): string[] {
  const seen = new Map<string, number>()
  const conflicts: string[] = []
  group.tracks.forEach((track, trackIndex) => {
    const scopes = new Set(track.flatMap((activity) => writeScopesFor(activity)))
    for (const scope of scopes) {
      const owner = seen.get(scope)
      if (owner !== undefined && owner !== trackIndex) conflicts.push(scope)
      else seen.set(scope, trackIndex)
    }
  })
  return [...new Set(conflicts)]
}

export function activeAssetActivities(state: VideoGameWorkflowState): VideoGameActivity[] {
  return state.assetPipeline.activeActivities.filter((activity) => (
    isAssetPipelineActivity(activity) && !isSettled(state.activities[activity]?.status)
  ))
}

export function isAssetPipelineReady(state: VideoGameWorkflowState): boolean {
  return Object.values(state.assetPipeline.readiness).every((status) => status === 'ready')
}

export function aggregateAssetPipelineStatus(state: VideoGameWorkflowState): AssetPipelineStatus {
  if (isAssetPipelineReady(state)) return 'ready'
  const readiness = Object.values(state.assetPipeline.readiness)
  const failed = readiness.some((status) => status === 'failed')
    || state.assetPipeline.blockers.length > 0
  const hasReady = readiness.some((status) => status === 'ready')
  if (failed) return hasReady ? 'partial' : 'blocked'
  if (hasReady) return 'partial'
  if (
    activeAssetActivities(state).length > 0
    || readiness.some((status) => status === 'working')
  ) return 'working'
  return 'not-started'
}
