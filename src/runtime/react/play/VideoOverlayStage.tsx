/**
 * 视频 overlay 舞台 —— 与 object-fit:contain 后的实际画面矩形对齐。
 * HUD / 表现叠层 / 交互层均相对这块定位，视频缩放或换比例时跟着视频走。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { VideoContentRect } from './videoContentRect'
import { ScaledOverlayContent } from './ScaledOverlayContent'

export function videoOverlayStageStyle(contentRect: VideoContentRect | null): CSSProperties {
  // containerType: 'size' 开容器查询上下文——皮肤里的 cqw/cqh 才能相对这块「舞台」解析，
  // 与编辑器预览的 `.gc-preview-overlays`（见 catalogCss.ts）保持同一套基准，否则同一份
  // cqh 配置在预览和全屏试玩里会解析出不同的物理尺寸。
  const base: CSSProperties = { containerType: 'size', pointerEvents: 'none' }
  return contentRect
    ? { ...base, position: 'absolute', left: contentRect.left, top: contentRect.top, width: contentRect.width, height: contentRect.height }
    : { ...base, position: 'absolute', inset: 0 }
}

export function VideoOverlayStage({
  contentRect,
  className,
  children,
}: {
  contentRect: VideoContentRect | null
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className={className} style={videoOverlayStageStyle(contentRect)}>
      <ScaledOverlayContent>{children}</ScaledOverlayContent>
    </div>
  )
}
