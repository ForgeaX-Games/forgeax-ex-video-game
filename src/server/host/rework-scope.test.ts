import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  beginWorkflowActivity,
  createInitialWorkflowState,
  readWorkflowState,
  VIDEO_GAME_WORKFLOW_FILE,
} from './workflow-state'

const encoder = new TextEncoder()

/**
 * 返工作用域（设计 §15「某条线失败只重派该条，其余成果保留」）。
 *
 * 返工曾经以组为单位清空：数值线出问题会连带把已经出完的角色图和场景图
 * 一起打回未开始，一次失败变成三次重跑。这组用例钉住 track 级作用域。
 */

function createContext(): ExtensionContext {
  const files = new Map<string, Uint8Array>()
  const state = createInitialWorkflowState('g')
  state.productPhase = 'feature-development'
  state.activity = 'rules.catalog'
  state.activityStatus = 'blocked'
  state.activities['blueprint.outline'] = { revision: 1, status: 'complete', artifactRefs: [], evidence: [] }
  state.activities['characters.modeling'] = { revision: 2, status: 'complete', artifactRefs: [], evidence: [] }
  state.activities['characters.previewing'] = { revision: 2, status: 'complete', artifactRefs: [], evidence: [] }
  state.activities['scenes.modeling'] = { revision: 2, status: 'complete', artifactRefs: [], evidence: [] }
  state.activities['rules.catalog'] = { revision: 3, status: 'blocked', artifactRefs: [], evidence: [] }
  state.activeGroup = {
    id: 'modeling',
    activities: ['scenes.previewing', 'rules.catalog'],
    status: 'blocked',
    revision: 1,
  }
  state.validationEvidence = [
    { schemaVersion: 1, activity: 'characters.previewing', activityRevision: 2, checkId: 'characters.references.ready', status: 'pass', observedAt: new Date().toISOString() },
    { schemaVersion: 1, activity: 'rules.catalog', activityRevision: 3, checkId: 'rules.catalog.valid', status: 'fail', observedAt: new Date().toISOString() },
  ] as typeof state.validationEvidence
  files.set(VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(state)))
  return {
    gameId: 'g',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

describe('返工作用域', () => {
  it('只重跑失败那条线，同组另外两条线的成果保留', async () => {
    const context = createContext()
    const before = (await readWorkflowState(context))!

    await beginWorkflowActivity(context, {
      activity: 'rules.catalog',
      expectedWorkflowRevision: before.revision,
      rework: true,
    })
    const after = (await readWorkflowState(context))!

    expect(after.activities['rules.catalog']?.status).toBe('working')
    expect(after.activities['characters.modeling']?.status).toBe('complete')
    expect(after.activities['characters.previewing']?.status).toBe('complete')
    expect(after.activities['scenes.modeling']?.status).toBe('complete')
  })

  it('返工清掉本条线的证据，但不动其他线已通过的证据', async () => {
    const context = createContext()
    const before = (await readWorkflowState(context))!

    await beginWorkflowActivity(context, {
      activity: 'rules.catalog',
      expectedWorkflowRevision: before.revision,
      rework: true,
    })
    const after = (await readWorkflowState(context))!

    expect(after.validationEvidence.map((item) => item.checkId)).toEqual(['characters.references.ready'])
  })

  it('同一条 track 上返工靠前的一步，会连带打回这条线的后续步骤', async () => {
    const context = createContext()
    const before = (await readWorkflowState(context))!

    await beginWorkflowActivity(context, {
      activity: 'characters.modeling',
      expectedWorkflowRevision: before.revision,
      rework: true,
    })
    const after = (await readWorkflowState(context))!

    // 角色设定重做，角色出图必须跟着重做——它的输入变了。
    expect(after.activities['characters.modeling']?.status).toBe('working')
    expect(after.activities['characters.previewing']?.status).toBe('not-started')
    // 场景线与角色线无关，不受影响。
    expect(after.activities['scenes.modeling']?.status).toBe('complete')
  })

  it('返工仍然打回后面所有组，避免下游拿着过期上游产物继续跑', async () => {
    const context = createContext()
    const before = (await readWorkflowState(context))!
    // 先伪造一个下游组已完成的状态。
    const seeded = { ...before }
    seeded.activities['rules.binding'] = { revision: 1, status: 'complete', artifactRefs: [], evidence: [] }
    await context.files.write(
      VIDEO_GAME_WORKFLOW_FILE,
      encoder.encode(JSON.stringify(seeded)),
    )

    await beginWorkflowActivity(context, {
      activity: 'rules.catalog',
      expectedWorkflowRevision: seeded.revision,
      rework: true,
    })
    const after = (await readWorkflowState(context))!

    expect(after.activities['rules.binding']?.status).toBe('not-started')
  })
})
