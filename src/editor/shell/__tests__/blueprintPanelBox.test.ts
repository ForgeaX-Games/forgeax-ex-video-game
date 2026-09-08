import { describe, expect, it } from 'vitest'
import { resolveBlueprintPanelBox } from '../blueprintPanelBox'

describe('resolveBlueprintPanelBox', () => {
  it('anchors the panel bottom above the bottom bar on a tall surface', () => {
    const box = resolveBlueprintPanelBox({ rootHeight: 900 })
    expect(box).toEqual({ x: 12, y: 833 - 420, w: 540, h: 420 })
    // 浮层底边 + 底栏 + 间距 = 容器高度：正好贴着栏顶沿。
    expect(box.y + box.h + 59 + 8).toBe(900)
  })

  it('shrinks the panel instead of overflowing a short surface', () => {
    const box = resolveBlueprintPanelBox({ rootHeight: 400 })
    expect(box.y).toBe(12)
    expect(box.h).toBe(400 - 67 - 12)
    expect(box.y + box.h).toBeLessThanOrEqual(400 - 59)
  })

  it('keeps a usable minimum height when the surface is tiny', () => {
    const box = resolveBlueprintPanelBox({ rootHeight: 150 })
    expect(box.h).toBe(200)
    expect(box.y).toBe(12)
  })

  it('falls back to the top position when the height is unknown', () => {
    expect(resolveBlueprintPanelBox({ rootHeight: 0 })).toEqual({ x: 12, y: 12, w: 540, h: 420 })
    expect(resolveBlueprintPanelBox({ rootHeight: Number.NaN }).y).toBe(12)
  })
})
