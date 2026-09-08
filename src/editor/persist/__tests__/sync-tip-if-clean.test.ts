import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-client')>()
  return {
    ...actual,
    loadStore: vi.fn(),
    saveProject: vi.fn(async () => ({ ok: true, revision: 'rev-local' })),
    currentVersion: vi.fn(async () => ({ tag: null, commitHash: null, dirty: false })),
    listVersions: vi.fn(async () => []),
  }
})

import {
  resetCleanFingerprintForTests,
  setTipRevisionForTests,
  useGraphScenario,
} from '../graphScenarioStore'
import { loadStore, saveProject } from '../persist-client'
import { documentFromBlueprints, emptyBlueprintDoc } from '@/authoring/blueprint/blueprint-project'
import type { BlueprintDoc } from '@/runtime/core/schema/graph-schema'

const node = (id: string, name = id): BlueprintDoc['graph']['nodes'][number] => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name },
})

function library(packs: Record<string, BlueprintDoc>, mainId: string) {
  return documentFromBlueprints(packs, mainId, {})
}

function seed(opts?: { active?: string; selected?: string | null }): void {
  const a = emptyBlueprintDoc({ id: 'a', title: 'A' })
  a.graph = { nodes: [node('e', '旧名')], edges: [] }
  a.entry = 'e'
  const b = emptyBlueprintDoc({ id: 'b', title: 'B' })
  b.graph = { nodes: [node('x', '子')], edges: [] }
  b.entry = 'x'
  useGraphScenario.setState({
    blueprints: { a, b },
    mainBlueprintId: 'a',
    activeBlueprintId: opts?.active ?? 'a',
    graph: (opts?.active === 'b' ? b : a).graph,
    meta: {},
    booted: true,
    game: 'game-test',
    isDraft: false,
    selectedNodeId: opts?.selected ?? 'e',
    loadEpoch: 0,
    fitSignal: 0,
    demo: null,
  } as never)
}

beforeEach(async () => {
  vi.mocked(loadStore).mockReset()
  vi.mocked(saveProject).mockClear().mockResolvedValue({ ok: true, revision: 'rev-local' })
  resetCleanFingerprintForTests()
  seed()
  useGraphScenario.getState().save()
  await vi.waitFor(() => expect(saveProject).toHaveBeenCalled())
})

describe('syncTipIfClean', () => {
  it('applies when remote revision differs and store is clean', async () => {
    setTipRevisionForTests('rev-local')
    const remote = library(
      {
        a: { ...emptyBlueprintDoc({ id: 'a', title: 'A' }), entry: 'e', graph: { nodes: [node('e', '新名')], edges: [] } },
      },
      'a',
    )
    vi.mocked(loadStore).mockResolvedValue({ project: remote, revision: 'rev-remote', versions: [] })

    const epoch = useGraphScenario.getState().loadEpoch
    const result = await useGraphScenario.getState().syncTipIfClean()
    expect(result).toBe('applied')
    expect(useGraphScenario.getState().graph.nodes[0]?.data.name).toBe('新名')
    expect(useGraphScenario.getState().loadEpoch).toBe(epoch + 1)
    expect(useGraphScenario.getState().isDraft).toBe(false)
    expect(useGraphScenario.getState().selectedNodeId).toBe('e')
    expect(useGraphScenario.temporal.getState().pastStates).toEqual([])
  })

  it('keeps dirty graph edits and does not advance tipRevision when no external meta changed', async () => {
    setTipRevisionForTests('rev-local')
    useGraphScenario.setState({ isDraft: true } as never)
    const remote = library(
      {
        a: { ...emptyBlueprintDoc({ id: 'a', title: 'A' }), entry: 'e', graph: { nodes: [node('e', 'agent')], edges: [] } },
      },
      'a',
    )
    vi.mocked(loadStore).mockResolvedValue({ project: remote, revision: 'rev-remote', versions: [] })

    expect(await useGraphScenario.getState().syncTipIfClean()).toBe('unchanged')
    expect(useGraphScenario.getState().graph.nodes[0]?.data.name).toBe('旧名')

    useGraphScenario.setState({ isDraft: false } as never)
    expect(await useGraphScenario.getState().syncTipIfClean()).toBe('applied')
    expect(useGraphScenario.getState().graph.nodes[0]?.data.name).toBe('agent')
  })

  it('returns unchanged when revision matches', async () => {
    setTipRevisionForTests('rev-same')
    vi.mocked(loadStore).mockResolvedValue({
      project: library(
        { a: { ...emptyBlueprintDoc({ id: 'a', title: 'A' }), entry: 'e', graph: { nodes: [node('e', '旧名')], edges: [] } } },
        'a',
      ),
      revision: 'rev-same',
      versions: [],
    })
    expect(await useGraphScenario.getState().syncTipIfClean()).toBe('unchanged')
  })

  it('falls back active blueprint and clears missing selection', async () => {
    seed({ active: 'b', selected: 'x' })
    const savesBefore = vi.mocked(saveProject).mock.calls.length
    useGraphScenario.getState().save()
    await vi.waitFor(() => {
      expect(vi.mocked(saveProject).mock.calls.length).toBeGreaterThan(savesBefore)
    })
    await Promise.resolve()
    await Promise.resolve()
    setTipRevisionForTests('rev-local')
    const remote = library(
      {
        a: { ...emptyBlueprintDoc({ id: 'a', title: 'A' }), entry: 'e', graph: { nodes: [node('e', 'only')], edges: [] } },
      },
      'a',
    )
    vi.mocked(loadStore).mockResolvedValue({ project: remote, revision: 'rev-remote', versions: [] })
    expect(await useGraphScenario.getState().syncTipIfClean()).toBe('applied')
    expect(useGraphScenario.getState().activeBlueprintId).toBe('a')
    expect(useGraphScenario.getState().selectedNodeId).toBeNull()
  })

  it('skips while a tip write is in flight', async () => {
    const pending: Array<(v: { ok: boolean; revision: string }) => void> = []
    vi.mocked(saveProject).mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    )
    useGraphScenario.getState().setGraph((g) => ({
      ...g,
      nodes: [...g.nodes, node('extra')],
    }))
    useGraphScenario.getState().save()
    expect(saveProject).toHaveBeenCalled()

    vi.mocked(loadStore).mockResolvedValue({
      project: library(
        { a: { ...emptyBlueprintDoc({ id: 'a', title: 'A' }), entry: 'e', graph: { nodes: [node('e', 'x')], edges: [] } } },
        'a',
      ),
      revision: 'rev-remote',
      versions: [],
    })
    expect(await useGraphScenario.getState().syncTipIfClean()).toBe('skipped')
    pending[0]?.({ ok: true, revision: 'rev-done' })
  })
})
