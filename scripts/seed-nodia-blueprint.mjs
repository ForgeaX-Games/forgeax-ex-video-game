// One-off seed: migrate game-nodia-fighting's existing authored scenario
// (old CanonFile at game-video/scenarios.graph.json) into the new game-host
// layout (blueprint.json + project.json at the game repo root), so the save
// loop round-trips REAL content on first load rather than falling back to demo.
//
// Run with bun from this independent repo:
//   bun scripts/seed-nodia-blueprint.mjs /absolute/path/to/game-nodia-fighting
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const gameRootArg = process.argv[2]
if (!gameRootArg) {
  console.error('usage: bun scripts/seed-nodia-blueprint.mjs /absolute/path/to/game-root')
  process.exit(2)
}
const gameRoot = resolve(gameRootArg)
const oldCanon = resolve(gameRoot, 'game-video', 'scenarios.graph.json')

const { normalizeDocument } = await import('../src/authoring/blueprint/blueprint-project.ts')

if (!existsSync(oldCanon)) {
  console.error('[seed] no old scenarios.graph.json; nothing to migrate at', oldCanon)
  process.exit(1)
}
const canon = JSON.parse(readFileSync(oldCanon, 'utf-8'))
const scenario = canon?.items?.[0]?.scenario
if (!scenario) {
  console.error('[seed] old CanonFile has no items[0].scenario')
  process.exit(1)
}

const doc = normalizeDocument(scenario)

mkdirSync(resolve(gameRoot, 'assets'), { recursive: true })
writeFileSync(resolve(gameRoot, 'blueprint.json'), JSON.stringify(doc, null, 2))

const projectPath = resolve(gameRoot, 'project.json')
if (!existsSync(projectPath)) {
  writeFileSync(
    projectPath,
    JSON.stringify(
      {
        id: 'game-nodia-fighting',
        title: 'Nodia Fighting',
        platform: 'game-video',
        platformVersion: '1',
        entry: { blueprint: 'blueprint.json', components: 'dist/components' },
      },
      null,
      2,
    ),
  )
}
const manifestPath = resolve(gameRoot, 'assets', 'manifest.json')
if (!existsSync(manifestPath)) writeFileSync(manifestPath, JSON.stringify({ assets: {} }, null, 2))

console.log('[seed] wrote', resolve(gameRoot, 'blueprint.json'))
console.log('[seed] mainPackId =', doc.manifest.mainPackId, '· packs =', Object.keys(doc.manifest.packs).join(','))
