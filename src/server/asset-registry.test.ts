import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  deleteAsset,
  clearManifestAssetReferences,
  healMissingDocuments,
  isDocumentRecord,
  listAssets,
  setStyleAxes,
  upsertAsset,
  upsertHostDocument,
} from './asset-registry'
import { makeAssetId } from '@/authoring/assets/registry-types'

let dir: string

const providerVideo = {
  id: 'provider-video',
  kind: 'video',
  name: 'provider-video.mp4',
  status: 'ready',
  mimeType: 'video/mp4',
  bytes: 10,
  createdAt: 1,
  updatedAt: 1,
  provider: { kind: 'cos', ref: 'videos/provider-video.mp4' },
}

const providerImage = {
  id: 'provider-image',
  kind: 'image',
  name: 'hero.png',
  productionType: 'character_ref',
  sourceModule: 'game-video',
  status: 'ready',
  mimeType: 'image/png',
  bytes: 10,
  createdAt: 1,
  updatedAt: 1,
  provider: { kind: 'local', ref: 'blobs/provider-image.png' },
  meta: {},
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gva-asset-registry-'))
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ version: 2, assets: [providerVideo, providerImage] }),
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('shared asset manifest coexistence', () => {
  test('clears deleted reference ids from generated assets and placements', () => {
    const { manifest, clearedReferences } = clearManifestAssetReferences({
      version: 2,
      assets: [
        { ...providerImage, id: 'asset-character' },
        {
          id: 'video-1',
          kind: 'video',
          productionType: 'video_clip',
          status: 'ready',
          createdAt: 1,
          updatedAt: 1,
          meta: { characterRefIds: ['asset-character', 'asset-other'] },
          provenance: {
            origin: 'generation',
            recipe: {
              version: 1,
              inputs: [
                { assetId: 'asset-character', role: 'character_reference' },
                { assetId: 'asset-other', role: 'scene_reference' },
              ],
              parameters: {},
            },
          },
        },
      ],
      assetLibrary: {
        version: 1,
        folders: [],
        placements: { 'asset-character': 'folder-1' },
      },
      assetCatalog: {
        version: 1,
        folders: [],
        placements: { 'image:asset-character': { folderId: 'root:image', sortKey: 'a0' } },
        entities: {
          character: {
            hero: {
              id: 'hero', name: '主角', current: { assetId: 'asset-character' },
              history: [{ assetId: 'asset-character', appliedAt: 1, source: 'generate' }],
              createdAt: 1, updatedAt: 1,
            },
          },
          scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {},
        },
      },
    }, 'asset-character')
    const video = manifest.assets.find((asset) => asset.id === 'video-1') as unknown as {
      meta: { characterRefIds: string[] }
      provenance: { recipe: { inputs: Array<{ assetId: string }> } }
    }
    expect(video.meta.characterRefIds).toEqual(['asset-other'])
    expect(video.provenance.recipe.inputs).toEqual([{ assetId: 'asset-other', role: 'scene_reference' }])
    expect(manifest.assetLibrary?.placements).toEqual({})
    expect(manifest.assetCatalog?.entities.character.hero?.current).toBeUndefined()
    expect(manifest.assetCatalog?.entities.character.hero?.history).toEqual([])
    expect(manifest.assetCatalog?.placements).toEqual({})
    expect(clearedReferences).toEqual([
      'video-1.meta.characterRefIds',
      'video-1.provenance.recipe.inputs',
      'assetLibrary.placements',
      'assetCatalog.entities.character.hero',
      'assetCatalog.placements.image:asset-character',
    ])
  })

  test('registry ids are opaque and never encode a media production type', () => {
    const id = makeAssetId()
    expect(id).toMatch(/^asset_/)
    expect(id).not.toContain('char')
    expect(id).not.toContain('scene')
  })

  test('registry mutations preserve provider-backed video records and v2', () => {
    setStyleAxes(dir, { artMedia: 'ink' })
    upsertAsset(dir, {
      id: 'generated-image',
      kind: 'image',
      productionType: 'shot_image',
      status: 'ready',
      file: 'media/generated-image.png',
      createdAt: 1,
      updatedAt: 1,
    })

    const raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    expect(raw.version).toBe(2)
    expect(raw.styleAxes).toEqual({ artMedia: 'ink' })
    expect(raw.assets).toContainEqual(providerVideo)
    expect(raw.assets).toContainEqual(providerImage)
    expect(listAssets(dir).map((asset) => asset.id)).toEqual(['provider-video', 'provider-image', 'generated-image'])
    expect(listAssets(dir)[0]).toMatchObject({
      label: 'provider-video.mp4',
      mime: 'video/mp4',
      productionType: 'video_clip',
      meta: { upload: true },
    })
  })

  test('registry cannot overwrite or delete an id owned by another asset domain', () => {
    expect(() =>
      upsertAsset(dir, {
        id: 'provider-video',
        kind: 'video',
        productionType: 'video_clip',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrow('owned by another asset domain')
    expect(deleteAsset(dir, 'provider-video')).toBe(false)
    expect(() =>
      upsertAsset(dir, {
        id: 'provider-image',
        kind: 'image',
        productionType: 'character_ref',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrow('owned by another asset domain')
    expect(deleteAsset(dir, 'provider-image')).toBe(false)
  })

  test('registry fails loudly instead of replacing a malformed shared manifest', () => {
    writeFileSync(join(dir, 'manifest.json'), '{"version":2,"assets":{}}')
    expect(() => setStyleAxes(dir, { artMedia: 'ink' })).toThrow(
      'Unsupported shared asset manifest',
    )
    expect(readFileSync(join(dir, 'manifest.json'), 'utf-8')).toBe(
      '{"version":2,"assets":{}}',
    )
  })

  test('rejects an invalid media provenance contract', () => {
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      version: 2,
      assets: [{ ...providerImage, provenance: { origin: 'generation', recipe: { version: 2 } } }],
    }))
    expect(() => listAssets(dir)).toThrow('Invalid or duplicate shared asset id')
  })
})

describe('project document records', () => {
  test('accepts a local Markdown document record outside the media domain', () => {
    expect(isDocumentRecord({
      id: 'doc-intake',
      kind: 'document',
      name: '需求',
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref: 'docs/demo_intake.md' },
      createdAt: 1,
      updatedAt: 1,
      meta: { documentType: 'intake' },
    })).toBe(true)
  })

  test('accepts a versioned generation recipe but rejects malformed provenance', () => {
    const base = {
      id: 'doc-intake',
      kind: 'document',
      name: '需求',
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref: 'docs/demo_intake.md' },
      createdAt: 1,
      updatedAt: 1,
      meta: { documentType: 'intake' },
    }
    expect(isDocumentRecord({
      ...base,
      provenance: {
        origin: 'generation',
        recipe: {
          version: 1,
          inputs: [{ assetId: 'asset_reference', role: 'context' }],
          parameters: { temperature: 0.7, options: ['brief'] },
        },
      },
    })).toBe(true)
    expect(isDocumentRecord({
      ...base,
      provenance: { origin: 'generation', recipe: { version: 2, parameters: {} } },
    })).toBe(false)
  })

  test('rejects non-Markdown and unbounded document paths', () => {
    const base = {
      id: 'doc-intake',
      kind: 'document',
      name: '需求',
      status: 'ready',
      mimeType: 'text/markdown',
      createdAt: 1,
      updatedAt: 1,
      meta: { documentType: 'intake' },
    }
    expect(isDocumentRecord({
      ...base,
      provider: { kind: 'local', ref: '../blueprint.json' },
    })).toBe(false)
    expect(isDocumentRecord({
      ...base,
      mimeType: 'text/plain',
      provider: { kind: 'local', ref: 'docs/demo_intake.md' },
    })).toBe(false)
    expect(isDocumentRecord({
      ...base,
      provider: { kind: 'local', ref: 'documents/outline.md' },
    })).toBe(false)
  })
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function memoryContext(seed: Record<string, string> = {}): {
  context: ExtensionContext
  store: Record<string, string>
} {
  const store = { ...seed }
  return {
    store,
    context: {
      gameId: 'game-1',
      files: {
        list: async (directory: string) => {
          const prefix = `${directory.replace(/\/+$/u, '')}/`
          return [...new Set(
            Object.keys(store)
              .filter((path) => path.startsWith(prefix))
              .map((path) => path.slice(prefix.length).split('/', 1)[0]!)
              .filter(Boolean),
          )].sort()
        },
        read: async (path: string) => {
          const value = store[path]
          return value === undefined ? null : encoder.encode(value)
        },
        write: async (path: string, contents: Uint8Array) => {
          store[path] = decoder.decode(contents)
        },
        withLocks: async <T>(_keys: readonly string[], operation: () => Promise<T>) => (
          operation()
        ),
      },
    } as unknown as ExtensionContext,
  }
}

function designOption(id: 'A' | 'B' | 'C', recommended = false) {
  return {
    id,
    title: `方案 ${id}`,
    recommended,
    tags: ['命运', '悬疑', '探索', '抉择'],
    markdown: `### 方案 ${id}\n\n> 钩子 ${id}`,
    genre: '东方奇幻 / 悬疑',
    visualStyle: '游戏 CG、3D 写实化风',
    scale: '短篇 · 预计游玩 25 分钟',
    projectIntroduction: `项目介绍 ${id}`,
    themeExpression: `主题表达 ${id}`,
    mainLoop: `主循环 ${id}`,
    deliveryPromise: `交付承诺 ${id}`,
    pillarStance: { narrative: 'core', exploration: 'support' },
  }
}

function validDesignOptions(): string {
  const promptOption = (item: ReturnType<typeof designOption>) => {
    const { pillarStance: _pillarStance, ...option } = item
    return option
  }
  return JSON.stringify([
    promptOption(designOption('A', true)),
    promptOption(designOption('B')),
    promptOption(designOption('C')),
  ])
}

type UpsertDocumentInput = Parameters<typeof upsertHostDocument>[1]

describe('upsertHostDocument slug contract', () => {
  test('requires a slug that is non-empty after trimming', async () => {
    const { context, store } = memoryContext()

    await expect(
      upsertHostDocument(context, { documentType: 'core', slug: '   ', content: '# Core' }),
    ).rejects.toThrow(/slug/)
    expect(Object.keys(store)).toEqual([])
  })

  test('rejects illegal slug characters instead of sanitizing them', async () => {
    const { context, store } = memoryContext()

    for (const slug of ['my game', '../evil', 'demo/nested', '_leading', 'ünïcode']) {
      await expect(
        upsertHostDocument(context, { documentType: 'core', slug, content: '# Core' }),
      ).rejects.toThrow(/slug/)
    }
    expect(Object.keys(store)).toEqual([])
  })

  test('never infers a slug from project.json', async () => {
    const { context, store } = memoryContext({
      'project.json': JSON.stringify({ slug: 'my-game', name: 'My Game', id: 'my-game-id' }),
    })

    await expect(
      upsertHostDocument(
        context,
        { documentType: 'core', content: '# Core' } as unknown as UpsertDocumentInput,
      ),
    ).rejects.toThrow(/slug/)
    expect(store['docs/my-game_core.md']).toBeUndefined()
    expect(store['assets/manifest.json']).toBeUndefined()
  })

  test('writes docs/<slug>_<type>.md for a valid slug', async () => {
    const { context, store } = memoryContext()

    const record = await upsertHostDocument(context, {
      documentType: 'pillar',
      slug: 'black_myth',
      content: '# Pillar',
    })

    expect(record).toMatchObject({
      id: 'doc-pillar',
      provider: { kind: 'local', ref: 'docs/black_myth_pillar.md' },
    })
    expect(store['docs/black_myth_pillar.md']).toBe('# Pillar')
  })
})

describe('upsertHostDocument design-options validation', () => {
  test.each([
    ['malformed JSON', '[{"id":"A","title":"broken "quote""}]', /JSON is invalid/i],
    ['invalid schema', JSON.stringify([designOption('A', true), designOption('B')]), /exactly three/i],
  ])('rejects %s without mutating the document or manifest', async (_label, content, error) => {
    const manifest = `${JSON.stringify({ version: 2, assets: [] }, null, 2)}\n`
    const previous = validDesignOptions()
    const { context, store } = memoryContext({
      'assets/manifest.json': manifest,
      'docs/wusong_design_options.md': previous,
    })

    await expect(upsertHostDocument(context, {
      documentType: 'design-options',
      slug: 'wusong',
      content,
    })).rejects.toThrow(error)

    expect(store['docs/wusong_design_options.md']).toBe(previous)
    expect(store['assets/manifest.json']).toBe(manifest)
  })

  test('persists prompt-compliant design-options and registers the document', async () => {
    const { context, store } = memoryContext()
    const content = validDesignOptions()

    const record = await upsertHostDocument(context, {
      documentType: 'design-options',
      slug: 'wusong',
      content,
    })

    expect(record).toMatchObject({
      id: 'doc-design-options',
      provider: { kind: 'local', ref: 'docs/wusong_design_options.md' },
    })
    expect(store['docs/wusong_design_options.md']).toBe(content)
    expect(JSON.parse(store['assets/manifest.json']!).assets).toContainEqual(
      expect.objectContaining({ id: 'doc-design-options' }),
    )
  })
})

describe('healMissingDocuments', () => {
  test('registers orphan docs/ files using the slug parsed from the filename', async () => {
    const { context, store } = memoryContext({
      'assets/manifest.json': JSON.stringify({ version: 2, assets: [] }),
      'docs/black_myth_core.md': '# Core',
    })

    const documents = await healMissingDocuments(context)

    expect(documents).toEqual([
      expect.objectContaining({
        id: 'doc-core',
        provider: { kind: 'local', ref: 'docs/black_myth_core.md' },
      }),
    ])
    expect(JSON.parse(store['assets/manifest.json']!).assets).toHaveLength(1)
  })
})
