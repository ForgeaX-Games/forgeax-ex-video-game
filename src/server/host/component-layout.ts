import type {
  ComponentLayoutContract,
  Layout,
  LayoutValue,
} from '@/runtime/core/schema/node-config-schema'

export interface NormalizedLayoutRect {
  left: number
  top: number
  width: number
  height: number
}

function unitValue(value: LayoutValue | undefined): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string' || !value.endsWith('%')) return undefined
  const parsed = Number.parseFloat(value.slice(0, -1))
  return Number.isFinite(parsed) ? parsed / 100 : undefined
}

/** 将可以表达为舞台比例的 Layout 解析成矩形；含 px 或 fit-content 的布局交给 DOM 实测。 */
export function normalizedLayoutRect(layout: Layout | undefined): NormalizedLayoutRect | null {
  if (!layout) return null
  const leftValue = unitValue(layout.left)
  const rightValue = unitValue(layout.right)
  const topValue = unitValue(layout.top)
  const bottomValue = unitValue(layout.bottom)
  const widthValue = unitValue(layout.width)
  const heightValue = unitValue(layout.height)

  const width = widthValue ?? (
    leftValue != null && rightValue != null ? 1 - leftValue - rightValue : undefined
  )
  const height = heightValue ?? (
    topValue != null && bottomValue != null ? 1 - topValue - bottomValue : undefined
  )
  if (width == null || height == null) return null

  const left = leftValue ?? (rightValue != null ? 1 - rightValue - width : 0)
  const top = topValue ?? (bottomValue != null ? 1 - bottomValue - height : 0)
  const translateX = unitValue(layout.translateX) ?? 0
  const translateY = unitValue(layout.translateY) ?? 0
  return {
    left: left + translateX * width,
    top: top + translateY * height,
    width,
    height,
  }
}

function isFullStage(rect: NormalizedLayoutRect): boolean {
  return rect.left === 0 && rect.top === 0 && rect.width === 1 && rect.height === 1
}

export function componentLayoutIssue(
  layout: Layout | undefined,
  contract: ComponentLayoutContract | undefined,
): { code: 'ui.component.layout-out-of-bounds' | 'ui.component.layout-too-small'; message: string } | null {
  if (!layout || !contract || contract.overflow !== 'forbidden') return null
  const rect = normalizedLayoutRect(layout)
  if (!rect) return null

  const right = rect.left + rect.width
  const bottom = rect.top + rect.height
  const margin = isFullStage(rect) ? 0 : contract.safeMargin
  if (
    rect.left < margin
    || rect.top < margin
    || right > 1 - margin
    || bottom > 1 - margin
    || rect.width < 0
    || rect.height < 0
  ) {
    return {
      code: 'ui.component.layout-out-of-bounds',
      message: `控件布局超出舞台安全区：left=${rect.left.toFixed(3)}, top=${rect.top.toFixed(3)}, width=${rect.width.toFixed(3)}, height=${rect.height.toFixed(3)}；安全边距为 ${contract.safeMargin}`,
    }
  }

  if (contract.minSize && (rect.width < contract.minSize.width || rect.height < contract.minSize.height)) {
    return {
      code: 'ui.component.layout-too-small',
      message: `控件布局小于建议最小尺寸：width=${rect.width.toFixed(3)}, height=${rect.height.toFixed(3)}；最小值为 ${contract.minSize.width} × ${contract.minSize.height}`,
    }
  }
  return null
}
