// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../i18n'
import {
  registerComponent,
  unregisterComponent,
} from '@/runtime/core/registry/component-registry'
import { refreshGameComponents } from '@/runtime/react/component-host'
import {
  registerOverlayRenderer,
} from '@/runtime/react/component-host/rendererRegistry'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { ComponentLibrary, OVERLAY_PRESET_MIME } from '../ComponentLibrary'
import { clearErrorReports, getErrorReports } from '@/lib/diagnostics/error-report'
import type { AssetCatalog } from '@/editor/assets/asset-catalog'

const extensionFetch = vi.fn()
const removeProjectComponentReferences = vi.fn(async () => true)
const assetCatalogMock = vi.hoisted(() => ({
  catalog: { folders: [], placements: {} } as Pick<AssetCatalog, 'folders' | 'placements'>,
}))

const COMPONENT_ID = 'project.option-button'
const moduleUrl = vi.fn(() => [
  'data:text/javascript,',
  'export default [{',
  '  component: function OptionButton() { return null },',
  `  manifest: { id: "${COMPONENT_ID}", label: "项目选项按钮", inputs: [{ key: "label", valueType: "string", default: "选项" }], events: [{ id: "click", label: "点击" }] },`,
  '}]',
].join(''))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => ({
    gameComponents: { moduleUrl },
    extension: { fetch: extensionFetch },
  }),
  readExtensionJson: async (response: Response) => response.json(),
}))

vi.mock('@/editor/assets/asset-catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/assets/asset-catalog')>()
  return {
    ...actual,
    useAssetCatalog: () => ({ catalog: assetCatalogMock.catalog, loading: false, error: null, refresh: vi.fn() }),
  }
})

afterEach(() => {
  cleanup()
  unregisterComponent(COMPONENT_ID)
  extensionFetch.mockReset()
  removeProjectComponentReferences.mockClear()
  assetCatalogMock.catalog = { folders: [], placements: {} }
  useGraphScenario.setState({ game: '', removeProjectComponentReferences })
  clearErrorReports()
})

describe('ComponentLibrary dynamic catalog', () => {
  it('shows a renderable component registered from the game project', () => {
    const OptionButton = (): JSX.Element => <button type="button">Option</button>
    const manifest = {
      id: COMPONENT_ID,
      label: '项目选项按钮',
      inputs: [{ key: 'label', valueType: 'string' as const, default: '选项' }],
      events: [{ id: 'click', label: '点击' }],
    }
    registerComponent(COMPONENT_ID, manifest)
    registerOverlayRenderer(COMPONENT_ID, OptionButton, manifest)

    const { container } = render(<ComponentLibrary />)

    expect(screen.getByText('项目选项按钮')).toBeTruthy()
    expect(container.querySelector(`[data-component-id="${COMPONENT_ID}"]`)).toBeTruthy()
  })

  it('uses control placements to show folders before their contained controls', () => {
    const OptionButton = (): JSX.Element => <button type="button">Option</button>
    const manifest = { id: COMPONENT_ID, label: '项目选项按钮', inputs: [], events: [] }
    registerComponent(COMPONENT_ID, manifest)
    registerOverlayRenderer(COMPONENT_ID, OptionButton, manifest)
    assetCatalogMock.catalog = {
      folders: [{ id: 'folder-controls', tabKind: 'control', parentId: null, name: '战斗', sortKey: '战斗', createdAt: 1, updatedAt: 1 }],
      placements: {
        [`control:${COMPONENT_ID}`]: { folderId: 'folder-controls', sortKey: '项目选项按钮', createdAt: 1, updatedAt: 1 },
      },
    }

    const { container } = render(<ComponentLibrary />)

    const folder = container.querySelector<HTMLElement>('[data-folder-id="folder-controls"]')!
    expect(folder).toBeTruthy()
    expect(folder.querySelector('.component-thumbnail-stage')).toBeTruthy()
    expect(container.querySelector(`[data-component-id="${COMPONENT_ID}"]`)).toBeNull()
    fireEvent.click(folder)
    expect(container.querySelector(`[data-component-id="${COMPONENT_ID}"]`)).toBeTruthy()
  })

  it('shows the branded empty state when no component matches the search', () => {
    render(<ComponentLibrary />)

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'definitely-not-a-component' } })

    const emptyState = screen.getByRole('status')
    expect(emptyState).toHaveTextContent('暂无控件')
    expect(emptyState.querySelector('img[aria-hidden="true"]')).toBeTruthy()
    expect(getComputedStyle(emptyState.parentElement!).placeItems).toBe('center')
  })

  it('updates the empty state when the host locale changes', () => {
    render(<ComponentLibrary />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'definitely-not-a-component' } })
    expect(screen.getByRole('status')).toHaveTextContent('暂无控件')

    act(() => setLocale('en'))

    expect(screen.getByRole('status')).toHaveTextContent('No controls')
    act(() => setLocale('zh'))
  })

  it('refreshes an open library and drags the generated component id', async () => {
    const game = `game-${crypto.randomUUID()}`
    useGraphScenario.setState({ game })
    const { container } = render(<ComponentLibrary />)
    expect(container.querySelector(`[data-component-id="${COMPONENT_ID}"]`)).toBeNull()

    await act(async () => {
      await refreshGameComponents(game)
    })

    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: COMPONENT_ID } })
    const card = container.querySelector(`[data-component-id="${COMPONENT_ID}"]`)
    expect(card).toBeTruthy()

    const setData = vi.fn()
    fireEvent.dragStart(card!, {
      dataTransfer: { setData, effectAllowed: 'none', setDragImage: vi.fn() },
    })
    expect(setData).toHaveBeenCalledWith(OVERLAY_PRESET_MIME, COMPONENT_ID)
  })

  it('does not expose destructive control actions from the library card', async () => {
    const game = `game-${crypto.randomUUID()}`
    useGraphScenario.setState({ game, removeProjectComponentReferences })
    await act(async () => {
      await refreshGameComponents(game)
    })
    extensionFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      componentId: COMPONENT_ID,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    render(<ComponentLibrary />)
    expect(screen.queryByRole('button', { name: '删除控件 项目选项按钮' })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除控件 字幕/ })).toBeNull()
    expect(removeProjectComponentReferences).not.toHaveBeenCalled()
  })

  it('keeps a project control visible when the editor game state changes after catalog loading', async () => {
    const loadedGame = `game-${crypto.randomUUID()}`
    await act(async () => {
      await refreshGameComponents(loadedGame)
    })
    useGraphScenario.setState({
      game: `game-${crypto.randomUUID()}`,
      removeProjectComponentReferences,
    })

    render(<ComponentLibrary />)

    expect(screen.getByText('项目选项按钮')).toBeTruthy()
  })

  it('isolates a broken generated preview without showing its exception in the library', async () => {
    const brokenId = `project.broken-${crypto.randomUUID()}`
    function BrokenPreview(): JSX.Element {
      throw new Error('generated preview details must stay hidden')
    }
    const manifest = { id: brokenId, label: '损坏控件', events: [] }
    registerComponent(brokenId, manifest)
    registerOverlayRenderer(brokenId, BrokenPreview, manifest)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { container } = render(<ComponentLibrary />)

    expect(container.querySelector(`[data-component-id="${brokenId}"]`)).toBeTruthy()
    expect(container).not.toHaveTextContent('generated preview details must stay hidden')
    expect(screen.getByText('损坏控件')).toBeTruthy()
    expect(getErrorReports()).toEqual([
      expect.objectContaining({
        region: 'component-library-preview',
        message: 'generated preview details must stay hidden',
        context: expect.objectContaining({ componentId: brokenId }),
      }),
    ])
    consoleError.mockRestore()
    unregisterComponent(brokenId)
  })
})
