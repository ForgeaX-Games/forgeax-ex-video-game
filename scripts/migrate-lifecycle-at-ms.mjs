/**
 * 一次性治理脚本：把节点生命周期效果的触发相位统一折算成 `at(ms)`。
 *
 * 背景：`node.data.reactions` 的生命周期子集原有四种相位（enter / at / exit / complete），
 * 在作者视角里是同一件事的四种说法——「什么时刻施加这组副作用」。检视器已去掉四选一下拉框，
 * 只留「播到 ms」（唯一可精确表达、且能在时间轴上看见并拖动的形式），这里把落盘数据跟上。
 *
 * 折算规则：
 *   - enter → `at(0)`（进入即施加，语义等价）
 *   - at    → 原样不动
 *
 * **`exit` / `complete` 刻意不动**，因为它们折算过去会静默改坏行为，不是"同一件事的另一种说法"：
 *   - `complete` 是**只取一条**（引擎 `applyCompleteReactionEffects`：首个 `if` 成立者，否则无 `if`
 *     的兜底），作者用它写 if/else 对。全折算成 `at` 后每条都会触发，if/else 退化成"最后一条赢"
 *     —— demo 的先手判定（`mineFirst` 1/0 两分支）正是这样被反转的。
 *   - `exit` 在**任何**离开路径上都触发（含提前走边），`at(durationMs)` 只在播满时触发。
 *
 * 这两种相位的历史数据仍由运行时支持，检视器把它们显示成对应 ms 并打黄色角标；作者改动那一行时
 * 才就地折算成 `at`（丢 `if` 是那一刻的显式选择，不由脚本静默代劳）。
 *
 * 用法：node scripts/migrate-lifecycle-at-ms.mjs <file.json> [...]
 *
 * 用法：node scripts/migrate-lifecycle-at-ms.mjs <file.json> [...]
 */
import { readFileSync, writeFileSync } from 'node:fs'

let converted = 0
const kept = []

function migrateNode(node, nodeLabel) {
  const reactions = node?.data?.reactions
  if (!Array.isArray(reactions)) return
  node.data.reactions = reactions.map((r) => {
    const type = r?.when?.type
    if (type === 'exit' || type === 'complete') {
      kept.push(`${nodeLabel} · ${type}${type === 'complete' && r.when.if ? '(if)' : ''}`)
      return r
    }
    if (type !== 'enter') return r
    converted += 1
    return { ...r, when: { type: 'at', ms: 0 } }
  })
}

function migrateDoc(doc) {
  const graphs = [doc.graph, ...Object.values(doc.manifest?.packs ?? {}).map((p) => p.graph)]
  for (const g of graphs) {
    for (const n of g?.nodes ?? []) migrateNode(n, `${n.data?.name ?? n.id} (${n.id})`)
  }
}

for (const file of process.argv.slice(2)) {
  converted = 0
  kept.length = 0
  const doc = JSON.parse(readFileSync(file, 'utf-8'))
  migrateDoc(doc)
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`)
  // eslint-disable-next-line no-console
  console.log(`${file}: enter → at(0) 折算 ${converted} 条`)
  for (const line of kept) {
    // eslint-disable-next-line no-console
    console.log(`  · 保留原相位（折算会改行为，见文件头注释）：${line}`)
  }
}
