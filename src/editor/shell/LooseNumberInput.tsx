import { useState, type CSSProperties, type JSX } from 'react'

/** 允许输入过程中的 `-` / `.` / `-0.`；避免 `Number(x)||0` 把负数/小数草稿打回 0。 */
const LOOSE_NUM_RE = /^[+-]?(\d+\.?\d*|\.\d*)?$/

export function LooseNumberInput({
  value,
  onChange,
  emptyValue,
  className,
  style,
  title,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: number
  onChange: (n: number) => void
  /** 草稿留空并失焦时写入的默认值；不传则恢复最近一次有效值。 */
  emptyValue?: number
  className?: string
  style?: CSSProperties
  title?: string
  placeholder?: string
  'aria-label'?: string
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      aria-label={ariaLabel}
      value={shown}
      style={style}
      title={title}
      placeholder={placeholder}
      onFocus={() => setDraft(String(value))}
      onBlur={() => {
        const raw = (draft ?? '').trim()
        const n = Number(raw)
        onChange(raw !== '' && Number.isFinite(n) ? n : (emptyValue ?? value))
        setDraft(null)
      }}
      onChange={(e) => {
        const next = e.target.value
        if (next !== '' && !LOOSE_NUM_RE.test(next)) return
        setDraft(next)
        if (next === '' || next === '+' || next === '-' || next === '.' || next === '+.' || next === '-.') return
        const n = Number(next)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}
