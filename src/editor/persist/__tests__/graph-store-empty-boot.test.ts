import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-client')>()
  return {
    ...actual,
    loadStore: vi.fn(async () => ({ project: null, revision: null, versions: [] })),
    saveProject: vi.fn(async () => ({ ok: true, revision: 'rev' })),
    currentVersion: vi.fn(async () => ({ tag: null, commitHash: null, dirty: false })),
    listVersions: vi.fn(async () => []),
  }
})

vi.mock('@/runtime/react/component-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runtime/react/component-host')>()
  return {
    ...actual,
    bootComponents: vi.fn(async () => {}),
  }
})

import { useGraphScenario } from '../graphScenarioStore'
import { loadStore, saveProject } from '../persist-client'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

const demoNode = {
  id: 'demo-node',
  type: 'perf' as const,
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: 'Demo node' },
}
const demoMain = {
  id: 'demo-main',
  title: 'Demo main',
  entry: demoNode.id,
  graph: { nodes: [demoNode], edges: [] },
}
const demo = {
  version: 'game-video.graph.v1',
  graph: demoMain.graph,
  entities: {
    'demo-entity': { id: 'demo-entity', attrs: { hp: 100 } },
  },
  variables: {
    'demo-variable': { id: 'demo-variable', kind: 'number', initial: 1 },
  },
  manifest: {
    version: 'game-video.blueprint-manifest.v1',
    mainPackId: demoMain.id,
    packs: { [demoMain.id]: demoMain },
  },
} as unknown as GraphLibraryDocument

beforeEach(() => {
  vi.clearAllMocks()
  useGraphScenario.setState({
    game: '',
    demo: null,
    blueprints: { stale: demoMain },
    mainBlueprintId: 'stale',
    activeBlueprintId: 'stale',
    graph: demoMain.graph,
    meta: {
      entities: demo.entities,
      variables: demo.variables,
    },
    booted: false,
    isDraft: true,
    loadEpoch: 0,
  } as never)
})

describe('store boot failures', () => {
  it('rejects a package load without saving an empty library, then permits a retry', async () => {
    const loadError = new Error('temporary package read failure')
    vi.mocked(loadStore)
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce({ project: demo, revision: 'rev-demo', versions: [] })

    await expect(useGraphScenario.getState().ensureBoot('brand-new-game', demo)).rejects.toThrow(loadError)

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()

    expect(saveProject).not.toHaveBeenCalled()
    expect(useGraphScenario.getState().booted).toBe(false)

    await expect(useGraphScenario.getState().ensureBoot('brand-new-game', demo)).resolves.toBeUndefined()

    const state = useGraphScenario.getState()
    expect(state.booted).toBe(true)
    expect(state.graph.nodes.map((node) => node.id)).toEqual(['demo-node'])
    expect(saveProject).not.toHaveBeenCalled()
  })
})
