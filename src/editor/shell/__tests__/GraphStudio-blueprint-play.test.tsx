import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph, GameScenario } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())
const useProjectAssets = vi.hoisted(() => vi.fn())
const hostClient = vi.hoisted(() => ({
  context: {
    gameId: 'game-nodia-fighting',
    endpoints: { gamePackage: 'https://host.test/__extension__/v1/games/game-nodia-fighting/package' },
  },
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => hostClient,
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(async () => ({ styleAxes: null, assets: [] })),
}))

vi.mock('../../assets/kinoVideoCacheStore', () => ({
  useKinoVideoResources,
  useKinoVideoCache: { getState: () => ({ byGame: {} }) },
}))
vi.mock('../../assets/projectAssetCacheStore', () => ({ useProjectAssets }))

const MAIN_ID = 'bp-main'
const CHILD_ID = 'bp-child'

const MAIN_GRAPH: GameGraph = {
  nodes: [{
    id: 'main-entry',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: '主蓝图入口', durationMs: 1_000 },
  }],
  edges: [],
}

/** 入口刻意不是 `nodes[0]`，也不是 x 最小的那个：只有读 `entry` 才会从「子蓝图入口」开跑。 */
const CHILD_GRAPH: GameGraph = {
  nodes: [
    {
      id: 'child-stray',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '旁支节点', durationMs: 1_000 },
    },
    {
      id: 'child-entry',
      type: 'perf',
      position: { x: 240, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '子蓝图入口', durationMs: 1_000 },
    },
  ],
  edges: [],
}

const MAIN_DOC: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'main-entry', graph: MAIN_GRAPH }
const CHILD_DOC: BlueprintDoc = { id: CHILD_ID, title: 'Child', entry: 'child-entry', graph: CHILD_GRAPH }
const CHILD_SCENARIO: GameScenario = { version: 'game-video.graph.v1', graph: CHILD_GRAPH }

function activateChild(selectedNodeId: string | null): void {
  useGraphScenario.setState({
    game: 'game-nodia-fighting',
    demo: CHILD_SCENARIO,
    blueprints: { [MAIN_ID]: MAIN_DOC, [CHILD_ID]: CHILD_DOC },
    mainBlueprintId: MAIN_ID,
    activeBlueprintId: CHILD_ID,
    graph: CHILD_GRAPH,
    meta: {},
    selectedNodeId,
    booted: true,
  })
}

describe('GraphStudio 试玩当前蓝图', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ versions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('alert', vi.fn())
    useKinoVideoResources.mockReturnValue({
      items: [], total: 0, loading: false, error: null, generation: 0, refresh: vi.fn(),
    })
    useProjectAssets.mockReturnValue({ items: [], loading: false, error: null, generation: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('主蓝图不显示「试玩当前蓝图」（整页试玩已覆盖主入口）', () => {
    useGraphScenario.setState({
      game: 'game-nodia-fighting',
      demo: { version: 'game-video.graph.v1', graph: MAIN_GRAPH },
      blueprints: { [MAIN_ID]: MAIN_DOC, [CHILD_ID]: CHILD_DOC },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: MAIN_ID,
      graph: MAIN_GRAPH,
      meta: {},
      selectedNodeId: null,
      booted: true,
    })
    render(<GraphStudio scenario={{ version: 'game-video.graph.v1', graph: MAIN_GRAPH }} />)
    expect(screen.queryByRole('button', { name: '试玩当前蓝图' })).toBeNull()
    expect(screen.queryByTestId('play-current-blueprint')).toBeNull()
  })

  it('从当前子蓝图声明的入口开跑，而不是节点数组首位', async () => {
    activateChild(null)
    render(<GraphStudio scenario={CHILD_SCENARIO} />)

    fireEvent.click(screen.getByTestId('play-current-blueprint'))

    const overlay = await waitFor(() => screen.getByTestId('play-overlay'))
    expect(overlay).toHaveTextContent('子蓝图入口')
    expect(overlay).not.toHaveTextContent('旁支节点')
  })

  it('从节点试玩之后再点它，回到入口且「重开」不再钉在那个节点', async () => {
    activateChild('child-stray')
    render(<GraphStudio scenario={CHILD_SCENARIO} />)

    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toHaveTextContent('旁支节点'))

    fireEvent.click(screen.getByTestId('play-current-blueprint'))
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toHaveTextContent('子蓝图入口'))

    fireEvent.click(screen.getByTitle('重开'))
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toHaveTextContent('子蓝图入口'))
  })

  it('右下角把手可拖拽改变浮层宽高，且不小于下限', async () => {
    activateChild(null)
    render(<GraphStudio scenario={CHILD_SCENARIO} />)

    fireEvent.click(screen.getByTestId('play-current-blueprint'))
    const overlay = await waitFor(() => screen.getByTestId('play-overlay'))
    const stage = screen.getByTestId('play-overlay-stage')
    expect(overlay.style.width).toBe('320px')
    expect(stage.style.height).toBe('180px')

    const grip = screen.getByTestId('play-overlay-resize')
    fireEvent.pointerDown(grip, { button: 0, pointerId: 5, clientX: 500, clientY: 400 })
    fireEvent.pointerMove(grip, { pointerId: 5, clientX: 600, clientY: 480 })
    fireEvent.pointerUp(grip, { pointerId: 5, clientX: 600, clientY: 480 })

    expect(overlay.style.width).toBe('420px')
    expect(stage.style.height).toBe('260px')

    // 继续往左上拽过头：卡在下限，不会缩成一条缝。
    fireEvent.pointerDown(grip, { button: 0, pointerId: 6, clientX: 600, clientY: 480 })
    fireEvent.pointerMove(grip, { pointerId: 6, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(grip, { pointerId: 6, clientX: 0, clientY: 0 })

    expect(overlay.style.width).toBe('260px')
    expect(stage.style.height).toBe('120px')
  })

  it('取消节点选中不关闭蓝图试玩浮层（它不属于节点配置面板）', async () => {
    activateChild('child-stray')
    render(<GraphStudio scenario={CHILD_SCENARIO} />)

    fireEvent.click(screen.getByTestId('play-current-blueprint'))
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toBeTruthy())

    act(() => { useGraphScenario.getState().setSelectedNode(null) })

    await waitFor(() => expect(screen.queryByTestId('node-inspector-root')).toBeNull())
    expect(screen.getByTestId('play-overlay')).toBeTruthy()
  })

  it('倍速下拉的四档文案是可区分的倍数，且选中即生效', async () => {
    activateChild(null)
    render(<GraphStudio scenario={CHILD_SCENARIO} />)

    fireEvent.click(screen.getByTestId('play-current-blueprint'))
    const select = await waitFor(() => screen.getByRole('combobox', { name: '试玩倍速' }) as HTMLSelectElement)

    expect([...select.options].map((option) => option.textContent))
      .toEqual(['0.5X', '1X', '1.5X', '2X'])
    expect(select.value).toBe('1')

    fireEvent.change(select, { target: { value: '2' } })
    await waitFor(() => expect(select.value).toBe('2'))
  })

  it('切换蓝图时关闭试玩浮层，下一张图要自己再点一次', async () => {
    const other: BlueprintDoc = {
      id: 'bp-other',
      title: 'Other',
      entry: 'other-entry',
      graph: {
        nodes: [{
          id: 'other-entry',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: '另一张入口', durationMs: 1_000 },
        }],
        edges: [],
      },
    }
    activateChild(null)
    useGraphScenario.setState((st) => ({
      blueprints: { ...st.blueprints, [other.id]: other },
    }))
    render(<GraphStudio scenario={CHILD_SCENARIO} />)

    fireEvent.click(screen.getByTestId('play-current-blueprint'))
    await waitFor(() => expect(screen.getByTestId('play-overlay')).toBeTruthy())

    act(() => { useGraphScenario.getState().selectBlueprint(other.id) })

    await waitFor(() => expect(screen.queryByTestId('play-overlay')).toBeNull())
  })
})
