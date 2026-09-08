import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph, GameScenario } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphPlaySurface } from '../GraphPlaySurface'

const useAssetCatalog = vi.hoisted(() => vi.fn())

vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog,
  }
})

const MAIN_ID = 'bp-main'
const CHILD_ID = 'bp-child'

const MAIN_GRAPH: GameGraph = {
  nodes: [{ id: 'main-entry', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '主入口', durationMs: 1000 } }],
  edges: [],
}
const CHILD_GRAPH: GameGraph = {
  nodes: [
    { id: 'child-stray', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '旁支', durationMs: 1000 } },
    { id: 'child-entry', type: 'perf', position: { x: 240, y: 0 }, inputs: [], outputs: [], data: { name: '子入口', durationMs: 1000 } },
  ],
  edges: [],
}
const MAIN_DOC: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'main-entry', graph: MAIN_GRAPH }
const CHILD_DOC: BlueprintDoc = { id: CHILD_ID, title: 'Child', entry: 'child-entry', graph: CHILD_GRAPH }
const SCENARIO: GameScenario = { version: 'game-video.graph.v1', graph: MAIN_GRAPH }

function seed(): void {
  useGraphScenario.setState({
    game: 'game-nodia-fighting',
    demo: SCENARIO,
    blueprints: { [MAIN_ID]: MAIN_DOC, [CHILD_ID]: CHILD_DOC },
    mainBlueprintId: MAIN_ID,
    activeBlueprintId: CHILD_ID,
    graph: CHILD_GRAPH,
    meta: {},
    booted: true,
  })
}

describe('GraphPlaySurface blueprint switch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    useAssetCatalog.mockReset()
    useAssetCatalog.mockReturnValue({
      catalog: { version: 1, folders: [], placements: {}, entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} }, assets: {} },
      loading: false, error: null, refresh: vi.fn(),
    })
    seed()
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('defaults to main blueprint entry even if activeBlueprintId is a child', async () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    expect(screen.getByTestId('play-blueprint-trigger')).toHaveTextContent('Main')
    await waitFor(() => expect(screen.getByText('主入口')).toBeInTheDocument())
  })

  it('lists all top-level blueprints and switches session to selected entry', async () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    fireEvent.click(screen.getByTestId('play-blueprint-trigger'))
    expect(screen.getByTestId(`play-blueprint-option-${CHILD_ID}`)).toHaveTextContent('Child')
    fireEvent.click(screen.getByTestId(`play-blueprint-option-${CHILD_ID}`))
    await waitFor(() => expect(screen.getByText('子入口')).toBeInTheDocument())
    expect(screen.queryByText('旁支')).not.toBeInTheDocument()
    expect(useGraphScenario.getState().activeBlueprintId).toBe(CHILD_ID)
    expect(screen.getByTestId('play-blueprint-trigger')).toHaveTextContent('Child')

    fireEvent.click(screen.getByTestId('play-blueprint-trigger'))
    fireEvent.click(screen.getByTestId(`play-blueprint-option-${MAIN_ID}`))
    await waitFor(() => expect(screen.getByText('主入口')).toBeInTheDocument())
    expect(useGraphScenario.getState().activeBlueprintId).toBe(CHILD_ID)
  })

  it('restart keeps current play root, not main', async () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    fireEvent.click(screen.getByTestId('play-blueprint-trigger'))
    fireEvent.click(screen.getByTestId(`play-blueprint-option-${CHILD_ID}`))
    await waitFor(() => expect(screen.getByText('子入口')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('play-restart'))
    await waitFor(() => expect(screen.getByText('子入口')).toBeInTheDocument())
  })

  it('shows the video display label on blueprint overlay cards, not the raw media id', async () => {
    const graph: GameGraph = {
      nodes: [{
        id: 'main-entry',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '主入口', durationMs: 1000, media: { kind: 'video', ref: 'catalog-video' } },
      }],
      edges: [],
    }
    useAssetCatalog.mockReturnValue({
      catalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: { character: {}, scene: {}, video: {
          story: { id: 'story', name: '叙事·第1章·上岸', current: { assetId: 'catalog-video' }, history: [{ assetId: 'catalog-video', appliedAt: 1 }], createdAt: 1, updatedAt: 1 },
        }, icon: {}, control: {}, audio: {}, font: {} },
        assets: {
          'catalog-video': { id: 'catalog-video', kind: 'video', name: '叙事·第1章·上岸', url: 'https://media.test/clip.mp4' },
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    useGraphScenario.setState({
      demo: { ...SCENARIO, graph },
      blueprints: { [MAIN_ID]: { id: MAIN_ID, title: 'Main', entry: 'main-entry', graph } },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: MAIN_ID,
      graph,
    })

    render(<GraphPlaySurface scenario={{ ...SCENARIO, graph }} />)
    fireEvent.click(screen.getByTestId('play-blueprint-overlay'))

    await waitFor(() => expect(screen.getByText('叙事·第1章·上岸')).toBeInTheDocument())
    expect(screen.queryByText('catalog-video')).not.toBeInTheDocument()
  })

  it('renders the play controls in bottom chrome and toggles the blueprint overlay', () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)

    const bottomBar = screen.getByTestId('play-bottom-bar')
    expect(bottomBar).toContainElement(screen.getByTestId('play-toggle'))
    expect(bottomBar).toContainElement(screen.getByTestId('play-restart'))
    expect(bottomBar).toContainElement(screen.getByTestId('play-rate-trigger'))
    expect(bottomBar).toContainElement(screen.getByTestId('play-fullscreen'))
    expect(bottomBar.querySelector('select')).toBeNull()

    const overlayTrigger = screen.getByTestId('play-blueprint-overlay')
    expect(overlayTrigger).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(overlayTrigger)
    expect(overlayTrigger).toHaveAttribute('aria-pressed', 'true')
  })

  it('marks the active playback rate in the menu', () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    fireEvent.click(screen.getByTestId('play-rate-trigger'))
    expect(screen.getByTestId('play-rate-option-1')).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByTestId('play-rate-option-2'))
    fireEvent.click(screen.getByTestId('play-rate-trigger'))
    expect(screen.getByTestId('play-rate-option-2')).toHaveAttribute('aria-current', 'true')
  })

  it('marks the rate trigger as selected only when the rate leaves the default', () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    const trigger = screen.getByTestId('play-rate-trigger')
    expect(trigger).toHaveAttribute('data-selected', 'false')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('play-rate-option-2'))
    expect(trigger).toHaveAttribute('data-selected', 'true')

    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('play-rate-option-1'))
    expect(trigger).toHaveAttribute('data-selected', 'false')
  })

  it('shows clip clock for duration-only performance', async () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)

    const time = await screen.findByTestId('play-clip-time')
    expect(time).toHaveTextContent('00:00 / 00:01')
    const bar = screen.getByTestId('play-clip-progress')
    expect(bar).toHaveAttribute('role', 'progressbar')
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0)
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(100)
    fireEvent.click(bar)
    expect(time).toHaveTextContent('00:00 / 00:01')
  })

  it('updates the clip clock from the active video timeupdate event', async () => {
    const videoGraph: GameGraph = {
      nodes: [{
        id: 'video-entry',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '视频入口',
          media: { kind: 'video', ref: 'catalog-video' },
        },
      }],
      edges: [],
    }
    const videoDoc: BlueprintDoc = {
      id: MAIN_ID,
      title: 'Main',
      entry: 'video-entry',
      graph: videoGraph,
    }
    useAssetCatalog.mockReturnValue({
      catalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: { character: {}, scene: {}, video: {
          clip: { id: 'clip', name: 'clip.mp4', current: { assetId: 'catalog-video' }, history: [{ assetId: 'catalog-video', appliedAt: 1 }], createdAt: 1, updatedAt: 1 },
        }, icon: {}, control: {}, audio: {}, font: {} },
        assets: {
          'catalog-video': {
            id: 'catalog-video',
            kind: 'video',
            name: 'clip.mp4',
            url: 'https://media.test/clip.mp4',
          },
        },
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    useGraphScenario.setState({
      demo: { ...SCENARIO, graph: videoGraph },
      blueprints: { [MAIN_ID]: videoDoc },
      mainBlueprintId: MAIN_ID,
      activeBlueprintId: MAIN_ID,
      graph: videoGraph,
    })

    const { container } = render(<GraphPlaySurface scenario={{ ...SCENARIO, graph: videoGraph }} />)
    const video = await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      return element!
    })
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 })
    fireEvent.loadedMetadata(video)
    fireEvent.loadedData(video)
    await waitFor(() => expect(video).toHaveStyle({ opacity: '1' }))
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 2.4 })
    fireEvent.timeUpdate(video)

    await waitFor(() => {
      expect(screen.getByTestId('play-clip-time')).toHaveTextContent('00:02 / 00:10')
      expect(Number(screen.getByTestId('play-clip-progress').getAttribute('aria-valuenow'))).toBeCloseTo(24)
    })

    // 默认音量 50 落到真实 <video> 上：不再默认静音。
    expect(video.volume).toBeCloseTo(0.5)
    fireEvent.click(screen.getByTestId('play-volume-trigger'))
    fireEvent.change(screen.getByTestId('play-volume-slider'), { target: { value: '80' } })
    await waitFor(() => expect(video.volume).toBeCloseTo(0.8))
  })

  it('opens a volume slider that starts at 50 and mutes at zero', () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)

    const trigger = screen.getByTestId('play-volume-trigger')
    expect(trigger).toHaveAttribute('data-muted', 'false')
    expect(screen.queryByTestId('play-volume-slider')).toBeNull()

    fireEvent.click(trigger)
    const slider = screen.getByTestId('play-volume-slider') as HTMLInputElement
    expect(slider.value).toBe('50')

    fireEvent.change(slider, { target: { value: '0' } })
    expect(trigger).toHaveAttribute('data-muted', 'true')

    fireEvent.change(slider, { target: { value: '80' } })
    expect(trigger).toHaveAttribute('data-muted', 'false')
  })

  it('toggles pause without an active highlight and supports Space', () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    const toggle = screen.getByTestId('play-toggle')
    const root = screen.getByTestId('play-surface-root')

    expect(toggle).toHaveAttribute('data-action', 'pause')
    expect(toggle).toHaveAttribute('aria-label', '暂停试玩')
    // 暂停不是「工具开着」：只换图标，不给橙色选中底。
    expect(toggle).toHaveStyle({ background: 'transparent' })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('data-action', 'resume')
    expect(toggle).toHaveAttribute('aria-label', '继续试玩')
    expect(toggle).toHaveStyle({ background: 'transparent' })

    root.focus()
    fireEvent.keyDown(root, { key: ' ', code: 'Space' })
    expect(toggle).toHaveAttribute('data-action', 'pause')
  })

  it('shows play after the session ends and restarts on click', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const shortGraph: GameGraph = {
        nodes: [{
          id: 'short-entry',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: '短片', durationMs: 40 },
        }],
        edges: [],
      }
      const shortDoc: BlueprintDoc = {
        id: MAIN_ID,
        title: 'Main',
        entry: 'short-entry',
        graph: shortGraph,
      }
      useGraphScenario.setState({
        demo: { ...SCENARIO, graph: shortGraph },
        blueprints: { [MAIN_ID]: shortDoc, [CHILD_ID]: CHILD_DOC },
        mainBlueprintId: MAIN_ID,
        activeBlueprintId: MAIN_ID,
        graph: shortGraph,
      })
      render(<GraphPlaySurface scenario={{ ...SCENARIO, graph: shortGraph }} />)

      await waitFor(() => {
        expect(screen.getByTestId('play-toggle')).toHaveAttribute('data-action', 'restart')
      })
      expect(screen.getByTestId('play-toggle')).toHaveAttribute('aria-label', '继续试玩')

      fireEvent.click(screen.getByTestId('play-toggle'))
      await waitFor(() => {
        expect(screen.getByTestId('play-toggle')).toHaveAttribute('data-action', 'pause')
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('requests fullscreen on the play root and exits when already fullscreen', () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    const exitFullscreen = vi.fn(() => Promise.resolve())
    render(<GraphPlaySurface scenario={SCENARIO} />)
    const root = screen.getByTestId('play-surface-root')
    Object.defineProperty(root, 'requestFullscreen', { value: requestFullscreen, configurable: true })
    Object.defineProperty(document, 'exitFullscreen', { value: exitFullscreen, configurable: true })

    fireEvent.click(screen.getByTestId('play-fullscreen'))
    expect(requestFullscreen).toHaveBeenCalledOnce()

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => root })
    fireEvent(document, new Event('fullscreenchange'))
    const fullscreenButton = screen.getByTestId('play-fullscreen')
    expect(fullscreenButton).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(fullscreenButton)
    expect(exitFullscreen).toHaveBeenCalledOnce()

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null })
    fireEvent(document, new Event('fullscreenchange'))
    expect(fullscreenButton).toHaveAttribute('aria-pressed', 'false')
  })
})
