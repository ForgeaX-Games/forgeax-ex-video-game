import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  nodeVideoEntityId,
  type AssetCatalogState,
  type AssetManifest,
} from '@/authoring/assets/registry-types'
import { documentFromBlueprints, normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import type { BlueprintDoc, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import {
  ensureFinalBlueprintPlaceholderVideos,
  FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID,
  FINAL_BLUEPRINT_PLACEHOLDER_FILE,
} from './final-blueprint-placeholder'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function node(id: string, data: Record<string, unknown>) {
  return {
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: id, ...data },
  }
}

function project(): GraphLibraryDocument {
  const main: BlueprintDoc = {
    id: 'bp-main',
    title: 'Main',
    entry: 'entry',
    graph: {
      nodes: [
        node('entry', { media: { kind: 'video', prompt: 'opening' } }),
        node('ready', { media: { kind: 'video', prompt: 'ready', ref: 'a-real-video' } }),
        node('container', {
          subProcess: {
            entry: 'nested',
            graph: {
              nodes: [node('nested', { media: { kind: 'video', prompt: 'nested' } })],
              edges: [],
            },
          },
        }),
      ],
      edges: [],
    },
  }
  const chapter: BlueprintDoc = {
    id: 'bp-chapter',
    title: 'Chapter',
    entry: 'chapter-entry',
    graph: {
      nodes: [node('chapter-entry', {})],
      edges: [],
    },
  }
  return documentFromBlueprints(
    { 'bp-main': main, 'bp-chapter': chapter },
    'bp-main',
    {},
  )
}

function createContext(): {
  context: ExtensionContext
  files: Map<string, Uint8Array>
  putCount: () => number
} {
  const initial = { ...project(), revision: 7, scopeRevisions: { graph: 7 } }
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(initial))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({
      version: 2,
      assets: [{
        id: 'a-real-video',
        kind: 'video',
        productionType: 'video_clip',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }],
    }))],
  ])
  let puts = 0
  const context = {
    gameId: 'game-one',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, bytes: Uint8Array) {
        files.set(path, new Uint8Array(bytes))
      },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>): Promise<T> {
        return operation()
      },
    },
    media: {
      async list() { return [] },
      async read() { return null },
      async put(_gameId: string, input: { bytes: Uint8Array, metadata?: Record<string, unknown> }) {
        puts += 1
        return {
          id: 'host-placeholder',
          filename: 'placeholder.mp4',
          type: 'video',
          url: '/media/assets/host-placeholder',
          contentType: 'video/mp4',
          sizeBytes: input.bytes.byteLength,
          metadata: input.metadata,
        }
      },
      async delete() {},
    },
  } as unknown as ExtensionContext
  return { context, files, putCount: () => puts }
}

describe('ensureFinalBlueprintPlaceholderVideos', () => {
  it('materializes one shared placeholder and exposes it as every unbound node current video', async () => {
    const { context, files, putCount } = createContext()

    const first = await ensureFinalBlueprintPlaceholderVideos(context)

    expect(first).toEqual({ changed: true, boundNodeCount: 4, revision: 8 })
    expect(putCount()).toBe(1)
    const persisted = JSON.parse(decoder.decode(files.get('blueprint.json'))) as GraphLibraryDocument & {
      revision: number
      scopeRevisions: Record<string, number>
    }
    const normalized = normalizeDocument(persisted)
    expect(persisted.revision).toBe(8)
    expect(persisted.scopeRevisions.graph).toBe(8)
    expect(normalized.manifest.packs['bp-main']?.graph.nodes[0]?.data.media?.ref)
      .toBe(FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID)
    expect(normalized.manifest.packs['bp-main']?.graph.nodes[1]?.data.media?.ref)
      .toBe('a-real-video')
    const container = normalized.manifest.packs['bp-main']?.graph.nodes[2]
    expect(container?.data.media?.ref).toBe(FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID)
    expect(container && 'subProcess' in container.data
      ? container.data.subProcess.graph.nodes[0]?.data.media?.ref
      : undefined).toBe(FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID)
    expect(normalized.manifest.packs['bp-chapter']?.graph.nodes[0]?.data.media?.ref)
      .toBe(FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID)

    const manifest = JSON.parse(decoder.decode(files.get('assets/manifest.json'))) as AssetManifest
    expect(manifest.assets).toContainEqual(expect.objectContaining({
      id: FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID,
      kind: 'video',
      productionType: 'video_clip',
      status: 'placeholder',
      file: `media/${FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID}.mp4`,
      durationMs: 3_000,
    }))
    const catalog = manifest.assetCatalog as AssetCatalogState
    for (const entityId of [
      nodeVideoEntityId({ blueprintId: 'bp-main', nodeId: 'entry' }),
      nodeVideoEntityId({ blueprintId: 'bp-main', nodeId: 'container' }),
      nodeVideoEntityId({ blueprintId: 'bp-main', graphPath: ['container'], nodeId: 'nested' }),
      nodeVideoEntityId({ blueprintId: 'bp-chapter', nodeId: 'chapter-entry' }),
    ]) {
      expect(catalog.entities.video[entityId]?.current?.assetId, entityId)
        .toBe(FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID)
      expect(catalog.placements[`video:${entityId}`], entityId)
        .toMatchObject({ folderId: 'root:video' })
    }
    expect(catalog.entities.video[nodeVideoEntityId({ blueprintId: 'bp-main', nodeId: 'ready' })]?.current?.assetId)
      .toBe('a-real-video')

    const projectVideo = files.get(FINAL_BLUEPRINT_PLACEHOLDER_FILE)
    expect(projectVideo).toBeDefined()
    expect(createHash('sha256').update(projectVideo!).digest('hex'))
      .toBe('67943175e2c179115fa2cf62d04aed92057e5f4ebe3baf95b9d1f097891ba631')

    const second = await ensureFinalBlueprintPlaceholderVideos(context)
    expect(second).toEqual({ changed: false, boundNodeCount: 0, revision: 8 })
    expect(putCount()).toBe(1)
  })
})
