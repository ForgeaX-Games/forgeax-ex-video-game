/**
 * 「哪些试玩表面真的会出声」—— 每个能按下 ▶ 的地方都得挂 `BgmPlayer`，否则作者在检视器里
 * 配好 `data.bgm`、按下重开、什么都没听到，读起来就是「这功能坏了」。
 *
 * 断言面 = `document` 里有没有床轨音频元素（`BgmPlayer` 自己 createElement 并挂 body，
 * 见该文件注释）；不碰音量/淡变，那些由 `BgmPlayer.test.tsx` 钉。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameScenario } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphPlaySurface } from '../GraphPlaySurface'
import { GraphStudio } from '../GraphStudio'

const useKinoVideoResources = vi.hoisted(() => vi.fn())
const useProjectAssets = vi.hoisted(() => vi.fn())

vi.mock('../../assets/kinoVideoCacheStore', () => ({
  useKinoVideoResources,
  useKinoVideoCache: { getState: () => ({ byGame: {} }) },
}))
// 本件只问「有没有出声」；素材查询（视频/音频）都是别处的事，异步 hydration 留在这儿只会
// 变成 act(...) 警告。
vi.mock('../../assets/projectAssetCacheStore', () => ({ useProjectAssets }))
vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => ({
    context: {
      gameId: 'game-nodia-fighting',
      endpoints: { gamePackage: 'https://host.test/__extension__/v1/games/game-nodia-fighting/package' },
    },
    extension: {
      fetch: vi.fn(),
      url: (path: string) => `https://host.test/extension/runtime/${path.replace(/^\/+/, '')}`,
    },
  }),
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(),
}))

const BED = 'a-aud-story'

const SCENARIO: GameScenario = {
  version: 'game-video.graph.v1',
  bgm: { ref: BED, loop: true },
  graph: {
    nodes: [{
      id: 'intro',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: 'Intro', durationMs: 5000 },
    }],
    edges: [],
  },
}

const MAIN_ID = 'bp-main'
const MAIN_DOC: BlueprintDoc = { id: MAIN_ID, title: 'Main', entry: 'intro', graph: SCENARIO.graph }

/** 床轨住在文档级 meta（`metaFromDocument` 把 `scn.bgm` 收进 meta），不在图里。 */
function seedGraphStore(): void {
  useGraphScenario.setState({
    game: 'game-nodia-fighting',
    demo: SCENARIO,
    blueprints: { [MAIN_ID]: MAIN_DOC },
    mainBlueprintId: MAIN_ID,
    activeBlueprintId: MAIN_ID,
    graph: SCENARIO.graph,
    meta: { bgm: SCENARIO.bgm },
    selectedNodeId: 'intro',
    booted: true,
  })
}

const decks = () => [...document.querySelectorAll('audio[data-gv-bgm="active"]')]

describe('试玩表面挂载床轨', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ versions: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })))
    useKinoVideoResources.mockReset()
    useKinoVideoResources.mockReturnValue({
      items: [], total: 0, loading: false, error: null, generation: 0, refresh: vi.fn(),
    })
    useProjectAssets.mockReset()
    useProjectAssets.mockReturnValue({
      items: [], loading: false, error: null, generation: 0,
    })
    seedGraphStore()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('GraphPlaySurface：整表面即试玩，进场就起文档床', () => {
    render(<GraphPlaySurface scenario={SCENARIO} />)
    expect(decks().map((el) => el.getAttribute('src'))).toEqual([
      '/api/v1/kino/resources/a-aud-story/content?game_id=game-nodia-fighting',
    ])
    // 默认音量 50：进场就有声，床轨音量按主音量缩放。
    const deck = decks()[0] as HTMLAudioElement
    expect(deck.muted).toBe(false)
    expect(deck.volume).toBeCloseTo(0.5)

    fireEvent.click(screen.getByTestId('play-volume-trigger'))
    const slider = screen.getByTestId('play-volume-slider')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(deck.muted).toBe(true)

    fireEvent.change(slider, { target: { value: '100' } })
    expect(deck.muted).toBe(false)
    expect(deck.volume).toBeCloseTo(1)
  })

  // 画布侧的试玩浮层才是作者真正的编辑闭环（左边配 bgm、右边按重开）；它不挂 BgmPlayer 的话，
  // 唯一能听到声的地方是另开的整页试玩，作者不会知道要去那儿。
  it('GraphStudio：节点「从此试玩」在独立试玩浮层播放床轨，关闭即停止', () => {
    render(<GraphStudio scenario={SCENARIO} />)
    expect(decks()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: '▶ 从此试玩' }))
    expect(decks().map((el) => el.getAttribute('src'))).toEqual([
      '/api/v1/kino/resources/a-aud-story/content?game_id=game-nodia-fighting',
    ])
    const deck = decks()[0] as HTMLAudioElement
    expect(deck.muted).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '关闭视频原声' }))
    expect(deck.muted).toBe(true)

    fireEvent.click(screen.getByTitle('隐藏'))
    expect(decks()).toHaveLength(0)
  })
})
