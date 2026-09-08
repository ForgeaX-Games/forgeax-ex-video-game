import type { LocalComponentManifest } from './manifest'

export const InkKouManifest: LocalComponentManifest = {
  id: 'InkKou',
  label: '叩击',
  prompt: '叩击 QTE：单点卡点，价值在仪式感而不在分支——破门、斩杀、挣脱、最后一击。'
    + '事件：只有 kou 一个，必须接线；它代表「这一下成了」，下游节点的视频要演出这一下的结果。'
    + '它没有内部超时，被 window 卸载时不会发任何事件，所以必须同时配 window.endMs 和一条'
    + '玩家没按时的兜底走向（default 出边或 routingSettlement），否则观众不点就永久卡死。'
    + '使用：inputs.triggerKey 配触发按键。'
    + '调度：用 window 表达时机，对齐视频里该出手的那一帧；0ms 开场弹出会与画面脱节。'
    + '摆放：页面中央；不要与血条、技能条重叠，同一时刻只出现一个 QTE。',
  layout: {
    anchor: 'center',
    preferredRegion: { x: [0.25, 0.75], y: [0.28, 0.72] },
    defaultLayout: { left: 0.3, top: 0.32, width: 0.4, height: 0.24 },
    minSize: { width: 0.12, height: 0.14 },
    safeMargin: 0.04,
    avoid: ['BattleEnemyHpBar', 'BattlePlayerHpBar', 'BattleSkill', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'windowed-qte', mount: 'window', emitsOnUnmount: false },
  events: [{ id: 'kou', label: '叩' }],
  inputs: [{ key: 'triggerKey', label: '触发按键', valueType: 'string', default: 'A' }],
}
