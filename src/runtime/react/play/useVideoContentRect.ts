import { useCallback, useEffect, useState, type RefObject } from 'react'
import { computeVideoContentRect, type VideoContentRect } from './videoContentRect'

/** 跟踪 video object-fit:contain 后的实际画面矩形（相对 video.parentElement）。 */
export function useVideoContentRect(videoRef: RefObject<HTMLVideoElement | null>, deps: unknown[] = []): {
  contentRect: VideoContentRect | null
  recomputeRect: () => void
} {
  const [contentRect, setContentRect] = useState<VideoContentRect | null>(null)
  const recomputeRect = useCallback(() => {
    const v = videoRef.current
    setContentRect(v ? computeVideoContentRect(v) : null)
  }, [videoRef])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const parent = v.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recomputeRect())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [recomputeRect, ...deps])

  return { contentRect, recomputeRect }
}
