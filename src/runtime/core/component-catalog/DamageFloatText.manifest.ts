import type { LocalComponentManifest } from './manifest'

export const DamageFloatTextManifest: LocalComponentManifest = {
  id: 'DamageFloatText',
  label: '伤害飘字',
  prompt: '伤害飘字：打击反馈。扣了血却没有飘字，观众只能盯着血条猜这一下有没有打中，手感会塌掉；'
    + '凡是造成伤害的 event reaction，都应当配一条飘字。'
    + '飘字实例只能由 reaction 的 spawn 动态产生，不能写进静态 children；'
    + '但这不限制时间轴卡点：如果要在视频 3000ms 出现，应写 reaction.when={ type: "at", ms: 3000 }，'
    + '再在 do 里执行 { kind: "spawn", from: "base:DamageFloatText/DamageFloatText-0", '
    + 'inputs: { parameter: { expr: "formula.<伤害公式 id>" } }, ttlMs: 1100 }。'
    + '静态挂载会被 ui.floattext.static-mount 拦下；at(ms) 的 reaction 是合法用法。'
    + '使用：inputs.parameter 绑伤害值（numberExpr），inputs.fixedText 是固定前缀文字，'
    + 'inputs.color/fontSize/durationMs 配样式；无 events。'
    + '出现位置由 spawn 时的受击目标决定；同一节拍不要连续 spawn 多条完全重叠的飘字。',
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
    { key: 'color', label: '字色', valueType: 'string', component: 'color', default: '#ff5a5a' },
    { key: 'fontSize', label: '字号', valueType: 'number', default: 3.5 },
    { key: 'durationMs', label: '总时长ms', valueType: 'number', default: 1100 },
  ],
  events: [],
}
