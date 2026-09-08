import type { LocalComponentManifest } from './manifest'

export const BattleSkillManifest: LocalComponentManifest = {
  id: 'BattleSkill',
  label: '战斗技能条',
  prompt: '战斗技能条：唯一的多选决策器，四个出口对应四种后果，是回合制战斗里「这一回合怎么打」的抓手。'
    + '事件：light（轻攻击）/ heavy（重攻击）/ medit（冥想）/ ult（灭世）。'
    + '四个事件都必须有去处（reaction 或出边），并且各自通向不同的后果，'
    + '再由下游节拍的视频演出来——轻击是试探、重击是拼命、冥想是回气、灭世是爆发；'
    + '四招走同一段演出等于四个等价按钮，观众按哪个都一样。'
    + '这一段剧情用不上某一招时，要让那个按钮真的按不下去，而不是留个空事件。'
    + '置灰规则是「资源 < 消耗」：把 <事件>Cost 配到 <事件>Resource 的上界之上'
    + '（资源绑常量就比常量大，绑 var.x 就比 variables.x.max 大，绑 entity.e.attr.a 就比 attrMeta.a.max 大）。'
    + '注意不配不等于关闭：缺省是 lightCost=0 / heavyCost=2 / meditCost=0 / ultCost=5，四个 *Resource 缺省 0，'
    + '所以不写 medit 的输入时「0 < 0」为假，冥想按钮是亮的、点得动、发得出事件，而没人接。要禁用就显式写 Cost。'
    + '使用：inputs.*Resource 绑技能资源（numberExpr），inputs.*Cost 配每招消耗，inputs.*Key 配按键。'
    + '资源变量最好同时绑到 BattlePlayerHpBar.qi，否则观众不知道大招为什么是灰的、还差多少。'
    + '一次挂载只能发一次事件（点完即锁），多回合必须靠图上的环回到待命节拍，不要指望在同一节点连点。'
    + '挂载用 trigger.when=enter，不配 window。摆放：页面底部居中（玩家血条上方）；同一场景只放一个技能条。',
  layout: {
    anchor: 'bottom-center',
    preferredRegion: { x: [0.2, 0.8], y: [0.68, 0.96] },
    defaultLayout: { left: 0.25, top: 0.72, width: 0.5, height: 0.18 },
    minSize: { width: 0.24, height: 0.12 },
    safeMargin: 0.04,
    avoid: ['BattlePlayerHpBar', 'BattleParry', 'InkKou', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'persistent-hud', mount: 'trigger-enter' },
  events: [
    { id: 'light', label: '轻攻击' },
    { id: 'heavy', label: '重攻击' },
    { id: 'medit', label: '冥想' },
    { id: 'ult', label: '灭世' },
  ],
  inputs: [
    { key: 'lightResource', label: '轻攻击资源', valueType: 'number', component: 'numberExpr' },
    { key: 'lightCost', label: '轻攻击资源消耗', valueType: 'number', component: 'numberExpr', default: 0 },
    { key: 'heavyResource', label: '重攻击资源', valueType: 'number', component: 'numberExpr' },
    { key: 'heavyCost', label: '重攻击资源消耗', valueType: 'number', component: 'numberExpr', default: 2 },
    { key: 'meditResource', label: '冥想资源', valueType: 'number', component: 'numberExpr' },
    { key: 'meditCost', label: '冥想资源消耗', valueType: 'number', component: 'numberExpr', default: 0 },
    { key: 'ultResource', label: '灭世资源', valueType: 'number', component: 'numberExpr' },
    { key: 'ultCost', label: '灭世资源消耗', valueType: 'number', component: 'numberExpr', default: 5 },
    { key: 'lightKey', label: '轻攻击按键', valueType: 'string', default: 'X' },
    { key: 'heavyKey', label: '重攻击按键', valueType: 'string', default: 'A' },
    { key: 'meditKey', label: '冥想按键', valueType: 'string', default: 'S' },
    { key: 'ultKey', label: '灭世按键', valueType: 'string', default: 'B' },
  ],
}
