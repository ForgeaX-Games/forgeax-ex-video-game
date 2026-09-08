/**
 * _raw —— Node 版 Vite `?raw`。
 *
 * reel 原本用 Vite 的 `import x from './SKILL.md?raw'` 把 skill 文本编译进 bundle。
 * 本插件的生成内核 vendored 到 forgeax-server（Node/Bun）里跑，没有 Vite，故改为
 * 运行时按「相对调用方模块」的路径 fs 读取。语义等价：拿到该 .md 的原始文本。
 *
 * 搬运纪律（reel-fmv-merge-plan.md §0.5）：各 loader 的 REGISTRY / 解析逻辑
 * 一字未动，仅把 `?raw` import 换成 `readRaw(import.meta.url, relPath)`。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 相对 `metaUrl`（传 `import.meta.url`）读取文件文本，等价于 Vite 的 `?raw`。 */
export function readRaw(metaUrl: string, relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, metaUrl)), 'utf8')
}
