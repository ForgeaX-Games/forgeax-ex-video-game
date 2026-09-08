/**
 * 皮肤自带运行时（component-host/ 内部工具箱）—— 让每个皮肤组件**自闭环**：只依赖 React + 本工具，
 * 不 import 游戏引擎其它代码。样式/SVG 滤镜都由皮肤自己注入，方便用户把组件整包拷走/替换。
 */
import type { CSSProperties } from 'react'

// Keep the font as a package asset instead of embedding 6MB into every
// browser bundle. tsup copies it to dist/, and Vite can rewrite this static
// URL when an Arrival build consumes the published package.
const brushFontUrl = new URL('./HYShangWei.woff2', import.meta.url).href

const injected = new Map<string, HTMLStyleElement>()

/** 同组件再次显示时不重复添加视觉规则，修改视觉规则后即时替换页面中的旧效果。 */
export function injectCss(id: string, css: string): void {
  if (typeof document === 'undefined') return
  const existing = injected.get(id)
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.setAttribute('data-skin-style', id)
  style.textContent = css
  document.head.appendChild(style)
  injected.set(id, style)
}

const INK_HOST_ID = 'skin-ink-filter-defs'
const INK_DEF = (id: string): string =>
  `<filter id="${id}" x="-20%" y="-60%" width="140%" height="220%">` +
  '<feTurbulence type="fractalNoise" baseFrequency="0.018 0.5" numOctaves="2" seed="7" result="n"/>' +
  '<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>' +
  '</filter>'

/** 注入 #inkRough / #inkRoughNarr 两个水墨毛边滤镜（幂等，全局一次）。 */
export function ensureInkFilters(): void {
  if (typeof document === 'undefined' || document.getElementById(INK_HOST_ID)) return
  const host = document.createElement('div')
  host.id = INK_HOST_ID
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  host.innerHTML = `<svg width="0" height="0" focusable="false" aria-hidden="true">${INK_DEF('inkRough')}${INK_DEF('inkRoughNarr')}</svg>`
  document.body.appendChild(host)
}

/** 注入水墨手书字体 HYShangWei（@font-face，幂等）。字体文件与本工具同层自带 */
export function ensureBrushFont(): void {
  injectCss(
    'skin-brush-font',
    `@font-face{font-family:'HYShangWei';src:url('${brushFontUrl}') format('woff2');font-weight:normal;font-style:normal;font-display:swap;}`,
  )
}

/**
 * catalog 叶子组件共享的文字外观输入。字段必须保持可选：皮肤定义身份默认值，
 * 组件只在自己的 manifest 中选择性暴露可由作者覆盖的字段。
 *
 * `fontSize` 的单位是画面高度百分比，渲染为 cqh；因此在不同画布尺寸下仍保持比例。
 */
export interface TextAppearanceInputs {
  color?: string
  fontSize?: number
}

/** 将可选作者覆盖合并进组件自己的文字默认值。 */
export function resolveTextAppearance(
  inputs: TextAppearanceInputs,
  defaults: Required<TextAppearanceInputs>,
): CSSProperties {
  return {
    color: inputs.color ?? defaults.color,
    // happy-dom 尚不解析 cqh；通过 CSS custom property 保持测试环境与浏览器表现一致。
    ['--gv-text-font-size']: `${inputs.fontSize ?? defaults.fontSize}cqh`,
  } as CSSProperties
}

/** 统一动画总时长与冻结预览时间轴的 CSS 变量契约。 */
export function animationTimingStyle(durationMs: number, previewTimeMs?: number): CSSProperties {
  return {
    ['--gv-animation-duration']: `${durationMs}ms`,
    ...(previewTimeMs == null ? {} : previewTStyle(previewTimeMs)),
  } as CSSProperties
}

/** 预览态 CSS 动画负 delay 使用的本地时间。 */
export function previewTStyle(localMs: number): CSSProperties {
  const normalizedMs = Math.round(Math.max(0, localMs) * 1000) / 1000
  return { ['--preview-t']: `${normalizedMs}ms` } as CSSProperties
}
