import { describe, expect, it } from 'vitest'
import { minimapNodeColor } from '../GraphCanvas'

function nodeWithBadge(badge: string | undefined) {
  return {
    data: {
      fx: { data: { badge } },
    },
  }
}

describe('minimapNodeColor', () => {
  it('maps known badges to BADGE_COLOR', () => {
    expect(minimapNodeColor(nodeWithBadge('qte'))).toBe('#8b5cf6')
    expect(minimapNodeColor(nodeWithBadge('choice'))).toBe('#3b82f6')
    expect(minimapNodeColor(nodeWithBadge('pack'))).toBe('#3b82f6')
    expect(minimapNodeColor(nodeWithBadge('subflow'))).toBe('#eab308')
  })

  it('falls back to #4b5563 when badge missing or unknown', () => {
    expect(minimapNodeColor(nodeWithBadge(undefined))).toBe('#4b5563')
    expect(minimapNodeColor(nodeWithBadge('nope'))).toBe('#4b5563')
    expect(minimapNodeColor({ data: {} })).toBe('#4b5563')
    expect(minimapNodeColor({ data: null })).toBe('#4b5563')
  })
})
