import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-client')>()
  return { ...actual, saveProject: vi.fn(actual.saveProject) }
})

import { useGraphScenario } from '../graphScenarioStore'
import { saveProject } from '../persist-client'
import type { BlueprintDoc } from '@/runtime/core/schema/graph-schema'

const bpNode = (id: string, refId?: string) => ({
  id, type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
  data: refId ? { name: id, subFlowPack: { id: refId } } : { name: id },
})
const bpDoc = (id: string, refId?: string): BlueprintDoc => ({ id, title: id, entry: 'e',
  graph: { nodes: refId ? [bpNode('e', refId)] : [bpNode('e')], edges: [] },
})

beforeEach(() => {
  vi.mocked(saveProject).mockClear()
  useGraphScenario.setState({
    game: 'test-game',
    blueprints: { a: bpDoc('a', 'b'), b: bpDoc('b', 'a') },
    mainBlueprintId: 'a',
    activeBlueprintId: 'a',
    graph: bpDoc('a', 'b').graph,
    meta: {},
    booted: true,
    isDraft: true,
    savedTip: '',
  } as any)
})

describe('save() blocks on cross-blueprint reference cycle', () => {
  it('does not call saveProject and sets a savedTip naming the cycle', () => {
    useGraphScenario.getState().save()
    expect(saveProject).not.toHaveBeenCalled()
    const st = useGraphScenario.getState()
    expect(st.savedTip).toMatch(/环/)
    // 阻塞保存不应清掉「未保存草稿」标记——用户改坏的东西还得留着改。
    expect(st.isDraft).toBe(true)
  })

  it('acyclic project saves normally (no block)', () => {
    useGraphScenario.setState({
      blueprints: { a: bpDoc('a') },
      mainBlueprintId: 'a',
      activeBlueprintId: 'a',
      graph: { nodes: [bpNode('e')], edges: [] },
    } as any)
    useGraphScenario.getState().save()
    expect(saveProject).toHaveBeenCalledTimes(1)
  })

  it('blocks save before the Host handshake binds a game identity', () => {
    useGraphScenario.setState({ game: '' })

    expect(useGraphScenario.getState().save()).toBe(-1)
    expect(saveProject).not.toHaveBeenCalled()
    expect(useGraphScenario.getState().savedTip).toContain('Host handshake')
  })
})
