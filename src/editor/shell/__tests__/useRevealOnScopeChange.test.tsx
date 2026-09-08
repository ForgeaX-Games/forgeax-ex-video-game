import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRevealOnScopeChange } from '../useRevealOnScopeChange'

function Probe({
  scopeKey,
  nodeId,
  onReveal,
}: {
  scopeKey: string | null
  nodeId: string | null
  onReveal: (id: string | null) => void
}): null {
  const reveal = useRevealOnScopeChange(scopeKey, nodeId)
  onReveal(reveal)
  return null
}

describe('useRevealOnScopeChange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('pulses reveal on scope change, ignores same-scope advances, then clears', () => {
    const seen: Array<string | null> = []
    const { rerender } = render(
      <Probe scopeKey="main" nodeId="a" onReveal={(id) => { seen.push(id) }} />,
    )
    act(() => { vi.advanceTimersByTime(50) })
    expect(seen.at(-1)).toBe('a')

    const mid = seen.length
    rerender(<Probe scopeKey="main" nodeId="b" onReveal={(id) => { seen.push(id) }} />)
    act(() => { vi.advanceTimersByTime(50) })
    // same scope → no pulse for "b"
    expect(seen.slice(mid).some((id) => id === 'b')).toBe(false)

    act(() => { vi.advanceTimersByTime(400) })
    expect(seen.at(-1)).toBeNull()

    rerender(<Probe scopeKey="pack" nodeId="tele" onReveal={(id) => { seen.push(id) }} />)
    act(() => { vi.advanceTimersByTime(50) })
    expect(seen.at(-1)).toBe('tele')
  })

  it('clears when scope becomes null (panel closed)', () => {
    const seen: Array<string | null> = []
    const { rerender } = render(
      <Probe scopeKey="main" nodeId="a" onReveal={(id) => { seen.push(id) }} />,
    )
    act(() => { vi.advanceTimersByTime(50) })
    rerender(<Probe scopeKey={null} nodeId="a" onReveal={(id) => { seen.push(id) }} />)
    expect(seen.at(-1)).toBeNull()
  })
})
