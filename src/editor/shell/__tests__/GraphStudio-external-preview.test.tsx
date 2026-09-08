import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameScenario } from '@/runtime/core/schema/graph-schema'
import {
  applyHostInit,
  releaseHostInit,
  resetHostInjectionForTests,
  setInspectorActive,
} from '@/editor/host-init'
import { resetHostInitForTests } from '../../../lib/forgeax-http'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useVideoGenerationPanel } from '../../persist/videoGenerationPanelStore'
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
    ],
    edges: [],
  },
}

const MAIN_ID = 'bp-main'
const MAIN_DOC: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'intro', graph: SCENARIO.graph }

/**
 * Splitting the node panel across two host slots is what lets the config form
 * track a resizable sidebar: the preview surface is no longer a column inside
 * the form's container (Figma 14597:20310).
 */
describe('GraphStudio · external previewEl', () => {
  let canvasHost: HTMLDivElement
  let inspectorEl: HTMLDivElement
  let previewEl: HTMLDivElement
  let onPreviewOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>
  let onInspectorTabChange: ReturnType<
    typeof vi.fn<(tab: { label: string, selected: boolean }) => void>
  >

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
    useVideoGenerationPanel.setState({
      open: false,
      returnView: 'graph',
      nodeTarget: null,
    })

    canvasHost = document.createElement('div')
    inspectorEl = document.createElement('div')
    previewEl = document.createElement('div')
    document.body.append(canvasHost, inspectorEl, previewEl)
    onPreviewOpenChange = vi.fn()
    onInspectorTabChange = vi.fn()
    applyHostInit({ inspectorEl, previewEl, onPreviewOpenChange, onInspectorTabChange })
  })

  afterEach(() => {
    cleanup()
    releaseHostInit()
    resetHostInitForTests()
    resetHostInjectionForTests()
    canvasHost.remove()
    inspectorEl.remove()
    previewEl.remove()
  })

  /** 插槽是通用的，蓝图得自己命名页签，不能落到宿主兜底的「节点编辑」。 */
  it('names the slot tab after the selected node', async () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    await waitFor(() =>
      expect(onInspectorTabChange).toHaveBeenCalledWith({ label: 'Intro调试面板', selected: true }),
    )

    act(() => {
      useGraphScenario.getState().setSelectedNode(null)
    })

    await waitFor(() =>
      expect(onInspectorTabChange).toHaveBeenLastCalledWith({ label: '节点调试面板', selected: false }),
    )
  })

  /**
   * 拉片挂在画布上，宿主藏不掉；Agent 页签在前时节点面板整个不可见，
   * 抽屉入口留着就成了一个改不了任何可见内容的按钮。
   */
  it('hides the toggle pill while the host shows its Agent tab', async () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })
    expect(canvasHost.querySelector('button[aria-label="展开预览区"]')).toBeTruthy()

    act(() => setInspectorActive(false))
    await waitFor(() =>
      expect(canvasHost.querySelector('button[aria-label="展开预览区"]')).toBeNull(),
    )
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(false)

    act(() => setInspectorActive(true))
    await waitFor(() =>
      expect(canvasHost.querySelector('button[aria-label="展开预览区"]')).toBeTruthy(),
    )
  })

  it('floats the toggle pill on the canvas edge, not inside either host slot', () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    const pill = canvasHost.querySelector<HTMLElement>('button[aria-label="展开预览区"]')
    expect(pill).toBeTruthy()
    // Anchored to the canvas' right inner edge so a collapsed preview column can
    // stay zero-width instead of reserving a rail over the blueprint nodes.
    expect(pill?.style.right).toBe('0px')
    expect(pill?.style.left).toBe('')
    expect(previewEl.querySelector('button[aria-label="展开预览区"]')).toBeNull()
    expect(inspectorEl.querySelector('button[aria-label="展开预览区"]')).toBeNull()
  })

  it('renders the form full-width with no preview column beside it', () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    const columns = inspectorEl.querySelector<HTMLElement>('[data-testid="node-panel-columns"]')
    expect(columns).toBeTruthy()
    expect(columns?.style.display).toBe('flex')
    expect(columns?.style.gridTemplateColumns).toBe('')
    expect(inspectorEl.querySelector('[data-testid="node-preview-column"]')).toBeNull()

    const form = inspectorEl.querySelector<HTMLElement>('[data-testid="node-inspector-column"]')
    expect(form?.style.minWidth).toBe('0')
    expect(form?.style.flex).toBe('1 1 auto')
  })

  it('reports drawer state to the host and mounts the preview into previewEl', async () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    await waitFor(() => expect(onPreviewOpenChange).toHaveBeenCalledWith(false))
    expect(previewEl.querySelector('[data-testid="node-preview-column"]')).toBeNull()

    act(() => {
      canvasHost.querySelector<HTMLButtonElement>('button[aria-label="展开预览区"]')?.click()
    })

    await waitFor(() => expect(onPreviewOpenChange).toHaveBeenCalledWith(true))
    expect(previewEl.querySelector('[data-testid="node-preview-column"]')).toBeTruthy()
    expect(inspectorEl.querySelector('[data-testid="node-preview-column"]')).toBeNull()
  })

  it('uses the canvas pill to close the drawer while node video generation is active', async () => {
    useVideoGenerationPanel.getState().openForNode(
      { gameId: 'game-nodia-fighting', blueprintId: MAIN_ID, nodeId: 'intro' },
      'graph',
    )
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    const pill = canvasHost.querySelector<HTMLButtonElement>('button[aria-label="收起预览区"]')
    expect(pill).toBeTruthy()

    act(() => pill?.click())

    await waitFor(() => expect(useVideoGenerationPanel.getState().open).toBe(false))
    expect(window.localStorage.getItem('game-video.nodePanel.previewOpen')).toBe('0')
    expect(onPreviewOpenChange).toHaveBeenLastCalledWith(false)
  })

  /**
   * Leaving the blueprint (界面 / 资产库 / …) unmounts this view while the host
   * column keeps whatever width it was last told. Without handing the column
   * back, an expanded preview squeezes the next view's middle area.
   */
  it('hands the preview column and the slot tab back to the host on unmount', async () => {
    const view = render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    act(() => {
      canvasHost.querySelector<HTMLButtonElement>('button[aria-label="展开预览区"]')?.click()
    })
    await waitFor(() => expect(onPreviewOpenChange).toHaveBeenCalledWith(true))

    onPreviewOpenChange.mockClear()
    onInspectorTabChange.mockClear()
    view.unmount()

    expect(onPreviewOpenChange).toHaveBeenCalledWith(false)
    expect(onInspectorTabChange).toHaveBeenCalledWith({ label: '', selected: false })
  })

  /**
   * The host drops the whole slot tab on deselect, so leaving an empty state in
   * the slot would be DOM nobody can reach.
   */
  it('empties both slots when selection clears', async () => {
    render(<GraphStudio scenario={SCENARIO} />, { container: canvasHost })

    act(() => {
      useGraphScenario.getState().setSelectedNode(null)
    })

    await waitFor(() => expect(inspectorEl.childNodes.length).toBe(0))
    expect(inspectorEl.querySelector('[data-testid="node-inspector-empty"]')).toBeNull()
    expect(previewEl.childNodes.length).toBe(0)
    expect(canvasHost.querySelector('button[aria-label="展开预览区"]')).toBeNull()
  })
})
