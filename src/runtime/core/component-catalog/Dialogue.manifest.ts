import type { LocalComponentManifest } from './manifest'

export const DialogueManifest: LocalComponentManifest = {
  id: 'Dialogue',
  label: '字幕/对白',
  prompt: '字幕 / 对白：叙事底座，零互动价值。它能让一段戏被听懂，但挂了它不等于配了玩法——'
    + 'beat 不是 narrative 的节点只挂字幕，等于观众只能干看。'
    + '互动只来自决策器（战斗技能条、防反 QTE、應默抉择、叩击、文字交互），字幕是陪衬不是主角。'
    + '无 events，纯表现。使用：inputs.text 绑台词（numberExpr 可读变量 / 公式），inputs.speaker 是说话人名，'
    + 'inputs.color/fontSize 配样式。'
    + '挂载用 trigger.when=enter；需要与语音对齐时用 window 表达出现区间。'
    + '摆放：页面底部居中（尽量靠近下缘）；同一时刻只显示一条字幕，不要与血条、技能条重叠。',
  layout: {
    anchor: 'bottom-center',
    preferredRegion: { x: [0.08, 0.92], y: [0.68, 0.94] },
    defaultLayout: { left: 0.08, top: 0.76, width: 0.84, height: 0.14 },
    minSize: { width: 0.3, height: 0.1 },
    safeMargin: 0.04,
    avoid: ['BattlePlayerHpBar', 'BattleEnemyHpBar', 'BattleSkill', 'TextOption'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'interactive-choice', mount: 'trigger-enter' },
  inputs: [
    { key: 'speaker', label: '说话人', valueType: 'string', component: 'numberExpr' },
    { key: 'text', label: '台词', valueType: 'string', component: 'numberExpr', default: '……' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color' },
    { key: 'fontSize', label: '字号', valueType: 'number' },
  ],
  events: [],
}
