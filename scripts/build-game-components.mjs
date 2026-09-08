// build-game-components.mjs — build a game repo's components/ → dist/components/index.js
//
// Per-game components (game repo `components/index.tsx`) are bundled to an ESM
// artifact that the runtime `component-host` loads via
// `GET /api/game-host/games/<slug>/components/index.js`.
//
// Contract (see src/component-host/index.ts): the artifact exports
//   export function register(host) { … }
// and uses the host-injected `host.React` / `host.registerComponent` /
// `host.registerOverlayRenderer` instead of importing react/platform modules —
// so the artifact carries no React copy and no platform coupling.
//
// Usage:  bun scripts/build-game-components.mjs <gameDir>
//   e.g.  bun scripts/build-game-components.mjs ../../../games/game-nodia-fighting
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const gameDir = process.argv[2]
if (!gameDir) {
  console.error('usage: bun scripts/build-game-components.mjs <gameDir>')
  process.exit(2)
}
const root = resolve(process.cwd(), gameDir)
const entryTs = resolve(root, 'components', 'index.tsx')
const entry = existsSync(entryTs) ? entryTs : resolve(root, 'components', 'index.ts')
if (!existsSync(entry)) {
  console.error('[build-components] no components/index.tsx|ts in', root)
  process.exit(1)
}
const outfile = resolve(root, 'dist', 'components', 'index.js')

// bun build → ESM; react/react-dom external (host injects React). No platform imports expected.
const res = spawnSync(
  'bun',
  [
    'build',
    entry,
    `--outfile=${outfile}`,
    '--format=esm',
    '--target=browser',
    '--external=react',
    '--external=react-dom',
    '--external=react/jsx-runtime',
  ],
  { stdio: 'inherit' },
)
if (res.status !== 0) process.exit(res.status ?? 1)
console.log('[build-components] wrote', outfile)
