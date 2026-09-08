/**
 * Layout → CSS（绝对定位）。overlay 挂载 / 子组件 / HUD 皮肤共用。
 */
import type { Layout, LayoutValue } from './node-config-schema'

export type LayoutStyle = {
  position?: 'absolute' | 'relative'
  pointerEvents?: 'none' | 'auto'
  top?: string | number
  right?: string | number
  bottom?: string | number
  left?: string | number
  width?: string | number
  height?: string | number
  zIndex?: number
  transform?: string
}

/** 铺满视频舞台（OverlayNode.layout / 舞台坐标类 OverlayChild.layout）。 */
export const STAGE_FILL_LAYOUT: Layout = { left: 0, top: 0, width: 1, height: 1 }

/** number → 百分比（含负值）；已是 `%`/`px` 串则原样。 */
export function layoutValueToCss(v: LayoutValue): string {
  if (typeof v === 'number') return `${v * 100}%`
  return v
}

/** 是否配置了显式盒尺寸（宽/高或双锚点撑满）。 */
export function layoutHasExplicitSize(layout: Layout | undefined): boolean {
  if (!layout) return false
  return (
    layout.width != null ||
    layout.height != null ||
    (layout.left != null && layout.right != null) ||
    (layout.top != null && layout.bottom != null)
  )
}

function layoutHasExplicitWidth(layout: Layout | undefined): boolean {
  return !!layout && (layout.width != null || (layout.left != null && layout.right != null))
}

function layoutHasExplicitHeight(layout: Layout | undefined): boolean {
  return !!layout && (layout.height != null || (layout.top != null && layout.bottom != null))
}

/** child 使用完整父舞台坐标；父 mount 必须有确定宽高，不能落入 fit-content。 */
export function layoutUsesFullParentStage(layout: Layout | undefined): boolean {
  return layout?.width === 1 && layout.height === 1
}

/**
 * 含满舞台 child 时，为缺失的 mount 维度补齐 100%。
 * 保留显式宽高与锚点，兼容真正需要自适应内容的非舞台组件。
 */
export function resolveMountLayoutForChildren(
  mountLayout: Layout | undefined,
  childLayouts: readonly (Layout | undefined)[],
): Layout | undefined {
  if (!childLayouts.some(layoutUsesFullParentStage)) return mountLayout
  const next: Layout = { ...mountLayout }
  if (!layoutHasExplicitWidth(next)) {
    next.width = 1
    if (next.left == null && next.right == null) next.left = 0
  }
  if (!layoutHasExplicitHeight(next)) {
    next.height = 1
    if (next.top == null && next.bottom == null) next.top = 0
  }
  return next
}

/** layout 是否实质为空（{} 或全 undefined）。 */
export function layoutIsEffectivelyEmpty(layout: Layout | undefined): boolean {
  if (!layout) return true
  return (
    layout.top == null &&
    layout.right == null &&
    layout.bottom == null &&
    layout.left == null &&
    layout.width == null &&
    layout.height == null &&
    layout.translateX == null &&
    layout.translateY == null &&
    layout.zIndex == null
  )
}

/** 挂载级外包盒：相对视频舞台；无显式尺寸时 width/height = fit-content（自适应内容）。 */
export function mountWrapStyle(layout?: Layout): LayoutStyle {
  const style: LayoutStyle = { position: 'absolute', pointerEvents: 'none' }
  if (!layout || layoutIsEffectivelyEmpty(layout)) {
    return { ...style, left: 0, top: 0, width: 'fit-content', height: 'fit-content' }
  }
  if (layout.top != null) style.top = layoutValueToCss(layout.top)
  if (layout.right != null) style.right = layoutValueToCss(layout.right)
  if (layout.bottom != null) style.bottom = layoutValueToCss(layout.bottom)
  if (layout.left != null) style.left = layoutValueToCss(layout.left)
  if (layout.zIndex != null) style.zIndex = layout.zIndex
  const tx = layout.translateX != null ? layoutValueToCss(layout.translateX) : null
  const ty = layout.translateY != null ? layoutValueToCss(layout.translateY) : null
  if (tx != null || ty != null) {
    style.transform = `translate(${tx ?? '0'}, ${ty ?? '0'})`
  }

  const hasSize = layoutHasExplicitSize(layout)
  if (hasSize) {
    if (layout.width != null) style.width = layoutValueToCss(layout.width)
    if (layout.height != null) style.height = layoutValueToCss(layout.height)
    if (layout.left != null && layout.right != null && layout.width == null) {
      style.left = layoutValueToCss(layout.left)
      style.right = layoutValueToCss(layout.right)
    }
    if (layout.top != null && layout.bottom != null && layout.height == null) {
      style.top = layoutValueToCss(layout.top)
      style.bottom = layoutValueToCss(layout.bottom)
    }
    if (layout.width != null && layout.height == null && !(layout.top != null && layout.bottom != null)) {
      style.height = 'fit-content'
    }
    if (layout.height != null && layout.width == null && !(layout.left != null && layout.right != null)) {
      style.width = 'fit-content'
    }
    return style
  }

  style.width = 'fit-content'
  style.height = 'fit-content'
  return style
}

/**
 * 子组件级外包盒：相对挂载盒；`Layout` 字段一一映射为 CSS（left/top/width/height/…）。
 * - 子项有 layout → 原样转 CSS。
 * - 挂载有显式尺寸、子项无 layout → 铺满挂载盒（坐标空间 = overlay 盒子，供内部 %/inset 使用）。
 * - 挂载自适应、子项无 layout → 流式排布（单组件时挂载=组件大小）。
 * 点击：铺满盒（显式宽高或默认铺满）用 `pointer-events:none` 以免挡台下交互；
 * 仅锚点/自适应的小盒子保持 `auto`（面板按钮等）。
 */
export function childWrapStyle(childLayout: Layout | undefined, mountHasSize: boolean): LayoutStyle {
  const hasChildPos =
    childLayout != null &&
    (childLayout.left != null ||
      childLayout.right != null ||
      childLayout.top != null ||
      childLayout.bottom != null ||
      childLayout.width != null ||
      childLayout.height != null ||
      childLayout.translateX != null ||
      childLayout.translateY != null)
  if (hasChildPos && childLayout) {
    const hasSize = layoutHasExplicitSize(childLayout)
    const pe = hasSize ? 'none' : 'auto'
    return { ...layoutToCss(childLayout), pointerEvents: pe }
  }
  if (mountHasSize) {
    return {
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      ...(childLayout?.zIndex != null ? { zIndex: childLayout.zIndex } : {}),
    }
  }
  if (childLayout?.zIndex != null) {
    return { position: 'relative', pointerEvents: 'auto', zIndex: childLayout.zIndex }
  }
  return { pointerEvents: 'auto' }
}

/** @deprecated 用 mountWrapStyle / childWrapStyle */
export function layoutWrapStyle(layout: Layout, pointerEvents: 'auto' | 'none' = 'auto'): LayoutStyle {
  return { ...mountWrapStyle(layout), pointerEvents }
}

/** 转成可直接挂到绝对定位节点上的 style。无 layout 时仅 `position:absolute`。 */
export function layoutToCss(layout: Layout | undefined): LayoutStyle {
  const style: LayoutStyle = { position: 'absolute' }
  if (!layout) return style
  if (layout.top != null) style.top = layoutValueToCss(layout.top)
  if (layout.right != null) style.right = layoutValueToCss(layout.right)
  if (layout.bottom != null) style.bottom = layoutValueToCss(layout.bottom)
  if (layout.left != null) style.left = layoutValueToCss(layout.left)
  if (layout.width != null) style.width = layoutValueToCss(layout.width)
  if (layout.height != null) style.height = layoutValueToCss(layout.height)
  if (layout.zIndex != null) style.zIndex = layout.zIndex
  const tx = layout.translateX != null ? layoutValueToCss(layout.translateX) : null
  const ty = layout.translateY != null ? layoutValueToCss(layout.translateY) : null
  if (tx != null || ty != null) {
    style.transform = `translate(${tx ?? '0'}, ${ty ?? '0'})`
  }
  return style
}
