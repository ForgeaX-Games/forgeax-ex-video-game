import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameScenario } from '@/runtime/core/schema/graph-schema'
import {
  applyHostInit,
  releaseHostInit,
  resetHostInjectionForTests,
} from '@/editor/host-init'
import { resetHostInitForTests } from '../../../lib/forgeax-http'
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
  setExtensionHost: vi.fn(),
  clearExtensionHost: vi.fn(),
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(),
}))

vi.mock('../../assets/kinoVideoCacheStore', () => ({
  useKinoVideoResources,
  useKinoVideoCache: { getState: () => ({ byGame: {} }) },
}))
vi.mock('../../assets/projectAssetCacheStore', () => ({ useProjectAssets }))

const SCENARIO: GameScenario = {
  version: 'game-video.graph.v1',
  graph: {
    nodes: [
      {
        id: 'intro',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: 'Intro' },
      },
      {
        id: 'second',
        type: 'perf',
        position: { x: 240, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: 'Second' },
      },
    ],
    edges: [],
  },
}

const MAIN_ID = 'bp-main'
const MAIN_DOC: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'intro', graph: SCENARIO.graph }

describe('GraphStudio · external inspectorEl', () => {
  let canvasHost: HTMLDivElement
  let inspectorEl: HTMLDivElement
  let onNodeSelect: ReturnType<typeof vi.fn<(nodeId: string | null) => void>>

  beforeEach(() => {
    window.localStorage.clear()
    useKinoVideoResources.mockReturnValue({
      items: [], total: 0, loading: false, error: null, generation: 0, refresh: vi.fn(),
    })
    useProjectAssets.mockReturnValue({
      items: [], loading: false, error: null, generation: 0,
    })
    useGraphScenario.setState({
      game: 'game-nodia-fighting',
      demo: SCENARIO,
      blueprints: { [MAIN_ID]: MAIN_DOC },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: MAIN_ID,
      graph: SCENARIO.graph,
      meta: {},
      selectedNodeId: 'intro',
      booted: true,
    })

    canvasHost = document.createElement('div')
    inspectorEl = document.createElement('div')
    document.body.append(canvasHost, inspectorEl)
    onNodeSelect = vi.fn()
    applyHostInit({ inspectorEl, onNodeSelect })
  })

  afterEach(() => {
    cleanup()
    releaseHostInit()
    resetHostInitForTests()
    resetHostInjectionForTests()
    canvasHost.remove()
    inspectorEl.remove()
  })

  it('renders the inspector into inspectorEl and keeps it out of the canvas host', () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    expect(inspectorEl.querySelector('[data-testid="node-inspector-root"]')).toBeTruthy()
    expect(canvasHost.querySelector('[data-testid="node-inspector-root"]')).toBeNull()
    expect(canvasHost.querySelector('.gv-node-panel')).toBeNull()
    // Host chrome already owns Agent | 节点编辑 — the embedded NodePanelTabBar
    // (Agent / {name}调试面板 / ✕) must not duplicate it in the external slot.
    expect(inspectorEl.querySelector('[aria-label="节点面板页签"]')).toBeNull()
    expect(screen.queryByText('Intro调试面板')).toBeNull()
    expect(inspectorEl.querySelector('[data-testid="node-config-tab-content"]')).toBeTruthy()
    expect(screen.getByTestId('node-panel-columns').style.gridTemplateColumns)
      .toBe('minmax(0, var(--gv-preview-w)) minmax(0, 1fr)')
  })

  it('notifies onNodeSelect on select and clear; empty state stays in the slot', async () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    await waitFor(() => expect(onNodeSelect).toHaveBeenCalledWith('intro'))

    act(() => {
      useGraphScenario.getState().setSelectedNode(null)
    })

    await waitFor(() => expect(onNodeSelect).toHaveBeenCalledWith(null))
    expect(inspectorEl.querySelector('[data-testid="node-inspector-empty"]')).toBeTruthy()
    expect(canvasHost.querySelector('[data-testid="node-inspector-empty"]')).toBeNull()
    expect(inspectorEl.querySelector('[data-testid="node-inspector-root"]')).toBeNull()
  })

  it('re-notifies the host when the already-selected node is clicked again', async () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })
    await waitFor(() => expect(onNodeSelect).toHaveBeenCalledWith('intro'))
    onNodeSelect.mockClear()

    fireEvent.click(canvasHost.querySelector<HTMLElement>('.react-flow__node[data-id="intro"]')!)

    expect(onNodeSelect).toHaveBeenCalledWith('intro')
    expect(onNodeSelect).toHaveBeenCalledTimes(1)
  })

  it('stays silent when mounting with no selection (host tab must not be kicked)', async () => {
    act(() => {
      useGraphScenario.getState().setSelectedNode(null)
    })

    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    await waitFor(() =>
      expect(inspectorEl.querySelector('[data-testid="node-inspector-empty"]')).toBeTruthy(),
    )
    expect(onNodeSelect).not.toHaveBeenCalled()
  })

  it('does not re-notify on remount, only on real transitions', async () => {
    act(() => {
      useGraphScenario.getState().setSelectedNode(null)
    })

    const first = render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })
    await waitFor(() =>
      expect(inspectorEl.querySelector('[data-testid="node-inspector-empty"]')).toBeTruthy(),
    )
    first.unmount()

    const secondHost = document.createElement('div')
    document.body.append(secondHost)
    render(<GraphStudio scenario={SCENARIO} />, { container: secondHost })
    await waitFor(() =>
      expect(inspectorEl.querySelector('[data-testid="node-inspector-empty"]')).toBeTruthy(),
    )
    expect(onNodeSelect).not.toHaveBeenCalled()

    act(() => {
      useGraphScenario.getState().setSelectedNode('second')
    })
    await waitFor(() => expect(onNodeSelect).toHaveBeenCalledWith('second'))
    expect(onNodeSelect).toHaveBeenCalledTimes(1)
    secondHost.remove()
  })
})
