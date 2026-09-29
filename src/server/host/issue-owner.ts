/**
 * 问题归属：一条校验失败该由哪个活动返工。
 *
 * 总脉络 / 规则 / 界面 / 整装是编译阶段，没有 agent 工具；审查阶段也已收回写域。
 * 所以这些码的 owner 收口到 `document.pillar`：编译产物的缺口只能改编译输入，
 * 再整份重编译。把它们指向审查阶段等于要求 LLM 手改编译结果——实测那会把一张
 * 21 边全可达的图改成仅入口可达，再报出 50 条它自己造出来的错误。
 *
 * 认不出的码返回 `undefined`：猜错 owner 会把 peer 引向错误的返工路径，比不猜更糟。
 */
import { isCompiledActivity, type VideoGameActivity } from '../../workflow/contracts'

/** 前缀 → 负责返工的活动。顺序敏感：更长的前缀必须排在更短的之前。 */
const OWNER_BY_PREFIX: Array<[string, VideoGameActivity]> = [
  ['document.pillar.', 'document.pillar'],
  ['outline.', 'blueprint.outline'],
  ['combat.', 'blueprint.outline'],
  // 界面挂载与输入键属于界面写域。
  ['ui.overlay.', 'ui.authoring'],
  ['ui.component.', 'ui.authoring'],
  ['ui.exit.', 'ui.authoring'],
  ['ui.timing.', 'ui.authoring'],
  ['ui.trigger.', 'ui.authoring'],
  ['ui.floattext.', 'ui.authoring'],
  ['qte.', 'ui.authoring'],
  ['finalization.plan.component-unmounted', 'ui.authoring'],
  ['finalization.plan.event-reaction-missing', 'ui.authoring'],
  ['finalization.plan.state-feedback-missing', 'ui.authoring'],
  ['finalization.required-ui', 'ui.authoring'],
  ['finalization.interaction.', 'ui.authoring'],
  // 把规则接到边与 reaction 上是 rules.binding 的活。
  ['rules.binding.', 'rules.binding'],
  ['finalization.plan.effect-', 'rules.binding'],
  ['finalization.plan.terminal-unwired', 'rules.binding'],
  ['finalization.plan.settlement-', 'rules.binding'],
  ['finalization.settlements', 'rules.binding'],
  ['finalization.binding.', 'rules.binding'],
  // 区间、公式、实体属性都在规则目录里。
  ['rules.plan.', 'rules.catalog'],
  ['rules.formula.', 'rules.catalog'],
  ['rules.variable.', 'rules.catalog'],
  ['rules.entity.', 'rules.catalog'],
  ['rules.attr-meta.', 'rules.catalog'],
  ['ref.formula.', 'rules.binding'],
  ['ref.symbol.', 'rules.binding'],
  ['ref.expr.', 'rules.binding'],
  ['finalization.formula.', 'rules.catalog'],
  ['playtest.variable.', 'rules.catalog'],
  ['playtest.attr.', 'rules.catalog'],
  // 结构类：节点、边、出口，都要 graph 写域，归整装。
  ['playtest.dead-loop', 'game.finalizing'],
  ['playtest.no-rest-point', 'game.finalizing'],
  ['playtest.path.', 'game.finalizing'],
  ['playtest.runtime.', 'game.finalizing'],
  ['playtest.edge.', 'game.finalizing'],
  ['graph.', 'game.finalizing'],
  ['finalization.plan.exit-missing', 'game.finalizing'],
  ['quality.edge-producer-', 'blueprint.outline'],
  ['quality.pillar-trace-', 'blueprint.outline'],
  ['quality.downstream-payoff-', 'blueprint.outline'],
  ['quality.combat-loop-', 'blueprint.outline'],
  ['quality.decision-consequence', 'blueprint.outline'],
  ['quality.feedback-coverage', 'ui.authoring'],
  ['finalization.', 'game.finalizing'],
  // 角色与场景各归自己那条线；出图缺口归出图那一步。
  ['character.preview.', 'characters.previewing'],
  ['characters.preview', 'characters.previewing'],
  ['characters.', 'characters.modeling'],
  ['scene.preview.', 'scenes.previewing'],
  ['scenes.preview', 'scenes.previewing'],
  ['scenes.', 'scenes.modeling'],
  ['video.presets.', 'video.presets.binding'],
  ['node.video-', 'video.presets.binding'],
]

export function ownerForIssueCode(code: string): VideoGameActivity | undefined {
  for (const [prefix, activity] of OWNER_BY_PREFIX) {
    if (!code.startsWith(prefix)) continue
    return isCompiledActivity(activity) ? 'document.pillar' : activity
  }
  return undefined
}
