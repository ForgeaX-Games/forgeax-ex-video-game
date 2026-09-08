import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import type { BlueprintDoc, GameScenario } from '@/runtime/core/schema/graph-schema'
import { disconnect } from '@/authoring/graph/graph-edit'
import { GraphSession } from '@/runtime/core/engine/session'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { setInjectedAcceptReference } from '../../../platform/HostSdkBridge'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())
const useProjectAssets = vi.hoisted(() => vi.fn())
const useAssetCatalog = vi.hoisted(() => vi.fn())
const applyCatalogAsset = vi.hoisted(() => vi.fn(async () => {}))
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
const acceptReference = vi.hoisted(() => vi.fn())

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
  useKinoVideoCache: {
    getState: () => ({
      byGame: {
        'game-nodia-fighting': {
          items: ['intro', 'second'].map((nodeId) => ({
            resource_id: `${nodeId}-video`,
            game_id: 'game-nodia-fighting',
            media_type: 'video',
            name: `${nodeId}.mp4`,
            type: 'UPLOAD',
            url: `https://cdn.test/${nodeId}.mp4`,
            source: 'upload',
            source_meta: {},
            created_at: 1,
            updated_at: 1,
          })),
          total: 2,
          loading: false,
          error: null,
          generation: 1,
        },
      },
    }),
  },
}))
vi.mock('../../assets/projectAssetCacheStore', () => ({ useProjectAssets }))
vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/editor/assets/asset-catalog')>(),
  useAssetCatalog,
}))
vi.mock('@/editor/assets/asset-catalog-client', () => ({
  assetCatalogClient: { apply: applyCatalogAsset },
}))

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

const FOCUS_SCENARIO: GameScenario = {
  version: 'game-video.graph.v1',
  graph: {
    nodes: [{
      id: 'intro',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: {
        name: 'Intro',
        durationMs: 3_000,
        overlayNodes: [{ id: 'mount-hud', overlay: 'hud' }],
        reactions: [{
          when: { type: 'at', ms: 1_000 },
          do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: -20 }] }],
        }],
      },
    }],
    edges: [],
  },
  ui: {
    overlays: {
      hud: {
        id: 'hud',
        title: 'HUD',
        children: [{ id: 'damage', component: 'test.float', window: { startMs: 500, endMs: 2_500 }, trigger: { when: 'enter' }, inputs: { value: 20 } }],
      },
    },
  },
}

describe('GraphStudio 节点配置分栏', { timeout: 10_000 }, () => {
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
    useProjectAssets.mockReturnValue({
      items: [], loading: false, error: null, generation: 0,
    })
    useAssetCatalog.mockReturnValue({
      catalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
        assets: {},
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    applyCatalogAsset.mockClear()
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
      isDraft: false,
    })
  })

  afterEach(() => {
    cleanup()
    acceptReference.mockReset()
    setInjectedAcceptReference(null)
    vi.unstubAllGlobals()
  })

  it('实体规则数值变化时用最新模板重建试玩 session', async () => {
    useGraphScenario.setState({
      meta: {
        entities: {
          player: { id: 'player', attrs: { hpMax: 100 } },
        },
      },
    })
    const start = vi.spyOn(GraphSession.prototype, 'start')
    render(<GraphStudio scenario={SCENARIO} />)
    const startsBeforeRuleChange = start.mock.calls.length

    act(() => {
      useGraphScenario.setState((state) => ({
        meta: {
          ...state.meta,
          entities: {
            player: { id: 'player', attrs: { hpMax: 200 } },
          },
        },
      }))
    })

    await waitFor(() => expect(start.mock.calls.length).toBeGreaterThan(startsBeforeRuleChange))
  })

  it('节点调试面板移除旧入口并保留画布橙色引用入口', () => {
    setInjectedAcceptReference(acceptReference)
    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.queryByRole('button', { name: '🔗 引用' })).toBeNull()
    expect(screen.queryByRole('button', { name: '🎬 生成视频' })).toBeNull()
    expect(document.querySelector('button[aria-label="引用"]')).toBeNull()

    fireEvent.click(document.querySelector<HTMLElement>('.react-flow__node[data-id="intro"]')!)

    const referenceButton = document.querySelector<HTMLButtonElement>('button[aria-label="引用"]')
    expect(referenceButton).toBeTruthy()

    fireEvent.click(referenceButton!)

    expect(acceptReference).toHaveBeenCalledWith(expect.objectContaining({
      refKind: 'game-video.blueprint-node.v1',
      sourceExtensionId: '@forgeax-extension/game-video',
    }))
  })

  it('uses manifest video asset ids from the new catalog in the node video selector', async () => {
    useAssetCatalog.mockReturnValue({
      catalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: { character: {}, scene: {}, video: {
          direct: { id: 'direct', name: '直接生成视频', current: { assetId: 'asset-direct-video' }, history: [{ assetId: 'asset-direct-video', appliedAt: 1 }], createdAt: 1, updatedAt: 1 },
        }, icon: {}, control: {}, audio: {}, font: {} },
        assets: {
          'asset-direct-video': { id: 'asset-direct-video', kind: 'video', name: '直接生成视频', url: 'https://cdn.test/direct.mp4' },
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(document.querySelector<HTMLElement>('.react-flow__node[data-id="intro"]')!)
    const select = screen.getAllByLabelText('演出视频').find((element) => element.tagName === 'SELECT') as HTMLSelectElement
    await waitFor(() => expect(within(select).getByRole('option', { name: '直接生成视频' })).toBeTruthy())
    act(() => useGraphScenario.setState({ isDraft: false }))
    fireEvent.change(select, { target: { value: 'asset-direct-video' } })

    await waitFor(() => expect(applyCatalogAsset).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'asset-direct-video',
      tabKind: 'video',
      mode: 'blueprint',
      target: { kind: 'node-video', blueprintId: 'bp-main', nodeId: 'intro' },
    })))
  })
  it('记忆已有节点的展开状态，但新增节点时强制收起', async () => {
    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
    expect(screen.queryByTestId('node-preview-column')).toBeNull()
    expect(screen.getByTestId('node-inspector-column')).toHaveStyle({ minWidth: '280px' })

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))
    expect(screen.getByTestId('node-panel-columns').style.gridTemplateColumns)
      .toBe('minmax(0, var(--gv-preview-w)) minmax(0, var(--gv-form-w))')
    expect(screen.queryByTitle('拖动调整预览区宽度')).toBeNull()
    expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
    expect(window.localStorage.getItem('game-video.nodePanel.previewOpen')).toBe('1')

    act(() => { useGraphScenario.getState().setSelectedNode('second') })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
      expect(screen.getByTestId('node-preview-column')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '新建节点' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
      expect(screen.queryByTestId('node-preview-column')).toBeNull()
      expect(window.localStorage.getItem('game-video.nodePanel.previewOpen')).toBe('0')
    })
  })

  it('收起预览时保留抽屉内容到 220ms 动画结束', async () => {
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))
    expect(screen.getByTestId('node-panel-columns')).toHaveAttribute('data-preview-open', 'true')
    expect(screen.getByTestId('node-preview-column')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起预览区' }))
    expect(screen.getByTestId('node-panel-columns')).toHaveAttribute('data-preview-open', 'false')
    expect(screen.getByTestId('node-preview-column')).toBeTruthy()

    await waitFor(
      () => expect(screen.queryByTestId('node-preview-column')).toBeNull(),
      { timeout: 500 },
    )
  })

  it('预览抽屉开合不改变右侧配置列的轨道与占位', async () => {
    render(<GraphStudio scenario={SCENARIO} />)

    const columns = screen.getByTestId('node-panel-columns')
    const collapsedTracks = columns.style.gridTemplateColumns
    expect(screen.getByTestId('node-inspector-column')).toHaveStyle({ gridColumn: '2' })

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))
    expect(columns.style.gridTemplateColumns).toBe(collapsedTracks)
    expect(screen.getByTestId('node-inspector-column')).toHaveStyle({ gridColumn: '2' })

    fireEvent.click(screen.getByRole('button', { name: '收起预览区' }))
    expect(columns.style.gridTemplateColumns).toBe(collapsedTracks)
    await waitFor(
      () => expect(screen.queryByTestId('node-preview-column')).toBeNull(),
      { timeout: 500 },
    )
    expect(columns.style.gridTemplateColumns).toBe(collapsedTracks)
    expect(screen.getByTestId('node-inspector-column')).toHaveStyle({ gridColumn: '2' })
  })

  it('用裁切层揭开固定最终宽度的预览内容', () => {
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))

    expect(screen.getByTestId('node-preview-column')).toHaveStyle({
      gridColumn: '1',
      overflow: 'hidden',
    })
    const content = screen.getByTestId('node-preview-content')
    expect(content).toHaveStyle({
      position: 'absolute',
      right: '0px',
    })
    expect(content.style.width).toBe('var(--gv-preview-target-w)')
  })

  it('切换节点时保持节点预览的声音开关', async () => {
    const videoScenario: GameScenario = {
      ...SCENARIO,
      graph: {
        ...SCENARIO.graph,
        nodes: SCENARIO.graph.nodes.map((node) => ({
          ...node,
          data: { ...node.data, media: { kind: 'VIDEO', ref: `${node.id}-video` } },
        })),
      },
    }
    window.localStorage.setItem('game-video.nodePanel.previewOpen', '1')
    useGraphScenario.setState({
      demo: videoScenario,
      blueprints: { [MAIN_ID]: { ...MAIN_DOC, graph: videoScenario.graph } },
      graph: videoScenario.graph,
      selectedNodeId: 'intro',
    })

    const { container } = render(<GraphStudio scenario={videoScenario} />)
    const firstVideo = await waitFor(() => container.querySelector<HTMLVideoElement>('.nps-frame video')!)
    expect(firstVideo.muted).toBe(true)
    Object.defineProperty(firstVideo, 'currentTime', { configurable: true, value: 4.2 })

    fireEvent.click(screen.getByRole('button', { name: '取消静音' }))
    await waitFor(() => {
      expect(firstVideo.muted).toBe(false)
      expect(screen.getByRole('button', { name: '静音' })).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('rf__node-second'))
    const secondVideo = await waitFor(() => {
      const video = container.querySelector<HTMLVideoElement>('.nps-frame video')
      expect(video).not.toBe(firstVideo)
      return video!
    })
    expect(secondVideo.muted).toBe(false)
    expect(secondVideo.currentTime).toBe(0)
    expect(screen.getByRole('button', { name: '静音' })).toBeTruthy()
  })

  it('试玩浮层与已展开的节点视频预览互斥，关闭后恢复预览', async () => {
    window.localStorage.setItem('game-video.nodePanel.previewOpen', '1')
    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.getByTestId('node-preview-column')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))

    await waitFor(() => {
      expect(screen.getByTitle('隐藏')).toBeTruthy()
      expect(screen.queryByTestId('node-preview-column')).toBeNull()
      expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
    })
    expect(window.localStorage.getItem('game-video.nodePanel.previewOpen')).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: '展开预览区' }))
    await waitFor(() => {
      expect(screen.queryByTitle('隐藏')).toBeNull()
      expect(screen.getByTestId('node-preview-column')).toBeTruthy()
      expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))
    await waitFor(() => expect(screen.getByTitle('隐藏')).toBeTruthy())
    fireEvent.click(screen.getByTitle('隐藏'))
    await waitFor(() => {
      expect(screen.queryByTitle('隐藏')).toBeNull()
      expect(screen.getByTestId('node-preview-column')).toBeTruthy()
      expect(screen.getByRole('button', { name: '收起预览区' })).toBeTruthy()
    })
    expect(window.localStorage.getItem('game-video.nodePanel.previewOpen')).toBe('1')
  })

  it('关闭节点配置面板时同步关闭从此试玩浮层', async () => {
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))
    await waitFor(() => expect(screen.getByTitle('隐藏')).toBeTruthy())

    fireEvent.click(screen.getByTitle('关闭'))
    await waitFor(() => {
      expect(screen.queryByText('Intro调试面板')).toBeNull()
      expect(screen.queryByTitle('隐藏')).toBeNull()
    })
  })

  it('切换节点后时间轴缩放重置为 1×（不沿用上节点的缩放残留）', async () => {
    window.localStorage.setItem('game-video.nodePanel.previewOpen', '1')
    const { container } = render(<GraphStudio scenario={SCENARIO} />)
    const canvas = () => container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!

    // jsdom 视口宽 0 → 画布宽 = zoom × 1px，放大后不再是 1px。
    fireEvent.click(screen.getByRole('button', { name: '时间轴放大' }))
    expect(canvas().style.width).not.toBe('1px')
    expect(screen.getByRole('slider', { name: '时间轴缩放' })).toHaveAttribute('aria-valuenow', '1.2')

    act(() => { useGraphScenario.getState().setSelectedNode('second') })
    await waitFor(() => expect(canvas().style.width).toBe('1px'))
    expect(screen.getByRole('slider', { name: '时间轴缩放' })).toHaveAttribute('aria-valuenow', '1')
  })

  it('一级页签在 Agent 空态与节点调试面板间切换', () => {
    render(<GraphStudio scenario={SCENARIO} />)

    // 默认选中调试面板页签；Agent 页签未选中且无空态占位。
    expect(screen.getByRole('tab', { name: 'Intro调试面板' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.queryByTestId('node-panel-agent')).toBeNull()

    // 切到 Agent：显示空态占位；配置内容仅隐藏不卸载，组件本地状态保留。
    fireEvent.click(screen.getByRole('tab', { name: 'Agent' }))
    expect(screen.getByTestId('node-panel-agent')).toBeTruthy()
    expect(screen.getByTestId('node-config-tab-content').style.display).toBe('none')

    // 切回调试面板：内容恢复可见。
    fireEvent.click(screen.getByRole('tab', { name: 'Intro调试面板' }))
    expect(screen.queryByTestId('node-panel-agent')).toBeNull()
    expect(screen.getByTestId('node-config-tab-content').style.display).toBe('contents')
  })

  it('预览展开时一级页签栏仍只属于右侧表单列', () => {
    window.localStorage.setItem('game-video.nodePanel.previewOpen', '1')
    render(<GraphStudio scenario={SCENARIO} />)

    // 预览列展开时，页签栏仍挂在右侧表单列内，不横跨预览区。
    expect(screen.getByTestId('node-preview-column')).toBeTruthy()
    expect(screen.getByTestId('node-inspector-column').querySelector('[role="tablist"]')).toBeTruthy()
    expect(screen.getByTestId('node-preview-column').querySelector('[role="tablist"]')).toBeNull()
  })

  it('按时间轴像素比例在当前指针前添加不重叠的结算', async () => {
    window.localStorage.setItem('game-video.nodePanel.previewOpen', '1')
    useGraphScenario.setState({
      demo: FOCUS_SCENARIO,
      blueprints: { [MAIN_ID]: { ...MAIN_DOC, graph: FOCUS_SCENARIO.graph } },
      graph: FOCUS_SCENARIO.graph,
      meta: { ui: FOCUS_SCENARIO.ui },
      selectedNodeId: 'intro',
    })
    const { container } = render(<GraphStudio scenario={FOCUS_SCENARIO} />)
    const timeline = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(container.querySelector('.gc-mtimeline-ruler')!, {
      pointerId: 7,
      clientX: 100,
    })
    fireEvent.pointerUp(timeline, { pointerId: 7, clientX: 100 })
    // 新增结算走类型选择下拉：先开「添加结算」，再选「时间轴结算」。
    fireEvent.click(screen.getByRole('button', { name: '添加结算' }))
    fireEvent.click(
      within(screen.getByRole('listbox', { name: '添加结算' })).getByRole('button', { name: '时间轴结算' }),
    )

    await waitFor(() => {
      const reactions = useGraphScenario.getState().graph.nodes[0]?.data.reactions ?? []
      // 3s / 200px，14px 的视觉间距换算为 210ms：1500ms → 1290ms。
      expect(reactions.at(-1)?.when).toEqual({ type: 'at', ms: 1_290 })
    })
    await waitFor(() => {
      expect(container.querySelector('.gc-point-mark.is-lifecycle.is-selected')).toBeTruthy()
      expect(container.querySelector('[data-lifecycle-effect-index][data-selected="true"]')).toBeTruthy()
    })
  })

  it('配置面板打开时屏蔽 Delete，关闭面板后恢复删除', async () => {
    useGraphScenario.setState({ selectedNodeId: null })
    render(<GraphStudio scenario={SCENARIO} />)

    fireEvent.click(screen.getByTestId('rf__node-intro'))
    expect(screen.getByText('Intro调试面板')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })
    fireEvent.keyUp(document, { key: 'Delete', code: 'Delete' })
    expect(useGraphScenario.getState().graph.nodes.some((node) => node.id === 'intro')).toBe(true)
    expect(confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTitle('关闭'))
    await waitFor(() => { expect(screen.queryByText('Intro调试面板')).toBeNull() })

    fireEvent.keyDown(document, { key: 'Delete', code: 'Delete' })
    fireEvent.keyUp(document, { key: 'Delete', code: 'Delete' })
    await waitFor(() => {
      expect(useGraphScenario.getState().graph.nodes.some((node) => node.id === 'intro')).toBe(false)
    })
    expect(useGraphScenario.getState().blueprints[MAIN_ID]!.entry).toBe('second')
  })

  it('点击预览工作区的其他区域会清空选中态，当前对象自身与配置块除外', async () => {
    window.localStorage.setItem('game-video.nodePanel.previewOpen', '1')
    useGraphScenario.setState({
      demo: FOCUS_SCENARIO,
      blueprints: { [MAIN_ID]: { ...MAIN_DOC, graph: FOCUS_SCENARIO.graph } },
      graph: FOCUS_SCENARIO.graph,
      meta: { ui: FOCUS_SCENARIO.ui },
      selectedNodeId: 'intro',
    })
    const { container } = render(<GraphStudio scenario={FOCUS_SCENARIO} />)

    const clip = await waitFor(() => container.querySelector<HTMLElement>('.gc-mclip.is-mount')!)
    fireEvent.pointerDown(clip, { pointerId: 1, clientX: 10, clientY: 10 })
    await waitFor(() => expect(clip).toHaveClass('is-selected'))

    const mountCard = container.querySelector<HTMLElement>('[data-focus-anchor="mount:mount-hud"]')!
    expect(mountCard.style.outline).not.toBe('')
    fireEvent.pointerDown(mountCard)
    expect(clip).toHaveClass('is-selected')

    const play = screen.getByRole('button', { name: '播放' })
    fireEvent.pointerDown(play)
    fireEvent.click(play)
    await waitFor(() => {
      expect(clip).not.toHaveClass('is-selected')
      expect(mountCard.style.outline).toBe('')
    })

    const settlement = screen.getByRole('slider', { name: /结算 · ent-player\.hp add -20/ })
    fireEvent.pointerDown(settlement, { pointerId: 2, clientX: 20, clientY: 20 })
    await waitFor(() => expect(settlement.closest('.gc-point-mark')).toHaveClass('is-selected'))
    fireEvent.pointerDown(container.querySelector('.gc-mtimeline-canvas')!, { pointerId: 3, clientX: 200, clientY: 200 })
    await waitFor(() => expect(settlement.closest('.gc-point-mark')).not.toHaveClass('is-selected'))
  })

  it('下钻子流程后添加节点只写入当前子图', async () => {
    const childEntry = {
      id: 'child-entry', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '子流程入口' },
    }
    const rootGraph = {
      nodes: [{
        id: 'process', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
        data: { name: '回合', subProcess: { entry: childEntry.id, graph: { nodes: [childEntry], edges: [] } } },
      }],
      edges: [],
    }
    const rootScenario: GameScenario = { version: 'game-video.graph.v1', graph: rootGraph }
    useGraphScenario.setState({
      demo: rootScenario,
      blueprints: { [MAIN_ID]: { id: MAIN_ID, title: 'Main', entry: 'process', graph: rootGraph } },
      activeBlueprintId: MAIN_ID,
      graph: rootGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={rootScenario} />)
    // Figma 14947_83595：子流程/子蓝图下钻改为点击标题栏「进入」按钮。
    // jsdom 下 xyflow 节点默认 visibility:hidden，用 title 而非 role 查找以避开 visibility 过滤。
    fireEvent.click(screen.getByTitle('进入子流程'))
    await waitFor(() => expect(screen.getByTestId('rf__node-child-entry')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '新建节点' }))
    await waitFor(() => {
      const savedRoot = useGraphScenario.getState().graph
      expect(savedRoot.nodes.map((node) => node.id)).toEqual(['process'])
      expect(getSubProcess(savedRoot.nodes[0]!.data)!.graph.nodes).toHaveLength(2)
    })
  })

  it('下钻子流程后可以从当前子图节点试玩并重开', async () => {
    const childEntry = {
      id: 'child-play', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
      data: { name: '子流程试玩节点', durationMs: 5000 },
    }
    const rootGraph = {
      nodes: [{
        id: 'process-play', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
        data: { name: '试玩回合', subProcess: { entry: childEntry.id, graph: { nodes: [childEntry], edges: [] } } },
      }],
      edges: [],
    }
    const rootScenario: GameScenario = { version: 'game-video.graph.v1', graph: rootGraph }
    useGraphScenario.setState({
      demo: rootScenario,
      blueprints: { [MAIN_ID]: { id: MAIN_ID, title: 'Main', entry: 'process-play', graph: rootGraph } },
      activeBlueprintId: MAIN_ID,
      graph: rootGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={rootScenario} />)
    // Figma 14947_83595：子流程/子蓝图下钻改为点击标题栏「进入」按钮。
    // jsdom 下 xyflow 节点默认 visibility:hidden，用 title 而非 role 查找以避开 visibility 过滤。
    fireEvent.click(screen.getByTitle('进入子流程'))
    await waitFor(() => expect(screen.getByTestId('rf__node-child-play')).toBeTruthy())
    fireEvent.click(screen.getByTestId('rf__node-child-play'))
    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))

    await waitFor(() => expect(screen.getByText(/试玩 · playing/)).toHaveTextContent('子流程试玩节点'))
    fireEvent.click(screen.getByTitle('重开 · 回到 child-play'))
    await waitFor(() => expect(screen.getByText(/试玩 · playing/)).toHaveTextContent('子流程试玩节点'))
  })

  it('下钻到内嵌子图后通过 Catalog apply 写回显式 graphPath', async () => {
    const childEntry = {
      id: 'child-video', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
      data: { name: '子流程视频节点' },
    }
    const rootGraph = {
      nodes: [{
        id: 'process-video', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [],
        data: { name: '视频子流程', subProcess: { entry: childEntry.id, graph: { nodes: [childEntry], edges: [] } } },
      }],
      edges: [],
    }
    const rootScenario: GameScenario = { version: 'game-video.graph.v1', graph: rootGraph }
    useAssetCatalog.mockReturnValue({
      catalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: { character: {}, scene: {}, video: {
          nested: { id: 'nested', name: '嵌套视频', current: { assetId: 'asset-nested-video' }, history: [{ assetId: 'asset-nested-video', appliedAt: 1 }], createdAt: 1, updatedAt: 1 },
        }, icon: {}, control: {}, audio: {}, font: {} },
        assets: { 'asset-nested-video': { id: 'asset-nested-video', kind: 'video', name: '嵌套视频' } },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    useGraphScenario.setState({
      demo: rootScenario,
      blueprints: { [MAIN_ID]: { id: MAIN_ID, title: 'Main', entry: 'process-video', graph: rootGraph } },
      activeBlueprintId: MAIN_ID,
      graph: rootGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={rootScenario} />)
    fireEvent.click(screen.getByTitle('进入子流程'))
    await waitFor(() => expect(screen.getByTestId('rf__node-child-video')).toBeTruthy())
    fireEvent.click(screen.getByTestId('rf__node-child-video'))
    const select = screen.getAllByLabelText('演出视频').find((element) => element.tagName === 'SELECT') as HTMLSelectElement
    await waitFor(() => expect(within(select).getByRole('option', { name: '嵌套视频' })).toBeTruthy())

    fireEvent.change(select, { target: { value: 'asset-nested-video' } })

    await waitFor(() => expect(applyCatalogAsset).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({ kind: 'node-video', blueprintId: MAIN_ID, nodeId: 'child-video', graphPath: ['process-video'] }),
      mode: 'blueprint',
    })))
    expect(getSubProcess(useGraphScenario.getState().graph.nodes[0]!.data)?.graph.nodes[0]!.data.media).toBeUndefined()
  })

  it('子蓝图入口作为第一个业务节点展示完整演出配置和入口标识', () => {
    const childGraph = {
      nodes: [{
        id: 'child-entry',
        type: 'perf' as const,
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '子蓝图入口' },
      }],
      edges: [],
    }
    const child: BlueprintDoc = { id: 'bp-child', title: 'Child', entry: 'child-entry', graph: childGraph }
    useGraphScenario.setState({
      blueprints: { [MAIN_ID]: MAIN_DOC, [child.id]: child },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: child.id,
      graph: childGraph,
      selectedNodeId: 'child-entry',
    })

    render(<GraphStudio scenario={SCENARIO} />)

    expect(screen.getByRole('button', { name: '展开预览区' })).toBeTruthy()
    expect(screen.queryByTestId('node-preview-column')).toBeNull()
    expect(screen.getByText('演出视频', { selector: 'label > span:first-child' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '播放模式' })).toBeTruthy()
    expect(screen.getByText('界面', { selector: '.ni-section-title' })).toBeTruthy()
    expect(screen.getByText('结算', { selector: '.ni-section-title' })).toBeTruthy()
    expect(screen.queryByText('响应规则', { selector: 'b' })).toBeNull()
    expect(screen.getByLabelText('入口节点')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '🗑 删除节点' }))
    expect(useGraphScenario.getState().blueprints[child.id]!.graph.nodes).toHaveLength(1)
    expect(alert).toHaveBeenCalledWith('入口是当前图唯一的业务节点，不能删除。')
  })

  it('下钻子流程后新增节点和删除边只修改子蓝图', async () => {
    const childGraph = {
      nodes: [
        { id: 'child-entry', type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '入口' } },
        { id: 'child-after', type: 'perf' as const, position: { x: 240, y: 0 }, inputs: [], outputs: [], data: { name: '后续' } },
      ],
      edges: [{ id: 'child-edge', source: 'child-entry', target: 'child-after', sourceHandle: 'default', targetHandle: 'in' }],
    }
    const child: BlueprintDoc = { id: 'bp-child', title: 'Child', entry: 'child-entry', graph: childGraph }
    const mainGraph = {
      nodes: [{
        id: 'container',
        type: 'perf' as const,
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '子流程', subFlowPack: { id: child.id } },
      }],
      edges: [],
    }
    const main: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'container', graph: mainGraph }
    useGraphScenario.setState({
      blueprints: { [main.id]: main, [child.id]: child },
      mainBlueprintId: main.id,
      activeBlueprintId: main.id,
      graph: mainGraph,
      selectedNodeId: null,
    })

    render(<GraphStudio scenario={{ ...SCENARIO, graph: mainGraph }} />)
    // Figma 14947_83595：子流程/子蓝图下钻改为点击标题栏「进入」按钮，
    // 不再依赖双击节点（避免与节点选中/打开配置面板的交互冲突）。
    // jsdom 下 xyflow 节点默认 visibility:hidden，用 title 而非 role 查找以避开 visibility 过滤。
    fireEvent.click(screen.getByTitle('进入子蓝图'))
    await waitFor(() => expect(useGraphScenario.getState().activeBlueprintId).toBe(child.id))

    fireEvent.click(screen.getByRole('button', { name: '新建节点' }))
    await waitFor(() => expect(useGraphScenario.getState().blueprints[child.id]!.graph.nodes).toHaveLength(3))
    expect(useGraphScenario.getState().blueprints[main.id]!.graph).toEqual(mainGraph)

    act(() => useGraphScenario.getState().setGraph((graph) => disconnect(graph, 'child-edge')))
    const state = useGraphScenario.getState()
    expect(state.blueprints[child.id]!.graph.edges).toHaveLength(0)
    expect(state.blueprints[child.id]!.graph.nodes).toHaveLength(3)
    expect(state.blueprints[main.id]!.graph).toEqual(mainGraph)
  })
})
