import { describe, expect, it } from 'vitest'
import { formatPlayClock, resolveClipDurationMs } from '../playClipClock'

describe('formatPlayClock', () => {
  it('formats mm:ss from milliseconds', () => {
    expect(formatPlayClock(0)).toBe('00:00')
    expect(formatPlayClock(2_000)).toBe('00:02')
    expect(formatPlayClock(65_000)).toBe('01:05')
  })

  it('clamps negative to zero', () => {
    expect(formatPlayClock(-500)).toBe('00:00')
  })
})

describe('resolveClipDurationMs', () => {
  it('takes min when both video and clip caps exist', () => {
    expect(resolveClipDurationMs({ videoDurationMs: 10_000, clipDurationMs: 8_000 })).toBe(8_000)
  })

  it('falls back to whichever is finite', () => {
    expect(resolveClipDurationMs({ videoDurationMs: 4_000 })).toBe(4_000)
    expect(resolveClipDurationMs({ clipDurationMs: 3_000 })).toBe(3_000)
    expect(resolveClipDurationMs({})).toBe(0)
  })
})
