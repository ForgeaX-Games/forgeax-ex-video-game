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
