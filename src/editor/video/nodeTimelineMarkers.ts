import { t as translateUi } from '../../i18n'
import type { GameNode, GameScenario, OverlayInstanceChild } from '@/runtime/core/schema/graph-schema'
import { expandNodeChildren } from '@/runtime/core/schema/expand-overlay'
import { isSettlementReaction, type NodeAction } from '@/runtime/core/schema/node-config-schema'
import { elementStartMs } from '@/authoring/graph/timeline-geometry'
import { formatWatchPathLabel } from '../watch-path-label'
import type { TimelineConditionMarker, TimelinePointMarker } from './materialTimelineShared'

/** 动作侧分段：效果 / 绑定界面 / 隐藏界面 / 添加连线各成一段，供条件行 chips 与 label 复用。 */
function effectsParts(actions: NodeAction[]): string[] {
  const effects = actions.flatMap((action) => (action.kind === 'effect' ? action.effects : []))
  const spawns = actions.filter((action) => action.kind === 'spawn').length
  const hiddenOverlays = actions.filter((action) => action.kind === 'hideOverlay').length
  const parts = effects.slice(0, 2).map((effect) => {
    if (effect.kind === 'attr') return `${effect.entityId}.${effect.attr} ${effect.op} ${String(effect.value)}`
    if (effect.kind === 'var') return `${effect.varId} ${effect.op} ${String(effect.value)}`
    if (effect.kind === 'flag') return `${effect.varId} = ${effect.value}`
    return `${effect.itemId} ${effect.op === 'give' ? '+' : '-'}${effect.count}`
  })
  if (effects.length > 2) parts.push(`等 ${effects.length} 项`)
  if (spawns > 0) parts.push(`绑定 ${spawns} 个界面`)
  if (hiddenOverlays > 0) parts.push(`隐藏 ${hiddenOverlays} 个界面`)
  if (actions.some((action) => action.kind === 'advance')) parts.push('添加连线')
  return parts.length ? parts : ['未配置动作']
}

function effectsBrief(actions: NodeAction[]): string {
  return effectsParts(actions).join(' · ')
}

function matchesReactionTarget(of: string, child: OverlayInstanceChild): boolean {
  const source = child.source
  return of === source.childId
    || of === child.id
    || of === `${source.mountId}/${source.childId}`
    || of === `${source.overlayId}/${source.childId}`
}

/** 从节点配置派生时间轴结算标记；单节点编辑与全流程预览共用。 */
export function collectNodeTimelineMarkers(
  scenario: GameScenario,
  node: GameNode,
): { pointMarkers: TimelinePointMarker[]; conditionMarkers: TimelineConditionMarker[] } {
  const pointMarkers: TimelinePointMarker[] = []
  const conditionMarkers: TimelineConditionMarker[] = []
  const settlement = node.data.routingSettlement
  if (settlement?.type === 'at') {
    pointMarkers.push({
      id: 'settlement',
      ms: settlement.ms,
      kind: 'settlement',
      label: translateUi('ui.object.4825ae716006'),
    })
  }

  const children = expandNodeChildren(scenario, node)
  ;(node.data.reactions ?? []).filter(isSettlementReaction).forEach((reaction, settlementIndex) => {
    const id = `life:${settlementIndex}`
    const actionChips = effectsParts(reaction.do)
    const actionLabel = actionChips.join(' · ')
    if (reaction.when.type === 'at' || reaction.when.type === 'enter') {
      pointMarkers.push({
        id,
        ms: reaction.when.type === 'at' ? reaction.when.ms : 0,
        kind: 'lifecycle',
        label: `${translateUi('ui.object.f419e35cc479')}${actionLabel}`,
      })
      return
    }
    if (reaction.when.type === 'watch') {
      const direction = reaction.when.on === 'inc' ? '增加' : reaction.when.on === 'dec' ? '减少' : '变化'
      // 条件行给作者看：用实体/属性中文名，不把 entity.ent-player.attr.hp 原样甩上时间轴。
      const ofLabel = formatWatchPathLabel(reaction.when.of ?? '', scenario.entities, scenario.variables)
      const conditionChips = [ofLabel, direction]
      conditionMarkers.push({ id, label: `${conditionChips.join(' ')} → ${actionLabel}`, conditionChips, actionChips })
      return
    }
    if (reaction.when.type === 'state') {
      const clauses = reaction.when.condition?.all
      const count = Array.isArray(clauses) ? clauses.length : 0
      const conditionChips = [count ? `满足 ${count} 项条件` : '未配置条件']
      conditionMarkers.push({ id, label: `${conditionChips[0]} → ${actionLabel}`, conditionChips, actionChips })
      return
    }
    if (reaction.when.type === 'shown' || reaction.when.type === 'hidden') {
      const when = reaction.when
      const child = children.find((candidate) => matchesReactionTarget(when.of, candidate))
      const ms = when.type === 'shown'
        ? (child ? elementStartMs(child) : null)
        : child?.window?.endMs ?? null
      const phase = when.type === 'shown' ? '出现' : '消失'
      const label = `${when.of || '未选界面'} ${phase} → ${actionLabel}`
      if (ms != null) {
        pointMarkers.push({ id, ms, kind: 'derived', draggable: false, label })
      } else {
        conditionMarkers.push({ id, label, conditionChips: [when.of || '未选界面', phase], actionChips })
      }
    }
  })

  return { pointMarkers, conditionMarkers }
}
