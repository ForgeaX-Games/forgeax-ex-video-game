import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createFollowIdleReattach,
  FLOW_FOLLOW_IDLE_REATTACH_MS,
  isHorizontalNavKey,
  isHorizontalWheelIntent,
  nextSoftFollowScrollLeft,
  shouldFollowPlayheadScroll,
} from '../flowPreviewScrollFollow'

afterEach(() => {
  vi.useRealTimers()
})

describe('flowPreviewScrollFollow', () => {
  it('blocks follow while detached, scrubbing, paused, or ended', () => {
    const base = {
      followEnabled: true,
      scrubbing: false,
      paused: false,
      phase: 'playing',
    }
    expect(shouldFollowPlayheadScroll(base)).toBe(true)
    expect(shouldFollowPlayheadScroll({ ...base, followEnabled: false })).toBe(false)
    expect(shouldFollowPlayheadScroll({ ...base, scrubbing: true })).toBe(false)
    expect(shouldFollowPlayheadScroll({ ...base, paused: true })).toBe(false)
    expect(shouldFollowPlayheadScroll({ ...base, phase: 'ended' })).toBe(false)
  })

  it('leaves scroll alone until the playhead reaches the follow line', () => {
    // viewport [0,400], follow line at 280, left pad at 40
    expect(nextSoftFollowScrollLeft({
      playheadX: 200,
      viewportWidth: 400,
      scrollLeft: 0,
    })).toBeNull()
  })

  it('pins the playhead on the follow line once it passes, frame by frame', () => {
    // 连续跟滚：每帧位移 = playhead 位移，没有跳屏
    expect(nextSoftFollowScrollLeft({
      playheadX: 300,
      viewportWidth: 400,
      scrollLeft: 0,
    })).toBe(20)
    expect(nextSoftFollowScrollLeft({
      playheadX: 305,
      viewportWidth: 400,
      scrollLeft: 20,
    })).toBe(25)
  })

  it('pulls the playhead back when it falls off the left edge', () => {
    expect(nextSoftFollowScrollLeft({
      playheadX: 1_000,
      viewportWidth: 400,
      scrollLeft: 980,
    })).toBe(720)
  })

  it('treats horizontal wheel gestures as browse intent but ignores plain vertical wheel', () => {
    const wheel = (patch: Partial<Parameters<typeof isHorizontalWheelIntent>[0]>) => ({
      deltaX: 0,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...patch,
    })
    // 触控板横滑 / Shift+滚轮 / 缩放 = 用户在自己看别处
    expect(isHorizontalWheelIntent(wheel({ deltaX: -40 }))).toBe(true)
    expect(isHorizontalWheelIntent(wheel({ shiftKey: true }))).toBe(true)
    expect(isHorizontalWheelIntent(wheel({ ctrlKey: true }))).toBe(true)
    // 纯纵向滚轮 = 看轨道，不该打断横向跟随
    expect(isHorizontalWheelIntent(wheel({}))).toBe(false)
  })

  it('recognizes keys that move the viewport horizontally', () => {
    expect(isHorizontalNavKey('ArrowLeft')).toBe(true)
    expect(isHorizontalNavKey('End')).toBe(true)
    expect(isHorizontalNavKey('ArrowUp')).toBe(false)
    expect(isHorizontalNavKey('a')).toBe(false)
  })

  it('reattaches follow after idle with no further user scroll', () => {
    vi.useFakeTimers()
    const onDetach = vi.fn()
    const onReattach = vi.fn()
    const idle = createFollowIdleReattach({ onDetach, onReattach })

    idle.noteUserScroll()
    expect(onDetach).toHaveBeenCalledTimes(1)
    expect(onReattach).not.toHaveBeenCalled()

    vi.advanceTimersByTime(FLOW_FOLLOW_IDLE_REATTACH_MS - 1)
    expect(onReattach).not.toHaveBeenCalled()

    idle.noteUserScroll()
    expect(onDetach).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(FLOW_FOLLOW_IDLE_REATTACH_MS - 1)
    expect(onReattach).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onReattach).toHaveBeenCalledTimes(1)

    idle.cancel()
  })

  it('cancel clears a pending idle reattach', () => {
    vi.useFakeTimers()
    const onReattach = vi.fn()
    const idle = createFollowIdleReattach({
      onDetach: vi.fn(),
      onReattach,
    })

    idle.noteUserScroll()
    idle.cancel()
    vi.advanceTimersByTime(FLOW_FOLLOW_IDLE_REATTACH_MS)
    expect(onReattach).not.toHaveBeenCalled()
  })
})
