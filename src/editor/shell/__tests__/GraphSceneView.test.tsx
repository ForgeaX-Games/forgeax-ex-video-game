/**
 * 场景目录页与角色目录页是平行的两条线：场景同样有专属工作台视图，
 * 侧栏「场景」根进的是它，而不是通用素材文件夹树。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { GraphSceneView } from '../GraphSceneView'
import { NewSidebar } from '../NewSidebar'

const catalogState = vi.hoisted(() => ({
  scenes: {} as Record<string, Record<string, unknown>>,
  assets: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog: () => ({
      catalog: {
        ...actual.EMPTY_ASSET_CATALOG,
        entities: { ...actual.EMPTY_ASSET_CATALOG.entities, scene: catalogState.scenes },
        assets: catalogState.assets,
      },
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  }
})

vi.mock('../../assets/registry-assets', () => ({
  fetchRegistryAssets: vi.fn(async () => []),
}))
vi.mock('../../assets/assetLibraryClient', () => ({
  createKinoAssetLibraryClient: () => ({}),
  useAssetLibrary: () => ({
    items: [{ id: 'kino-resource-hill', kind: 'image', name: 'Hill', url: 'https://example.com/hill.jpg' }],
  }),
}))
vi.mock('../../assets/useVideoAssets', () => ({
  useVideoAssets: () => ({ items: [] }),
}))
vi.mock('../../assets/project-component-client', () => ({
  deleteProjectComponent: vi.fn(async () => {}),
}))
vi.mock('@/runtime/react/component-host', () => ({
  refreshGameComponents: vi.fn(async () => true),
}))

const initialScenario = useGraphScenario.getState()
const emptyGraph: GameGraph = { nodes: [], edges: [] }
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'entry', graph: emptyGraph }

beforeEach(() => {
  useGraphView.setState({ view: 'ui' })
  useGraphScenario.setState({ booted: true, game: 'demo', meta: {} })
  catalogState.scenes = {}
  catalogState.assets = {}
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  vi.restoreAllMocks()
})

describe('GraphSceneView', () => {
  it('renders the empty catalog without an unstable snapshot loop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => { render(<GraphSceneView />) })

    expect(screen.getByRole('region', { name: '场景资产' })).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(consoleError.mock.calls.flat().join('\n')).not.toMatch(/getSnapshot|Maximum update depth/)
  })

  it('lists declared scenes with their visual description, prompt and preview', async () => {
    catalogState.scenes = {
      hill: { id: 'hill', name: '景阳冈', description: '日暮的荒草山冈', prompt: 'a dusk hillside with tall grass', current: { assetId: 'kino-resource-hill' }, history: [], createdAt: 1, updatedAt: 1 },
    }
    catalogState.assets = {
      'kino-resource-hill': { id: 'kino-resource-hill', kind: 'image', name: 'Hill', url: 'https://example.com/hill.jpg' },
    }

    await act(async () => { render(<GraphSceneView />) })

    expect(screen.getByText('景阳冈')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('日暮的荒草山冈')).toBeTruthy()
    expect(screen.getByText('a dusk hillside with tall grass')).toBeTruthy()
    expect(screen.getByRole('img', { name: '景阳冈 预览' }).getAttribute('src'))
      .toBe('https://example.com/hill.jpg')
  })

  it('marks scenes without a current preview instead of rendering a broken image', async () => {
    catalogState.scenes = {
      hill: { id: 'hill', name: '景阳冈', description: '日暮的荒草山冈', prompt: 'a dusk hillside', history: [], createdAt: 1, updatedAt: 1 },
      palace: { id: 'palace', name: '天宫', description: '云海之上的宫阙', prompt: 'a celestial palace', current: { assetId: 'missing-asset' }, history: [], createdAt: 1, updatedAt: 1 },
    }

    await act(async () => { render(<GraphSceneView />) })

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('尚未生成参考图')).toBeTruthy()
    expect(screen.getByText('参考图暂不可用')).toBeTruthy()
  })
})

describe('NewSidebar scene navigation', () => {
  it('keeps scenes under the unified asset catalog instead of a blueprint-owned root', () => {
    useGraphScenario.setState({
      blueprints: { main },
      mainBlueprintId: 'main',
      activeBlueprintId: 'main',
      graph: emptyGraph,
      game: 'demo',
    })
    render(<NewSidebar />)

    expect(screen.queryByText('场景')).toBeNull()
    expect(screen.getByText('资产库')).toBeTruthy()
  })
})
