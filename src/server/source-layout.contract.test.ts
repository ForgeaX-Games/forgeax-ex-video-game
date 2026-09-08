import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

describe('source domain layout', () => {
  it('keeps all implementation domains under root src', () => {
    expect(existsSync(resolve(root, 'src/editor'))).toBe(true)
    expect(existsSync(resolve(root, 'src/player'))).toBe(true)
    expect(existsSync(resolve(root, 'src/runtime/core'))).toBe(true)
    expect(existsSync(resolve(root, 'src/runtime/react'))).toBe(true)
    expect(existsSync(resolve(root, 'src/authoring'))).toBe(true)
    expect(existsSync(resolve(root, 'src/server'))).toBe(true)
    expect(existsSync(resolve(root, 'game-package'))).toBe(true)
    expect(existsSync(resolve(root, 'server'))).toBe(false)
    expect(existsSync(resolve(root, 'src/runtime/sdk'))).toBe(false)
  })

  it('publishes the player from root dist only', () => {
    expect(pkg.exports['./standalone']).toBe('./dist/player/index.html')
    expect(pkg.files).toContain('dist')
    expect(pkg.files).not.toContain('src/runtime/sdk/dist')
  })

  it('syncs components from the React runtime domain', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'game-video-components-'))
    try {
      execFileSync('bun', ['scripts/sync-components-to-game.mjs', fixture], {
        cwd: root,
        stdio: 'pipe',
      })
      const destination = resolve(fixture, 'components')
      expect(existsSync(resolve(destination, 'index.ts'))).toBe(true)
      expect(existsSync(resolve(destination, '__tests__'))).toBe(false)
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('keeps operational scripts on current domain paths', () => {
    const buildSeed = readFileSync(resolve(root, 'scripts/build-nodia-seed.mjs'), 'utf8')
    const migrateSeed = readFileSync(resolve(root, 'scripts/seed-nodia-blueprint.mjs'), 'utf8')
    expect(buildSeed).toContain('src/authoring/demo/nodia.graph.json')
    expect(migrateSeed).toContain('src/authoring/blueprint/blueprint-project.ts')
    expect(buildSeed).not.toContain('src/editor/demo/nodia.graph.json')
    expect(migrateSeed).not.toContain('src/editor/persist/blueprint-project.ts')
  })
})
