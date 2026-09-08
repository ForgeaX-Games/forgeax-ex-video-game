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

const extensionFetch = vi.fn()
const removeProjectComponentReferences = vi.fn(async () => true)

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

afterEach(() => {
  cleanup()
  unregisterComponent(COMPONENT_ID)
  extensionFetch.mockReset()
  removeProjectComponentReferences.mockClear()
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

  it('shows deletion only for project components and requires confirmation', async () => {
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
    expect(screen.getByRole('button', { name: '删除控件 项目选项按钮' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /删除控件 字幕/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '删除控件 项目选项按钮' }))
    expect(screen.getByRole('dialog', { name: '删除控件 项目选项按钮' }))
      .toHaveTextContent('工程中使用该控件的界面和节点引用将一并清除')
    expect(extensionFetch).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    })
    expect(removeProjectComponentReferences).toHaveBeenCalledWith(COMPONENT_ID)
    expect(extensionFetch).toHaveBeenCalledWith(`components/${COMPONENT_ID}`, { method: 'DELETE' })
  })

  it('keeps deletion available when the editor game state changes after catalog loading', async () => {
    const loadedGame = `game-${crypto.randomUUID()}`
    await act(async () => {
      await refreshGameComponents(loadedGame)
    })
    useGraphScenario.setState({
      game: `game-${crypto.randomUUID()}`,
      removeProjectComponentReferences,
    })

    render(<ComponentLibrary />)

    expect(screen.getByRole('button', { name: '删除控件 项目选项按钮' })).toBeTruthy()
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
