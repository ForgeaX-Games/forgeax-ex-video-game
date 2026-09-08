/**
 * 角色视图的选择器必须返回稳定引用：`meta.characters` 缺省时若在选择器里 `?? {}`，
 * useSyncExternalStore 每次读快照都拿到新对象 → 无限重渲染直到 React 抛
 * 「Maximum update depth exceeded」。这里钉住「没有角色数据也能安静渲染」。
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { fetchRegistryAssets } from '../../assets/registry-assets'
import { GraphCharacterView, resolveCharacterPreviewUrl } from '../GraphCharacterView'
import type { MediaAsset } from '@/authoring/assets/registry-types'

const catalogState = vi.hoisted(() => ({
  entities: {} as Record<string, Record<string, unknown>>,
  assets: {} as Record<string, Record<string, unknown>>,
}))

vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog: () => ({
      catalog: {
        ...actual.EMPTY_ASSET_CATALOG,
        entities: { ...actual.EMPTY_ASSET_CATALOG.entities, character: catalogState.entities },
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

vi.mock('../../assets/kino-api', () => ({
  createKinoVideoClient: () => ({
    list: vi.fn(async () => ({
      items: [{ resource_id: 'kino-resource-1', url: 'https://example.com/from-kino.jpg' }],
    })),
  }),
}))

const fetchRegistryAssetsMock = vi.mocked(fetchRegistryAssets)
const initialScenario = useGraphScenario.getState()

beforeEach(() => {
  useGraphScenario.setState({ booted: true, game: 'demo', meta: {} })
  catalogState.entities = {}
  catalogState.assets = {}
  fetchRegistryAssetsMock.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  vi.clearAllMocks()
})

describe('GraphCharacterView', () => {
  it('renders the empty catalog without an unstable snapshot loop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => { render(<GraphCharacterView />) })

    expect(screen.getByRole('region', { name: '角色资产' })).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(consoleError.mock.calls.flat().join('\n')).not.toMatch(/getSnapshot|Maximum update depth/)
  })

  it('lists characters from scenario meta', async () => {
    catalogState.entities = {
      hero: { id: 'hero', name: '主角', summary: '持刀者', description: '黑袍', prompt: 'a swordsman in black', history: [], createdAt: 1, updatedAt: 1 },
    }

    await act(async () => { render(<GraphCharacterView />) })

    expect(screen.getByText('主角')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
  })

  it('renders the bound registry preview image on the character card', async () => {
    fetchRegistryAssetsMock.mockResolvedValue([
      {
        id: 'asset_kino_generation-1',
        kind: 'image',
        productionType: 'character_ref',
        status: 'ready',
        url: 'https://example.com/hero-registry.jpg',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    catalogState.entities = {
      hero: { id: 'hero', name: '主角', description: '黑袍', prompt: 'a swordsman in black', current: { assetId: 'asset_kino_generation-1' }, history: [], createdAt: 1, updatedAt: 1 },
    }

    await act(async () => { render(<GraphCharacterView />) })

    expect(screen.getByRole('img', { name: '主角 预览' }).getAttribute('src')).toBe(
      'https://example.com/hero-registry.jpg',
    )
  })

  it('falls back to the Kino resource url when the registry asset has no direct url', async () => {
    fetchRegistryAssetsMock.mockResolvedValue([
      {
        id: 'asset_kino_generation-2',
        kind: 'image',
        productionType: 'character_ref',
        status: 'ready',
        meta: { kinoResourceId: 'kino-resource-1' },
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    catalogState.entities = {
      hero: { id: 'hero', name: '主角', description: '黑袍', prompt: 'a swordsman in black', current: { assetId: 'asset_kino_generation-2' }, history: [], createdAt: 1, updatedAt: 1 },
    }

    await act(async () => { render(<GraphCharacterView />) })

    expect(screen.getByRole('img', { name: '主角 预览' }).getAttribute('src')).toBe(
      'https://example.com/from-kino.jpg',
    )
  })
})

describe('resolveCharacterPreviewUrl', () => {
  it('prefers hostMedia.locator when asset.url is missing', () => {
    const asset = {
      id: 'asset-1',
      kind: 'image',
      productionType: 'character_ref',
      status: 'ready',
      meta: {
        hostMedia: {
          provenance: 'extension-media-capability',
          assetId: 'host-1',
          locator: 'https://media.example/host-1',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    } satisfies MediaAsset

    expect(resolveCharacterPreviewUrl(asset, 'demo', new Map())).toBe('https://media.example/host-1')
  })
})
