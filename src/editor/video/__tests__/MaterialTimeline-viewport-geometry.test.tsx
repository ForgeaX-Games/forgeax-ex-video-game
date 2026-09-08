import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialTimeline } from '../MaterialTimeline'
import { TIMELINE_LAYER_STEP, TIMELINE_LAYER_TOP, TIMELINE_MIN_TRACKS } from '../materialTimelineShared'

afterEach(cleanup)

/**
 * 画布高度必须只由轨道内容派生，不得回读视口 clientHeight。
 *
 * 回读会形成自激振荡：clientHeight 被横向滚动条扣掉 10px → 画布高度跟着变 →
 * 触发/撤销纵向滚动条 → clientWidth 再变 10px → canvasPx 变 → 又改布局。
 * 表现为时间轴宽高在 10px 间每帧来回抽动，并使视频条帧画面位图反复重建。
 * 「内容矮时填满可视区」由 CSS `min-height: 100%` 声明式完成，不需要测量。
 */
describe('MaterialTimeline · 视口几何', () => {
  const CONTENT_H = TIMELINE_LAYER_TOP + TIMELINE_MIN_TRACKS * TIMELINE_LAYER_STEP + 8

  function renderTimeline({ clientWidth, clientHeight }: { clientWidth: number; clientHeight: number }) {
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight)
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={10_000}
        playheadMs={0}
        selectedMaterialKey={null}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )
    return { canvas: container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!, widthSpy, heightSpy }
  }

  it('视口比内容高时，画布高度仍是内容高（填满交给 CSS min-height）', () => {
    const { canvas, widthSpy, heightSpy } = renderTimeline({ clientWidth: 600, clientHeight: 999 })
    try {
      expect(canvas.style.width).toBe('600px')
      expect(canvas.style.height).toBe(`${CONTENT_H}px`)
    } finally {
      widthSpy.mockRestore()
      heightSpy.mockRestore()
    }
  })

  it('视口内高变化（横向滚动条出现/消失）不改变画布高度', () => {
    const tall = renderTimeline({ clientWidth: 600, clientHeight: 403 })
    const tallHeight = tall.canvas.style.height
    tall.widthSpy.mockRestore()
    tall.heightSpy.mockRestore()
    cleanup()

    const short = renderTimeline({ clientWidth: 600, clientHeight: 393 })
    try {
      expect(short.canvas.style.height).toBe(tallHeight)
    } finally {
      short.widthSpy.mockRestore()
      short.heightSpy.mockRestore()
    }
  })

  /**
   * 右缘装饰（结尾处播放头游标半个头、绑定界面组标签）曾把可滚动宽度撑大，
   * 于是「播放到结尾」会凭空冒出横向滚动条，再牵动纵向滚动条一起抽动。
   * 裁掉这份溢出是根治；滚动条不常驻占位（设计稿观感），故不用 scrollbar-gutter。
   */
  describe('滚动条无关性（CSS 契约）', () => {
    function ruleBlock(css: string, selector: string): string {
      const match = css.match(new RegExp(`${selector.replace('.', '\\.')} \\{[^}]*\\}`))
      return match?.[0] ?? ''
    }

    /** 只看真实声明：注释里提到某属性（如「刻意不用 X」）不算生效。 */
    function timelineCss(): string {
      const { widthSpy, heightSpy } = renderTimeline({ clientWidth: 600, clientHeight: 400 })
      widthSpy.mockRestore()
      heightSpy.mockRestore()
      const raw = document.querySelector('style[data-reel-style="material-timeline"]')?.textContent ?? ''
      return raw.replace(/\/\*[\s\S]*?\*\//g, '')
    }

    it('画布横向裁掉右缘装饰溢出，结尾播放头不会凭空触发横向滚动条', () => {
      const block = ruleBlock(timelineCss(), '.gc-mtimeline-canvas')
      expect(block).toContain('overflow-x: clip')
      expect(block).toContain('overflow-anchor: none')
    })

    it('不给滚动条留常驻沟槽（会破坏设计稿观感；振荡在测量侧收敛）', () => {
      expect(timelineCss()).not.toContain('scrollbar-gutter')
    })
  })
})
