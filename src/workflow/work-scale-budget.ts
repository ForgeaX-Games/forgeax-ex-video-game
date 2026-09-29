import type { RequirementContract } from './contracts'

export interface WorkScaleBudget {
  id: 'micro' | 'short' | 'medium' | 'long'
  label: '极短' | '短篇' | '中篇' | '长篇'
  nodeCount: number
  minNodeCount: number
  maxNodeCount: number
  characterCount?: number
  sceneCount?: number
  minCombatCount?: number
  maxCombatCount?: number
}

export const WORK_SCALE_BUDGETS: readonly WorkScaleBudget[] = [
  {
    id: 'micro',
    label: '极短',
    nodeCount: 3,
    minNodeCount: 3,
    maxNodeCount: 4,
    characterCount: 2,
    sceneCount: 1,
    minCombatCount: 0,
    maxCombatCount: 1,
  },
  {
    id: 'short',
    label: '短篇',
    nodeCount: 10,
    minNodeCount: 8,
    maxNodeCount: 15,
    minCombatCount: 1,
  },
  {
    id: 'medium',
    label: '中篇',
    nodeCount: 15,
    minNodeCount: 12,
    maxNodeCount: 20,
    minCombatCount: 1,
    maxCombatCount: 3,
  },
  {
    id: 'long',
    label: '长篇',
    nodeCount: 20,
    minNodeCount: 16,
    maxNodeCount: 28,
    minCombatCount: 1,
    maxCombatCount: 8,
  },
]

/** Parse the canonical questionnaire value while tolerating legacy short labels. */
export function workScaleBudgetFromValue(value: string | undefined): WorkScaleBudget | null {
  const normalized = value?.replace(/\s+/g, '') ?? ''
  if (!normalized) return null
  return WORK_SCALE_BUDGETS.find((budget) => (
    normalized.startsWith(budget.label)
    || normalized.includes(`${budget.nodeCount}个章节`)
    || normalized.includes(`${budget.nodeCount}个蓝图节点`)
  )) ?? null
}

export function workScaleBudgetFromContract(
  contract: RequirementContract | undefined,
): WorkScaleBudget | null {
  return workScaleBudgetFromValue(contract?.dimensions.work_scale?.value)
}

/** Pillar fields that decide how many outline chapters a design physically needs. */
export interface OutlineNodeBudgetSource {
  beats: readonly {
    actions: readonly {
      id: string
      stateMutationOwner?: 'none' | 'settlement'
      requiredRole?: string
    }[]
    settlements: readonly { sourceActionId?: string }[]
  }[]
}

export interface MinimumOutlineNodeCount {
  interactiveChapters: number
  resultChapters: number
  combatActions: number
  minNodeCount: number
}

/**
 * 每个有动作的节拍 1 个互动节点；该拍只要有已配对的 settlement 动作，再加 1 个同节拍结果节点。
 * 同一拍的多个数值选项 / 战斗指令共用这一拍结果节点，否则短篇默认骨架
 * （10 拍 + 两处分叉 + 一场战斗）会在加上终局后越过 15 的上限。
 * 纯叙事节拍（无动作）不占最小预算——它们可以并进已有结果节点。
 */
export function minimumOutlineNodeCount(pillar: OutlineNodeBudgetSource): MinimumOutlineNodeCount {
  let interactiveChapters = 0
  let resultChapters = 0
  let combatActions = 0
  for (const beat of pillar.beats) {
    combatActions += beat.actions.filter((action) => action.requiredRole === 'combat-command').length
    if (beat.actions.length === 0) continue
    interactiveChapters += 1
    const settles = beat.actions.some((action) => (
      action.stateMutationOwner === 'settlement'
      && beat.settlements.some((settlement) => settlement.sourceActionId === action.id)
    ))
    if (settles) resultChapters += 1
  }
  return {
    interactiveChapters,
    resultChapters,
    combatActions,
    minNodeCount: interactiveChapters + resultChapters,
  }
}

export function outlineScaleBudgetMessage(
  budget: WorkScaleBudget,
  outline: MinimumOutlineNodeCount,
): string {
  return (
    `这份支柱最少需要 ${outline.minNodeCount} 个主图节点`
    + `（${outline.interactiveChapters} 个互动节拍 + ${outline.resultChapters} 个同节拍结果节点），`
    + `超过${budget.label}上限 ${budget.maxNodeCount}。`
    + '请合并节拍、把部分动作改成 stateMutationOwner=none，或改篇幅规模后再让作者确认。'
  )
}

export type OutlineScaleBudgetErrorCode =
  | 'outline.pillar-budget-exceeded'
  | 'outline.node-count-exceeds-scale'

/**
 * 骨架提交前的篇幅闸门。没有预算时放行——那是需求未齐，不该在这里猜上限。
 */
export function outlineScaleBudgetFailure(
  pillar: OutlineNodeBudgetSource,
  chapterCount: number,
  budget: WorkScaleBudget | null | undefined,
): { errorCode: OutlineScaleBudgetErrorCode; message: string } | null {
  if (!budget) return null
  const outline = minimumOutlineNodeCount(pillar)
  if (outline.minNodeCount > budget.maxNodeCount) {
    return {
      errorCode: 'outline.pillar-budget-exceeded',
      message: outlineScaleBudgetMessage(budget, outline),
    }
  }
  if (chapterCount > budget.maxNodeCount) {
    return {
      errorCode: 'outline.node-count-exceeds-scale',
      message: (
        `${budget.label}主图最多 ${budget.maxNodeCount} 个节点，骨架提交了 ${chapterCount} 个。`
        + `按支柱最少需要 ${outline.minNodeCount} 个`
        + `（${outline.interactiveChapters} 个互动节拍 + ${outline.resultChapters} 个同节拍结果节点）。`
        + '超上限不要建骨架，先压缩支柱或改篇幅。'
      ),
    }
  }
  return null
}
