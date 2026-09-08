import type { LocalComponentManifest } from './manifest'

export const TextOptionManifest: LocalComponentManifest = {
  id: 'TextOption',
  label: '文字交互',
  prompt: '文字交互提示：探索与搜证入口，也是最低成本提升互动密度的手段（「查看血迹」「推开柴门」「向掌柜搭话」）。'
    + '事件：只有 activate 一个，所以单个 TextOption 本身不构成分歧。'
    + '要做「查 A 还是查 B」就挂两个实例、inputs.text 各写各的，并在各自挂载的 reactions 里用 '
    + '{ kind: "advance", edgeId } 指名不同的出边——节点出口 handle 按 id 去重，两个实例共用同一个 '
    + 'activate 出口，靠 sourceHandle 分不开。两条支线要落在不同节点，各自的视频演各自查到了什么。'
    + '同一节点已经挂了 InkYingMo 做抉择时，不要再挂一个后果相同的 TextOption：'
    + '两个控件做同一件事是冗余，观众也不知道该点哪个。'
    + '使用：inputs.text 是提示文字，inputs.triggerKey 是触发按键，inputs.color 配样式。挂载用 trigger.when=enter。'
    + '摆放：可交互对象附近或页面底部居中；不要与字幕、血条重叠。',
  layout: {
    anchor: 'target-or-bottom-center',
    preferredRegion: { x: [0.15, 0.85], y: [0.6, 0.88] },
    defaultLayout: { left: 0.25, top: 0.72, width: 0.5, height: 0.12 },
    minSize: { width: 0.15, height: 0.08 },
    safeMargin: 0.04,
    avoid: ['Dialogue', 'BattleEnemyHpBar', 'BattlePlayerHpBar', 'BattleSkill'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'interactive-choice', mount: 'trigger-enter' },
  inputs: [
    { key: 'text', label: '文字', valueType: 'string', component: 'numberExpr', default: '摁F交互' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
    { key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'F' },
  ],
  events: [{ id: 'activate', label: '交互' }],
}
