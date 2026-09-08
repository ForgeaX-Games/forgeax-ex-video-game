import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import { beginWorkflowActivity, createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import {
  readAssetManifestRevision,
  readAssetManifestScopeRevisions,
  readDocumentRevision,
} from './document-revision'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/**
 * Asset manifest 与 blueprint 两个独立 revision 平面的端到端验证。
 *
 * 角色/场景写只提交 manifest；图写在需要校验 manifest 引用时同时持有两把锁。
 * 因此两个平面不会互相覆盖，角色与场景 scope 也能从同一个 asset revision 合并。
 */

const blueprint = {
  revision: 1,
  manifest: {
    mainPackId: 'main',
    packs: {
      main: {
        id: 'main',
        entry: 'n1',
        graph: {
          nodes: [
            {
              id: 'n1',
              type: 'scene',
              position: { x: 0, y: 0 },
              data: {
                name: 'n1',
                cast: [{ characterId: 'c1' }],
                scenes: [{ sceneId: 's1' }],
              },
            },
          ],
          edges: [],
        },
      },
    },
  },
  graph: { nodes: [], edges: [] },
  variables: { hp: { id: 'hp', initial: 10 } },
}

const assetManifest = {
  version: 2,
  assets: [],
  assetCatalog: {
    version: 1,
    folders: [],
    placements: {},
    entities: {
      character: {
        c1: { id: 'c1', name: '角色一', description: '外观', prompt: '参考图', history: [], createdAt: 1, updatedAt: 1 },
      },
      scene: {
        s1: { id: 's1', name: '场景一', description: '画面', prompt: '参考图', history: [], createdAt: 1, updatedAt: 1 },
      },
      video: {}, icon: {}, control: {}, audio: {}, font: {},
    },
  },
}

/** 串行化的文件桩：模拟真实 Host 的 withLocks 语义。 */
function createContext(): { context: ExtensionContext, files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', json(blueprint)],
    ['assets/manifest.json', json(assetManifest)],
  ])
  const workflow = createInitialWorkflowState('g')
  workflow.productPhase = 'feature-development'
  workflow.phaseStatus = 'working'
  workflow.activity = 'game.finalizing'
  workflow.activityRevision = 1
  workflow.activityStatus = 'working'
  for (const activity of [
    'brief.collecting',
    'document.inquiry',
    'document.core',
    'document.pillar',
    'blueprint.outline',
    'rules.catalog',
    'ui.authoring',
    'rules.binding',
  ] as const) {
    workflow.activities[activity] = {
      revision: 1,
      status: 'complete',
      artifactRefs: [],
      evidence: [],
    }
  }
  workflow.activities['characters.modeling'] = { revision: 1, status: 'working', artifactRefs: [], evidence: [] }
  workflow.activities['scenes.modeling'] = { revision: 1, status: 'working', artifactRefs: [], evidence: [] }
  workflow.activities['game.finalizing'] = { revision: 1, status: 'working', artifactRefs: [], evidence: [] }
  workflow.activeGroup = {
    id: 'integration',
    activities: ['game.finalizing'],
    status: 'working',
    revision: 1,
  }
  workflow.assetPipeline = {
    ...workflow.assetPipeline,
    revision: 1,
    status: 'working',
    activeActivities: ['characters.modeling', 'scenes.modeling'],
    readiness: {
      characters: 'working',
      scenes: 'working',
      videoPresets: 'pending',
    },
  }
  files.set(VIDEO_GAME_WORKFLOW_FILE, json(workflow))

  let chain: Promise<unknown> = Promise.resolve()
  const context = {
    gameId: 'g',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) {
        files.set(path, new Uint8Array(contents))
      },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>): Promise<T> {
        const run = chain.then(operation, operation)
        chain = run.catch(() => undefined)
        return run
      },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
  return { context, files }
}

describe('asset manifest 并发写', () => {
  it('角色线与场景线从同一 asset revision 合并，且不改 blueprint 字节或 graph revision', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const blueprintBefore = decoder.decode(files.get('blueprint.json')!)
    const graphRevisionBefore = readDocumentRevision(files.get('blueprint.json')!)

    const [characters, scenes] = await Promise.all([
      service.patchCharacters({
        activityRevision: 1,
        expectedRevision: 0,
        ops: [{
          op: 'upsert-character',
          character: {
            id: 'c1',
            name: '角色一',
            appearance: { description: '改过的外观', previewPrompt: '改过的参考图' },
          },
        }],
      }) as Promise<{ ok: boolean, errors?: string[] }>,
      service.patchScenes({
        activityRevision: 1,
        expectedRevision: 0,
        ops: [{ op: 'upsert-scene', sceneId: 's1', description: '改过的画面' }],
      }) as Promise<{ ok: boolean, errors?: string[] }>,
    ])

    expect(characters.ok, JSON.stringify(characters.errors)).toBe(true)
    expect(scenes.ok, JSON.stringify(scenes.errors)).toBe(true)

    const stored = JSON.parse(decoder.decode(files.get('assets/manifest.json')!))
    expect(stored.assetCatalog.entities.character.c1.description).toBe('改过的外观')
    expect(stored.assetCatalog.entities.scene.s1.description).toBe('改过的画面')
    const scopeRevisions = readAssetManifestScopeRevisions(files.get('assets/manifest.json')!)
    expect(scopeRevisions.characters).toBeGreaterThan(0)
    expect(scopeRevisions.scenes).toBeGreaterThan(0)
    expect(readAssetManifestRevision(files.get('assets/manifest.json')!)).toBe(2)
    expect(decoder.decode(files.get('blueprint.json')!)).toBe(blueprintBefore)
    expect(readDocumentRevision(files.get('blueprint.json')!)).toBe(graphRevisionBefore)
  })

  it('角色 manifest 写不会覆盖并发 graph 写', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const [characterResult, graphResult] = await Promise.all([
      service.patchCharacters({
        activityRevision: 1,
        expectedRevision: 0,
        ops: [{
          op: 'upsert-character',
          character: { id: 'c1', name: '角色一', appearance: { description: 'A', previewPrompt: 'A' } },
        }],
      }) as Promise<{ ok: boolean, errors?: string[] }>,
      service.patchGraph({
        activityRevision: 1,
        expectedRevision: 1,
        ops: [{ op: 'set-node-field', nodeId: 'n1', field: 'name', value: '图写入' }],
      }) as Promise<{ ok: boolean, errors?: string[] }>,
    ])

    expect(characterResult.ok, JSON.stringify(characterResult.errors)).toBe(true)
    expect(graphResult.ok, JSON.stringify(graphResult.errors)).toBe(true)
    const storedBlueprint = JSON.parse(decoder.decode(files.get('blueprint.json')!))
    const storedManifest = JSON.parse(decoder.decode(files.get('assets/manifest.json')!))
    expect(storedBlueprint.manifest.packs.main.graph.nodes[0].data.name).toBe('图写入')
    expect(storedManifest.assetCatalog.entities.character.c1.description).toBe('A')
  })

  it('场景 manifest 写不会覆盖并发 graph 写', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const [sceneResult, graphResult] = await Promise.all([
      service.patchScenes({
        activityRevision: 1,
        expectedRevision: 0,
        ops: [{ op: 'upsert-scene', sceneId: 's1', description: 'B' }],
      }) as Promise<{ ok: boolean, errors?: string[] }>,
      service.patchGraph({
        activityRevision: 1,
        expectedRevision: 1,
        ops: [{ op: 'set-node-field', nodeId: 'n1', field: 'name', value: '图写入' }],
      }) as Promise<{ ok: boolean, errors?: string[] }>,
    ])

    expect(sceneResult.ok, JSON.stringify(sceneResult.errors)).toBe(true)
    expect(graphResult.ok, JSON.stringify(graphResult.errors)).toBe(true)
    const storedBlueprint = JSON.parse(decoder.decode(files.get('blueprint.json')!))
    const storedManifest = JSON.parse(decoder.decode(files.get('assets/manifest.json')!))
    expect(storedBlueprint.manifest.packs.main.graph.nodes[0].data.name).toBe('图写入')
    expect(storedManifest.assetCatalog.entities.scene.s1.description).toBe('B')
  })

  it('跨组推进仍然校验全局修订号，顺序不能被绕过', async () => {
    const { context, files } = createContext()
    const workflow = JSON.parse(decoder.decode(files.get(VIDEO_GAME_WORKFLOW_FILE)!))
    const staleRevision = workflow.revision - 1

    // rules.binding 属于下一组：拿过期修订号推进必须被拒。
    await expect(beginWorkflowActivity(context, {
      activity: 'rules.binding',
      expectedWorkflowRevision: staleRevision,
    })).rejects.toMatchObject({ code: 'workflow.revision.conflict' })
  })

  it('两次写同一个域时，后到者仍然被乐观锁拦住', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const first = await service.patchScenes({
      activityRevision: 1,
      expectedRevision: 0,
      ops: [{ op: 'upsert-scene', sceneId: 's1', description: '第一次' }],
    }) as { ok: boolean }
    expect(first.ok).toBe(true)
    const blueprintAfterFirst = decoder.decode(files.get('blueprint.json')!)
    const graphRevisionAfterFirst = readDocumentRevision(files.get('blueprint.json')!)

    // 基于已经过期的 revision 再写同一个域：必须拒绝，不能静默覆盖。
    const second = await service.patchScenes({
      activityRevision: 1,
      expectedRevision: 0,
      ops: [{ op: 'upsert-scene', sceneId: 's1', description: '覆盖第一次' }],
    }) as { ok: boolean, errorCode?: string, conflict?: { code: string } }
    expect(second.ok).toBe(false)
    expect(second.errorCode ?? second.conflict?.code).toBe('revision.conflict')
    expect(decoder.decode(files.get('blueprint.json')!)).toBe(blueprintAfterFirst)
    expect(readDocumentRevision(files.get('blueprint.json')!)).toBe(graphRevisionAfterFirst)
  })

  it('删除目录实体前检查持锁后读到的最新 graph 引用', async () => {
    const { context, files } = createContext()
    const stored = JSON.parse(decoder.decode(files.get('blueprint.json')!))
    stored.manifest.packs.main.graph.nodes[0].data.cast = []
    stored.graph = stored.manifest.packs.main.graph
    files.set('blueprint.json', json(stored))
    const service = createGameVideoService(context)

    const graphWrite = service.patchGraph({
      activityRevision: 1,
      expectedRevision: 1,
      ops: [{
        op: 'set-node-data',
        nodeId: 'n1',
        patch: { cast: [{ characterId: 'c1' }] },
      }],
    }) as Promise<{ ok: boolean }>
    const deletion = service.patchCharacters({
      activityRevision: 1,
      expectedRevision: 0,
      ops: [{ op: 'remove-character', characterId: 'c1' }],
    }) as Promise<{ ok: boolean, errors?: string[] }>

    expect((await graphWrite).ok).toBe(true)
    const deletionResult = await deletion
    expect(deletionResult.ok).toBe(false)
    expect(deletionResult.errors?.join('\n')).toContain('仍被节点引用')
    const manifest = JSON.parse(decoder.decode(files.get('assets/manifest.json')!))
    expect(manifest.assetCatalog.entities.character.c1).toBeDefined()
  })
})
