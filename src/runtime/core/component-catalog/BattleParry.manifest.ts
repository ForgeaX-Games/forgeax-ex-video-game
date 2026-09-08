import type { LocalComponentManifest } from './manifest'

export const BattleParryManifest: LocalComponentManifest = {
  id: 'BattleParry',
  label: '防反 QTE',
  prompt: '防反 QTE：唯一的实时操作压力源，三档判定天然对应三条边。用在敌方杀招袭来的那一刻。'
    + '事件：greatSuccess（两键全中）/ success（中一键）/ fail（未中）。'
    + '三档由元件自己在约 1500ms 内结算，玩家回避不了任何一档，也没有办法把某一档关掉——'
    + '三个事件必须全部接线，且必须通向真正不同的后果：大成功反打重创、成功减免伤害、失败吃满伤，'
    + '各自在下游节拍有对应的演出。三档合流到同一个节点，这个 QTE 就只是装饰。'
    + '使用：inputs.firstKey/secondKey 配两个按键。'
    + '调度：用 window 表达时机，不要靠 trigger——必须对齐视频里出刀 / 扑击的那一帧，'
    + '0ms 开场弹出会与画面脱节。它自带 1500ms 内部判定，外层窗口要么不设 endMs（让它自己结算），'
    + '要么 endMs - startMs ≥ 1600，短于这个会打断判定环动画。'
    + '被 window 卸载时它仍会 emit，所以不需要超时兜底。'
    + '摆放：页面中央；不要与血条、技能条重叠，同一时刻只出现一个 QTE。',
  layout: {
    anchor: 'center',
    preferredRegion: { x: [0.25, 0.75], y: [0.28, 0.72] },
    defaultLayout: { left: 0.3, top: 0.32, width: 0.4, height: 0.24 },
    minSize: { width: 0.12, height: 0.12 },
    safeMargin: 0.04,
    avoid: ['BattleEnemyHpBar', 'BattlePlayerHpBar', 'BattleSkill', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'windowed-qte', mount: 'window', selfSettleMs: 1500, emitsOnUnmount: true },
  events: [{ id: 'greatSuccess', label: '大成功' }, { id: 'success', label: '成功' }, { id: 'fail', label: '失败' }],
  inputs: [
    { key: 'firstKey', label: '第一按键', valueType: 'string', default: 'A' },
    { key: 'secondKey', label: '第二按键', valueType: 'string', default: 'B' },
  ],
}
