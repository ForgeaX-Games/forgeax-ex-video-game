// sync-components-lib.ts — SSOT for "copy the platform component set into a game repo".
//
// This phase: the authoritative component source lives at
// src/runtime/react/component-host/components/ (compiled + run by the platform). Each
// game repo keeps an IDENTICAL copy at .forgeax/games/<slug>/components/ so the
// components travel with the game's git version. On save/版本 it is re-synced.
//
// Shared by: scripts/sync-components-to-game.mjs (CLI seed) and vite.config.ts
// (dev endpoint POST /@sync-components).
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// scripts/ dir → extension root → platform component source.
const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC_COMPONENTS = resolve(
  HERE,
  '..',
  'src',
  'runtime',
  'react',
  'component-host',
  'components',
)

/** Recursively copy a dir, excluding __tests__. */
function copyDirExcludingTests(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(src)) {
    if (name === '__tests__') continue
    const s = join(src, name)
    const d = join(dest, name)
    if (statSync(s).isDirectory()) copyDirExcludingTests(s, d)
    else copyFileSync(s, d)
  }
}

/** Copy platform component-host/components → `<gameDir>/components` (verbatim snapshot). */
export function syncComponentsToGame(gameDir: string): string {
  const dest = resolve(gameDir, 'components')
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  copyDirExcludingTests(SRC_COMPONENTS, dest)
  return dest
}
