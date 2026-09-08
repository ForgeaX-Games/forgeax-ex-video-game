import type { LocalComponentManifest } from './manifest'

export const InkYingMoManifest: LocalComponentManifest = {
  id: 'InkYingMo',
  label: '應/默 抉择',
  prompt: '應/默 抉择：二元剧情分歧器。用在故事真的要分岔的节点——观众替主角做一个有后果的取舍'
    + '（应下 / 沉默、再饮 / 停杯、出手 / 旁观）；不要拿它当「点击继续」。'
    + '事件：ying（應）与 mo（默）是故事的两条岔路，不是同一段剧情的两种点法。两个事件都必须接线，'
    + '并且应当通向不同的下游节点：观众选「應」进入「應」的支线，在那个节点上结算「應」的后果，'
    + '并让该节点的视频演出这一后果（例如醉度上升、脚步虚浮）；「默」同理。'
    + '两条边指向同一个节点时观众的选择就是假的——一段视频演不出两种相反的后果。'
    + '无 inputs（两个选项文案固定）。挂载用 trigger.when=enter；台词还没说完就弹选项会让观众来不及听，'
    + '需要延后用 window.startMs。'
    + '摆放：页面中央或底部居中；同一时刻只出现一个抉择组件，不要与 QTE、血条重叠。',
  layout: {
    anchor: 'center-or-bottom-center',
    preferredRegion: { x: [0.2, 0.8], y: [0.48, 0.84] },
    defaultLayout: { left: 0.3, top: 0.56, width: 0.4, height: 0.26 },
    minSize: { width: 0.18, height: 0.12 },
    safeMargin: 0.04,
    avoid: ['BattleEnemyHpBar', 'BattlePlayerHpBar', 'BattleParry', 'InkKou', 'BattleSkill', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'interactive-choice', mount: 'trigger-enter' },
  events: [{ id: 'ying', label: '應' }, { id: 'mo', label: '默' }],
  inputs: [],
}
