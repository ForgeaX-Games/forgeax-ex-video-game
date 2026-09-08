/**
 * video-fx —— 滤镜 / 特效纯解析（runtime-neutral）。
 * 数据：overlay 展开后的 children 里 kind:'filter'|'fx' 的项。
 */
import type { OverlayInstanceChild } from '../schema/node-config-schema'
import type { GameNode, Overlay } from '../schema/graph-schema'
import { expandNodeOverlays } from '../schema/expand-overlay'

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t)
}
function round(v: number, d = 3): number {
  const p = 10 ** d
  return Math.round(v * p) / p
}

export interface FilterPreset {
  id: string
  label: string
  css: (intensity: number) => string
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: '无', css: () => '' },
  { id: 'grayscale', label: '黑白', css: (i) => `grayscale(${round(i)})` },
  { id: 'sepia', label: '怀旧', css: (i) => `sepia(${round(i)})` },
  {
    id: 'warm',
    label: '暖调',
    css: (i) => `sepia(${round(0.3 * i)}) saturate(${round(lerp(1, 1.35, i))}) brightness(${round(lerp(1, 1.05, i))}) hue-rotate(${round(-8 * i, 1)}deg)`,
  },
  {
    id: 'cool',
    label: '冷调',
    css: (i) => `saturate(${round(lerp(1, 1.15, i))}) contrast(${round(lerp(1, 1.05, i))}) brightness(${round(lerp(1, 0.98, i))}) hue-rotate(${round(-16 * i, 1)}deg)`,
  },
  { id: 'noir', label: '黑色电影', css: (i) => `grayscale(1) contrast(${round(lerp(1, 1.5, i))}) brightness(${round(lerp(1, 0.92, i))})` },
  { id: 'vivid', label: '鲜艳', css: (i) => `saturate(${round(lerp(1, 1.7, i))}) contrast(${round(lerp(1, 1.15, i))})` },
  { id: 'dream', label: '梦幻', css: (i) => `brightness(${round(lerp(1, 1.1, i))}) saturate(${round(lerp(1, 1.25, i))}) blur(${round(1.2 * i, 2)}px)` },
]
const FILTER_BY_ID = new Map(FILTER_PRESETS.map((p) => [p.id, p]))
export const FILTER_OPTIONS = FILTER_PRESETS.map((p) => ({ value: p.id, label: p.label }))

export type FxKindId = 'flash' | 'tint' | 'vignette' | 'shake' | 'zoom'
export interface FxPreset {
  id: FxKindId
  label: string
  color?: boolean
  defaultColor?: string
}
export const FX_PRESETS: FxPreset[] = [
  { id: 'flash', label: '闪白/闪光', color: true, defaultColor: '#ffffff' },
  { id: 'tint', label: '染色', color: true, defaultColor: '#ff5533' },
  { id: 'vignette', label: '暗角' },
  { id: 'shake', label: '震屏' },
  { id: 'zoom', label: '变焦冲击' },
]
export const FX_OPTIONS = FX_PRESETS.map((p) => ({ value: p.id, label: p.label }))
export function fxNeedsColor(fx: string | undefined): boolean {
  return FX_PRESETS.find((p) => p.id === fx)?.color ?? false
}

export interface FxOverlay {
  id: string
  style: Record<string, string | number>
}
export interface VideoFxRender {
  filter?: string
  transform?: string
  overlays: FxOverlay[]
}

function winStart(el: OverlayInstanceChild): number {
  return el.window?.startMs ?? 0
}
function winEnd(el: OverlayInstanceChild, maxMs: number): number {
  return el.window?.endMs ?? maxMs
}
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

/** 当前 ms 下、给定 children 要施加的滤镜/特效。 */
export function resolveVideoFxRender(children: OverlayInstanceChild[], ms: number, maxMs: number): VideoFxRender {
  const filters: string[] = []
  const transforms: string[] = []
  const overlays: Array<{ zIndex: number; ov: FxOverlay }> = []

  for (const el of children) {
    const start = winStart(el)
    const end = winEnd(el, maxMs)
    if (ms < start || ms > end) continue
    const zIndex = num(el.layout?.zIndex, 0)

    if (el.component === 'filter') {
      const preset = FILTER_BY_ID.get((el.inputs.filter as string) ?? 'warm')
      const css = preset?.css(num(el.inputs.intensity, 1)) ?? ''
      if (css) filters.push(css)
      continue
    }
    if (el.component !== 'fx') continue

    const fx = (el.inputs.fx as FxKindId) ?? 'flash'
    const intensity = clamp01(num(el.inputs.intensity, 1))
    const color = (el.inputs.color as string) || FX_PRESETS.find((p) => p.id === fx)?.defaultColor || '#ffffff'
    const span = Math.max(1, end - start)
    const progress = clamp01((ms - start) / span)

    if (fx === 'flash') {
      overlays.push({ zIndex, ov: { id: `fx:${el.id}`, style: { background: color, opacity: round(intensity * (1 - progress), 3) } } })
    } else if (fx === 'tint') {
      overlays.push({ zIndex, ov: { id: `fx:${el.id}`, style: { background: color, mixBlendMode: 'multiply', opacity: round(0.55 * intensity, 3) } } })
    } else if (fx === 'vignette') {
      const dark = round(0.85 * intensity, 3)
      overlays.push({
        zIndex,
        ov: { id: `fx:${el.id}`, style: { background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${dark}) 100%)`, opacity: 1 } },
      })
    } else if (fx === 'shake') {
      const amp = 7 * intensity
      transforms.push(`translate(${round(Math.sin(ms / 38) * amp, 2)}px, ${round(Math.cos(ms / 31) * amp, 2)}px)`)
    } else if (fx === 'zoom') {
      const env = 1 - progress
      transforms.push(`scale(${round(1 + 0.18 * intensity * env, 4)})`)
    }
  }

  return {
    filter: filters.length ? filters.join(' ') : undefined,
    transform: transforms.length ? transforms.join(' ') : undefined,
    overlays: overlays.sort((a, b) => a.zIndex - b.zIndex).map((o) => o.ov),
  }
}

/** 从节点 + overlays 目录解析。 */
export function resolveVideoFxForNode(
  node: GameNode | undefined,
  overlays: Record<string, Overlay> | undefined,
  ms: number,
  maxMs: number,
): VideoFxRender {
  if (!node) return { overlays: [] }
  return resolveVideoFxRender(expandNodeOverlays(overlays, node).flatMap((i) => i.children), ms, maxMs)
}
