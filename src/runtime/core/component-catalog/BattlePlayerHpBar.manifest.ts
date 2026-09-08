import type { LocalComponentManifest } from './manifest'

export const BattlePlayerHpBarManifest: LocalComponentManifest = {
  id: 'BattlePlayerHpBar',
  label: '我方水墨血条',
  prompt: '我方（玩家）血条：危机感与资源可视化。它同时承担两件事——'
    + '血量让观众感到危险，气力让观众明白「攒气开大」是一件可以规划的事。'
    + '无 events，纯显示。使用：inputs.current/max 绑玩家血量属性与其 attrMeta.max，inputs.qi/qiMax 绑气力（可省）。'
    + 'qi 应当与 BattleSkill 的 *Resource 绑同一个变量，否则观众不知道大招为什么是灰的、还差多少。'
    + 'max 必须真的有值：attrRatio 条件的分母就是它，缺了会让「血量比例 ≤ 0」在满血时就成立。'
    + '挂载用 trigger.when=enter，不配 window。摆放：页面右下角；一个场景只放一个我方血条。',
  layout: {
    anchor: 'bottom-right',
    preferredRegion: { x: [0.68, 0.96], y: [0.68, 0.96] },
    defaultLayout: { left: 0.68, top: 0.76, width: 0.28, height: 0.16 },
    minSize: { width: 0.16, height: 0.08 },
    safeMargin: 0.04,
    avoid: ['BattleEnemyHpBar', 'BattleSkill', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'persistent-hud', mount: 'trigger-enter' },
  inputs: [
    { key: 'label', label: '显示名', valueType: 'string', default: '我方', component: 'numberExpr' },
    { key: 'current', label: '血量', valueType: 'number', required: true, component: 'numberExpr' },
    { key: 'max', label: '最大血量', valueType: 'number', required: true, component: 'numberExpr' },
    { key: 'qi', label: '当前气力', valueType: 'number', component: 'numberExpr', default: 3 },
    { key: 'qiMax', label: '气力上限', valueType: 'number', component: 'numberExpr', default: 5 },
  ],
  events: [],
}
