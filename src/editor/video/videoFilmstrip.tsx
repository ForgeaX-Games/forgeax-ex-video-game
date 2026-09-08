import { useEffect, useRef, useState } from 'react'

/**
 * 视频帧胶片（剪映同款轨道帧画面）：隐藏 <video> 按固定时间密度顺序 seek 抽帧 →
 * 离屏 sprite canvas → 按条宽 cover 绘制到条内 canvas。
 *
 * 架构与 AudioWaveform 同源：解码结果 module 级按 src 缓存（只抽一次，缩放/改宽只重绘），
 * 失败（无源 / 元数据超时 / 解码错）→ 返回 null，宿主回退纯色媒体条。
 *
 * 跨域注记：仅使用 drawImage（不回读像素），故跨域污染源也能正常显示。
 * 缓存按 src 永久生效（同 peaksCache）；AI 重生成同 id 换内容时会吃到旧帧——
 * 待素材层暴露内容版本（registry version / Kino generation）后再 bust。
 */

export interface FilmstripPlan {
  /** 相邻帧起点间隔（ms）。 */
  intervalMs: number
  /** 帧数（≥1）。 */
  count: number
}

export interface Filmstrip {
  sprite: HTMLCanvasElement
  tileW: number
  tileH: number
  intervalMs: number
  count: number
  /** 视频元数据时长（ms）；条内只画 [0, maxMs] 窗口内的帧。 */
  durationMs: number
}

/** sprite 单帧高度（显示高 40px 的 2×，cover 裁剪留出余量）。 */
const TILE_H = 80
/** 目标密度：1s 一帧；长视频按 0.5s 粒度放宽，总帧数不超过 MAX_TILES。 */
const BASE_INTERVAL_MS = 1_000
const MAX_TILES = 24
const METADATA_TIMEOUT_MS = 8_000
const SEEK_TIMEOUT_MS = 3_000

/** 按视频时长规划抽帧密度（纯函数，便于测试）。 */
export function planTiles(durationMs: number): FilmstripPlan {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) return { intervalMs: BASE_INTERVAL_MS, count: 0 }
  let intervalMs = BASE_INTERVAL_MS
  while (Math.ceil(durationMs / intervalMs) > MAX_TILES) intervalMs += 500
  return { intervalMs, count: Math.max(1, Math.ceil(durationMs / intervalMs)) }
}

const stripCache = new Map<string, Promise<Filmstrip | null>>()

function waitEvent(target: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`${event} timeout`))
    }, timeoutMs)
    const cleanup = (): void => {
      clearTimeout(timer)
      target.removeEventListener(event, onEvent)
      target.removeEventListener('error', onError)
    }
    const onEvent = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error(`${event} error`))
    }
    target.addEventListener(event, onEvent, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

async function captureFilmstrip(src: string): Promise<Filmstrip | null> {
  if (typeof document === 'undefined') return null
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  try {
    video.src = src
    video.load()
    await waitEvent(video, 'loadedmetadata', METADATA_TIMEOUT_MS)
    const durationMs = video.duration * 1000
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null
    const { intervalMs, count } = planTiles(durationMs)
    if (count === 0) return null
    const aspect = video.videoWidth > 0 && video.videoHeight > 0
      ? video.videoWidth / video.videoHeight
      : 16 / 9
    const tileW = Math.max(8, Math.round(TILE_H * aspect))
    const sprite = document.createElement('canvas')
    sprite.width = tileW * count
    sprite.height = TILE_H
    const ctx = sprite.getContext('2d')
    if (!ctx) return null
    for (let i = 0; i < count; i++) {
      // 抽帧让出主线程，避免连续解码卡住交互。
      await new Promise((resolve) => setTimeout(resolve, 0))
      try {
        // 帧采槽位中点：播放头落在槽内任意位置，画面偏差 ≤ intervalMs/2（最优「对得上」采样）；
        // 末尾帧 clamp 到结尾前（≈最后一帧），末尾槽位仍有结尾画面。
        const tMs = Math.min(Math.max(0, durationMs - 40), (i + 0.5) * intervalMs)
        video.currentTime = Math.min(video.duration, tMs / 1000)
        await waitEvent(video, 'seeked', SEEK_TIMEOUT_MS)
        ctx.drawImage(video, i * tileW, 0, tileW, TILE_H)
      } catch {
        // 单帧失败留透明（该槽位显示条底色），后续帧继续。
      }
    }
    return { sprite, tileW, tileH: TILE_H, intervalMs, count, durationMs }
  } catch {
    return null
  } finally {
    // 释放解码器：清 src 再 load 一次。
    try {
      video.removeAttribute('src')
      video.load()
    } catch { /* ignore */ }
  }
}

export function getFilmstrip(src: string): Promise<Filmstrip | null> {
  let p = stripCache.get(src)
  if (!p) {
    p = captureFilmstrip(src)
    stripCache.set(src, p)
  }
  return p
}

/**
 * 视频条内的帧画面层：左右各让出 5.6px（露出媒体条双端把手），绝对铺满剩余区域，
 * 不吃指针事件。帧按视频时刻与刻度尺严格对位（x = t × pxPerMs），cover 居中裁剪。
 */
export function VideoFilmstrip({
  src,
  width,
  maxMs,
  height,
}: {
  src: string | undefined
  /** 视频条像素宽（= maxMs × pxPerMs）。 */
  width: number
  /** 视频条时长上限（ms）。 */
  maxMs: number
  /** 视频条像素高。 */
  height: number
}): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [strip, setStrip] = useState<Filmstrip | null>(null)

  useEffect(() => {
    let alive = true
    setStrip(null)
    if (!src) return
    void getFilmstrip(src).then((s) => {
      if (alive) setStrip(s)
    })
    return () => {
      alive = false
    }
  }, [src])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // 按元素实测尺寸绘制（元素被边框盒包住时会比 height prop 小，直接用 prop 会压扁画面）；
    // 画布比条窄 11.2px（左右把手位），DPR 上限 2。
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!strip || !(maxMs > 0)) return
    const pxPerMs = w / maxMs
    for (let i = 0; i < strip.count; i++) {
      const t = i * strip.intervalMs
      if (t >= maxMs) break
      const slotW = Math.min(strip.intervalMs, maxMs - t) * pxPerMs
      if (slotW < 1) continue
      // cover：槽位与帧各自保持比例，超出的部分居中裁掉。
      const scale = Math.max(slotW / strip.tileW, h / strip.tileH)
      const dw = strip.tileW * scale
      const dh = strip.tileH * scale
      ctx.drawImage(
        strip.sprite,
        i * strip.tileW,
        0,
        strip.tileW,
        strip.tileH,
        t * pxPerMs + (slotW - dw) / 2,
        (h - dh) / 2,
        dw,
        dh,
      )
    }
  }, [strip, width, maxMs, height])

  if (!src) return null
  return <canvas ref={canvasRef} className="gc-filmstrip" aria-hidden />
}
