import type { LocalComponentManifest } from './manifest'

export const GainFloatTextManifest: LocalComponentManifest = {
  id: 'GainFloatText',
  label: '增益飘字',
  prompt: '增益飘字：正反馈。回气、回血、拾取、士气上涨——凡是往好的方向改了数值的 reaction，'
    + '都应当让观众当场看见。与伤害飘字对称，只是默认金色。'
    + '飘字实例只能由 reaction 的 spawn 动态产生，不能写进静态 children；'
    + '但这不限制时间轴卡点：如果要在视频 3000ms 出现，应写 reaction.when={ type: "at", ms: 3000 }，'
    + '再在 do 里执行 { kind: "spawn", from: "base:GainFloatText/GainFloatText-0", '
    + 'inputs: { parameter: { expr: "formula.<增益公式 id>" } }, ttlMs: 1100 }。'
    + '静态挂载会被 ui.floattext.static-mount 拦下；at(ms) 的 reaction 是合法用法。'
    + '使用：inputs.parameter 绑增益值（numberExpr），inputs.fixedText 是固定前缀文字，'
    + 'inputs.color/fontSize/durationMs 配样式；无 events。'
    + '出现位置由 spawn 时的目标角色决定；同一节拍不要连续 spawn 多条完全重叠的飘字。',
  layout: {
    anchor: 'target',
    preferredRegion: { x: [0.2, 0.8], y: [0.16, 0.7] },
    defaultLayout: { left: 0.35, top: 0.3, width: 0.3, height: 0.14 },
    minSize: { width: 0.08, height: 0.06 },
    safeMargin: 0.04,
    avoid: ['DamageFloatText', 'GainFloatText'],
    overflow: 'forbidden',
  },
  timing: { kind: 'spawn-only', mount: 'spawn', defaultTtlMs: 1100 },
  inputs: [
    { key: 'fixedText', label: '固定文本', valueType: 'string', default: '' },
    { key: 'parameter', label: '参数', valueType: 'string', component: 'numberExpr' },
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#ffd54a' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 3.5 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1100 },
  ],
  events: [],
}
