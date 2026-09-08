/**
 * placeAdaptivePop：优先按钮下方，并给出指向触发钮的箭头偏移。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { placeAdaptivePop } from '../useBlueprintNavActions'

function stubRect(partial: Partial<DOMRect>): DOMRect {
  return {
    x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0,
    toJSON: () => ({}),
    ...partial,
  }
}

describe('placeAdaptivePop', () => {
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
  })

  it('prefers below the trigger, right-aligned, with arrow under the button', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const trigger = document.createElement('button')
    trigger.getBoundingClientRect = () => stubRect({
      top: 200, left: 200, right: 224, bottom: 224, width: 24, height: 24,
    })
    const placement = placeAdaptivePop(trigger, { width: 180, height: 96 })
    expect(placement).not.toBeNull()
    expect(placement!.side).toBe('below')
    expect(placement!.style).toMatchObject({ position: 'fixed', top: 232, left: 44 })
    // 按钮中心 x=212，浮层 left=44 → arrow = 168
    expect(placement!.style).toHaveProperty('--ns-arrow', '168px')
  })

  it('flips above when there is no room below', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 240 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 280 })
    const trigger = document.createElement('button')
    trigger.getBoundingClientRect = () => stubRect({
      top: 220, left: 200, right: 224, bottom: 244, width: 24, height: 24,
    })
    const placement = placeAdaptivePop(trigger, { width: 180, height: 96 })
    expect(placement).not.toBeNull()
    expect(placement!.side).toBe('above')
    expect((placement!.style.top as number)).toBeLessThan(220)
  })

  it('falls back to the side when neither above nor below has room', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 120 })
    const trigger = document.createElement('button')
    trigger.getBoundingClientRect = () => stubRect({
      top: 40, left: 40, right: 60, bottom: 64, width: 20, height: 24,
    })
    const placement = placeAdaptivePop(trigger, { width: 180, height: 96 })
    expect(placement).not.toBeNull()
    expect(placement!.side).toBe('right')
    expect((placement!.style.left as number)).toBeGreaterThanOrEqual(60)
  })
})
