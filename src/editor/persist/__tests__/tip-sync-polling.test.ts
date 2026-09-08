import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installTipSyncPolling,
  resetTipSyncPollingForTests,
} from '../tipSyncPolling'

describe('installTipSyncPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetTipSyncPollingForTests()
  })
  afterEach(() => {
    resetTipSyncPollingForTests()
    vi.useRealTimers()
  })

  it('calls sync on interval only when visible', async () => {
    const sync = vi.fn(async () => 'unchanged')
    let visible = true
    const dispose = installTipSyncPolling({
      intervalMs: 1500,
      sync,
      isVisible: () => visible,
    })

    await vi.advanceTimersByTimeAsync(1500)
    expect(sync).toHaveBeenCalledTimes(1)

    visible = false
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(1)

    visible = true
    await vi.advanceTimersByTimeAsync(1500)
    expect(sync).toHaveBeenCalledTimes(2)

    dispose()
    await vi.advanceTimersByTimeAsync(3000)
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('refcount: second dispose does not stop shared timer early', async () => {
    const sync = vi.fn(async () => 'unchanged')
    const a = installTipSyncPolling({ intervalMs: 1000, sync, isVisible: () => true })
    const b = installTipSyncPolling({ intervalMs: 1000, sync, isVisible: () => true })
    a()
    await vi.advanceTimersByTimeAsync(1000)
    expect(sync).toHaveBeenCalledTimes(1)
    b()
    await vi.advanceTimersByTimeAsync(2000)
    expect(sync).toHaveBeenCalledTimes(1)
  })
})
