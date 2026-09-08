// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../i18n'
import type { ComponentProps } from 'react'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import { overlayStageMaxPercent, OverlaySchemeEditor } from '../OverlaySchemeEditor'

beforeAll(registerTestComponents)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  setLocale('zh')
})

function renderEditor(
  props: Partial<ComponentProps<typeof OverlaySchemeEditor>> & {
    onReorderChildren?: (orderedChildIds: string[]) => void
  } = {},
): ReturnType<typeof render> {
  return render(
    <OverlaySchemeEditor
      overlayId="workspace"
      overlay={{ id: 'workspace', title: '战斗界面', children: [] }}
      entities={{}}
      variables={{}}
      usageCount={0}
      onRename={vi.fn()}
      onRemove={vi.fn()}
      onPromptChange={vi.fn()}
      onAddChild={vi.fn()}
      onRemoveChild={vi.fn()}
      onPatchChild={vi.fn()}
      onReactionsChange={vi.fn()}
      {...props}
    />,
  )
}

describe('OverlaySchemeEditor workspace layout', () => {
  it('uses a fill-height flat stage and bottom library workspace', () => {
    const { container } = renderEditor()

    const stageRegion = screen.getByTestId('overlay-stage-region')
    const libraryRegion = screen.getByTestId('overlay-library-region')
    const stage = container.querySelector('.ocp-stage') as HTMLElement
    expect(screen.getByTestId('overlay-scheme-workspace')).toHaveClass('ose-workspace')
    expect(stageRegion).toHaveClass('ose-stage')
    expect(libraryRegion).toHaveClass('ose-bottom')
    expect(stageRegion).toHaveStyle({ height: '56%' })
    expect(getComputedStyle(stageRegion).maxHeight).toBe('min(calc(100% - 190px), 56.25cqw)')
    expect(getComputedStyle(libraryRegion).minHeight).toBe('184px')
    expect(getComputedStyle(stage).backgroundColor).toBe('#000')
    expect(container.querySelector('[data-overlay-viewport]')).toHaveStyle({ aspectRatio: '16 / 9' })
    expect(getComputedStyle(stage).borderRadius).toBe('')
    expect(getComputedStyle(stage).boxShadow).toBe('')
    expect(container.querySelector('.ocp-root')).toHaveClass('is-workspace-fill')
    const activeTab = screen.getByRole('tab', { name: '控件库' })
    expect(activeTab).toHaveAttribute('aria-selected', 'true')
    expect(getComputedStyle(activeTab).color).toBe('#ff9c2a')
    const workspaceStyles = document.querySelector('style[data-reel-style="overlay-scheme-workspace"]')?.textContent
    expect(workspaceStyles).toContain('.ose-tabs button:hover { background:transparent; }')
    expect(workspaceStyles).not.toContain('button[aria-selected="true"]::after')
    expect(screen.getByTestId('component-library')).toBeTruthy()
    expect(screen.queryByLabelText('界面方案名称')).toBeNull()
    const separator = screen.getByRole('separator', { name: '调整画布区域高度' })
    expect(separator).toHaveAttribute('aria-valuenow', '56')
    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(separator).toHaveAttribute('aria-valuenow', '58')
  })

  it('caps stage height at the current width-derived 16:9 height', () => {
    const maxPercent = overlayStageMaxPercent({ width: 1200, height: 1000 })
    expect(maxPercent).toBe(67.5)
    expect(1000 * maxPercent / 100).toBe(675)

    // 较矮工作区先受底部 190px 最小空间约束。
    expect(overlayStageMaxPercent({ width: 1200, height: 700 })).toBeCloseTo(510 / 7)
  })

  it('defaults to layers when the scheme already has children', () => {
    renderEditor({
      overlay: {
        id: 'workspace',
        title: '战斗界面',
        children: [{ id: 'notice', component: 'test.notice', inputs: {} }],
      },
    })

    expect(screen.getByRole('tab', { name: '图层' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('overlay-layers')).toBeTruthy()
    expect(screen.getByRole('button', { name: /状态提示 · notice/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps locked schemes on visible layers without a component library', () => {
    renderEditor({
      locked: true,
      overlay: {
        id: 'workspace',
        children: [{ id: 'notice', component: 'test.notice', inputs: {} }],
      },
    })

    expect(screen.queryByRole('tab', { name: '控件库' })).toBeNull()
    expect(screen.getByRole('tab', { name: '图层' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('overlay-layers')).toBeTruthy()
    expect(screen.queryByTestId('component-library')).toBeNull()
  })

  it('moves a layer to a new front-to-back position after a long press', () => {
    vi.useFakeTimers()
    const onReorderChildren = vi.fn()
    renderEditor({
      overlay: {
        id: 'workspace',
        children: [
          { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
          { id: 'middle', component: 'test.notice', layout: { zIndex: 2 } },
          { id: 'front', component: 'test.notice', layout: { zIndex: 3 } },
        ],
      },
      onReorderChildren,
    })

    const back = screen.getByTitle('back')
    const front = screen.getByTitle('front')
    vi.spyOn(front, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 32,
      width: 300,
      height: 32,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(back, { pointerId: 1, clientX: 12, clientY: 12 })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerMove(front, { pointerId: 1, clientX: 12, clientY: 4 })
    fireEvent.pointerUp(front, { pointerId: 1, clientX: 12, clientY: 4 })

    expect(onReorderChildren).toHaveBeenCalledWith(['back', 'front', 'middle'])
  })

  it('cancels a pending long press when the pointer moves before activation', () => {
    vi.useFakeTimers()
    const onReorderChildren = vi.fn()
    renderEditor({
      overlay: {
        id: 'workspace',
        children: [
          { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
          { id: 'front', component: 'test.notice', layout: { zIndex: 2 } },
        ],
      },
      onReorderChildren,
    })

    const back = screen.getByTitle('back')
    const front = screen.getByTitle('front')
    vi.spyOn(front, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 32,
      width: 300,
      height: 32,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(back, { pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(back, { pointerId: 2, clientX: 24, clientY: 10 })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerMove(front, { pointerId: 2, clientX: 24, clientY: 4 })
    fireEvent.pointerUp(front, { pointerId: 2, clientX: 24, clientY: 4 })

    expect(onReorderChildren).not.toHaveBeenCalled()
  })

  it('does not activate layer sorting for a locked scheme', () => {
    vi.useFakeTimers()
    const onReorderChildren = vi.fn()
    renderEditor({
      locked: true,
      overlay: {
        id: 'workspace',
        children: [
          { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
          { id: 'front', component: 'test.notice', layout: { zIndex: 2 } },
        ],
      },
      onReorderChildren,
    })

    const back = screen.getByTitle('back')
    const front = screen.getByTitle('front')
    vi.spyOn(front, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 32,
      width: 300,
      height: 32,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(back, { pointerId: 4, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerMove(front, { pointerId: 4, clientX: 10, clientY: 4 })
    fireEvent.pointerUp(front, { pointerId: 4, clientX: 10, clientY: 4 })

    expect(onReorderChildren).not.toHaveBeenCalled()
  })

  it('uses the row under the pointer after pointer capture retargets movement', () => {
    vi.useFakeTimers()
    const onReorderChildren = vi.fn()
    renderEditor({
      overlay: {
        id: 'workspace',
        children: [
          { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
          { id: 'front', component: 'test.notice', layout: { zIndex: 2 } },
        ],
      },
      onReorderChildren,
    })

    const back = screen.getByTitle('back')
    const front = screen.getByTitle('front')
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(front)
    vi.spyOn(front, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 300,
      bottom: 32,
      width: 300,
      height: 32,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(back, { pointerId: 5, clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerMove(back, { pointerId: 5, clientX: 10, clientY: 4 })
    fireEvent.pointerUp(back, { pointerId: 5, clientX: 10, clientY: 4 })

    expect(onReorderChildren).toHaveBeenCalledWith(['back', 'front'])
  })

  it('scrolls a long touch list instead of selecting or sorting before activation', () => {
    vi.useFakeTimers()
    const onReorderChildren = vi.fn()
    renderEditor({
      overlay: {
        id: 'workspace',
        children: [
          { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
          { id: 'front', component: 'test.notice', layout: { zIndex: 2 } },
        ],
      },
      onReorderChildren,
    })

    const layers = screen.getByTestId('overlay-layers')
    const back = screen.getByTitle('back')
    layers.scrollTop = 40
    fireEvent.pointerDown(back, {
      pointerId: 6,
      pointerType: 'touch',
      button: 0,
      clientX: 10,
      clientY: 100,
    })
    fireEvent.pointerMove(back, {
      pointerId: 6,
      pointerType: 'touch',
      clientX: 10,
      clientY: 80,
    })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.pointerUp(back, { pointerId: 6, pointerType: 'touch', clientX: 10, clientY: 80 })

    expect(layers.scrollTop).toBe(60)
    expect(back).toHaveAttribute('aria-pressed', 'false')
    expect(onReorderChildren).not.toHaveBeenCalled()

    // The compatibility click from the scroll gesture is consumed once.
    fireEvent.click(back)
    expect(back).toHaveAttribute('aria-pressed', 'false')

    // A distinct touch tap immediately afterwards must still select normally.
    fireEvent.pointerDown(back, {
      pointerId: 7,
      pointerType: 'touch',
      button: 0,
      clientX: 10,
      clientY: 80,
    })
    fireEvent.pointerUp(back, { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 80 })
    fireEvent.click(back)
    expect(back).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a visible focus indicator on a keyboard-focused layer', () => {
    renderEditor({
      overlay: {
        id: 'workspace',
        children: [{ id: 'notice', component: 'test.notice' }],
      },
    })

    const row = screen.getByTitle('notice')
    row.focus()

    expect(getComputedStyle(row).outlineColor).toBe('#ff9c2a')
    expect(getComputedStyle(row).outlineWidth).toBe('2px')
  })

  it('cancels a pending drag when the edited scheme changes', () => {
    vi.useFakeTimers()
    const onReorderChildren = vi.fn()
    const commonProps = {
      entities: {},
      variables: {},
      usageCount: 0,
      onRename: vi.fn(),
      onRemove: vi.fn(),
      onPromptChange: vi.fn(),
      onAddChild: vi.fn(),
      onRemoveChild: vi.fn(),
      onPatchChild: vi.fn(),
      onReorderChildren,
      onReactionsChange: vi.fn(),
    }
    const { rerender } = render(
      <OverlaySchemeEditor
        {...commonProps}
        overlayId="first"
        overlay={{
          id: 'first',
          children: [
            { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
            { id: 'front', component: 'test.notice', layout: { zIndex: 2 } },
          ],
        }}
      />,
    )

    fireEvent.pointerDown(screen.getByTitle('back'), {
      pointerId: 7,
      button: 0,
      clientX: 10,
      clientY: 10,
    })
    rerender(
      <OverlaySchemeEditor
        {...commonProps}
        overlayId="second"
        overlay={{
          id: 'second',
          children: [
            { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
            { id: 'front', component: 'test.notice', layout: { zIndex: 2 } },
          ],
        }}
      />,
    )
    act(() => vi.advanceTimersByTime(300))

    expect(screen.getByTestId('overlay-layers')).not.toHaveClass('is-dragging')
    expect(onReorderChildren).not.toHaveBeenCalled()
  })

  it('moves the selected layer with Alt and arrow keys and announces its position', () => {
    const onReorderChildren = vi.fn()
    renderEditor({
      overlay: {
        id: 'workspace',
        children: [
          { id: 'back', component: 'test.notice', layout: { zIndex: 1 } },
          { id: 'middle', component: 'test.notice', layout: { zIndex: 2 } },
          { id: 'front', component: 'test.notice', layout: { zIndex: 3 } },
        ],
      },
      onReorderChildren,
    })

    fireEvent.keyDown(screen.getByTitle('front'), { key: 'ArrowDown', altKey: true })

    expect(onReorderChildren).toHaveBeenCalledWith(['middle', 'front', 'back'])
    expect(screen.getByRole('status')).toHaveTextContent('状态提示已移动到第 2 层，共 3 层。')

    act(() => setLocale('en'))
    expect(screen.getByRole('status')).toHaveTextContent('状态提示 moved to layer 2 of 3.')
  })
})

describe('OverlaySchemeEditor placement hint', () => {
  it('commits a manual prompt edit on blur', () => {
    const onPromptChange = vi.fn()
    renderEditor({
      overlay: { id: 'workspace', title: '战斗界面', children: [] },
      onPromptChange,
    })

    const input = screen.getByTestId('overlay-prompt-editor').querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  我方状态 HUD 一般放在右下角。  ' } })
    fireEvent.blur(input)

    expect(onPromptChange).toHaveBeenCalledWith('我方状态 HUD 一般放在右下角。')
  })

  it('does not write when the value is unchanged', () => {
    const onPromptChange = vi.fn()
    renderEditor({
      overlay: { id: 'workspace', title: '战斗界面', prompt: '底部居中', children: [] },
      onPromptChange,
    })

    const input = screen.getByTestId('overlay-prompt-editor').querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: '底部居中' } })
    fireEvent.blur(input)

    expect(onPromptChange).not.toHaveBeenCalled()
  })
})
