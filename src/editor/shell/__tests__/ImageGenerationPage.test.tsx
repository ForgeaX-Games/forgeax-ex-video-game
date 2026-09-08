import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { ImageGenerationPage } from '../ImageGenerationPage'
import type { ImageGenerationTarget } from '../../assets/generation/imageGenerationNavigation'

const testState = vi.hoisted(() => ({
  target: undefined as ImageGenerationTarget | undefined,
  workspaceProps: null as { initialAssetId?: string, characterId?: string, entityId?: string, appliedAssetId?: string, onApplyResult?: (assetId: string) => Promise<void> } | null,
  catalog: undefined as import('../../assets/asset-catalog').AssetCatalog | undefined,
  apply: vi.fn(async () => {}),
}))

vi.mock('../../assets/generation/ImageGenerationWorkspace', () => ({
  ImageGenerationWorkspace: (props: { initialAssetId?: string, characterId?: string, entityId?: string, appliedAssetId?: string, onApplyResult?: (assetId: string) => Promise<void> }) => {
    testState.workspaceProps = props
    return <div>image-generation-workspace</div>
  },
}))
vi.mock('../../assets/generation/imageGenerationNavigation', () => ({
  consumeImageGenerationTarget: () => testState.target,
}))
vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog: () => ({
      catalog: testState.catalog ?? actual.EMPTY_ASSET_CATALOG,
      loading: false,
      error: null,
      refresh: vi.fn(),
    }),
  }
})
vi.mock('@/editor/assets/asset-catalog-client', () => ({ assetCatalogClient: { apply: testState.apply } }))

const initialScenario = useGraphScenario.getState()

beforeEach(() => {
  useGraphScenario.setState({ booted: true, game: 'demo', meta: {} })
  testState.target = undefined
  testState.workspaceProps = null
  testState.catalog = undefined
  testState.apply.mockClear()
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  vi.restoreAllMocks()
})

describe('ImageGenerationPage', () => {
  it('renders without an unstable scenario snapshot when characters are absent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => { render(<ImageGenerationPage onBack={vi.fn()} />) })

    expect(screen.getByText('image-generation-workspace')).toBeTruthy()
    expect(consoleError.mock.calls.flat().join('\n')).not.toMatch(/getSnapshot|Maximum update depth/)
  })

  it('keeps the validated image target as the history scope while the catalog catches up', async () => {
    testState.target = {
      gameId: 'demo',
      assetId: 'asset-not-in-first-catalog-response',
      targetRoot: 'image',
      returnView: 'assets',
    }

    await act(async () => { render(<ImageGenerationPage onBack={vi.fn()} />) })

    expect(testState.workspaceProps?.initialAssetId).toBe('asset-not-in-first-catalog-response')
  })

  it('applies a selected image history asset to its catalog entity', async () => {
    testState.target = {
      gameId: 'demo',
      assetId: 'character-current',
      entityId: 'hero',
      targetRoot: 'character',
      returnView: 'assets',
    }
    testState.catalog = {
      version: 1,
      folders: [],
      placements: {},
      assets: {},
      entities: {
        character: {
          hero: {
            id: 'hero',
            name: 'Hero',
            current: { assetId: 'character-current' },
            history: [{ assetId: 'character-old', appliedAt: 1 }],
            createdAt: 1,
            updatedAt: 2,
          },
        },
        scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {},
      },
    }

    await act(async () => { render(<ImageGenerationPage onBack={vi.fn()} />) })
    await act(async () => { await testState.workspaceProps?.onApplyResult?.('character-old') })

    expect(testState.workspaceProps?.appliedAssetId).toBe('character-current')
    expect(testState.workspaceProps?.characterId).toBe('hero')
    expect(testState.workspaceProps?.entityId).toBe('hero')
    expect(testState.apply).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'character-old',
      tabKind: 'character',
      mode: 'catalog',
      entityId: 'hero',
      source: 'select',
    }))
  })
})
