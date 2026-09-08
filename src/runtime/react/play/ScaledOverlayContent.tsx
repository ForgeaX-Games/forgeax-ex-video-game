import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/** 界面 tab 的标准 16:9 CSS 画布宽度；节点预览相对此尺寸等比缩小。 */
export const OVERLAY_LOGICAL_WIDTH = 960

export interface ScaledOverlayGeometry {
  logicalWidth: number
  logicalHeight: number
  scale: number
}

/** 节点预览以界面画布宽度排版，只在实际视频画布更小时等比缩小。 */
export function computeScaledOverlayGeometry(
  width: number,
  height: number,
  logicalWidth = OVERLAY_LOGICAL_WIDTH,
): ScaledOverlayGeometry | null {
  if (!(width > 0) || !(height > 0) || !(logicalWidth > 0)) return null
  const resolvedLogicalWidth = Math.max(width, logicalWidth)
  const scale = width / resolvedLogicalWidth
  return {
    logicalWidth: resolvedLogicalWidth,
    logicalHeight: height / scale,
    scale,
  }
}

export function ScaledOverlayContent({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [geometry, setGeometry] = useState<ScaledOverlayGeometry | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = (): void => {
      const rect = root.getBoundingClientRect()
      setGeometry(computeScaledOverlayGeometry(rect.width, rect.height))
    }
    update()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update)
      observer.observe(root)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const innerStyle: CSSProperties = geometry
    ? {
        position: 'absolute',
        left: 0,
        top: 0,
        width: geometry.logicalWidth,
        height: geometry.logicalHeight,
        transform: `scale(${geometry.scale})`,
        transformOrigin: '0 0',
        containerType: 'size',
        pointerEvents: 'none',
      }
    : {
        position: 'absolute',
        inset: 0,
        containerType: 'size',
        pointerEvents: 'none',
      }

  return (
    <div
      ref={rootRef}
      className={className}
      data-overlay-scale-root
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <div
        data-overlay-logical-stage
        data-overlay-scale={geometry?.scale}
        style={innerStyle}
      >
        {children}
      </div>
    </div>
  )
}
