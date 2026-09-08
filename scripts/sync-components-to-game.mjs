// sync-components-to-game.mjs — CLI wrapper: copy platform component set into a game repo.
// Logic SSOT is scripts/sync-components-lib.ts (shared with vite.config dev endpoint).
//
// Usage:  bun scripts/sync-components-to-game.mjs <gameDir>
//   e.g.  bun scripts/sync-components-to-game.mjs ../../../games/game-nodia-fighting
import { resolve } from 'node:path'
import { syncComponentsToGame } from './sync-components-lib.ts'

const gameDir = process.argv[2]
if (!gameDir) {
  console.error('usage: bun scripts/sync-components-to-game.mjs <gameDir>')
  process.exit(2)
}
const dest = syncComponentsToGame(resolve(process.cwd(), gameDir))
console.log('[sync-components] copied platform components →', dest)
