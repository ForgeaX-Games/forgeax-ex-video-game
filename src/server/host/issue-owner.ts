/**
 * 问题归属：一条校验失败该由哪个活动返工。
 *
 * `playtest.validating` 写域是空的——它看得见问题却改不了，只能 `report_blocker` 交回。
 * 此前「交回哪一步」全凭模型判断，第二局它判错了：把界面缺口当成整装自己的活，
 * 于是同样的四条边连改三遍还是过不去。归属是**写域的函数**，不是判断题，
 * 所以由 Host 算出来随失败一起回传。
 *
 * 认不出的码返回 `undefined`：猜错 owner 会把 peer 引向错误的返工路径，比不猜更糟。
 */
import type { VideoGameActivity } from '../../workflow/contracts'

/** 前缀 → 负责返工的活动。顺序敏感：更长的前缀必须排在更短的之前。 */
const OWNER_BY_PREFIX: Array<[string, VideoGameActivity]> = [
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
  ['finalization.required-ui', 'ui.authoring'],
  ['finalization.interaction.', 'ui.authoring'],
  // 把规则接到边与 reaction 上是 rules.binding 的活。
  ['rules.binding.', 'rules.binding'],
  ['finalization.plan.effect-unwired', 'rules.binding'],
  ['finalization.plan.terminal-unwired', 'rules.binding'],
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
    if (code.startsWith(prefix)) return activity
  }
  return undefined
}
