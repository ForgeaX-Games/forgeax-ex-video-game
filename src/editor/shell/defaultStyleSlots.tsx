/**
 * 「添加控件」库面板 —— 默认六槏位的图标 + 标题 + 说明，单一集合来源。
 *
 * 只放**纯展示常量**：图标 SVG、标题、描述文案，按 `DEFAULT_STYLE_SLOTS` 顺序渲染即为
 * 面板默认 tab 的六张卡片。各卡片的禁用判断（qteDisabled / optionDisabled / addDisabled）
 * 依赖当前节点状态，由调用方按 `slot.id` 查表，不下沉到这里。
 *
 * 非默认槏位（方案挂载目录里的组件）复用 `ICON_COMPONENT` 通用图标，不在
 * `DEFAULT_STYLE_SLOTS` 之列。
 */
import type { JSX } from 'react'

export const ICON_SUBTITLE: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M6.5 11.5 h3 M11.5 11.5 h6 M6.5 14.5 h6.5 M15 14.5 h2.5" />
  </svg>
)

export const ICON_OVERLAY: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3.6 13.7 9 19.1 10.7 13.7 12.4 12 17.8 10.3 12.4 4.9 10.7 10.3 9 Z" />
    <circle cx="18.7" cy="5.3" r="1.05" />
    <circle cx="5.4" cy="17" r="1.05" />
  </svg>
)

export const ICON_QTE: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="7.4" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1.8 v2.6 M12 19.6 v2.6 M1.8 12 h2.6 M19.6 12 h2.6" />
  </svg>
)

export const ICON_OPTION: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="5.2" cy="12" r="2.2" />
    <circle cx="18.6" cy="5.6" r="2.2" />
    <circle cx="18.6" cy="18.4" r="2.2" />
    <path d="M7.3 11 C 11.2 9.4, 13.2 7.4, 16.5 6.2" />
    <path d="M7.3 13 C 11.2 14.6, 13.2 16.6, 16.5 17.8" />
  </svg>
)

export const ICON_FILTER: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="9" cy="9" r="5" />
    <circle cx="15" cy="15" r="5" />
  </svg>
)

export const ICON_FX: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 2.5 14 8.4 20 10 14.6 12.3 12 18 9.4 12.3 4 10 10 8.4 Z" />
    <path d="M18.5 3 v3 M20 4.5 h-3 M5 16 v2.6 M6.3 17.3 H3.7" />
  </svg>
)

/** 方案挂载目录组件通用图标（二级栏 · 非默认槏位卡片用）。 */
export const ICON_COMPONENT: JSX.Element = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
)

export interface DefaultStyleSlot {
  /** 对齐 `MaterialTemplate` 里的固定值，也是 `addMaterial()` 的 template 入参。 */
  id: 'subtitle' | 'overlay' | 'qte' | 'option' | 'filter' | 'fx'
  icon: JSX.Element
  title: string
  desc: string
}

/** 「添加控件」默认 tab 的六张卡片，渲染顺序即数组顺序。 */
export const DEFAULT_STYLE_SLOTS: DefaultStyleSlot[] = [
  { id: 'subtitle', icon: ICON_SUBTITLE, title: '字幕', desc: '底栏对白/旁白字幕，可拖动显示时段。' },
  { id: 'overlay', icon: ICON_OVERLAY, title: '飘字', desc: '画面上的文字/数值飘字，可选到点结算扣血。' },
  {
    id: 'qte',
    icon: ICON_QTE,
    title: 'QTE 按键点',
    desc: '限时按键点，写入当前节点 QTE 轨；同节点多个按键点自动归入这一段 QTE（一次结算）。',
  },
  { id: 'option', icon: ICON_OPTION, title: '选项', desc: '添加节点选项，可切换清单或画面热区。' },
  { id: 'filter', icon: ICON_FILTER, title: '滤镜', desc: '一段时间内给画面调色（黑白/怀旧/暖冷调/鲜艳/梦幻）。' },
  { id: 'fx', icon: ICON_FX, title: '特效', desc: '画面特效（闪白/染色/暗角/震屏/变焦冲击）。' },
]
