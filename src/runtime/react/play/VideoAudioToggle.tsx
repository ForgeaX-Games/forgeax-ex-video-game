export interface VideoAudioToggleProps {
  enabled: boolean
  onToggle: () => void
  compact?: boolean
}

/** 用户手势驱动的视频原声开关；默认状态由播放入口持有。 */
export function VideoAudioToggle({ enabled, onToggle, compact = false }: VideoAudioToggleProps): JSX.Element {
  const label = enabled ? '关闭视频原声' : '开启视频原声'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      onClick={onToggle}
      style={{
        minWidth: compact ? 24 : 32,
        height: compact ? 24 : 28,
        padding: compact ? 0 : '0 7px',
        borderRadius: 6,
        border: `1px solid ${enabled ? '#f08840' : 'rgba(255,255,255,0.18)'}`,
        background: enabled ? '#2f2923' : 'rgba(27,23,19,0.78)',
        color: enabled ? '#f5bd75' : '#c9d1e0',
        cursor: 'pointer',
        fontSize: compact ? 13 : 14,
        lineHeight: 1,
      }}
    >
      {enabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'}
    </button>
  )
}
