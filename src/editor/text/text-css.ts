/**
 * GraphTextStyle → React CSSProperties（图原生，编辑器与播放器共用）。
 * 字段已与 CSS 同名；此处只做 fontSize→cqh、字体解析、缺省兜底，以及底色时的 padding 糖。
 */
import type { CSSProperties } from 'react'
import type { GraphTextStyle } from '@/runtime/core/schema/graph-schema'
import { resolveFontFamily } from './font-presets'

export function resolveGraphTextCss(
  style: GraphTextStyle | undefined,
  opts?: { fillDefaults?: boolean; fallbackColor?: string },
): CSSProperties {
  const s = style ?? {}
  const fill = opts?.fillDefaults ?? false
  const strokeColor = s.WebkitTextStrokeColor ?? (fill ? '#000000' : undefined)
  const strokeWidth = s.WebkitTextStrokeWidth ?? (fill ? 2 : undefined)
  const stroke = strokeColor && strokeWidth ? `${strokeWidth}px ${strokeColor}` : undefined
  return {
    fontFamily: resolveFontFamily(s.fontFamily),
    color: s.color ?? opts?.fallbackColor ?? (fill ? '#ffffff' : undefined),
    fontWeight: s.fontWeight ?? (fill ? 700 : undefined),
    textDecoration: s.textDecoration,
    fontSize: s.fontSize != null ? `${s.fontSize}cqh` : undefined,
    textAlign: s.textAlign,
    backgroundColor: s.backgroundColor,
    opacity: s.opacity,
    WebkitTextStroke: stroke,
    textShadow: s.textShadow ?? (fill ? '0 2px 6px rgba(0,0,0,0.6)' : undefined),
    padding: s.backgroundColor ? '2px 8px' : undefined,
    borderRadius: s.backgroundColor ? 4 : undefined,
  }
}
