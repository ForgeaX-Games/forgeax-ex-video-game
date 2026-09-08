import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe('module boundary checker', () => {
  it('rejects forbidden imports across resolved source domains', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'game-video-boundaries-'))
    fixtures.push(fixture)
    mkdirSync(resolve(fixture, 'src/server'), { recursive: true })
    mkdirSync(resolve(fixture, 'src/authoring'), { recursive: true })
    writeFileSync(resolve(fixture, 'src/server/bad.ts'), "import '@/editor/secret'\n")
    writeFileSync(
      resolve(fixture, 'src/authoring/bad.ts'),
      "import '../runtime/react/component-host'\n",
    )

    const result = spawnSync(
      'node',
      [resolve(import.meta.dirname, '../../scripts/check-module-boundaries.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, BOUNDARY_ROOT: fixture },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[server ↛ editor]')
    expect(result.stderr).toContain('[authoring ↛ runtime/react]')
  })

  it('rejects every cross-domain import that is absent from the allowlist', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'game-video-boundaries-'))
    fixtures.push(fixture)
    mkdirSync(resolve(fixture, 'src/authoring'), { recursive: true })
    mkdirSync(resolve(fixture, 'src/workflow'), { recursive: true })
    writeFileSync(resolve(fixture, 'src/authoring/localized.ts'), "import { t } from '@/i18n'\n")
    writeFileSync(resolve(fixture, 'src/workflow/leaky.ts'), "export { mount } from '../editor/mount'\n")

    const result = spawnSync(
      'node',
      [resolve(import.meta.dirname, '../../scripts/check-module-boundaries.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, BOUNDARY_ROOT: fixture },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[authoring ↛ i18n]')
    expect(result.stderr).toContain('[workflow ↛ editor]')
  })

  it('rejects forbidden require, import assignment, and commented dynamic imports', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'game-video-boundaries-'))
    fixtures.push(fixture)
    mkdirSync(resolve(fixture, 'src/server'), { recursive: true })
    writeFileSync(resolve(fixture, 'src/server/require.ts'), "require('@/editor/secret')\n")
    writeFileSync(
      resolve(fixture, 'src/server/import-assignment.ts'),
      "import secret = require('@/editor/secret')\n",
    )
    writeFileSync(
      resolve(fixture, 'src/server/dynamic.ts'),
      "void import(/* webpackIgnore: true */ '@/editor/secret')\n",
    )

    const result = spawnSync(
      'node',
      [resolve(import.meta.dirname, '../../scripts/check-module-boundaries.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, BOUNDARY_ROOT: fixture },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr.match(/\[server ↛ editor\]/g)).toHaveLength(3)
  })

  it('rejects production imports that enter test-only source paths', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'game-video-boundaries-'))
    fixtures.push(fixture)
    mkdirSync(resolve(fixture, 'src/server/__tests__'), { recursive: true })
    writeFileSync(resolve(fixture, 'src/server/live.ts'), "import './__tests__/bridge'\n")
    writeFileSync(resolve(fixture, 'src/server/__tests__/bridge.ts'), "import '@/editor/secret'\n")

    const result = spawnSync(
      'node',
      [resolve(import.meta.dirname, '../../scripts/check-module-boundaries.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, BOUNDARY_ROOT: fixture },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[server ↛ test]')
    expect(result.stderr).toContain("import './__tests__/bridge'")
  })

  it('rejects production imports that target a test directory index', () => {
    const fixture = mkdtempSync(resolve(tmpdir(), 'game-video-boundaries-'))
    fixtures.push(fixture)
    mkdirSync(resolve(fixture, 'src/server/__tests__'), { recursive: true })
    writeFileSync(resolve(fixture, 'src/server/live.ts'), "import './__tests__'\n")
    writeFileSync(resolve(fixture, 'src/server/__tests__/index.ts'), "import '@/editor/secret'\n")

    const result = spawnSync(
      'node',
      [resolve(import.meta.dirname, '../../scripts/check-module-boundaries.mjs')],
      {
        encoding: 'utf8',
        env: { ...process.env, BOUNDARY_ROOT: fixture },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[server ↛ test]')
    expect(result.stderr).toContain("import './__tests__'")
  })
})
