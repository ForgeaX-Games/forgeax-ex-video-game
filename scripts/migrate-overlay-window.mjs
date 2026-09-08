/**
 * 一次性治理脚本：把 overlay 子件的显隐时序统一落到 `window.startMs/endMs`。
 *
 * 背景：运行时早已以 `window` 为唯一权威（`nodes/perf.ts` 与 `engine.ts#flushTimeline` 都在
 * `el.window` 存在时跳过 `trigger`），但历史数据里拍点型组件（inkKou/battleParry）只有
 * `inputs.cues`、没有 `window`，编辑器便反推 cue 当显隐窗——两套时序来源就是"协议乱"的根。
 *
 * 本脚本给每个缺 `window` 的子件补上：
 *   - 拍点型（有 inputs.cues）：`{ startMs: min(appearAt), endMs: min(max(endAt), start + timeoutMs) }`
 *     —— 与它此前在时间轴/预览上的真实跨度一致，迁移前后画面不变；
 *   - 其余：`{ startMs: trigger.when==='at' ? trigger.ms : 0 }`（不写 endMs = 持续到节点结束，
 *     与原 trigger 行为等价）。
 * 已有 `window` 的子件一律不动。filter/fx 无时序语义，跳过。
 *
 * 用法：node scripts/migrate-overlay-window.mjs <file.json> [...]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const CUE_FALLBACK_MS = 1000

function childWindow(child) {
  const inputs = child.inputs ?? {}
  const cues = Array.isArray(inputs.cues) ? inputs.cues : null
  if (cues && cues.length > 0) {
    const start = Math.min(...cues.map((c) => c.appearAt ?? 0))
    let end = Math.max(
      ...cues.map((c) => c.endAt ?? (c.targetAt ?? c.appearAt ?? 0) + CUE_FALLBACK_MS),
    )
    const timeout = typeof inputs.timeoutMs === 'number' && inputs.timeoutMs > 0 ? inputs.timeoutMs : null
    if (timeout != null) end = Math.min(end, start + timeout)
    return { startMs: start, endMs: Math.max(start + 100, end) }
  }
  const start = child.trigger?.when === 'at' ? (child.trigger.ms ?? 0) : 0
  return { startMs: start }
}

let touched = 0
function migrateChild(child) {
  if (!child || typeof child !== 'object') return
  if (child.component === 'filter' || child.component === 'fx') return
  if (child.window && typeof child.window === 'object') return
  child.window = childWindow(child)
  touched += 1
}

/** 覆盖物子件散落三处：目录原型 ui.overlays[*].children、挂载 added[]、挂载 overrides[*]（可能带 inputs.cues）。 */
function migrateDoc(doc) {
  for (const ov of Object.values(doc.ui?.overlays ?? {})) {
    for (const c of ov.children ?? []) migrateChild(c)
  }
  const graphs = [doc.graph, ...Object.values(doc.manifest?.packs ?? {}).map((p) => p.graph)]
  for (const g of graphs) {
    for (const n of g?.nodes ?? []) {
      for (const mount of n.data?.overlayNodes ?? []) {
        for (const c of mount.added ?? []) migrateChild(c)
        for (const ov of Object.values(mount.overrides ?? {})) migrateChild(ov)
      }
    }
  }
}

for (const file of process.argv.slice(2)) {
  touched = 0
  const doc = JSON.parse(readFileSync(file, 'utf-8'))
  migrateDoc(doc)
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  // eslint-disable-next-line no-console
  console.log(`${file}: 补齐 window 的子件 ${touched} 个`)
}
