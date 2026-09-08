import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'

export interface PlaybackControl {
  paused: boolean
  rate: number
}

interface PlaybackClockValue extends PlaybackControl {
  now: () => number
}

const DEFAULT_PLAYBACK: PlaybackClockValue = {
  paused: false,
  rate: 1,
  now: () => performance.now(),
}

const PlaybackClockContext = createContext<PlaybackClockValue>(DEFAULT_PLAYBACK)

export function PlaybackClockProvider({
  value,
  children,
}: {
  value: PlaybackControl
  children: ReactNode
}): JSX.Element {
  const state = useRef({ logicalMs: 0, realMs: performance.now(), paused: value.paused, rate: value.rate })
  const previous = state.current
  const realNow = performance.now()
  if (!previous.paused) previous.logicalMs += (realNow - previous.realMs) * previous.rate
  previous.realMs = realNow
  previous.paused = value.paused
  previous.rate = value.rate

  const context: PlaybackClockValue = {
    ...value,
    now: () => {
      const current = state.current
      return current.logicalMs + (current.paused ? 0 : (performance.now() - current.realMs) * current.rate)
    },
  }
  return <PlaybackClockContext.Provider value={context}>{children}</PlaybackClockContext.Provider>
}

export function usePlaybackClock(): PlaybackClockValue {
  return useContext(PlaybackClockContext)
}

export function usePlaybackTimeout(
  callback: (() => void) | undefined,
  delayMs: number | undefined,
  disabled = false,
): void {
  const clock = usePlaybackClock()
  const callbackRef = useRef(callback)
  const deadlineRef = useRef<number | null>(null)
  const delayRef = useRef(delayMs)
  callbackRef.current = callback

  if (delayRef.current !== delayMs) {
    delayRef.current = delayMs
    deadlineRef.current = delayMs == null ? null : clock.now() + delayMs
  }

  useEffect(() => {
    if (disabled || delayMs == null || !callbackRef.current) {
      deadlineRef.current = null
      return
    }
    if (deadlineRef.current == null) deadlineRef.current = clock.now() + delayMs
    if (clock.paused) return
    const remainingLogicalMs = Math.max(0, deadlineRef.current - clock.now())
    const timer = setTimeout(() => {
      deadlineRef.current = null
      callbackRef.current?.()
    }, remainingLogicalMs / Math.max(0.01, clock.rate))
    return () => clearTimeout(timer)
  }, [clock.paused, clock.rate, delayMs, disabled])
}

/** 给 Provider 外的播放壳计时（如无视频节点）；剩余时间会跨暂停/变速保留。 */
export function useControlledPlaybackTimeout(
  callback: (() => void) | undefined,
  delayMs: number | undefined,
  control: PlaybackControl,
  disabled = false,
  resetKey?: unknown,
): void {
  const callbackRef = useRef(callback)
  const remainingRef = useRef<number | null>(delayMs ?? null)
  const delayRef = useRef(delayMs)
  const resetKeyRef = useRef(resetKey)
  callbackRef.current = callback
  if (delayRef.current !== delayMs || resetKeyRef.current !== resetKey) {
    delayRef.current = delayMs
    resetKeyRef.current = resetKey
    remainingRef.current = delayMs ?? null
  }

  useEffect(() => {
    if (disabled || delayMs == null || !callbackRef.current) {
      remainingRef.current = delayMs ?? null
      return
    }
    if (remainingRef.current == null) remainingRef.current = delayMs
    if (control.paused) return
    const startedAt = performance.now()
    const timer = setTimeout(() => {
      remainingRef.current = null
      callbackRef.current?.()
    }, remainingRef.current / Math.max(0.01, control.rate))
    return () => {
      clearTimeout(timer)
      if (remainingRef.current != null) {
        remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAt) * control.rate)
      }
    }
  }, [control.paused, control.rate, delayMs, disabled, resetKey])
}
