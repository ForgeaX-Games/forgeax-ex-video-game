import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import { createInitialWorkflowState, readWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'

const encoder = new TextEncoder()

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/**
 * 隐式 begin（设计 §9.7.3 L3）。
 *
 * 「先显式 begin_activity 再动手」是模型最容易漏的一步，漏了就撞
 * `workflow.transition.invalid`——而这类失败的验收目标是 0 次。
 * 这组用例钉住：owner 第一次动手时 Host 自动开活动，但不放宽组归属与作者门。
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
          nodes: [{
            id: 'n1',
            type: 'scene',
            position: { x: 0, y: 0 },
            data: { name: 'n1', cast: [{ characterId: 'c1' }], scenes: [{ sceneId: 's1' }] },
          }],
          edges: [],
        },
      },
    },
  },
  graph: { nodes: [], edges: [] },
  variables: {},
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
        c1: { id: 'c1', name: '角色一', description: '外观', prompt: '提示', history: [], createdAt: 1, updatedAt: 1 },
      },
      scene: {
        s1: { id: 's1', name: '场景一', description: '画面', prompt: '提示', history: [], createdAt: 1, updatedAt: 1 },
      },
      video: {}, icon: {}, control: {}, audio: {}, font: {},
    },
  },
}

/** 三条线都处于 not-started：模拟模型忘记 begin 就直接动手。 */
function createContext(): { context: ExtensionContext, files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', json(blueprint)],
    ['assets/manifest.json', json(assetManifest)],
  ])
  const workflow = createInitialWorkflowState('g')
  workflow.productPhase = 'feature-development'
  workflow.activity = 'characters.modeling'
  workflow.activityStatus = 'not-started'
  workflow.activities['blueprint.outline'] = { revision: 1, status: 'complete', artifactRefs: [], evidence: [] }
  workflow.activeGroup = {
    id: 'modeling',
    activities: ['characters.modeling', 'scenes.modeling', 'rules.catalog'],
    status: 'not-started',
    revision: 1,
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

describe('隐式 begin', () => {
  it('规则线没有显式 begin 也能直接写规则目录', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    const result = await service.patchRules({
      expectedRevision: 1,
      ops: [{ op: 'upsert-variable', variableId: 'hp', name: '生命', initial: 10 }],
    }) as { ok: boolean, errors?: string[] }

    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
    const state = (await readWorkflowState(context))!
    expect(state.activities['rules.catalog']?.status).toBe('working')
  })

  it('三条线各自第一次动手都能自开，互不干扰', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    await service.patchCharacters({
      expectedRevision: 1,
      ops: [{
        op: 'upsert-character',
        character: { id: 'c1', name: '角色一', appearance: { description: '新外观', previewPrompt: '提示' } },
      }],
    })
    await service.patchScenes({
      expectedRevision: 1,
      ops: [{ op: 'upsert-scene', sceneId: 's1', description: '新画面' }],
    })
    await service.patchRules({
      expectedRevision: 1,
      ops: [{ op: 'upsert-variable', variableId: 'mp', name: '法力', initial: 5 }],
    })

    const state = (await readWorkflowState(context))!
    expect(state.activities['characters.modeling']?.status).toBe('working')
    expect(state.activities['scenes.modeling']?.status).toBe('working')
    expect(state.activities['rules.catalog']?.status).toBe('working')
  })

  it('完成落到调用方指定的那条线，而不是组内代表活动', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)
    // 三条线都开起来，代表活动是角色线。
    await service.patchCharacters({
      expectedRevision: 1,
      ops: [{
        op: 'upsert-character',
        character: { id: 'c1', name: '角色一', appearance: { description: '外观', previewPrompt: '提示' } },
      }],
    })
    await service.patchScenes({ expectedRevision: 1, ops: [{ op: 'upsert-scene', sceneId: 's1', description: '画面' }] })

    const state = (await readWorkflowState(context))!
    const sceneRevision = state.activities['scenes.modeling']!.revision
    const result = await service.completeActivity({
      activity: 'scenes.modeling',
      activityRevision: sceneRevision,
      artifactRefs: [],
      checkIds: ['scenes.catalog.valid'],
    }) as { accepted: boolean, projection?: { activity?: string } }

    // 校验用的是场景线自己的契约，而不是代表活动（角色线）的。
    expect(result.accepted).toBe(true)
    const after = (await readWorkflowState(context))!
    expect(after.activities['scenes.modeling']?.status).toBe('complete')
    expect(after.activities['characters.modeling']?.status).toBe('working')
  })

  it('拒绝把完成记到不在活跃集合里的活动上', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)
    await service.patchRules({
      expectedRevision: 1,
      ops: [{ op: 'upsert-variable', variableId: 'hp', name: '生命', initial: 10 }],
    })

    await expect(service.completeActivity({
      activity: 'ui.authoring',
      activityRevision: 1,
      artifactRefs: [],
      checkIds: [],
    })).rejects.toMatchObject({ code: 'workflow.activity.stale' })
  })

  it('不放宽组归属：下一组的活动不会被隐式开启', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    // `ui.authoring` 属于后面的组，当前组没跑完就不该被自动开启。
    await expect(service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId: 'n1', field: 'name', value: '改名' }],
    })).rejects.toMatchObject({ code: 'workflow.capability.denied' })

    const state = (await readWorkflowState(context))!
    expect(state.activities['ui.authoring']?.status ?? 'not-started').toBe('not-started')
  })
})
