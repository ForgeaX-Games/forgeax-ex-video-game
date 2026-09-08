import { t as translateUi } from '../../i18n'
/**
 * 交互按键冲突输入：冲突时红底展示「按键重复」，悬浮显示 antd 风格气泡说明占用方。
 */
import { useId, useState, type CSSProperties, type JSX } from 'react'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

const CSS = `
.kci-root {
  position: relative;
  display: block;
  width: 100%;
  min-width: 0;
}
.kci-field {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 28px;
  box-sizing: border-box;
  border-radius: 6px;
  border: 1px solid transparent;
  background: rgba(255,255,255,.06);
  overflow: hidden;
}
.kci-field.is-conflict {
  background: #ff6b6b;
  border-color: #ff6b6b;
}
.kci-field input {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0 10px;
  border: 0;
  outline: none;
  background: transparent;
  color: #fff;
  font: inherit;
  font-size: 12px;
}
.kci-field.is-conflict input {
  color: rgba(255,255,255,.92);
}
.kci-field input::placeholder {
  color: rgba(255,255,255,.35);
}
.kci-badge {
  flex: none;
  padding: 0 10px 0 4px;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
}
.kci-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: 20;
  transform: translateX(-50%);
  box-sizing: border-box;
  max-width: min(360px, 70vw);
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(61, 61, 61, 1);
  color: rgba(255,255,255,.95);
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,.28);
}
.kci-tooltip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  margin-left: -5px;
  border: 5px solid transparent;
  border-top-color: rgba(61, 61, 61, 1);
}
`

export function KeyConflictInput({
  value,
  placeholder,
  conflict,
  tooltip,
  onChange,
  style,
}: {
  value: string
  placeholder?: string
  conflict: boolean
  /** 完整提示，如「按键C已应用于新方案 3-重攻击」。 */
  tooltip?: string | null
  onChange: (next: string) => void
  style?: CSSProperties
}): JSX.Element {
  injectStyleOnce('key-conflict-input', CSS)
  const tooltipId = useId()
  const [hovered, setHovered] = useState(false)
  const showTip = conflict && hovered && !!tooltip

  return (
    <span
      className="kci-root"
      style={style}
      data-key-conflict={conflict ? 'true' : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {showTip ? (
        <span className="kci-tooltip" id={tooltipId} role="tooltip">{tooltip}</span>
      ) : null}
      <span className={`kci-field${conflict ? ' is-conflict' : ''}`}>
        <input
          value={value}
          placeholder={placeholder}
          aria-invalid={conflict || undefined}
          aria-describedby={showTip ? tooltipId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {conflict ? <span className="kci-badge">{translateUi('ui.copy.d4dda30dd828')}</span> : null}
      </span>
    </span>
  )
}
