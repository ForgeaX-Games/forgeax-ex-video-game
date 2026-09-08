import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodiaSeed, validateNodiaSeed } from './nodia-seed'

const root = resolve(import.meta.dirname, '../../..')

function collectMediaRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, refs)
    return refs
  }
  if (!value || typeof value !== 'object') return refs

  const record = value as Record<string, unknown>
  const media = record.media
  if (media && typeof media === 'object') {
    const ref = (media as Record<string, unknown>).ref
    if (typeof ref === 'string') refs.push(ref)
  }
  for (const child of Object.values(record)) collectMediaRefs(child, refs)
  return refs
}

function setFirstMediaRef(seed: Awaited<ReturnType<typeof createNodiaSeed>>, ref: unknown): void {
  const main = seed.blueprint.manifest.packs[seed.blueprint.manifest.mainPackId]!
  for (const graph of [seed.blueprint.graph, main.graph]) {
    graph.nodes[0]!.data.media = { kind: 'video', ref } as never
  }
}

function setFirstSubFlowPack(seed: Awaited<ReturnType<typeof createNodiaSeed>>, value: unknown): void {
  const main = seed.blueprint.manifest.packs[seed.blueprint.manifest.mainPackId]!
  for (const graph of [seed.blueprint.graph, main.graph]) {
    ;(graph.nodes[0]!.data as unknown as { subFlowPack?: unknown }).subFlowPack = value
  }
}

describe('Nodia game package seed', () => {
  it('creates a portable, complete game package from extension-owned fixtures', async () => {
    const seed = await createNodiaSeed()

    expect(seed.project).toMatchObject({
      platform: 'game-video',
      entry: {
        blueprint: 'blueprint.json',
        components: 'dist/components',
      },
    })
    expect(seed.blueprint.manifest.mainPackId).toBeTruthy()
    expect(seed.assetsManifest.version).toBe(2)
    expect(seed.assetsManifest.assets).toHaveLength(31)
    expect(() => validateNodiaSeed(seed)).not.toThrow()

    const assetIds = new Set(seed.assetsManifest.assets.map((asset) => asset.id))
    for (const ref of collectMediaRefs(seed.blueprint)) {
      expect(assetIds.has(ref), `missing seeded asset for media.ref '${ref}'`).toBe(true)
    }
    for (const asset of seed.assetsManifest.assets) {
      expect(asset.id).toMatch(/^[^/\\.]+$/)
      expect(asset.file).toEqual({
        provider: 'extension',
        key: `zhandou/${asset.id}.mp4`,
        mime: 'video/mp4',
      })
    }

    expect(JSON.stringify(seed)).not.toMatch(/\/Users\/|\/workspace\/|\.forgeax\/games|file:\/\//)
  })

  it('returns isolated fixture copies and rejects invalid references', async () => {
    const first = await createNodiaSeed()
    const second = await createNodiaSeed()
    first.assetsManifest.assets[0]!.id = 'mutated'
    expect(second.assetsManifest.assets[0]!.id).not.toBe('mutated')

    second.blueprint.graph.nodes[0]!.data.media = { kind: 'video', ref: 'not-seeded' }
    second.blueprint.manifest.packs[second.blueprint.manifest.mainPackId]!.graph.nodes[0]!.data.media = {
      kind: 'video', ref: 'not-seeded',
    }
    expect(() => validateNodiaSeed(second)).toThrow(/media\.ref.*not-seeded/)
  })

  it('rejects cyclic subflow traversal', async () => {
    const seed = await createNodiaSeed()
    const main = seed.blueprint.manifest.packs[seed.blueprint.manifest.mainPackId]!
    ;(main.graph.nodes[0]!.data as unknown as { subFlowPack?: unknown }).subFlowPack = { id: main.id }
    ;(seed.blueprint.graph.nodes[0]!.data as unknown as { subFlowPack?: unknown }).subFlowPack = { id: main.id }

    expect(() => validateNodiaSeed(seed)).toThrow(/subflow reference cycle/)
  })

  it.each([42, null, '', '  '])('rejects a media.ref that is not a nonempty logical id: %j', async (ref) => {
    const seed = await createNodiaSeed()
    setFirstMediaRef(seed, ref)

    expect(() => validateNodiaSeed(seed)).toThrow(/media\.ref.*nonempty string logical id/)
  })

  it('rejects an unreachable graph node', async () => {
    const seed = await createNodiaSeed()
    const main = seed.blueprint.manifest.packs[seed.blueprint.manifest.mainPackId]!
    for (const graph of [seed.blueprint.graph, main.graph]) {
      graph.nodes.push({ ...structuredClone(graph.nodes[0]!), id: 'orphan-node' })
    }

    expect(() => validateNodiaSeed(seed)).toThrow(/unreachable node 'orphan-node'/)
  })

  it.each([
    [null, /subFlowPack must be an object/],
    [{}, /subFlowPack.id must be a nonempty string/],
    [{ id: '' }, /subFlowPack.id must be a nonempty string/],
    [{ id: 42 }, /subFlowPack.id must be a nonempty string/],
    [{ id: 'missing-pack' }, /references missing subflow 'missing-pack'/],
  ])('rejects malformed or missing subFlowPack references', async (value, expected) => {
    const seed = await createNodiaSeed()
    setFirstSubFlowPack(seed, value)

    expect(() => validateNodiaSeed(seed)).toThrow(expected)
  })

  it.each([
    ['id', 'other', /project.id must be nodia/],
    ['title', '', /project.title must be Nodia/],
    ['platformVersion', 1, /project.platformVersion must be 1/],
  ])('rejects invalid required project field %s', async (field, value, expected) => {
    const seed = await createNodiaSeed()
    ;(seed.project as unknown as Record<string, unknown>)[field] = value

    expect(() => validateNodiaSeed(seed)).toThrow(expected)
  })

  it('makes the fixture builder reject a media object with a non-string ref', async () => {
    const seed = await createNodiaSeed()
    setFirstMediaRef(seed, 42)
    const dir = mkdtempSync(join(tmpdir(), 'nodia-seed-builder-'))
    const blueprintPath = join(dir, 'invalid-blueprint.json')
    writeFileSync(blueprintPath, JSON.stringify(seed.blueprint))

    try {
      let failure: unknown
      try {
        execFileSync('bun', ['scripts/build-nodia-seed.mjs'], {
          cwd: root,
          env: {
            ...process.env,
            NODIA_DEMO_PATH: blueprintPath,
            NODIA_FIXTURES_DIR: join(dir, 'fixtures'),
          },
          stdio: 'pipe',
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeDefined()
      expect((failure as { stderr?: Buffer }).stderr?.toString()).toMatch(/media\.ref.*nonempty string logical id/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('builds fixtures from the canonical authoring demo by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nodia-seed-default-'))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODIA_FIXTURES_DIR: join(dir, 'fixtures'),
    }
    delete env.NODIA_DEMO_PATH

    try {
      execFileSync('bun', ['scripts/build-nodia-seed.mjs'], {
        cwd: root,
        env,
        stdio: 'pipe',
      })
      expect(existsSync(join(dir, 'fixtures', 'nodia.blueprint.json'))).toBe(true)
      expect(existsSync(join(dir, 'fixtures', 'nodia.assets.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
