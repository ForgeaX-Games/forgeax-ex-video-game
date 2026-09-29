import { useCallback, useLayoutEffect, useState, type CSSProperties } from 'react'

export interface AdaptiveCatalogGridOptions {
  itemCount: number
  cardWidth: number
  minColumnGap: number
}

export interface AdaptiveCatalogGridLayout {
  columns: number
  columnGap: number
}

export function adaptiveCatalogGridLayout(
  availableWidth: number,
  { itemCount, cardWidth, minColumnGap }: AdaptiveCatalogGridOptions,
): AdaptiveCatalogGridLayout {
  const count = Math.max(0, itemCount)
  const fittingColumns = Math.max(1, Math.floor((availableWidth + minColumnGap) / (cardWidth + minColumnGap)))
  const columns = Math.max(1, Math.min(count || 1, fittingColumns))
  return {
    columns,
    columnGap: count <= fittingColumns || columns === 1
      ? minColumnGap
      : (availableWidth - columns * cardWidth) / (columns - 1),
  }
}

/** 固定宽度卡片的自适应列数与横向间距。 */
export function useAdaptiveCatalogGrid(options: AdaptiveCatalogGridOptions): {
  ref: (element: HTMLDivElement | null) => void
  style: CSSProperties
} {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<AdaptiveCatalogGridLayout>(() => adaptiveCatalogGridLayout(0, options))
  const ref = useCallback((next: HTMLDivElement | null) => setElement(next), [])

  useLayoutEffect(() => {
    if (!element) return
    const update = (): void => {
      const computed = getComputedStyle(element)
      const availableWidth = Math.max(
        0,
        element.clientWidth - Number.parseFloat(computed.paddingLeft) - Number.parseFloat(computed.paddingRight),
      )
      const configuredMinGap = Number.parseFloat(computed.getPropertyValue('--adaptive-grid-min-column-gap'))
      setLayout(adaptiveCatalogGridLayout(availableWidth, {
        ...options,
        minColumnGap: Number.isFinite(configuredMinGap) ? configuredMinGap : options.minColumnGap,
      }))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [element, options.cardWidth, options.itemCount, options.minColumnGap])

  return {
    ref,
    style: {
      '--adaptive-grid-columns': layout.columns,
      '--adaptive-grid-column-gap': `${layout.columnGap}px`,
    } as CSSProperties,
  }
}
