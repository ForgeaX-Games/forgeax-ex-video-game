import { t as translateUi } from '../../i18n'
/**
 * ColorPicker —— 自研取色器（无第三方依赖）。
 *
 * 折叠态 = 显示当前色的色块按钮；点击展开浮层：色相饱和度方形拖拽面 + 色相条 +
 * 透明度条 + hex/rgba 文本框 + 预设色块。交互布局参考 react-colorful / Element Plus
 * 的经典取色器范式，但不引入第三方库，样式走本包既有的 `injectStyleOnce` 惯例。
 *
 * 值契约：接收/产出 `#rrggbb`（不透明）或 `rgba(r,g,b,a)`（a<1）字符串，与现有
 * `GraphTextStyle.color` / `inputs.color`（`component: 'color'`）的存值格式完全兼容——
 * 换这个控件不改变任何落盘数据形状。
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

interface Rgba { r: number; g: number; b: number; a: number }
interface Hsv { h: number; s: number; v: number }

const HEX3_RE = /^#([0-9a-f]{3})$/i
const HEX6_RE = /^#([0-9a-f]{6})$/i
const RGBA_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function parseColor(input: string | undefined): Rgba | null {
  const s = (input ?? '').trim()
  if (!s) return null
  const hex6 = HEX6_RE.exec(s)
  if (hex6) {
    const v = hex6[1]!
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 }
  }
  const hex3 = HEX3_RE.exec(s)
  if (hex3) {
    const v = hex3[1]!
    return { r: parseInt(v[0]! + v[0], 16), g: parseInt(v[1]! + v[1], 16), b: parseInt(v[2]! + v[2], 16), a: 1 }
  }
  const rgba = RGBA_RE.exec(s)
  if (rgba) {
    return {
      r: clamp(Number(rgba[1]), 0, 255),
      g: clamp(Number(rgba[2]), 0, 255),
      b: clamp(Number(rgba[3]), 0, 255),
      a: rgba[4] !== undefined ? clamp(Number(rgba[4]), 0, 1) : 1,
    }
  }
  return null
}

function hex2(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')
}

function formatColor(c: Rgba): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
  const a = Math.round(c.a * 100) / 100
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${a})`
}

function rgbToHsv({ r, g, b }: Rgba): Hsv {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = (((gn - bn) / d) % 6) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hsvToRgb({ h, s, v }: Hsv): Omit<Rgba, 'a'> {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

const PRESETS = [
  '#ffffff', '#000000', '#ff4d4f', '#ffb056', '#ffd24a',
  '#4ade80', '#5b9eff', '#cc9bfa', '#d4ff48', 'rgba(0,0,0,0.45)',
]

injectStyleOnce('color-picker', `
.gc-cp-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 8px; border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-sm, 4px); background: var(--color-background-base, #191919);
  cursor: pointer; font-size: 11px; font-family: var(--font-mono, monospace); color: inherit; flex: 1; min-width:0;
}
.gc-cp-swatch {
  position:relative; overflow:hidden; box-sizing:border-box;
  width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid rgba(162, 162, 162, 1);
  background-image:
    linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%);
  background-size: 6px 6px; background-position: 0 0, 0 3px, 3px -3px, -3px 0;
  background-color: #999;
}
.gc-cp-swatch-color { position:absolute; inset:0; border-radius:inherit; }
.gc-cp-value { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:left; }
.gc-cp-panel {
  z-index: var(--z-top, 9999); box-sizing: border-box;
  width: 220px; padding: 10px; border-radius: var(--radius-md, 8px);
  background: var(--color-background-floating, #333); border: 1px solid var(--color-border-default, #404040);
  box-shadow: var(--ks-shadow-lift, 0 8px 24px rgba(0,0,0,.5));
  display: flex; flex-direction: column; gap: 8px;
}
.gc-cp-sv { position: relative; width: 100%; height: 120px; border-radius: 6px; cursor: crosshair; touch-action: none; }
.gc-cp-sv-thumb {
  position: absolute; width: 10px; height: 10px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.4); transform: translate(-50%, -50%); pointer-events: none;
}
.gc-cp-slider { position: relative; width: 100%; height: 12px; border-radius: 6px; cursor: pointer; touch-action: none; }
.gc-cp-slider-thumb {
  position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; border: 1px solid rgba(0,0,0,.35); box-shadow: 0 0 0 1px rgba(0,0,0,.2);
  transform: translate(-50%, -50%); pointer-events: none;
}
.gc-cp-hex-row { display: flex; gap: 4px; align-items: center; }
.gc-cp-hex-row input { flex: 1; min-width: 0; font-family: var(--font-mono, monospace); font-size: 11px; padding: 4px 6px; }
.gc-cp-presets { display: flex; flex-wrap: wrap; gap: 4px; }
.gc-cp-preset { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(255,255,255,.2); cursor: pointer; padding: 0; }
.gc-cp-preset:hover { outline: 1px solid var(--color-brand-primary, #d4ff48); }
`)

/** 统一「按下即定位 + 拖拽跟随」——sv 面板 / 色相条 / 透明度条三处共用同一套指针逃生舱。 */
function useDrag(
  ref: RefObject<HTMLDivElement>,
  onMove: (fracX: number, fracY: number) => void,
): (e: React.PointerEvent) => void {
  return (e) => {
    e.preventDefault()
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const move = (clientX: number, clientY: number) => {
      const fx = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0
      const fy = rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0
      onMove(fx, fy)
    }
    move(e.clientX, e.clientY)
    const onPointerMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY)
    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }
}

export function ColorPicker({
  value,
  onChange,
  placeholder = '#ffffff',
}: {
  value: string | undefined
  onChange: (next: string | undefined) => void
  placeholder?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const alphaRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)

  const parsedValue = parseColor(value)
  const parsedPlaceholder = parseColor(placeholder)
  const configuredColor = parsedValue ?? parsedPlaceholder
  const seed = configuredColor ?? { r: 255, g: 255, b: 255, a: 1 }
  const previewColor = configuredColor ? formatColor(configuredColor) : undefined
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(seed))
  const [alpha, setAlpha] = useState(seed.a)
  const [hexDraft, setHexDraft] = useState<string | null>(null)

  // 外部 value 变化（比如切换了正在编辑的元素）才重新同步内部 HSV/alpha；
  // 自己拖拽产生的 onChange 不应该反过来打断当前手势（尤其饱和度=0 时 hue 不可逆推）。
  const lastEmitted = useRef(value)
  const lastPlaceholder = useRef(placeholder)
  useEffect(() => {
    if (value === lastEmitted.current && placeholder === lastPlaceholder.current) return
    lastEmitted.current = value
    lastPlaceholder.current = placeholder
    const p = parseColor(value) ?? parseColor(placeholder) ?? { r: 255, g: 255, b: 255, a: 1 }
    setHsv(rgbToHsv(p))
    setAlpha(p.a)
  }, [placeholder, value])

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger || typeof window === 'undefined') return
      const rect = trigger.getBoundingClientRect()
      const panel = panelRef.current
      const width = panel?.offsetWidth || 220
      const height = panel?.offsetHeight || 250
      const gap = 4
      const spaceBelow = window.innerHeight - rect.bottom
      const above = spaceBelow < height + gap && rect.top > spaceBelow
      setPanelStyle({
        position: 'fixed',
        top: above ? Math.max(8, rect.top - height - gap) : Math.min(rect.bottom + gap, window.innerHeight - height - 8),
        left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8),
      })
    }
    place()
    requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  function emit(nextHsv: Hsv, nextAlpha: number): void {
    const next = formatColor({ ...hsvToRgb(nextHsv), a: nextAlpha })
    // 拖动选色时退出手动文本草稿，让弹层输入框立即展示同一份实时色值。
    setHexDraft(null)
    lastEmitted.current = next
    onChange(next)
  }

  const onSvDown = useDrag(svRef, (fx, fy) => {
    const next = { ...hsv, s: fx, v: 1 - fy }
    setHsv(next)
    emit(next, alpha)
  })
  const onHueDown = useDrag(hueRef, (fx) => {
    const next = { ...hsv, h: fx * 360 }
    setHsv(next)
    emit(next, alpha)
  })
  const onAlphaDown = useDrag(alphaRef, (fx) => {
    setAlpha(fx)
    emit(hsv, fx)
  })

  const rgb = hsvToRgb(hsv)
  const opaqueHex = formatColor({ ...rgb, a: 1 })
  const currentColor = formatColor({ ...rgb, a: alpha })
  const hexShown = hexDraft ?? currentColor.toUpperCase()

  function commitHex(text: string): void {
    const p = parseColor(text.trim())
    if (!p) return
    setHsv(rgbToHsv(p))
    setAlpha(p.a)
    const next = formatColor(p)
    lastEmitted.current = next
    onChange(next)
  }

  const panel = open ? (
    <div
      ref={panelRef}
      className="gc-cp-panel"
      style={panelStyle ?? { position: 'fixed', top: 8, left: 8, visibility: 'hidden' }}
    >
          <div
            ref={svRef}
            className="gc-cp-sv"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h},100%,50%))` }}
            onPointerDown={onSvDown}
          >
            <div className="gc-cp-sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: opaqueHex }} />
          </div>
          <div
            ref={hueRef}
            className="gc-cp-slider"
            style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            onPointerDown={onHueDown}
          >
            <div className="gc-cp-slider-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div
            ref={alphaRef}
            className="gc-cp-slider"
            style={{
              background: `linear-gradient(to right, transparent, ${opaqueHex}), repeating-conic-gradient(#666 0% 25%, transparent 0% 50%) 0 0 / 8px 8px`,
            }}
            onPointerDown={onAlphaDown}
          >
            <div className="gc-cp-slider-thumb" style={{ left: `${alpha * 100}%` }} />
          </div>
          <div className="gc-cp-hex-row">
            <input
              value={hexShown}
              onFocus={() => setHexDraft(hexShown)}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => {
                if (hexDraft != null) commitHex(hexDraft)
                setHexDraft(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              placeholder={placeholder}
            />
            <button type="button" title={translateUi('ui.copy.7b15e5e8e7bd')} onClick={() => { onChange(undefined); setOpen(false) }} style={{ fontSize: 11 }}>×</button>
          </div>
          <div className="gc-cp-presets">
            {PRESETS.map((p) => (
              <button key={p} type="button" className="gc-cp-preset" style={{ background: p }} title={p} onClick={() => commitHex(p)} />
            ))}
          </div>
    </div>
  ) : null

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
      <button ref={triggerRef} type="button" className="gc-cp-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="gc-cp-swatch">
          <span
            className="gc-cp-swatch-color"
            style={{ backgroundColor: previewColor }}
          />
        </span>
        <span className="gc-cp-value">{(value?.trim() || placeholder).toUpperCase()}</span>
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  )
}
