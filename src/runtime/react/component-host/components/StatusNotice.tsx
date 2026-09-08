/**
 * 状态提示（component id: `StatusNotice`）。
 * 文案由 RuntimeComponentHost 解析后以扁平 props 传入；此处只展示。
 */
import type { ReactNode } from 'react'
import { animationTimingStyle, injectCss, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'

export { StatusNoticeManifest } from '@/runtime/core/component-catalog/StatusNotice.manifest'

export interface StatusNoticeProps {
  fixedText?: string
  parameter?: string
  color?: string
  fontSize?: number
  durationMs?: number
  preview?: boolean
  previewTimeMs?: number
  previewPlaying?: boolean
}

export function StatusNotice({
  fixedText = '获得道具',
  parameter = '〈xxx〉',
  color,
  fontSize,
  durationMs = 1600,
  preview,
  previewTimeMs,
  previewPlaying,
}: StatusNoticeProps): ReactNode {
  injectCss('status-notice', STATUS_NOTICE_CSS)
  const text = `${fixedText}${parameter}`
  const frozen = preview && !previewPlaying
  const textStyle = resolveTextAppearance({ color, fontSize } as TextAppearanceInputs, { color: '#f0f0f0', fontSize: 2.4 })

  return (
    <div
      className={`gv-status-notice${frozen ? ' is-preview-frozen' : ''}`}
      style={animationTimingStyle(durationMs, frozen ? previewTimeMs ?? 0 : undefined)}
    >
      <span data-overlay-fit-target style={textStyle}>{text}</span>
    </div>
  )
}

const STATUS_NOTICE_CSS = `
.gv-status-notice{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-status-notice span{font-size:var(--gv-text-font-size,2.4cqh);font-weight:700;line-height:1.5;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.7);white-space:pre-wrap;animation:gv-status-notice-in var(--gv-animation-duration,1600ms) ease-out forwards}
.gv-status-notice.is-preview-frozen span{animation-play-state:paused;animation-delay:calc(0ms - var(--preview-t,0ms))}
@keyframes gv-status-notice-in{0%{opacity:0;transform:translateY(16%) scale(.96)}12%{opacity:1;transform:translateY(0) scale(1)}78%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-12%) scale(1.02)}}
`
