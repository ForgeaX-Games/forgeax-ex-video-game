import {
  copyFile,
  readFile,
  readdir,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceFont = resolve(extensionRoot, 'src/runtime/react/component-host/components/HYShangWei.woff2')
const playerDist = resolve(extensionRoot, 'dist/player')
const sharedFont = resolve(playerDist, 'HYShangWei.woff2')
const assetsDir = resolve(playerDist, 'assets')
const entries = await readdir(assetsDir)
const fontFiles = entries.filter((name) => /^HYShangWei-.*\.woff2$/.test(name))

if (fontFiles.length !== 1) {
  throw new Error(
    `expected exactly one standalone HYShangWei font, found ${fontFiles.length}`,
  )
}

const emittedFont = fontFiles[0]
let replacements = 0

for (const name of entries.filter((entry) => entry.endsWith('.js'))) {
  const path = resolve(assetsDir, name)
  const source = await readFile(path, 'utf8')
  const rewritten = source.replaceAll(emittedFont, '../HYShangWei.woff2')
  if (rewritten === source) continue
  replacements += 1
  await writeFile(path, rewritten)
}

if (replacements === 0) {
  throw new Error(`standalone bundles do not reference ${emittedFont}`)
}

await copyFile(sourceFont, sharedFont)
await unlink(resolve(assetsDir, emittedFont))

console.log(
  `[deduplicate-standalone-font] rewrote ${replacements} bundle(s) to dist/player/HYShangWei.woff2`,
)
