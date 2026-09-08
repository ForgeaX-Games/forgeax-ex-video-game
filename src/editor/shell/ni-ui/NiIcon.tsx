/**
 * NiIcon —— 节点面板图标。几何全部来自 Figma 导出的 svg（`assets/ni-icons/`），
 * 这里只负责尺寸与上色：用 mask 让图标吃 `currentColor`，同一个文件可以在
 * 白 100% / 60% / 40% 三档下复用，不用为每种颜色再导一份。
 */
import type { CSSProperties, JSX } from 'react'
import { ensureNiUiStyle } from './theme'
import chevronUrl from '../assets/ni-icons/chevron.svg'
import muteUrl from '../assets/ni-icons/mute.svg'
import pencilUrl from '../assets/ni-icons/pencil.svg'
import playUrl from '../assets/ni-icons/play.svg'
import plusUrl from '../assets/ni-icons/plus.svg'
import trashUrl from '../assets/ni-icons/trash.svg'
import unfoldUrl from '../assets/ni-icons/unfold.svg'
import volumeUrl from '../assets/ni-icons/volume.svg'

/** `close` 与 `plus` 同一份几何：设计稿里的 ✕ 就是把 ＋ 转 45°（Figma 15635:81615）。 */
const ICON_URL = {
  chevron: chevronUrl,
  mute: muteUrl,
  pencil: pencilUrl,
  play: playUrl,
  plus: plusUrl,
  close: plusUrl,
  trash: trashUrl,
  /** 上下双箭头，折叠卡片的展开/收起（Figma dfrunfold-more · 15635:84476）。 */
  unfold: unfoldUrl,
  volume: volumeUrl,
} as const

export type NiIconName = keyof typeof ICON_URL

/** 导出的 chevron 指向左；面板里的四个方向都由它旋转得到。 */
const ICON_ROTATION: Partial<Record<NiIconName, number>> = {
  close: 45,
}

/**
 * 构建器可能把小 SVG 内联成仍含双引号的原始 data URI。直接拼进 `url("...")` 会让 SVG
 * 属性的双引号提前结束 CSS 字符串，浏览器随后丢弃整条 mask 声明。保留已有 `%HH` escape、
 * 编码其余 payload，确保 raw/已编码 data URI 和普通资源 URL 都能作为合法的 CSS url() 使用。
 */
export function iconMaskUrl(url: string): string {
  const svgDataPrefix = 'data:image/svg+xml,'
  if (url.startsWith(svgDataPrefix)) {
    const payload = url.slice(svgDataPrefix.length)
    let encodedPayload = ''
    let cursor = 0
    for (const match of payload.matchAll(/%[0-9a-f]{2}/gi)) {
      encodedPayload += encodeURIComponent(payload.slice(cursor, match.index))
      encodedPayload += match[0].toUpperCase()
      cursor = (match.index ?? 0) + match[0].length
    }
    encodedPayload += encodeURIComponent(payload.slice(cursor))
    return `url("${svgDataPrefix}${encodedPayload}")`
  }
  return `url(${JSON.stringify(url)})`
}

export function NiIcon({
  name,
  size = 14,
  rotate,
  style,
}: {
  name: NiIconName
  size?: number
  /** 额外旋转角（度）。chevron 传 -90 得到向下、90 得到向上。 */
  rotate?: number
  style?: CSSProperties
}): JSX.Element {
  // 图标可能渲染在 .ni-root 之外（共享编辑器），样式表不能只靠面板根去注入。
  ensureNiUiStyle()
  const url = ICON_URL[name]
  const deg = (ICON_ROTATION[name] ?? 0) + (rotate ?? 0)
  const maskUrl = iconMaskUrl(url)
  return (
    <span
      className="ni-icon"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        WebkitMaskImage: maskUrl,
        maskImage: maskUrl,
        ...(deg ? { transform: `rotate(${deg}deg)` } : {}),
        ...style,
      }}
    />
  )
}

/**
 * 给注入式 CSS 用的图标 mask 声明。
 *
 * 有些按钮由共享编辑器（editors.tsx 等）渲染，改不了它的 JSX，只能在作用域 CSS 里把文字
 * 压掉、用伪元素贴图标。这里与 JSX 图标共用同一份 URL 编码，避免不同构建器产出的 SVG
 * data URI 因引号或保留字符而让整条 mask 声明失效。
 *
 * 用法：`.foo::before { content:''; width:12px; height:12px; background:currentColor; ${niIconMaskCss('trash')} }`
 */
export function niIconMaskCss(name: NiIconName): string {
  const url = `${iconMaskUrl(ICON_URL[name])} no-repeat center / contain`
  return `-webkit-mask: ${url}; mask: ${url};`
}

/** 下拉右侧的展开箭头：稿子里是 16px 方框里一枚向下的 chevron。 */
export function NiChevronDown({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <span
      className="ni-select-chevron"
      aria-hidden="true"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}
    >
      <NiIcon name="chevron" size={size * 0.667} rotate={-90} />
    </span>
  )
}
