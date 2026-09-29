import type {
  PillarFeedbackContract,
  PillarInteractionBeatContract,
} from './pillar-interaction-contract'

/**
 * 一拍会编进蓝图节点的覆盖物清单。
 *
 * 约定：一个节点通常只挂一份同类覆盖物组件——多个选项共用一个 ChoicePanel
 * 的不同事件，而不是挂两个 ChoicePanel。瞬时 spawn（飘字）不算常驻挂载。
 */
export type PillarOverlayPlanRole = 'input' | 'hud' | 'transient'

export interface PillarOverlayPlanRow {
  component: string
  role: PillarOverlayPlanRole
  target?: string
}

function absorbFeedback(
  spec: PillarFeedbackContract | undefined,
  huds: Map<string, PillarOverlayPlanRow>,
  transients: Map<string, PillarOverlayPlanRow>,
): void {
  if (!spec) return
  if (spec.kind === 'state-binding' && spec.component) {
    huds.set(spec.component, {
      component: spec.component,
      role: 'hud',
      target: spec.target,
    })
    return
  }
  if (spec.kind === 'transient-component' && spec.component) {
    transients.set(spec.component, { component: spec.component, role: 'transient' })
  }
}

export function collectBeatOverlayPlan(
  beat: PillarInteractionBeatContract,
): PillarOverlayPlanRow[] {
  const inputs = new Map<string, PillarOverlayPlanRow>()
  const huds = new Map<string, PillarOverlayPlanRow>()
  const transients = new Map<string, PillarOverlayPlanRow>()
  for (const action of beat.actions) {
    if (action.carrier?.component) {
      inputs.set(action.carrier.component, {
        component: action.carrier.component,
        role: 'input',
      })
    }
    absorbFeedback(action.feedbackSpec, huds, transients)
  }
  for (const settlement of beat.settlements) {
    absorbFeedback(settlement.feedbackSpec, huds, transients)
  }
  return [...inputs.values(), ...huds.values(), ...transients.values()]
}

/** 既当玩家输入又当常驻 HUD 的组件——同一节点会挂两份同类覆盖物。 */
export function duplicateMountedOverlayComponents(
  beat: PillarInteractionBeatContract,
): string[] {
  const plan = collectBeatOverlayPlan(beat)
  const counts = new Map<string, number>()
  for (const row of plan) {
    if (row.role === 'transient') continue
    counts.set(row.component, (counts.get(row.component) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([component]) => component)
}
