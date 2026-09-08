import type { LocalComponentManifest } from './manifest'

export const BattleEnemyHpBarManifest: LocalComponentManifest = {
  id: 'BattleEnemyHpBar',
  label: '敌方水墨血条',
  prompt: '敌方（敌人 / BOSS）血条：目标进度条。没有它，回合制就失去节奏感——'
    + '观众不知道还要打几回合，也看不出这一击到底有没有效。'
    + '战斗节拍里它应当和我方血条成对出现；只挂技能条不挂血条，观众感知不到自己的操作改变了什么。'
    + '无 events，纯显示。使用：inputs.current 绑敌方实体的血量属性（numberExpr，例如 entity.tiger.attr.hp），'
    + 'inputs.max 绑该属性的 attrMeta.max，inputs.label 是显示名。'
    + 'max 必须真的有值：attrRatio 条件的分母就是它，缺了会让「血量比例 ≤ 0」在满血时就成立，一进战斗立刻判负。'
    + '挂载用 trigger.when=enter，不配 window。'
    + '摆放：页面顶部水平居中；一个场景只放一个，多个敌人时只展示当前主要敌人（BOSS）。',
  layout: {
    anchor: 'top-center',
    preferredRegion: { x: [0.2, 0.8], y: [0.02, 0.24] },
    defaultLayout: { left: 0.25, top: 0.04, width: 0.5, height: 0.12 },
    minSize: { width: 0.16, height: 0.06 },
    safeMargin: 0.04,
    avoid: ['BattlePlayerHpBar', 'BattleSkill', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'persistent-hud', mount: 'trigger-enter' },
  inputs: [
    { key: 'label', label: '显示名', valueType: 'string', default: '敌方', component: 'numberExpr' },
    { key: 'current', label: '血量', valueType: 'number', required: true, component: 'numberExpr' },
    { key: 'max', label: '最大血量', valueType: 'number', required: true, component: 'numberExpr' },
  ],
  events: [],
}
