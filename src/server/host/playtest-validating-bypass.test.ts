import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import {
  createInitialWorkflowState,
  VIDEO_GAME_WORKFLOW_FILE,
} from './workflow-state'
import { RETRY_LEDGER_FILE } from './retry-ledger'
import type { VideoGameWorkflowState } from '../../workflow/contracts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * 可玩性硬门必须始终拒绝损坏蓝图：重复重试只能积累诊断，不能把已知失败
 * 降级为成功交付。
 */

function brokenBlueprint() {
  // 全默认出边成环 → playtest.paths-not-illegally-stuck / graph 类硬门会失败
  const graph = {
    nodes: [
      { id: 'a', type: 'scene', position: { x: 0, y: 0 }, data: { name: 'a', chapterSummary: 'a', storyText: 'a' } },
      { id: 'b', type: 'scene', position: { x: 100, y: 0 }, data: { name: 'b', chapterSummary: 'b', storyText: 'b' } },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in', data: {} },
      { id: 'e2', source: 'b', target: 'a', sourceHandle: 'default', targetHandle: 'in', data: {} },
    ],
  }
  return {
    revision: 1,
    version: 'game-video.graph.v1',
    graph,
    manifest: {
      mainPackId: 'bp-main',
      packs: { 'bp-main': { id: 'bp-main', title: 'main', entry: 'a', graph } },
    },
    variables: {},
    entities: {},
    formulas: {},
    ui: { overlays: {} },
  }
}

function playtestWorkingState(): VideoGameWorkflowState {
  const state = createInitialWorkflowState('playtest-bypass')
  state.productPhase = 'asset-generation'
  state.activity = 'playtest.validating'
  state.activityStatus = 'working'
  state.activityRevision = 1
  state.activities['playtest.validating'] = {
    revision: 1, status: 'working', artifactRefs: [], evidence: [],
  }
  state.activeGroup = {
    id: 'delivery',
    activities: ['playtest.validating'],
    status: 'working',
    revision: 1,
  }
  return state
}

function createContext() {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(brokenBlueprint()))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
    [VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(playtestWorkingState()))],
  ])
  let chain: Promise<unknown> = Promise.resolve()
  const context = {
    gameId: 'playtest-bypass',
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

async function completeOnce(service: ReturnType<typeof createGameVideoService>) {
  return service.completeActivity({
    activity: 'playtest.validating',
    activityRevision: 1,
    artifactRefs: [],
    checkIds: [],
  }) as Promise<{
    accepted: boolean
    waivedAfterRetries?: boolean
    attempts?: number
    failedChecks?: string[]
    guidance?: string
    evidence?: unknown[]
  }>
}

describe('playtest.validating 不会用重试次数绕过硬门', () => {
  it('连续三次校验失败都拒绝 complete_activity 并保留失败记录', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    for (let i = 1; i <= 3; i += 1) {
      const result = await completeOnce(service)
      expect(result.accepted, `attempt ${i}`).toBe(false)
      expect(result.failedChecks?.length).toBeGreaterThan(0)
      expect(result.attempts).toBe(i)
      expect(result.waivedAfterRetries).toBeUndefined()
    }

    const ledger = JSON.parse(decoder.decode(files.get(RETRY_LEDGER_FILE)!)) as {
      attempts: Record<string, number>
    }
    expect(Object.keys(ledger.attempts).some((key) => key.startsWith('playtest.validating@'))).toBe(true)
  })
})
