/**
 * NodePreviewStage 两种模式共用的纯展示件。
 *
 * 这里只承载图标和时间格式，不接触播放状态或回调；Editable / Flow 各自保留原有业务控制权。
 */

/** HUD 时长格式（Figma 14935:70362：`00:00`，分秒皆两位）。 */
export function formatPreviewTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

/** 暂停态使用的实心播放三角。 */
export function PreviewPlayIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 15.618 15.618" fill="none" aria-hidden>
      <path d="M4.2 2.6 L11.6 7.809 L4.2 13.018 Z" fill="currentColor" />
    </svg>
  )
}

/** Figma 14935:70362：15.618 盒内两根暂停柱。 */
export function PreviewPauseIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 15.618 15.618" fill="none" aria-hidden>
      <rect x="3.904" y="1.952" width="1.952" height="11.713" fill="currentColor" />
      <rect x="9.761" y="1.952" width="1.952" height="11.714" fill="currentColor" />
    </svg>
  )
}

/** Figma 14935:70362 同族的 Volume2 glyph。 */
export function PreviewVolumeIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

/** Figma 15635:84858 的 cphrefresh 双弧箭头。 */
export function PreviewRefreshIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 13.7283 13.6675" fill="none" aria-hidden>
      <path
        d="M13.0133 7.48458C12.6881 10.5934 10.0592 13.0167 6.86425 13.0167C4.37954 13.0167 2.23716 11.551 1.25449 9.43708M0.681329 12.3658V9.11167H2.63383M0.715016 6.18292C1.04023 3.07411 3.66917 0.650833 6.86411 0.650833C9.3488 0.650833 11.4911 2.11649 12.4738 4.23042M13.047 1.30167V4.55583H11.0945"
        stroke="currentColor"
        strokeWidth="1.30167"
        strokeLinecap="square"
      />
    </svg>
  )
}
