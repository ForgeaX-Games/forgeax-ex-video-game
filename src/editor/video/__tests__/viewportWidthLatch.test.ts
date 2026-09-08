import { describe, expect, it } from 'vitest'

import {
  initialViewportWidthLatch,
  latchViewportWidth,
  SCROLLBAR_JITTER_PX,
} from '../materialTimelineShared'

/**
 * 画布宽由视口 clientWidth 派生，而滚动条显隐又改 clientWidth —— 天然成环。
 * 闩锁负责让这个环在一个来回内收敛，同时不误伤真实的布局变化。
 */
describe('latchViewportWidth', () => {
  it('首次测量直接采用', () => {
    const next = latchViewportWidth(initialViewportWidthLatch(), 652)
    expect(next.width).toBe(652)
  })

  it('滚动条显隐造成的来回抖动收敛到窄值', () => {
    let state = latchViewportWidth(initialViewportWidthLatch(), 652)
    // 横向滚动条出现 → 纵向滚动条出现 → clientWidth 少 10px
    state = latchViewportWidth(state, 642)
    expect(state.width).toBe(642)
    expect(state.suppressed).toBe(652)

    // 窄画布不再触发横向滚动条 → 浏览器又量到 652；这次必须压住，否则每帧抽动
    state = latchViewportWidth(state, 652)
    expect(state.width).toBe(642)

    // 继续抖也稳住
    state = latchViewportWidth(latchViewportWidth(state, 642), 652)
    expect(state.width).toBe(642)
  })

  it('真实布局变化（拖分栏 / 窗口缩放）照常采用并清掉旧怀疑值', () => {
    let state = latchViewportWidth(initialViewportWidthLatch(), 652)
    state = latchViewportWidth(state, 642)
    expect(state.suppressed).toBe(652)

    const widened = 642 + SCROLLBAR_JITTER_PX + 1
    state = latchViewportWidth(state, widened)
    expect(state.width).toBe(widened)
    expect(state.suppressed).toBeNull()

    // 清掉怀疑值后，回到 652 也是正常测量
    state = latchViewportWidth(state, 900)
    expect(state.width).toBe(900)
  })

  it('宽度未变时返回原状态，避免多余渲染', () => {
    const state = latchViewportWidth(initialViewportWidthLatch(), 652)
    expect(latchViewportWidth(state, 652)).toBe(state)
  })
})
