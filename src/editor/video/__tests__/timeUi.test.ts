import { describe, expect, it } from 'vitest'
import {
  TIME_STEP_SEC,
  fmtDur,
  msToSec,
  secToMs,
  settlementInsertMsBeforePlayhead,
} from '../materialTimelineShared'
import { resolveSnapGridMs } from '../timelineMath'

describe('time UI helpers', () => {
  it('ms ↔ sec round-trip at 0.01s step', () => {
    expect(TIME_STEP_SEC).toBe(0.01)
    expect(msToSec(1230)).toBe(1.23)
    expect(secToMs(1.23)).toBe(1230)
    expect(secToMs(0.01)).toBe(10)
  })

  it('fmtDur shows centiseconds', () => {
    expect(fmtDur(0)).toBe('0:00.00')
    expect(fmtDur(1500)).toBe('0:01.50')
    expect(fmtDur(61_020)).toBe('1:01.02')
  })

  it('snap grid defaults to 10ms (0.01s)', () => {
    expect(resolveSnapGridMs({ shift: false, alt: false })).toBe(10)
    expect(resolveSnapGridMs({ shift: true, alt: true })).toBe(10)
    expect(resolveSnapGridMs({ shift: false, alt: true })).toBe(100)
  })

  it('按视频时长和时间轴宽度换算结算点的非重叠像素间距', () => {
    expect(settlementInsertMsBeforePlayhead(7_500, 15_000, 559)).toBe(7_120)
    expect(settlementInsertMsBeforePlayhead(3_500, 7_000, 559)).toBe(3_320)
    expect(settlementInsertMsBeforePlayhead(100, 15_000, 559)).toBe(480)
    expect(settlementInsertMsBeforePlayhead(0, 15_000, 559)).toBe(380)
  })
})
