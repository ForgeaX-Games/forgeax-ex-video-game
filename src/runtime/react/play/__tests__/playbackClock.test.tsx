import { renderHook } from '@testing-library/react'
import { act, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PlaybackClockProvider, usePlaybackTimeout, type PlaybackControl } from '../../playback-clock'

describe('playback clock', () => {
  it('preserves a logical timeout across pause and rate changes', () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    let control: PlaybackControl = { paused: false, rate: 1 }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PlaybackClockProvider value={control}>{children}</PlaybackClockProvider>
    )
    const { rerender } = renderHook(() => usePlaybackTimeout(fired, 1000), { wrapper })

    act(() => vi.advanceTimersByTime(400))
    control = { paused: true, rate: 1 }
    rerender()
    act(() => vi.advanceTimersByTime(1000))
    expect(fired).not.toHaveBeenCalled()

    control = { paused: false, rate: 2 }
    rerender()
    act(() => vi.advanceTimersByTime(299))
    expect(fired).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(fired).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
