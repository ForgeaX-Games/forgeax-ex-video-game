export function formatPlayClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function resolveClipDurationMs(input: {
  videoDurationMs?: number
  clipDurationMs?: number
}): number {
  const video = Number.isFinite(input.videoDurationMs) ? input.videoDurationMs! : undefined
  const clip = Number.isFinite(input.clipDurationMs) ? input.clipDurationMs! : undefined
  if (video != null && clip != null) return Math.min(video, clip)
  return video ?? clip ?? 0
}
