/**
 * 蓝图浮层的**初始**位置：贴着底栏上方的左下角开，而不是左上角。
 *
 * 浮层是从底栏的「蓝图」按钮点出来的，落在左下角才挨着触发它的地方；开在左上角等于把视线
 * 甩到屏幕对角。开完仍可自由拖拽/缩放，这里只负责第一眼。
 */

/** 底栏自身高度（进度条 3 + 控件行 56），浮层不得压在它上面。 */
const BOTTOM_BAR_HEIGHT = 59
/** 底栏与浮层之间、以及浮层与顶边之间的留白。 */
const GAP = 8
const TOP_MARGIN = 12
/** 与 DraggablePanel 的缩放下限一致：再矮就没法看图了。 */
const MIN_HEIGHT = 200

export interface PanelBox {
  x: number
  y: number
  w: number
  h: number
}

export function resolveBlueprintPanelBox(input: {
  /** 试玩根容器高度；测不到（0 / NaN）时退回顶部老位置，别算出负坐标。 */
  rootHeight: number
  panelWidth?: number
  panelHeight?: number
  left?: number
}): PanelBox {
  const { rootHeight, panelWidth = 540, panelHeight = 420, left = 12 } = input
  const bottomInset = BOTTOM_BAR_HEIGHT + GAP

  if (!Number.isFinite(rootHeight) || rootHeight <= 0) {
    return { x: left, y: TOP_MARGIN, w: panelWidth, h: panelHeight }
  }

  const available = rootHeight - bottomInset - TOP_MARGIN
  const h = Math.max(MIN_HEIGHT, Math.min(panelHeight, available))
  const y = Math.max(TOP_MARGIN, rootHeight - bottomInset - h)
  return { x: left, y, w: panelWidth, h }
}
