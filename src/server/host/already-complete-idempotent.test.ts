import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import {
  createInitialWorkflowState,
  readWorkflowState,
  VIDEO_GAME_WORKFLOW_FILE,
  WorkflowStateError,
} from './workflow-state'

const encoder = new TextEncoder()

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/**
 * Host 在 upsert_document 时已经把活动 complete 了，peer 仍会按 prompt
 * 再打 validate_project / complete_activity。第四局实测：
 * 已完成活动不在 activeGroup 时，补打完成工具曾返回 stale 并造成无效重试。
 *
 * 已交付的活动再完成一次必须幂等成功，不能报 stale。
 * 从未开始、也不在活跃组里的活动（例如跨组的 ui.authoring）仍然拒绝。
 */

function createContext(workflow: ReturnType<typeof createInitialWorkflowState>): {
  context: ExtensionContext
  files: Map<string, Uint8Array>
} {
  const files = new Map<string, Uint8Array>([
    [VIDEO_GAME_WORKFLOW_FILE, json(workflow)],
    ['assets/manifest.json', json({ version: 2, assets: [] })],
  ])
  let chain: Promise<unknown> = Promise.resolve()
  const context = {
    gameId: workflow.gameId,
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

function pillarAlreadyComplete() {
  const workflow = createInitialWorkflowState('g')
  const evidence = [{
    schemaVersion: 1 as const,
    activity: 'document.pillar' as const,
    activityRevision: 1,
    projectRevision: 0,
    checkId: 'document.pillar.ready',
    status: 'pass' as const,
    observedAt: '2026-08-14T06:16:55.720Z',
  }]
  workflow.productPhase = 'planning-design'
  workflow.activity = 'document.pillar'
  workflow.activityRevision = 1
  workflow.activityStatus = 'complete'
  workflow.activities['document.core'] = {
    revision: 1, status: 'complete', artifactRefs: [], evidence: [],
  }
  workflow.activities['document.pillar'] = {
    revision: 1,
    status: 'complete',
    artifactRefs: [],
    evidence,
    completedAt: '2026-08-14T06:16:55.723Z',
  }
  // 组已交付：activeActivitiesIn 为空，但组 id 仍是 design。
  // 这就是实测报错 `${activity} is not active in group ${group.id}` 的状态。
  workflow.activeGroup = {
    id: 'design',
    activities: [],
    status: 'complete',
    revision: 12,
  }
  workflow.revision = 12
  return workflow
}

describe('已完成活动的幂等 complete / validate', () => {
  it('complete_activity 打到 Host 已完成的 pillar，返回 accepted + alreadyComplete，不改状态', async () => {
    const seeded = pillarAlreadyComplete()
    const { context } = createContext(seeded)
    const service = createGameVideoService(context)
    const before = seeded.revision

    const result = await service.completeActivity({
      activity: 'document.pillar',
      activityRevision: 1,
      artifactRefs: [],
      checkIds: ['document.pillar.ready'],
    }) as { accepted: boolean, alreadyComplete?: boolean, state: { revision: number } }

    expect(result.accepted).toBe(true)
    expect(result.alreadyComplete).toBe(true)
    expect(result.state.revision).toBe(before)
    const after = (await readWorkflowState(context))!
    expect(after.revision).toBe(before)
    expect(after.activities['document.pillar']?.status).toBe('complete')
  })

  it('validate_project 打到 Host 已完成的 pillar，返回 ok 而不是 stale', async () => {
    const { context } = createContext(pillarAlreadyComplete())
    const service = createGameVideoService(context)

    const result = await service.validateProject({
      activity: 'document.pillar',
    }) as { ok: boolean, alreadyComplete?: boolean }

    expect(result.ok).toBe(true)
    expect(result.alreadyComplete).toBe(true)
  })

  it('当前活动已切到 outline 时，补打 pillar 的 complete 仍幂等成功', async () => {
    const workflow = pillarAlreadyComplete()
    workflow.activity = 'blueprint.outline'
    workflow.activityStatus = 'working'
    workflow.activityRevision = 1
    workflow.activities['blueprint.outline'] = {
      revision: 1, status: 'working', artifactRefs: [], evidence: [],
    }
    workflow.activeGroup = {
      id: 'outline',
      activities: ['blueprint.outline'],
      status: 'working',
      revision: 13,
    }
    const { context } = createContext(workflow)
    const service = createGameVideoService(context)

    const result = await service.completeActivity({
      activity: 'document.pillar',
      activityRevision: 1,
      artifactRefs: [],
      checkIds: ['document.pillar.ready'],
    }) as { accepted: boolean, alreadyComplete?: boolean }

    expect(result.accepted).toBe(true)
    expect(result.alreadyComplete).toBe(true)
    const after = (await readWorkflowState(context))!
    expect(after.activities['blueprint.outline']?.status).toBe('working')
  })

  it('从未开始且不在活跃组的活动仍然 stale', async () => {
    const { context } = createContext(pillarAlreadyComplete())
    const service = createGameVideoService(context)

    await expect(service.completeActivity({
      activity: 'ui.authoring',
      activityRevision: 1,
      artifactRefs: [],
      checkIds: [],
    })).rejects.toMatchObject({ code: 'workflow.activity.stale' } satisfies Partial<WorkflowStateError>)
  })
})
