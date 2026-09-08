import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import {
  createInitialWorkflowState,
  VIDEO_GAME_WORKFLOW_FILE,
} from './workflow-state'
import type { VideoGameWorkflowState } from '../../workflow/contracts'
import { expandCheckIds } from '../../workflow/validation-check-groups'

const encoder = new TextEncoder()

function validBlueprint() {
  const graph = {
    nodes: [
      { id: 'a', type: 'scene', position: { x: 0, y: 0 }, data: { name: 'a', chapterSummary: 'a', storyText: 'a' } },
      { id: 'b', type: 'scene', position: { x: 240, y: 0 }, data: { name: 'b', chapterSummary: 'b', storyText: 'b' } },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in', data: {} },
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
  const state = createInitialWorkflowState('validate-project-groups')
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
    ['blueprint.json', encoder.encode(JSON.stringify(validBlueprint()))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
    [VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(playtestWorkingState()))],
  ])
  const context = {
    gameId: 'validate-project-groups',
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
        return operation()
      },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
  return context
}

describe('validate_project 组合 checkIds', () => {
  it('展开 blueprint.data.valid 并返回叶子 evidence', async () => {
    const service = createGameVideoService(createContext())
    const result = await service.validateProject({
      activity: 'playtest.validating',
      checkIds: ['blueprint.data.valid'],
    }) as { ok: boolean; evidence: Array<{ checkId: string; status: string }> }

    expect(result.ok).toBe(true)
    const ids = result.evidence.map((item) => item.checkId).sort()
    expect(ids).toEqual([...expandCheckIds(['blueprint.data.valid'])].sort())
    expect(ids).toContain('graph.connected')
    expect(ids).toContain('edge.no-producer')
    expect(ids).toContain('runtime.shape.valid')
  })

  it('叶子 checkIds 可单独请求', async () => {
    const service = createGameVideoService(createContext())
    const result = await service.validateProject({
      activity: 'playtest.validating',
      checkIds: ['graph.connected'],
    }) as { ok: boolean; evidence: Array<{ checkId: string }> }

    expect(result.ok).toBe(true)
    expect(result.evidence.map((item) => item.checkId)).toEqual(['graph.connected'])
  })
})
