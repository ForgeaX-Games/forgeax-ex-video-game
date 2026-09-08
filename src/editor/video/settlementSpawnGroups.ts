/**
 * 结算绑定界面 → 时间轴界面组的投影。
 *
 * 时间只有一份真相：组与组内每条界面的起始都读宿主结算的 `when.ms`，绝不落盘第二份，
 * 因此拖动菱形结算点时整组自动跟随。界面自己能编辑的只有结束（= `spawn.ttlMs`）。
 *
 * 行号在「自菱形轨向上数」的 u 空间里分配（u=1 紧贴菱形轨），不产出绝对轨号——绝对轨号
 * 依赖材料轨的最大层号，那是渲染层才知道的量，换算见 `spawnBarTrack`。
 * 每个界面独占一行，跨结算点也不共用，因此总行数 = 全部绑定界面数。
 */
import type { GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import { isSettlementReaction } from '@/runtime/core/schema/node-config-schema'
import type { TimelineSpawnBar, TimelineSpawnGroup } from './materialTimelineShared'

/** 绑定界面在编辑器内的稳定标识前缀；时间轴条与预览画布投影共用同一串。 */
export const SETTLEMENT_SPAWN_ID_PREFIX = 'settlement-spawn:'


/** 拼一条绑定界面的稳定 id。 */
export function settlementSpawnId(settlementIndex: number, actionIndex: number): string {
  return `${SETTLEMENT_SPAWN_ID_PREFIX}${settlementIndex}:${actionIndex}`
}

/** 从绑定界面 id 读回它的寻址；不是绑定界面 id 时返回 null。 */
export function settlementSpawnAddress(id: string): { settlementIndex: number; actionIndex: number } | null {
  if (!id.startsWith(SETTLEMENT_SPAWN_ID_PREFIX)) return null
  const parts = id.slice(SETTLEMENT_SPAWN_ID_PREFIX.length).split(':')
  if (parts.length !== 2) return null
  const settlementIndex = Number(parts[0])
  const actionIndex = Number(parts[1])
  if (!Number.isInteger(settlementIndex) || !Number.isInteger(actionIndex)) return null
  return { settlementIndex, actionIndex }
}

function spawnLabel(scenario: GameScenario, from: string): string {
  const overlayId = from.slice(0, from.indexOf('/') >= 0 ? from.indexOf('/') : from.length)
  return scenario.ui?.overlays?.[overlayId]?.title?.trim() || from
}

/**
 * 从节点配置派生绑定界面组；只有演出相位结算（`at` / 历史 `enter`）能承载界面组，
 * 条件结算的界面没有确定的时间坐标，仍留在条件条里表达。
 */
export function collectSettlementSpawnGroups(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
): TimelineSpawnGroup[] {
  const groups: TimelineSpawnGroup[] = []

  ;(node.data.reactions ?? []).filter(isSettlementReaction).forEach((reaction, settlementIndex) => {
    if (reaction.when.type !== 'at' && reaction.when.type !== 'enter') return
    const startMs = reaction.when.type === 'at' ? Math.max(0, Math.round(reaction.when.ms)) : 0

    const bars: TimelineSpawnBar[] = []
    reaction.do.forEach((action, actionIndex) => {
      if (action.kind !== 'spawn') return
      const openEnded = action.ttlMs == null || !(action.ttlMs > 0)
      bars.push({
        id: settlementSpawnId(settlementIndex, actionIndex),
        label: spawnLabel(scenario, action.from),
        startMs,
        endMs: Math.max(startMs + 1, openEnded ? maxMs : startMs + action.ttlMs!),
        openEnded,
        rowInGroup: bars.length,
      })
    })
    if (!bars.length) return

    groups.push({
      markerId: `life:${settlementIndex}`,
      settlementIndex,
      startMs,
      endMs: bars.reduce((mx, bar) => Math.max(mx, bar.endMs), startMs + 1),
      uBase: 1,
      bars,
    })
  })

  // 每个界面独占一行：不同结算点的界面即使时间上不重叠也不共用行，否则同一行上会并排出现
  // 分属不同结算的界面，归属关系难以分辨。按时间先后自下而上叠：早的贴菱形轨，晚的往上。
  // 行是连续分配的，不为分组额外消耗行 —— N 个绑定界面恰好占 N 行。
  let nextRow = 1
  for (const group of [...groups].sort((a, b) => a.startMs - b.startMs)) {
    group.uBase = nextRow
    nextRow += group.bars.length
  }
  return groups
}
