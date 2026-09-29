import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SeedContext } from '@forgeax/extension-host/node'
import { describe, expect, it } from 'vitest'
import { MAIN_ID, normalizeDocument, validateDocument } from '@/authoring/blueprint/blueprint-project'
import { validateEmptyLibrarySeed, validateVideoGameSeed } from './empty-library-seed'
import { createVideoGameTemplateSeed } from './video-game-template-seed'

function createContext(options?: Record<string, unknown>): SeedContext & {
  writes: Map<string, Uint8Array>
} {
  const writes = new Map<string, Uint8Array>()
  return {
    gameId: 'game-abc',
    options: options ?? {},
    writes,
    files: {
      async write(path: string, contents: Uint8Array) {
        writes.set(path, contents)
      },
    },
  } as unknown as SeedContext & { writes: Map<string, Uint8Array> }
}

async function readTemplateFile(template: string, file: string): Promise<unknown> {
  // 直接落到源码目录：`new URL(..., import.meta.url)` 会被 Vite 改写成 dev server URL。
  return JSON.parse(
    await readFile(resolve(import.meta.dirname, '../templates', template, file), 'utf8'),
  )
}

describe('createVideoGameTemplateSeed', () => {
  it.each(['tavern'] as const)(
    'copies the %s template package into the new game seed',
    async (template) => {
      const context = createContext({ template })
      const seed = await createVideoGameTemplateSeed(context)

      expect(seed.blueprint).toEqual(await readTemplateFile(template, 'blueprint.json'))
      expect(seed.assetsManifest).toEqual(
        await readTemplateFile(template, 'assets/manifest.json'),
      )
      expect(seed.project).toEqual({
        ...(await readTemplateFile(template, 'project.json') as Record<string, unknown>),
        id: 'game-abc',
        title: 'game-abc',
      })
      expect(() => validateVideoGameSeed(seed)).not.toThrow()
      expect(new TextDecoder().decode(context.writes.get('extra/copied.txt'))).toBe(
        `${template}-extra\n`,
      )
      expect(context.writes.has('project.json')).toBe(false)
      expect(context.writes.has('blueprint.json')).toBe(false)
      expect(context.writes.has('assets/manifest.json')).toBe(false)
    },
  )

  it.each([undefined, { template: 'none' }] as const)(
    'falls back to the empty library when options are %s',
    async (options) => {
      const context = createContext(options)
      const seed = await createVideoGameTemplateSeed(context)

      expect(() => validateEmptyLibrarySeed(seed)).not.toThrow()
      expect(seed.blueprint.graph.nodes).toHaveLength(1)
      expect(seed.blueprint.graph.edges).toEqual([])
      expect(context.writes.size).toBe(0)
    },
  )

  it('overwrites extra template files already present in the game directory', async () => {
    const context = createContext({ template: 'tavern' })
    await context.files.write('extra/copied.txt', new TextEncoder().encode('stale\n'))
    await createVideoGameTemplateSeed(context)
    expect(new TextDecoder().decode(context.writes.get('extra/copied.txt'))).toBe(
      'tavern-extra\n',
    )
  })

  it('rejects options naming an unknown template', async () => {
    await expect(
      createVideoGameTemplateSeed(createContext({ template: 'casino' })),
    ).rejects.toThrow('Invalid video game template options')
    await expect(
      createVideoGameTemplateSeed(createContext({ template: 'fishing' })),
    ).rejects.toThrow('Invalid video game template options')
  })

  it('rejects a template whose node only exists on the root graph', async () => {
    const seed = await createVideoGameTemplateSeed(
      createContext({ template: 'tavern' }),
    )
    seed.blueprint.graph.nodes.push({
      id: 'root-only',
      type: 'perf',
      position: { x: 520, y: 80 },
      inputs: [],
      outputs: [],
      data: { name: '只在根图' },
    })

    expect(() => validateVideoGameSeed(seed)).toThrow('root graph must match the main pack graph')
  })
})

describe('template packages on disk', () => {
  it.each(['tavern'] as const)(
    'ships a playable %s blueprint and a gameId placeholder project',
    async (template) => {
      const blueprint = normalizeDocument(
        (await readTemplateFile(template, 'blueprint.json')) as Parameters<
          typeof normalizeDocument
        >[0],
      )

      expect(validateDocument(blueprint)).toEqual([])
      expect(blueprint.manifest.mainPackId).toBe(MAIN_ID)
      expect(blueprint.graph.nodes[0]?.id).toBe('entry')
      expect(blueprint.graph.nodes.length).toBeGreaterThan(1)
      expect(
        (await readTemplateFile(template, 'blueprint.json')) as { graph: unknown },
      ).toMatchObject({
        graph: blueprint.manifest.packs[MAIN_ID]?.graph as object,
      })
      expect(await readTemplateFile(template, 'project.json')).toMatchObject({
        id: '__GAME_ID__',
        platform: 'game-video',
        platformVersion: '1',
        entry: { blueprint: 'blueprint.json', components: 'dist/components' },
      })
    },
  )
})
