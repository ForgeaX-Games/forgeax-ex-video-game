import { useEffect, useRef, useState } from 'react'
import { pluginFetch } from '../../lib/plugin-http'

/**
 * 音频波形：解码音频 → 归一 min/max 峰值桶 → canvas 绘制（像剪辑软件那样的填充波形）。
 *
 * 峰值按 `src` 缓存（module 级），解码只做一次；缩放/改宽只重绘、不重解。
 * 解码失败（无音轨 / 跨域 / 不支持）→ 返回 null，宿主回退到 clip 的底纹背景。
 */
export interface WavePeaks {
  min: Float32Array
  max: Float32Array
  buckets: number
}

export type AudioWaveformVariant = 'envelope' | 'bars'

export function waveformBarHeights(peaks: WavePeaks, count: number): number[] {
  return Array.from({ length: Math.max(1, count) }, (_, bar) => {
    const start = Math.floor((bar / count) * peaks.buckets)
    const end = Math.max(start + 1, Math.floor(((bar + 1) / count) * peaks.buckets))
    let peak = 0
    for (let index = start; index < Math.min(end, peaks.buckets); index++) {
      peak = Math.max(peak, Math.abs(peaks.min[index]!), Math.abs(peaks.max[index]!))
    }
    return peak
  })
}

const BUCKETS = 2048
const peaksCache = new Map<string, Promise<WavePeaks | null>>()
let sharedCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!sharedCtx) sharedCtx = new AC()
  return sharedCtx
}

async function computePeaks(src: string): Promise<WavePeaks | null> {
  const ctx = getAudioCtx()
  if (!ctx) return null
  const waveformSource = /^https?:/i.test(src)
    ? `media/audio-waveform?url=${encodeURIComponent(src)}`
    : src
  const res = await pluginFetch(waveformSource)
  if (!res.ok) return null
  const raw = await res.arrayBuffer()
  const audio = await ctx.decodeAudioData(raw)
  if (audio.numberOfChannels === 0) return null
  const ch = audio.getChannelData(0)
  const min = new Float32Array(BUCKETS)
  const max = new Float32Array(BUCKETS)
  const per = Math.max(1, Math.floor(ch.length / BUCKETS))
  for (let b = 0; b < BUCKETS; b++) {
    const start = b * per
    const end = Math.min(ch.length, start + per)
    let lo = 0
    let hi = 0
    for (let i = start; i < end; i++) {
      const v = ch[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max, buckets: BUCKETS }
}

export function getWavePeaks(src: string): Promise<WavePeaks | null> {
  let p = peaksCache.get(src)
  if (!p) {
    p = computePeaks(src).catch(() => null)
    peaksCache.set(src, p)
  }
  return p
}

/** clip 内的波形层：绝对铺满、透明背景（clip 底纹从空隙透出）、不吃指针事件。 */
export function AudioWaveform({
  src,
  width,
  height,
  color = '#7ff0dc',
  variant = 'envelope',
  className,
  fallbackSrc,
  playedRatio,
  durationSeconds,
  barsPerSecond,
}: {
  src: string | undefined
  width: number
  height: number
  color?: string
  variant?: AudioWaveformVariant
  className?: string
  fallbackSrc?: string
  playedRatio?: number
  durationSeconds?: number
  barsPerSecond?: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [peaks, setPeaks] = useState<WavePeaks | null>(null)

  useEffect(() => {
    let alive = true
    setPeaks(null)
    if (!src) return
    void getWavePeaks(src).then((p) => {
      if (alive) setPeaks(p)
    })
    return () => {
      alive = false
    }
  }, [src])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!peaks) return
    const mid = h / 2
    const amp = mid - 1
    ctx.fillStyle = color
    if (variant === 'bars') {
      const count = durationSeconds !== undefined && barsPerSecond !== undefined
        ? Math.max(1, Math.ceil(durationSeconds * barsPerSecond))
        : Math.max(1, Math.floor(w / 4))
      // Keep the placeholder SVG's 1:1 bar-to-gap rhythm while allowing
      // duration-derived slice counts to fill the preview stage responsively.
      const slotWidth = w / count
      const renderedBarWidth = Math.max(1, slotWidth / 2)
      const renderedGap = slotWidth - renderedBarWidth
      for (const [bar, peak] of waveformBarHeights(peaks, count).entries()) {
        const barHeight = Math.max(2, peak * (h - 2))
        if (playedRatio !== undefined) {
          ctx.fillStyle = bar / count < Math.max(0, Math.min(1, playedRatio))
            ? '#fff'
            : 'rgba(255,255,255,.32)'
        }
        const x = bar * (renderedBarWidth + renderedGap)
        const y = (h - barHeight) / 2
        ctx.beginPath()
        ctx.roundRect(x, y, renderedBarWidth, barHeight, Math.min(renderedBarWidth / 2, barHeight / 2))
        ctx.fill()
      }
      return
    }
    for (let x = 0; x < w; x++) {
      const i = Math.min(peaks.buckets - 1, Math.floor((x / w) * peaks.buckets))
      const yTop = mid - peaks.max[i]! * amp
      const yBot = mid - peaks.min[i]! * amp
      ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop))
    }
  }, [peaks, width, height, color, variant, playedRatio, durationSeconds, barsPerSecond])

  const canvas = <canvas ref={canvasRef} className={className ?? 'gc-audio-wave'} aria-hidden style={fallbackSrc ? { opacity: peaks ? 1 : 0 } : undefined} />
  return fallbackSrc
    ? <span className={`${className ?? 'gc-audio-wave'}-fallback`} aria-hidden><img src={fallbackSrc} alt="" style={{ opacity: peaks ? 0 : 1 }} />{canvas}</span>
    : canvas
}
