import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canvasHitStack,
  clampCanvasDelta,
  OverlayCanvasInteraction,
  constrainCanvasMove,
  resizeCanvasBox,
  resolveCanvasFrame,
  type CanvasBox,
  type CanvasInteractionItem,
} from '../OverlayCanvasInteraction'
import { overlayContentAndHitTargets, overlayFitTargets } from '../overlay-fit-targets'

afterEach(cleanup)

const ITEM: CanvasInteractionItem = {
  id: 'item',
  label: 'item',
  position: { x: 0.2, y: 0.2 },
  frame: { kind: 'box', left: 0.1, top: 0.1, width: 0.4, height: 0.4 },
  zIndex: 1,
  movable: true,
  resizable: true,
}

function Harness({
  items = [ITEM],
  selectedId = null,
  highlightedIds = [],
  onSelect = vi.fn(),
  onMove = vi.fn(),
  onResize,
  onReorder,
  onInteractionChange,
}: {
  items?: CanvasInteractionItem[]
  selectedId?: string | null
  highlightedIds?: readonly string[]
  onSelect?: (id: string | null) => void
  onMove?: (id: string, position: { x: number; y: number }) => void
  onResize?: (id: string, box: CanvasBox) => void
  onReorder?: (id: string, direction: 'front' | 'back') => void
  onInteractionChange?: (active: boolean) => void
}): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const bindStage = (element: HTMLDivElement | null): void => {
    stageRef.current = element
    if (!element) return
    element.getBoundingClientRect = () => ({
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
  }
  return (
    <div ref={bindStage} style={{ position: 'relative', width: 200, height: 100 }}>
      <OverlayCanvasInteraction
        stageRef={stageRef}
        items={items}
        selectedId={selectedId}
        highlightedIds={highlightedIds}
        onSelect={onSelect}
        onMove={onMove}
        onResize={onResize}
        onReorder={onReorder}
        onInteractionChange={onInteractionChange}
        ariaLabel="测试画布"
      />
    </div>
  )
}

describe('canvasHitStack 平级取舍', () => {
  const boxItem = (id: string, box: CanvasBox, zIndex = 0): CanvasInteractionItem => ({
    id,
    label: id,
    position: { x: box.left, y: box.top },
    frame: { kind: 'box', ...box },
    zIndex,
    movable: true,
    resizable: false,
  })
  const stage = { width: 200, height: 100 }

  it('prefers the smallest box containing the point when zIndex ties', () => {
    // 大框套小框、层级相同：作者点的是那个小的，不该被大框抢走。
    // 小框刻意排在数组更前面 —— 若只按数组序倒取，赢的会是 big。
    const small = boxItem('small', { left: 0.4, top: 0.4, width: 0.1, height: 0.1 })
    const big = boxItem('big', { left: 0.1, top: 0.1, width: 0.8, height: 0.8 })
    const stack = canvasHitStack([small, big], { x: 0.45, y: 0.45 }, stage)

    expect(stack.map((item) => item.id)).toEqual(['small', 'big'])
  })

  it('still lets an explicit zIndex win over a smaller box', () => {
    const big = boxItem('big', { left: 0.1, top: 0.1, width: 0.8, height: 0.8 }, 5)
    const small = boxItem('small', { left: 0.4, top: 0.4, width: 0.1, height: 0.1 }, 1)
    const stack = canvasHitStack([big, small], { x: 0.45, y: 0.45 }, stage)

    expect(stack.map((item) => item.id)).toEqual(['big', 'small'])
  })

  it('falls back to the later item when boxes coincide exactly', () => {
    const first = boxItem('first', { left: 0.4, top: 0.4, width: 0.1, height: 0.1 })
    const second = boxItem('second', { left: 0.4, top: 0.4, width: 0.1, height: 0.1 })
    const stack = canvasHitStack([first, second], { x: 0.45, y: 0.45 }, stage)

    expect(stack.map((item) => item.id)).toEqual(['second', 'first'])
  })
})

describe('OverlayCanvasInteraction 选中态与陪衬态', () => {
  it('draws a highlighted sibling differently from the selected item', () => {
    const sibling: CanvasInteractionItem = { ...ITEM, id: 'second', label: 'second' }
    const { container } = render(
      <Harness items={[ITEM, sibling]} selectedId="item" highlightedIds={['item', 'second']} />,
    )

    const selected = getComputedStyle(container.querySelector('[data-canvas-item="item"]')!)
    const highlighted = getComputedStyle(container.querySelector('[data-canvas-item="second"]')!)
    // 两者必须一眼可分：陪衬态只是"我在这儿"，不能读成"我被选中了"。
    expect(highlighted.borderStyle).not.toBe(selected.borderStyle)
    expect(highlighted.boxShadow).not.toBe(selected.boxShadow)
  })
})

describe('OverlayCanvasInteraction geometry', () => {
  it('converts a centered point hit target from pixels to normalized coordinates', () => {
    expect(resolveCanvasFrame(
      { kind: 'point', x: 0.5, y: 0.25, widthPx: 80, heightPx: 40 },
      { width: 400, height: 200 },
    )).toEqual({
      left: 0.4,
      top: 0.15,
      width: 0.2,
      height: 0.2,
    })
  })

  it('clamps drag deltas so the visible frame remains inside the stage', () => {
    const delta = clampCanvasDelta(
      { left: 0.8, top: 0.1, width: 0.15, height: 0.2 },
      0.2,
      -0.2,
    )
    expect(delta.x).toBeCloseTo(0.05)
    expect(delta.y).toBeCloseTo(-0.1)
  })

  it('can constrain movement by the persisted anchor instead of a full-stage frame', () => {
    const delta = constrainCanvasMove(
      {
        ...ITEM,
        position: { x: 0, y: 0 },
        frame: { kind: 'box', left: 0, top: 0, width: 1, height: 1 },
        movementBounds: 'anchor',
      },
      { left: 0, top: 0, width: 1, height: 1 },
      0.1,
      0.2,
    )
    expect(delta).toEqual({ x: 0.1, y: 0.2 })
  })

  it('allows a mount anchor to become negative when its visible content moves to the top-left edge', () => {
    const item: CanvasInteractionItem = {
      ...ITEM,
      position: { x: 0, y: 0 },
      frame: { kind: 'box', left: 0.3, top: 0.4, width: 0.2, height: 0.2 },
    }
    const delta = constrainCanvasMove(
      item,
      { left: 0.3, top: 0.4, width: 0.2, height: 0.2 },
      -0.5,
      -0.6,
    )
    expect(delta).toEqual({ x: -0.3, y: -0.4 })
    expect(item.position.x + delta.x).toBe(-0.3)
    expect(item.position.y + delta.y).toBe(-0.4)
  })

  it('returns overlapping items from topmost to bottommost', () => {
    const items: CanvasInteractionItem[] = [
      {
        id: 'low',
        label: 'low',
        position: { x: 0.2, y: 0.2 },
        frame: { kind: 'box', left: 0.1, top: 0.1, width: 0.4, height: 0.4 },
        zIndex: 1,
        movable: true,
        resizable: true,
      },
      {
        id: 'high',
        label: 'high',
        position: { x: 0.3, y: 0.3 },
        frame: { kind: 'box', left: 0.2, top: 0.2, width: 0.4, height: 0.4 },
        zIndex: 5,
        movable: true,
        resizable: true,
      },
    ]
    expect(canvasHitStack(items, { x: 0.3, y: 0.3 }, { width: 1000, height: 500 }).map((item) => item.id))
      .toEqual(['high', 'low'])
  })

  it('resizes from the requested edges and keeps the box inside the stage', () => {
    const box = resizeCanvasBox(
      { left: 0.2, top: 0.2, width: 0.4, height: 0.3 },
      -0.3,
      0.6,
      { horizontal: 'w', vertical: 's' },
    )
    expect(box.left).toBe(0)
    expect(box.top).toBe(0.2)
    expect(box.width).toBeCloseTo(0.6)
    expect(box.height).toBeCloseTo(0.8)
  })
})

describe('overlayFitTargets', () => {
  it('prefers explicit visual targets over full-size structural wrappers', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="full-wrapper">
        <span data-overlay-fit-target>+50</span>
      </div>
    `

    expect(overlayFitTargets(root).map((element) => element.textContent)).toEqual(['+50'])
  })

  it('includes interaction hot areas with explicit visual targets for library previews', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div data-overlay-fit-target>控件内容</div>
      <div data-overlay-hit-target>
        <button type="button"><span>交互热区</span></button>
      </div>
    `

    const targets = overlayContentAndHitTargets(root)
    expect(targets.some((element) => element.hasAttribute('data-overlay-fit-target'))).toBe(true)
    expect(targets.some((element) => element.hasAttribute('data-overlay-hit-target'))).toBe(true)
    expect(targets.some((element) => element.tagName === 'BUTTON')).toBe(true)
  })

  it('falls back to leaf content and outer interactive hit areas', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <div class="full-wrapper">
        <button type="button"><span>叩</span></button>
      </div>
    `

    const targets = overlayFitTargets(root)
    expect(targets.some((element) => element.tagName === 'BUTTON')).toBe(true)
    expect(targets.some((element) => element.textContent === '叩')).toBe(true)
    expect(targets.some((element) => element.classList.contains('full-wrapper'))).toBe(false)
  })
})

describe('OverlayCanvasInteraction events', () => {
  it('highlights multiple items while keeping resize controls on the active item', () => {
    const secondItem: CanvasInteractionItem = {
      ...ITEM,
      id: 'second',
      label: 'second',
      position: { x: 0.5, y: 0.5 },
      frame: { kind: 'box', left: 0.5, top: 0.5, width: 0.25, height: 0.25 },
      zIndex: 2,
    }

    const { container } = render(
      <Harness
        items={[ITEM, secondItem]}
        selectedId="item"
        highlightedIds={['item', 'second']}
        onResize={vi.fn()}
      />,
    )

    const activeFrame = container.querySelector('[data-canvas-item="item"]')
    const secondFrame = container.querySelector('[data-canvas-item="second"]')

    expect(activeFrame).toHaveClass('is-selected', 'is-highlighted')
    expect(secondFrame).toHaveClass('is-highlighted')
    expect(secondFrame).not.toHaveClass('is-selected')
    expect(activeFrame).toHaveAttribute('data-highlighted', 'true')
    expect(secondFrame).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getAllByRole('button', { name: /调整item大小/ })).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /调整second大小/ })).toBeNull()
  })

  it('drags from the existing position instead of snapping the anchor to pointer down', () => {
    const onSelect = vi.fn()
    const onMove = vi.fn()
    render(<Harness onSelect={onSelect} onMove={onMove} />)
    const layer = screen.getByRole('application', { name: '测试画布' })

    fireEvent.pointerDown(layer, { button: 0, pointerId: 1, clientX: 50, clientY: 25 })
    fireEvent.pointerMove(layer, { pointerId: 1, clientX: 90, clientY: 45 })
    fireEvent.pointerUp(layer, { pointerId: 1, clientX: 90, clientY: 45 })

    expect(onSelect).toHaveBeenCalledWith('item')
    expect(onMove).toHaveBeenLastCalledWith('item', { x: 0.4, y: 0.4 })
  })

  it('reports the active interval of a layout drag', () => {
    const onInteractionChange = vi.fn()
    render(<Harness onInteractionChange={onInteractionChange} />)
    const layer = screen.getByRole('application', { name: '测试画布' })

    fireEvent.pointerDown(layer, { button: 0, pointerId: 2, clientX: 50, clientY: 25 })
    fireEvent.pointerMove(layer, { pointerId: 2, clientX: 90, clientY: 45 })
    fireEvent.pointerUp(layer, { pointerId: 2, clientX: 90, clientY: 45 })

    expect(onInteractionChange.mock.calls).toEqual([[true], [false]])
  })

  it('nudges the selected item by one screen pixel', () => {
    const onMove = vi.fn()
    render(<Harness selectedId="item" onMove={onMove} />)

    fireEvent.keyDown(window, { key: 'ArrowRight' })

    const [, position] = onMove.mock.calls[0]!
    expect(position.x).toBeCloseTo(0.205)
    expect(position.y).toBeCloseTo(0.2)
  })

  it('shows eight handles for the selected item and resizes from the south-east handle', () => {
    const onResize = vi.fn()
    render(<Harness selectedId="item" onResize={onResize} />)

    expect(screen.getAllByRole('button', { name: /调整item大小/ })).toHaveLength(8)
    const handle = screen.getByRole('button', { name: '调整item大小：右下' })
    fireEvent.pointerDown(handle, { pointerId: 3, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 140, clientY: 70 })
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 140, clientY: 70 })

    expect(onResize).toHaveBeenLastCalledWith('item', {
      left: 0.1,
      top: 0.1,
      width: 0.6,
      height: 0.6,
    })
  })

  it('does not resize below the component-derived minimum size', () => {
    const onResize = vi.fn()
    render(
      <Harness
        items={[{ ...ITEM, minWidth: 0.3, minHeight: 0.25 }]}
        selectedId="item"
        onResize={onResize}
      />,
    )

    const handle = screen.getByRole('button', { name: '调整item大小：右下' })
    fireEvent.pointerDown(handle, { pointerId: 4, clientX: 100, clientY: 50 })
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 40, clientY: 10 })
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 40, clientY: 10 })

    const [, box] = onResize.mock.calls.at(-1)!
    expect(box.left).toBe(0.1)
    expect(box.top).toBe(0.1)
    expect(box.width).toBeCloseTo(0.3)
    expect(box.height).toBeCloseTo(0.25)
  })

  it('cycles through overlapping items and exposes the shared reorder menu', () => {
    const low = ITEM
    const high = { ...ITEM, id: 'high', label: 'high', zIndex: 2 }
    const onSelect = vi.fn()
    const onReorder = vi.fn()
    render(
      <Harness
        items={[low, high]}
        selectedId="high"
        onSelect={onSelect}
        onReorder={onReorder}
      />,
    )
    const layer = screen.getByRole('application', { name: '测试画布' })

    fireEvent.pointerDown(layer, { button: 0, pointerId: 2, clientX: 50, clientY: 25 })
    fireEvent.pointerUp(layer, { pointerId: 2, clientX: 50, clientY: 25 })
    expect(onSelect).toHaveBeenLastCalledWith('item')

    fireEvent.contextMenu(layer, { clientX: 50, clientY: 25 })
    fireEvent.pointerDown(screen.getByRole('button', { name: '置底' }))
    expect(onReorder).toHaveBeenCalledWith('high', 'back')
  })
})
