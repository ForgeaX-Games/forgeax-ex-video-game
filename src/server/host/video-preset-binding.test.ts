import type {
  BoundedGameFiles,
  ExtensionContext,
} from '@forgeax/extension-host/node'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, test } from 'vitest'
import { nodeVideoEntityId } from '@/authoring/assets/registry-types'
import { activityContract } from '@/workflow/activity-contracts'
import { WRITE_SCOPES } from '@/workflow/contracts'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import { graphSnapshotToken } from './graph-projection'
import { GRAPH_SAVE_LOCK, createGameVideoService } from './extension-service'
import { HOST_MANIFEST_LOCK } from '../asset-registry'
import { validateProjectForActivity } from './project-inspection'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

class MemoryFiles implements BoundedGameFiles {
  readonly entries = new Map<string, Uint8Array>()
  readonly calls: string[] = []

  async read(path: string): Promise<Uint8Array | null> {
    this.calls.push(`read:${path}`)
    const bytes = this.entries.get(path)
    return bytes ? new Uint8Array(bytes) : null
  }

  async write(path: string, contents: Uint8Array): Promise<void> {
    this.calls.push(`write:${path}`)
    this.entries.set(path, new Uint8Array(contents))
  }

  async delete(path: string): Promise<void> {
    this.calls.push(`delete:${path}`)
    this.entries.delete(path)
  }

  async list(): Promise<string[]> {
    return [...this.entries.keys()]
  }

  async withLocks<T>(
    keys: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    this.calls.push(`locks:${[...keys].sort().join(',')}`)
    return operation()
  }
}

function project() {
  const graph = {
    nodes: [{
      id: 'n1',
      type: 'perf',
      position: { x: 0, y: 0 },
      data: {
        name: '山道遇虎',
        chapterSummary: '武松在景阳冈遇虎',
        storyText: '武松提哨棒立于山道，猛虎从林中扑出。',
        cast: [{ characterId: 'c1' }],
        scenes: [{ sceneId: 's1', role: 'primary' }],
        overlayNodes: [{ id: 'choice', overlay: 'base:TextOption' }],
        interaction: { beat: 'narrative' },
      },
    }],
    edges: [],
  }
  return {
    version: 'game-video.graph.v1',
    revision: 7,
    scopeRevisions: { graph: 7, ui: 7, rules: 7 },
    variables: { courage: { id: 'courage', initial: 1 } },
    manifest: {
      mainPackId: 'main',
      packs: {
        main: {
          id: 'main',
          title: '主线',
          entry: 'n1',
          graph,
        },
      },
    },
    graph,
  }
}

function manifest() {
  return {
    version: 2,
    revision: 11,
    scopeRevisions: { characters: 11, scenes: 11 },
    assets: [
      {
        id: 'asset-character',
        kind: 'image',
        productionType: 'character_ref',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'asset-scene',
        kind: 'image',
        productionType: 'scene_ref',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    assetCatalog: {
      version: 1,
      folders: [],
      placements: {},
      entities: {
        character: {
          c1: {
            id: 'c1',
            name: '武松',
            description: '布衣壮汉',
            prompt: '武松角色设定图',
            current: { assetId: 'asset-character' },
            history: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        scene: {
          s1: {
            id: 's1',
            name: '景阳冈',
            description: '夜色山道',
            prompt: '景阳冈场景设定图',
            current: { assetId: 'asset-scene' },
            history: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
        video: {},
        icon: {},
        control: {},
        audio: {},
        font: {},
      },
    },
  }
}

function bindingWorkflow() {
  const workflow = createInitialWorkflowState('binding-game')
  workflow.activities['game.finalizing'] = {
    revision: 1,
    status: 'complete',
    artifactRefs: [],
    evidence: [],
  }
  workflow.activities['video.presets.binding'] = {
    revision: 3,
    status: 'working',
    artifactRefs: [],
    evidence: [],
  }
  workflow.assetPipeline = {
    ...workflow.assetPipeline,
    revision: 4,
    status: 'working',
    activeActivities: ['video.presets.binding'],
    readiness: {
      characters: 'ready',
      scenes: 'ready',
      videoPresets: 'working',
    },
  }
  return workflow
}

function createContext() {
  const files = new MemoryFiles()
  files.entries.set('blueprint.json', json(project()))
  files.entries.set('assets/manifest.json', json(manifest()))
  files.entries.set(
    VIDEO_GAME_WORKFLOW_FILE,
    json(bindingWorkflow()),
  )
  const context = {
    gameId: 'binding-game',
    files,
    media: {
      async list() { return [] },
      async read() { return null },
    },
  } as unknown as ExtensionContext
  return { context, files }
}

const binding = {
  activityRevision: 3,
  expectedGraphRevision: 7,
  graphSnapshotToken: graphSnapshotToken('binding-game', 7),
  expectedAssetRevision: 11,
  idempotencyKey: 'video-presets:main:n1:v1',
  bindings: [{
    nodeRef: { blueprintId: 'main', nodeId: 'n1' },
    media: {
      kind: 'video',
      prompt: '武松迎战猛虎，低机位推进，月光穿过松林。',
      generation: {
        schemaVersion: 1,
        durationSeconds: 8,
        generateAudio: false,
        mode: 'ref',
        resolution: '1080p',
        references: {
          sceneAssetIds: ['asset-scene'],
          extraImageAssetIds: ['asset-character'],
        },
      },
    },
  }],
}

type PatchNodeMedia = (
  input: unknown,
) => Promise<Record<string, unknown>>

function patchNodeMedia(context: ExtensionContext): PatchNodeMedia {
  return (createGameVideoService(context) as unknown as {
    patchNodeMedia: PatchNodeMedia
  }).patchNodeMedia
}

describe('video preset binding', () => {
  const returnsSchema = JSON.parse(readFileSync(
    resolve(import.meta.dirname, '..', '..', '..', 'schemas', 'patch-node-media.returns.json'),
    'utf8',
  ))
  const validateReturn = new Ajv2020({ allErrors: true, strict: false })
    .compile(returnsSchema)

  test('publishes a dedicated scoped write contract', () => {
    const contract = activityContract('video.presets.binding')
    const validating = activityContract('video.presets.validating')

    expect(contract.allowedToolNames).toContain(
      'mcp__as-mate-tools__extension__game_video__patch_node_media',
    )
    expect(contract.mutationSequence).toContain('patch-node-media')
    expect(contract.hardChecks).toEqual(expect.arrayContaining([
      'video.presets.bound',
      'video.presets.binding-receipt',
    ]))
    expect(validating.allowedToolNames).not.toContain(
      'mcp__as-mate-tools__extension__game_video__patch_node_media',
    )
    expect(WRITE_SCOPES['video.presets.validating']).toEqual([])
    expect(validating.requiredInputs).toContainEqual({
      kind: 'video-preset-bindings',
    })
  })

  test('publishes the paired graph snapshot and stable asset revision', async () => {
    const { context } = createContext()

    const result = await createGameVideoService(context).getGraph({
      blueprintId: 'main',
    })

    expect(result).toMatchObject({
      revision: 7,
      assetRevision: 11,
      snapshot: {
        token: graphSnapshotToken('binding-game', 7),
        revision: 7,
      },
    })
  })

  test('commits only node media and the matching manifest video projection', async () => {
    const { context, files } = createContext()
    const before = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))

    const result = await patchNodeMedia(context)(binding)

    expect(validateReturn(result), JSON.stringify(validateReturn.errors)).toBe(true)
    expect(result).toMatchObject({
      schemaVersion: 1,
      ok: true,
      graphRevision: 8,
      assetRevision: 12,
      nodeRefs: [{ blueprintId: 'main', nodeId: 'n1' }],
      replayed: false,
      idempotency: {
        key: 'video-presets:main:n1:v1',
        replayed: false,
      },
    })
    const persisted = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const node = persisted.manifest.packs.main.graph.nodes[0]
    expect(node.data.media).toEqual(binding.bindings[0]!.media)
    expect(node.data.storyText).toBe(
      before.manifest.packs.main.graph.nodes[0].data.storyText,
    )
    expect(node.data.overlayNodes).toEqual(
      before.manifest.packs.main.graph.nodes[0].data.overlayNodes,
    )
    expect(persisted.manifest.packs.main.graph.edges).toEqual(
      before.manifest.packs.main.graph.edges,
    )
    expect(persisted.variables).toEqual(before.variables)

    const persistedManifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')!),
    )
    const videoId = nodeVideoEntityId({ blueprintId: 'main', nodeId: 'n1' })
    expect(persistedManifest.assetCatalog.entities.video[videoId]).toMatchObject({
      id: videoId,
      prompt: binding.bindings[0]!.media.prompt,
    })
    expect(persistedManifest.assets).toEqual(manifest().assets)
    expect(persistedManifest.assetCatalog.entities.character).toEqual(
      manifest().assetCatalog.entities.character,
    )
    expect(persistedManifest.assetCatalog.entities.scene).toEqual(
      manifest().assetCatalog.entities.scene,
    )
    const productionContext = await createGameVideoService(
      context,
    ).getNodeProductionContext({
      blueprintId: 'main',
      nodeId: 'n1',
    }) as {
      video: { prompt?: string; generationPreset: unknown; presetSource: string }
    }
    expect(productionContext.video).toMatchObject({
      prompt: binding.bindings[0]!.media.prompt,
      generationPreset: binding.bindings[0]!.media.generation,
      presetSource: 'authored',
    })
    expect(files.calls).toContain(
      `locks:${[GRAPH_SAVE_LOCK, HOST_MANIFEST_LOCK].sort().join(',')}`,
    )
  })

  test('replays an identical binding without another graph or manifest write', async () => {
    const { context, files } = createContext()
    const mutate = patchNodeMedia(context)
    await mutate(binding)
    const writesAfterFirst = files.calls.filter((call) => call.startsWith('write:')).length

    const replay = await mutate(binding)

    expect(replay).toMatchObject({
      ok: true,
      graphRevision: 8,
      assetRevision: 12,
      replayed: true,
      idempotency: {
        key: binding.idempotencyKey,
        replayed: true,
      },
    })
    expect(files.calls.filter((call) => call.startsWith('write:'))).toHaveLength(
      writesAfterFirst,
    )
  })

  test('rejects reusing an idempotency key for a different binding snapshot', async () => {
    const { context, files } = createContext()
    const mutate = patchNodeMedia(context)
    await mutate(binding)
    const graphBefore = decoder.decode(files.entries.get('blueprint.json')!)
    const manifestBefore = decoder.decode(files.entries.get('assets/manifest.json')!)

    const conflict = await mutate({
      ...binding,
      expectedAssetRevision: 12,
    })

    expect(conflict).toMatchObject({
      ok: false,
      errorCode: 'idempotency.conflict',
      replayed: false,
    })
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(graphBefore)
    expect(decoder.decode(files.entries.get('assets/manifest.json')!)).toBe(
      manifestBefore,
    )
  })

  test('requires a persisted dedicated-operation receipt before binding can complete', async () => {
    const { context } = createContext()

    const before = await validateProjectForActivity(
      context,
      'video.presets.binding',
      3,
      activityContract('video.presets.binding').hardChecks,
    )
    await patchNodeMedia(context)(binding)
    const after = await validateProjectForActivity(
      context,
      'video.presets.binding',
      3,
      activityContract('video.presets.binding').hardChecks,
    )

    expect(before.ok).toBe(false)
    expect(before.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        checkId: 'video.presets.binding-receipt',
        status: 'fail',
      }),
    ]))
    expect(after.ok).toBe(true)
    expect(after.evidence.every((entry) => entry.status === 'pass')).toBe(true)
  })

  test('rejects activity completion until the dedicated binding is persisted', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    const result = await service.completeActivity({
      activity: 'video.presets.binding',
      activityRevision: 3,
      artifactRefs: [],
      checkIds: [],
    })

    expect(result).toMatchObject({
      accepted: false,
      failedChecks: expect.arrayContaining([
        'video.presets.bound',
        'video.presets.binding-receipt',
      ]),
    })
  })

  test('keeps preset validation read-only and passes once presets are bound', async () => {
    const { context, files } = createContext()
    await patchNodeMedia(context)(binding)
    const graphBefore = decoder.decode(files.entries.get('blueprint.json')!)
    const manifestBefore = decoder.decode(files.entries.get('assets/manifest.json')!)
    const writesBefore = files.calls.filter((call) => call.startsWith('write:')).length

    const validation = await validateProjectForActivity(
      context,
      'video.presets.validating',
      1,
      activityContract('video.presets.validating').hardChecks,
    )

    expect(validation.ok).toBe(true)
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(graphBefore)
    expect(decoder.decode(files.entries.get('assets/manifest.json')!)).toBe(
      manifestBefore,
    )
    expect(files.calls.filter((call) => call.startsWith('write:'))).toHaveLength(
      writesBefore,
    )
  })

  test.each([
    ['graph', { expectedGraphRevision: 6 }],
    ['graph snapshot', { graphSnapshotToken: 'binding-game:6' }],
    ['asset manifest', { expectedAssetRevision: 10 }],
  ])('rejects a stale %s without partial writes', async (_label, override) => {
    const { context, files } = createContext()
    const graphBefore = decoder.decode(files.entries.get('blueprint.json')!)
    const manifestBefore = decoder.decode(files.entries.get('assets/manifest.json')!)

    const result = await patchNodeMedia(context)({ ...binding, ...override })

    expect(validateReturn(result), JSON.stringify(validateReturn.errors)).toBe(true)
    expect(result).toMatchObject({ ok: false })
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(graphBefore)
    expect(decoder.decode(files.entries.get('assets/manifest.json')!)).toBe(
      manifestBefore,
    )
  })

  test('rejects an unknown NodeRef without partial writes', async () => {
    const { context, files } = createContext()
    const graphBefore = decoder.decode(files.entries.get('blueprint.json')!)
    const manifestBefore = decoder.decode(files.entries.get('assets/manifest.json')!)

    const result = await patchNodeMedia(context)({
      ...binding,
      bindings: [{
        ...binding.bindings[0],
        nodeRef: { blueprintId: 'main', nodeId: 'missing' },
      }],
    })

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'validation.failed',
      errors: [expect.stringContaining('Unknown node')],
    })
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(graphBefore)
    expect(decoder.decode(files.entries.get('assets/manifest.json')!)).toBe(
      manifestBefore,
    )
  })

  test('rejects the operation when video.presets.binding is not working', async () => {
    const { context, files } = createContext()
    const workflow = bindingWorkflow()
    workflow.activities['video.presets.binding']!.status = 'complete'
    workflow.assetPipeline.activeActivities = ['video.presets.validating']
    files.entries.set(
      VIDEO_GAME_WORKFLOW_FILE,
      json(workflow),
    )

    await expect(patchNodeMedia(context)(binding)).rejects.toMatchObject({
      code: 'workflow.capability.denied',
    })
  })

  test('does not reopen or alter a delivered main workflow', async () => {
    const { context, files } = createContext()
    const workflow = bindingWorkflow()
    workflow.productPhase = 'feature-development'
    workflow.phaseStatus = 'complete'
    workflow.activity = 'playtest.validating'
    workflow.activityRevision = 1
    workflow.activityStatus = 'complete'
    workflow.activities['playtest.validating'] = {
      revision: 1,
      status: 'complete',
      artifactRefs: [],
      evidence: [],
    }
    workflow.activeGroup = {
      id: 'delivery',
      activities: [],
      status: 'complete',
      revision: 8,
    }
    files.entries.set(
      VIDEO_GAME_WORKFLOW_FILE,
      json(workflow),
    )
    const workflowBefore = decoder.decode(
      files.entries.get(VIDEO_GAME_WORKFLOW_FILE)!,
    )

    await patchNodeMedia(context)(binding)

    expect(decoder.decode(
      files.entries.get(VIDEO_GAME_WORKFLOW_FILE)!,
    )).toBe(workflowBefore)
  })

  test('prevents game.finalizing from writing preset fields through patch_graph', async () => {
    const { context, files } = createContext()
    const workflow = bindingWorkflow()
    workflow.activeGroup = {
      id: 'integration',
      activities: ['game.finalizing'],
      status: 'working',
      revision: 9,
    }
    workflow.activity = 'game.finalizing'
    workflow.activityRevision = 2
    workflow.activityStatus = 'working'
    workflow.activities['game.finalizing'] = {
      revision: 2,
      status: 'working',
      artifactRefs: [],
      evidence: [],
    }
    workflow.activities['video.presets.binding']!.status = 'not-started'
    workflow.assetPipeline.activeActivities = []
    files.entries.set(
      VIDEO_GAME_WORKFLOW_FILE,
      json(workflow),
    )
    const before = decoder.decode(files.entries.get('blueprint.json')!)

    const result = await createGameVideoService(context).patchGraph({
      activityRevision: 2,
      ops: [{
        op: 'set-node-data',
        nodeId: 'n1',
        patch: { media: binding.bindings[0]!.media },
      }],
    }) as Record<string, unknown>

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'workflow.node-media.dedicated-operation-required',
    })
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(before)
  })
})
