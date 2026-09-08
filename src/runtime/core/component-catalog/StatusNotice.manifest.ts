import type { LocalComponentManifest } from './manifest'

export const StatusNoticeManifest: LocalComponentManifest = {
  id: 'StatusNotice',
  label: '状态提示',
  prompt: '状态提示：把不可见的变量变化显性化。醉度、疑窦、线索这类跨章节状态被改动时，'
    + '如果不弹一条提示，观众根本不知道自己刚才的选择留下了什么——后面用这个变量门控结局时，'
    + '分支会显得莫名其妙。'
    + '提示实例只能由 reaction 的 spawn 动态产生，不能写进静态 children；'
    + '但这不限制时间轴卡点：如果要在视频 3000ms 出现，应写 reaction.when={ type: "at", ms: 3000 }，'
    + '再在 do 里执行 { kind: "spawn", from: "base:StatusNotice/StatusNotice-0", '
    + 'inputs: { fixedText: "醉度 +1" }, ttlMs: 1600 }。'
    + '静态挂载会被 ui.floattext.static-mount 拦下；at(ms) 的 reaction 是合法用法。'
    + '使用：inputs.fixedText 是固定提示文字，inputs.parameter 可绑变量/公式插值，'
    + 'inputs.color/fontSize/durationMs 配样式；无 events。'
    + '同一时刻只弹一条状态提示，不要与血条、技能条抢位置。',
  layout: {
    anchor: 'top-center',
    preferredRegion: { x: [0.2, 0.8], y: [0.12, 0.38] },
    defaultLayout: { left: 0.3, top: 0.16, width: 0.4, height: 0.12 },
    minSize: { width: 0.16, height: 0.06 },
    safeMargin: 0.04,
    avoid: ['BattleEnemyHpBar', 'Dialogue'],
    maxInstances: 1,
    overflow: 'forbidden',
  },
  timing: { kind: 'spawn-only', mount: 'spawn', defaultTtlMs: 1600 },
  inputs: [
    { key: 'fixedText', label: '固定文本', valueType: 'string', default: '获得道具' },
    { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr', default: '〈xxx〉' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#f0f0f0' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 2.4 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1600 },
  ],
  events: [],
}
