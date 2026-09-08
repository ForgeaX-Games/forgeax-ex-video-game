import { t as translateUi } from '../../i18n'
/**
 * OverlayCanvasInteraction —— 界面方案画布与节点视频画布共享的交互层。
 *
 * 领域组件只提供归一坐标的 position + 命中 frame，并负责把 onMove/onReorder 写回各自 SSOT。
 * 本层统一点击选中、重叠循环、拖动、边界钳制、方向键微调、空白取消与层级菜单。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasBox {
  left: number
  top: number
  width: number
  height: number
}

export type CanvasFrame =
  | ({ kind: 'box' } & CanvasBox)
  | {
      kind: 'point'
      x: number
      y: number
      widthPx?: number
      heightPx?: number
    }

export interface CanvasInteractionItem {
  id: string
  label: string
  position: CanvasPoint
  frame: CanvasFrame
  zIndex: number
  movable: boolean
  resizable: boolean
  /** 已选中但命中栈里有更高 item 时，让更高 item 优先（编辑器背景 frame 用）。 */
  yieldToHigherItems?: boolean
  /**
   * 移动边界：
   * - frame（默认）：可见操作框完整留在舞台内；
   * - anchor：只约束写回锚点在 0~1，适合满舞台 OverlayNode 的偏移编辑；
   * - none：不钳制。
   */
  movementBounds?: 'frame' | 'anchor' | 'none'
  /** 组件 CSS/内容派生的最小盒尺寸（归一舞台坐标）。 */
  minWidth?: number
  minHeight?: number
  warn?: boolean
  /** 按键重复：与 warn 一同点亮红框，并由上层渲染专用警告图标。 */
  keyConflict?: boolean
}

export interface CanvasItemState {
  selected: boolean
  hovered: boolean
  dragging: boolean
  box: CanvasBox
}

const ARROW_DELTA: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

type HorizontalResize = 'w' | 'e'
type VerticalResize = 'n' | 's'
type ResizeHandle = {
  id: string
  label: string
  horizontal?: HorizontalResize
  vertical?: VerticalResize
}

const RESIZE_HANDLES: ResizeHandle[] = [
  { id: 'nw', label: '左上', horizontal: 'w', vertical: 'n' },
  { id: 'n', label: '上边', vertical: 'n' },
  { id: 'ne', label: '右上', horizontal: 'e', vertical: 'n' },
  { id: 'w', label: '左边', horizontal: 'w' },
  { id: 'e', label: '右边', horizontal: 'e' },
  { id: 'sw', label: '左下', horizontal: 'w', vertical: 's' },
  { id: 's', label: '下边', vertical: 's' },
  { id: 'se', label: '右下', horizontal: 'e', vertical: 's' },
]

const CSS = `
.oci-layer { position:absolute; inset:0; z-index:50; pointer-events:auto; outline:none; }
.oci-layer.is-over-item { cursor:grab; }
.oci-layer.is-dragging, .oci-layer.is-dragging * { cursor:grabbing!important; }
.oci-frame {
  position:absolute; box-sizing:border-box; pointer-events:none; touch-action:none;
  border:1px dashed rgba(255,255,255,.3); border-radius:4px;
}
.oci-frame.is-passive { border-color:transparent; }
.oci-frame.is-passive.is-hovered { border-color:rgba(200,149,90,.48); }
/* 陪衬态：只说明"我也在这儿、可以点我"，必须明显弱于选中态，否则一起亮就分不出选的是哪个。 */
.oci-frame.is-highlighted {
  border-style:dashed; border-color:rgba(200,149,90,.5);
  box-shadow:none;
}
.oci-frame.is-selected {
  border-style:solid; border-color:var(--gc-accent,#c8955a);
  box-shadow:0 0 0 1px rgba(200,149,90,.42),0 0 12px rgba(200,149,90,.2);
}
.oci-frame.is-warn { border-color:#ff6b6b; box-shadow:0 0 0 1px rgba(255,107,107,.48); }
.oci-resize {
  position:absolute; z-index:3; display:none; box-sizing:border-box; pointer-events:auto;
  width:9px; height:9px; padding:0; border:1px solid rgba(20,16,12,.9); border-radius:2px;
  background:var(--gc-accent,#c8955a); box-shadow:0 0 0 1px rgba(255,255,255,.45);
}
.oci-frame.is-selected .oci-resize { display:block; }
.oci-resize.nw { left:-5px; top:-5px; cursor:nwse-resize; }
.oci-resize.n { left:50%; top:-5px; transform:translateX(-50%); cursor:ns-resize; }
.oci-resize.ne { right:-5px; top:-5px; cursor:nesw-resize; }
.oci-resize.w { left:-5px; top:50%; transform:translateY(-50%); cursor:ew-resize; }
.oci-resize.e { right:-5px; top:50%; transform:translateY(-50%); cursor:ew-resize; }
.oci-resize.sw { left:-5px; bottom:-5px; cursor:nesw-resize; }
.oci-resize.s { left:50%; bottom:-5px; transform:translateX(-50%); cursor:ns-resize; }
.oci-resize.se { right:-5px; bottom:-5px; cursor:nwse-resize; }
.oci-menu {
  position:fixed; z-index:100000; min-width:96px; padding:3px;
  background:var(--gc-panel,#211c16); border:1px solid var(--gc-line,rgba(255,255,255,.14));
  border-radius:6px; box-shadow:0 6px 20px rgba(0,0,0,.5); font-size:12px;
}
.oci-menu button {
  display:block; width:100%; text-align:left; padding:5px 8px; border:0; border-radius:4px;
  background:none; color:var(--gc-text,#f6f1e9); cursor:pointer;
}
.oci-menu button:hover { background:var(--gc-item-hover,rgba(255,255,255,.08)); }
`

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function resolveCanvasFrame(
  frame: CanvasFrame,
  stageSize: { width: number; height: number },
): CanvasBox {
  if (frame.kind === 'box') return frame
  const width = stageSize.width > 0 ? (frame.widthPx ?? 56) / stageSize.width : 0
  const height = stageSize.height > 0 ? (frame.heightPx ?? 56) / stageSize.height : 0
  return {
    left: frame.x - width / 2,
    top: frame.y - height / 2,
    width,
    height,
  }
}

export function clampCanvasDelta(box: CanvasBox, dx: number, dy: number): CanvasPoint {
  const minDx = -box.left
  const maxDx = 1 - box.left - box.width
  const minDy = -box.top
  const maxDy = 1 - box.top - box.height
  return {
    x: maxDx < minDx ? 0 : clamp(dx, minDx, maxDx),
    y: maxDy < minDy ? 0 : clamp(dy, minDy, maxDy),
  }
}

export function constrainCanvasMove(
  item: CanvasInteractionItem,
  box: CanvasBox,
  dx: number,
  dy: number,
): CanvasPoint {
  if (item.movementBounds === 'none') return { x: dx, y: dy }
  if (item.movementBounds === 'anchor') {
    return {
      x: clamp(item.position.x + dx, 0, 1) - item.position.x,
      y: clamp(item.position.y + dy, 0, 1) - item.position.y,
    }
  }
  return clampCanvasDelta(box, dx, dy)
}

export function resizeCanvasBox(
  box: CanvasBox,
  dx: number,
  dy: number,
  handle: Pick<ResizeHandle, 'horizontal' | 'vertical'>,
  minWidth = 0.02,
  minHeight = 0.02,
): CanvasBox {
  let left = box.left
  let top = box.top
  let right = box.left + box.width
  let bottom = box.top + box.height

  if (handle.horizontal === 'w') left = clamp(box.left + dx, 0, right - minWidth)
  else if (handle.horizontal === 'e') right = clamp(right + dx, left + minWidth, 1)
  if (handle.vertical === 'n') top = clamp(box.top + dy, 0, bottom - minHeight)
  else if (handle.vertical === 's') bottom = clamp(bottom + dy, top + minHeight, 1)

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  }
}

export function canvasHitStack(
  items: readonly CanvasInteractionItem[],
  point: CanvasPoint,
  stageSize: { width: number; height: number },
): CanvasInteractionItem[] {
  return items
    .map((item, index) => ({ item, index, box: resolveCanvasFrame(item.frame, stageSize) }))
    .filter(({ box }) =>
      point.x >= box.left
      && point.x <= box.left + box.width
      && point.y >= box.top
      && point.y <= box.top + box.height)
    // 显式层级优先；层级相同时取**更小**的框 —— 小控件常压在大框之上，按面积取才是
    // 「点到最具体的那个」。都一样大（如刚绑定、还没摆位的两个界面）才回落到后来者优先。
    .sort((a, b) =>
      b.item.zIndex - a.item.zIndex
      || (a.box.width * a.box.height) - (b.box.width * b.box.height)
      || b.index - a.index)
    .map(({ item }) => item)
}

function ignoresCanvasShortcut(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || element.isContentEditable
    || !!element.closest?.('.gc-list')
}

export function OverlayCanvasInteraction({
  stageRef,
  items,
  selectedId,
  highlightedIds = [],
  onSelect,
  onMove,
  onResize,
  onReorder,
  onInteractionChange,
  renderFrame,
  frameVisibility = 'always',
  ariaLabel = '覆盖物画布',
  spaceDragId,
}: {
  stageRef: RefObject<HTMLElement | null>
  items: readonly CanvasInteractionItem[]
  selectedId?: string | null
  /** 同时显示选框的对象；不改变 selectedId 对应的键盘、缩放和层级操作目标。 */
  highlightedIds?: readonly string[]
  onSelect: (id: string | null) => void
  onMove: (id: string, position: CanvasPoint) => void
  onResize?: (id: string, box: CanvasBox) => void
  onReorder?: (id: string, direction: 'front' | 'back') => void
  /** 拖动或缩放开始/结束；预览宿主可据此暂停并冻结当前动画帧。 */
  onInteractionChange?: (active: boolean) => void
  renderFrame?: (item: CanvasInteractionItem, state: CanvasItemState) => ReactNode
  frameVisibility?: 'always' | 'active'
  ariaLabel?: string
  /** 按住 Space 时忽略命中栈，直接拖动指定 item，并阻止浏览器页面滚动。 */
  spaceDragId?: string
}): JSX.Element {
  injectStyleOnce('overlay-canvas-interaction', CSS)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [resizingId, setResizingId] = useState<string | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; itemId: string } | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const draggingRef = useRef(false)
  const spacePressedRef = useRef(false)
  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const highlightedIdSet = useMemo(() => new Set(highlightedIds), [highlightedIds])
  const hoveredMovable = hoveredId ? itemMap.get(hoveredId)?.movable === true : false

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = (): void => {
      const rect = stage.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [stageRef])

  const stageGeometry = (): { rect: DOMRect; size: { width: number; height: number } } | null => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return null
    return { rect, size: { width: rect.width, height: rect.height } }
  }

  const pointFromClient = (clientX: number, clientY: number): CanvasPoint | null => {
    const geometry = stageGeometry()
    if (!geometry) return null
    return {
      x: (clientX - geometry.rect.left) / geometry.rect.width,
      y: (clientY - geometry.rect.top) / geometry.rect.height,
    }
  }

  const hitStack = (clientX: number, clientY: number): CanvasInteractionItem[] => {
    const geometry = stageGeometry()
    const point = pointFromClient(clientX, clientY)
    if (!geometry || !point) return []
    return canvasHitStack(items, point, geometry.size)
  }

  useEffect(() => {
    if (!selectedId) return
    const onKey = (event: KeyboardEvent): void => {
      const direction = ARROW_DELTA[event.key]
      if (!direction || ignoresCanvasShortcut(event.target)) return
      const item = itemMap.get(selectedId)
      const geometry = stageGeometry()
      if (!item?.movable || !geometry) return
      event.preventDefault()
      const pixels = event.shiftKey ? 10 : 1
      const box = resolveCanvasFrame(item.frame, geometry.size)
      const delta = constrainCanvasMove(
        item,
        box,
        direction[0] * pixels / geometry.rect.width,
        direction[1] * pixels / geometry.rect.height,
      )
      onMove(item.id, {
        x: item.position.x + delta.x,
        y: item.position.y + delta.y,
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [itemMap, onMove, selectedId, stageRef])

  useEffect(() => {
    if (!spaceDragId) return
    const down = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || ignoresCanvasShortcut(event.target)) return
      event.preventDefault()
      if (spacePressedRef.current) return
      spacePressedRef.current = true
      setSpacePressed(true)
    }
    const up = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      if (!ignoresCanvasShortcut(event.target)) event.preventDefault()
      spacePressedRef.current = false
      setSpacePressed(false)
    }
    const blur = (): void => {
      spacePressedRef.current = false
      setSpacePressed(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [spaceDragId])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    if (menu) setMenu(null)
    const spaceItem = spacePressedRef.current && spaceDragId
      ? itemMap.get(spaceDragId)
      : undefined
    const stack = spaceItem ? [spaceItem] : hitStack(event.clientX, event.clientY)
    if (stack.length === 0) {
      onSelect(null)
      return
    }
    const selectedIndex = spaceItem ? -1 : stack.findIndex((item) => item.id === selectedId)
    const selectedItem = selectedIndex >= 0 ? stack[selectedIndex] : undefined
    const item = selectedItem && !selectedItem.yieldToHigherItems ? selectedItem : stack[0]
    if (!item) return
    onSelect(item.id)
    if (!item.movable) return

    const geometry = stageGeometry()
    if (!geometry) return
    const startBox = resolveCanvasFrame(item.frame, geometry.size)
    const startX = event.clientX
    const startY = event.clientY
    const element = event.currentTarget
    try { element.setPointerCapture(event.pointerId) } catch { /* optional */ }
    let moved = false

    const move = (next: globalThis.PointerEvent): void => {
      const clientDx = next.clientX - startX
      const clientDy = next.clientY - startY
      if (!moved && Math.abs(clientDx) < 2 && Math.abs(clientDy) < 2) return
      if (!moved) {
        moved = true
        draggingRef.current = true
        setDraggingId(item.id)
        onInteractionChange?.(true)
      }
      const delta = constrainCanvasMove(
        item,
        startBox,
        clientDx / geometry.rect.width,
        clientDy / geometry.rect.height,
      )
      onMove(item.id, {
        x: item.position.x + delta.x,
        y: item.position.y + delta.y,
      })
    }
    const up = (): void => {
      try { element.releasePointerCapture(event.pointerId) } catch { /* optional */ }
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      draggingRef.current = false
      setDraggingId(null)
      if (moved) onInteractionChange?.(false)
      if (!moved && selectedIndex >= 0 && stack.length > 1) {
        onSelect(stack[(selectedIndex + 1) % stack.length]!.id)
      }
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (draggingRef.current) return
    setHoveredId(hitStack(event.clientX, event.clientY)[0]?.id ?? null)
  }

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!onReorder) return
    const item = hitStack(event.clientX, event.clientY)[0]
    if (!item) {
      setMenu(null)
      return
    }
    event.preventDefault()
    onSelect(item.id)
    setMenu({ x: event.clientX, y: event.clientY, itemId: item.id })
  }

  const beginResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: CanvasInteractionItem,
    startBox: CanvasBox,
    handle: ResizeHandle,
  ): void => {
    if (!onResize || !item.resizable) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(item.id)
    setMenu(null)
    const geometry = stageGeometry()
    if (!geometry) return
    const startX = event.clientX
    const startY = event.clientY
    const element = event.currentTarget
    const minWidth = Math.max(0.02, 16 / geometry.rect.width, item.minWidth ?? 0)
    const minHeight = Math.max(0.02, 16 / geometry.rect.height, item.minHeight ?? 0)
    draggingRef.current = true
    setResizingId(item.id)
    onInteractionChange?.(true)
    try { element.setPointerCapture(event.pointerId) } catch { /* optional */ }

    const move = (next: globalThis.PointerEvent): void => {
      onResize(item.id, resizeCanvasBox(
        startBox,
        (next.clientX - startX) / geometry.rect.width,
        (next.clientY - startY) / geometry.rect.height,
        handle,
        minWidth,
        minHeight,
      ))
    }
    const up = (): void => {
      try { element.releasePointerCapture(event.pointerId) } catch { /* optional */ }
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      draggingRef.current = false
      setResizingId(null)
      onInteractionChange?.(false)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
  }

  return (
    <>
      <div
        className={`oci-layer${hoveredMovable || spacePressed ? ' is-over-item' : ''}${draggingId ? ' is-dragging' : ''}${resizingId ? ' is-resizing' : ''}`}
        role="application"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => { if (!draggingRef.current) setHoveredId(null) }}
        onContextMenu={onContextMenu}
      >
        {items.map((item) => {
          const box = resolveCanvasFrame(item.frame, stageSize)
          const highlighted = highlightedIdSet.has(item.id)
          const state: CanvasItemState = {
            selected: item.id === selectedId,
            hovered: item.id === hoveredId,
            dragging: item.id === draggingId,
            box,
          }
          return (
            <div
              key={item.id}
              data-canvas-item={item.id}
              data-highlighted={highlighted ? 'true' : 'false'}
              className={`oci-frame${frameVisibility === 'active' ? ' is-passive' : ''}${state.hovered ? ' is-hovered' : ''}${highlighted ? ' is-highlighted' : ''}${state.selected ? ' is-selected' : ''}${item.warn ? ' is-warn' : ''}`}
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
                zIndex: 100 + item.zIndex,
              }}
            >
              {renderFrame?.(item, state)}
              {state.selected && item.resizable && onResize
                ? RESIZE_HANDLES.map((handle) => (
                    <button
                      key={handle.id}
                      type="button"
                      className={`oci-resize ${handle.id}`}
                      aria-label={`${translateUi('ui.template.f65c42a2540b')}${item.label}${translateUi('ui.template.888d070cf293')}${handle.label}`}
                      title={`${translateUi('ui.template.0c6b22a75af1')}${handle.label}${translateUi('ui.template.d2fb5c572959')}`}
                      onPointerDown={(event) => beginResize(event, item, box, handle)}
                    />
                  ))
                : null}
            </div>
          )
        })}
      </div>
      {menu ? (
        <div className="oci-menu" style={{ left: menu.x, top: menu.y }}>
          <button type="button" onPointerDown={(event) => {
            event.stopPropagation()
            onReorder?.(menu.itemId, 'front')
            setMenu(null)
          }}>
            {translateUi('ui.copy.7bcf18641fd7')}</button>
          <button type="button" onPointerDown={(event) => {
            event.stopPropagation()
            onReorder?.(menu.itemId, 'back')
            setMenu(null)
          }}>
            {translateUi('ui.copy.2298689240dd')}</button>
        </div>
      ) : null}
    </>
  )
}
