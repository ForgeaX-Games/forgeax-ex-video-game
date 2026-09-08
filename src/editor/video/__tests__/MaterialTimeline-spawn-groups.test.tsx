import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialTimeline } from '../MaterialTimeline'
import type { TimelineSpawnGroup } from '../materialTimelineShared'

afterEach(cleanup)

const MAX_MS = 4_000
const CANVAS_PX = 1_000
const pxOf = (ms: number) => (ms * CANVAS_PX) / MAX_MS

/** 3000ms 结算绑定两个界面：怒气飘字 500ms，台词常驻到节点末端。 */
const group: TimelineSpawnGroup = {
  markerId: 'life:0',
  settlementIndex: 0,
  startMs: 3_000,
  endMs: MAX_MS,
  uBase: 1,
  bars: [
    { id: 'settlement-spawn:0:1', label: '怒气飘字', startMs: 3_000, endMs: 3_500, openEnded: false, rowInGroup: 0 },
    { id: 'settlement-spawn:0:2', label: '台词', startMs: 3_000, endMs: MAX_MS, openEnded: true, rowInGroup: 1 },
  ],
}

function renderTimeline(overrides: Partial<Parameters<typeof MaterialTimeline>[0]> = {}) {
  const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(CANVAS_PX)
  const result = render(
    <MaterialTimeline
      materials={[]}
      maxMs={MAX_MS}
      playheadMs={0}
      selectedMaterialKey={null}
      onSelectMaterial={vi.fn()}
      onPatchMaterial={vi.fn()}
      pointMarkers={[{ id: 'life:0', ms: 3_000, kind: 'lifecycle', label: '结算 · 气力 +10' }]}
      spawnGroups={[group]}
      {...overrides}
    />,
  )
  return { ...result, clientWidth }
}

describe('MaterialTimeline · 结算绑定界面组', () => {
  it('insets the dashed frame around its bars instead of hugging them', async () => {
    const { container, clientWidth } = renderTimeline()
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const frame = container.querySelector<HTMLElement>('.gc-spawn-group')!
      const bars = [...container.querySelectorAll<HTMLElement>('.gc-spawn-bar')]
      const num = (v: string) => Number.parseFloat(v)

      expect(frame.dataset.spawnGroup).toBe('life:0')
      expect(getComputedStyle(frame).borderStyle).toBe('dashed')
      // 组框四边都要留白：左边界在条起点之左，顶边在最上一条之上。
      expect(num(frame.style.left)).toBeLessThan(pxOf(3_000))
      expect(num(frame.style.top)).toBeLessThan(Math.min(...bars.map((bar) => num(bar.style.top))))
      const frameRight = num(frame.style.left) + num(frame.style.width)
      const barRight = Math.max(...bars.map((bar) => num(bar.style.left) + num(bar.style.width)))
      expect(frameRight).toBeGreaterThan(barRight)
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('reuses the shared material-bar look so bound interfaces match mounted ones', async () => {
    const { container, clientWidth } = renderTimeline()
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      for (const bar of container.querySelectorAll<HTMLElement>('.gc-spawn-bar')) {
        expect(bar).toHaveClass('gc-mclip')
        expect(bar).toHaveClass('is-spawn')
      }
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('paints a bound interface in the same tone as a mounted interface', async () => {
    const { container, clientWidth } = renderTimeline({
      materials: [{
        key: 'mount:hud',
        id: 'hud',
        kind: 'mount',
        label: '我方血条',
        startMs: 0,
        endMs: 1_000,
        zIndex: 0,
      }],
    })
    try {
      await waitFor(() => expect(container.querySelector('.gc-mclip.is-spawn')).not.toBeNull())
      const mount = getComputedStyle(container.querySelector<HTMLElement>('.gc-mclip.is-mount')!)
      const spawn = getComputedStyle(container.querySelector<HTMLElement>('.gc-mclip.is-spawn')!)

      // 绑定的也是「界面」，色调走界面那条线；归属关系由虚线组框和位置表达，不靠改色。
      expect(spawn.borderTopColor).toBe(mount.borderTopColor)
      expect(spawn.backgroundColor).toBe(mount.backgroundColor)
      expect(spawn.color).toBe(mount.color)
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('lets the unbind control escape the bar bounds once selected', async () => {
    const { container, clientWidth } = renderTimeline({
      onDeleteSpawnBar: vi.fn(),
      selectedSpawnBarId: 'settlement-spawn:0:1',
    })
    try {
      await waitFor(() => expect(container.querySelector('.gc-spawn-bar.is-selected')).not.toBeNull())
      const selected = container.querySelector<HTMLElement>('.gc-spawn-bar.is-selected')!
      // 关闭按钮定位在条外（top/right 负偏移），条不能裁剪它，否则点不到。
      expect(getComputedStyle(selected).overflow).toBe('visible')
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('stacks one row per bound interface directly above the diamond track', async () => {
    const { container, clientWidth } = renderTimeline()
    try {
      // 无材料轨 → dataMaxLayer 0；两行界面把菱形轨推到第 3 轨（top = 34 + 3×34 = 136）。
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const [first, second] = container.querySelectorAll<HTMLElement>('.gc-spawn-bar')
      expect(first).toHaveStyle({ top: '102px' })
      expect(second).toHaveStyle({ top: '68px' })
      expect(screen.getByRole('slider', { name: /气力 \+10/ })).toHaveStyle({ top: '152px' })
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('sizes a timed bar by its display duration and runs a persistent bar to the node end', async () => {
    const { container, clientWidth } = renderTimeline()
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const [timed, persistent] = container.querySelectorAll<HTMLElement>('.gc-spawn-bar')
      expect(timed).toHaveStyle({ width: `${pxOf(500)}px` })
      expect(timed).not.toHaveClass('is-open-ended')
      expect(persistent).toHaveStyle({ width: `${pxOf(1_000)}px` })
      expect(persistent).toHaveClass('is-open-ended')
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('offers only an end handle, because the start belongs to the diamond', async () => {
    const { clientWidth } = renderTimeline()
    try {
      await waitFor(() => expect(screen.getAllByRole('button', { name: '调整界面结束时间' })).toHaveLength(2))
      expect(screen.queryByRole('button', { name: '调整起点' })).toBeNull()
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('writes the dragged end back by settlement and action index', async () => {
    const onSpawnBarEndChange = vi.fn()
    const { container, clientWidth } = renderTimeline({ onSpawnBarEndChange })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: CANVAS_PX, bottom: 400,
        width: CANVAS_PX, height: 400, toJSON: () => ({}),
      })
      vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})

      const handle = screen.getAllByRole('button', { name: '调整界面结束时间' })[0]!
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: pxOf(3_500) })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: pxOf(3_800) })

      expect(onSpawnBarEndChange).toHaveBeenLastCalledWith('settlement-spawn:0:1', 3_800)
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('adjusts a bound interface end without selecting it, but still pauses playback', async () => {
    const onSelectSpawnBar = vi.fn()
    const onSelectPointMarker = vi.fn()
    const onScrubStart = vi.fn()
    const { container, clientWidth } = renderTimeline({
      onSpawnBarEndChange: vi.fn(),
      onSelectSpawnBar,
      onSelectPointMarker,
      onScrubStart,
    })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
      vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})

      fireEvent.pointerDown(screen.getAllByRole('button', { name: '调整界面结束时间' })[0]!, {
        pointerId: 1,
        clientX: pxOf(3_500),
      })

      expect(onSelectSpawnBar).not.toHaveBeenCalled()
      expect(onSelectPointMarker).not.toHaveBeenCalled()
      expect(onScrubStart).toHaveBeenCalled()
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('never lets a dragged end cross its own settlement moment', async () => {
    const onSpawnBarEndChange = vi.fn()
    const { container, clientWidth } = renderTimeline({ onSpawnBarEndChange })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: CANVAS_PX, bottom: 400,
        width: CANVAS_PX, height: 400, toJSON: () => ({}),
      })
      vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})

      const handle = screen.getAllByRole('button', { name: '调整界面结束时间' })[0]!
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: pxOf(3_500) })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: pxOf(1_000) })

      expect(onSpawnBarEndChange.mock.calls.at(-1)?.[1]).toBeGreaterThan(3_000)
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('selects the host settlement and the bar itself when a bar is pressed', async () => {
    const onSelectPointMarker = vi.fn()
    const onSelectSpawnBar = vi.fn()
    const { container, clientWidth } = renderTimeline({ onSelectPointMarker, onSelectSpawnBar })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      fireEvent.pointerDown(container.querySelector('.gc-spawn-bar')!)

      expect(onSelectPointMarker).toHaveBeenCalledWith('life:0')
      expect(onSelectSpawnBar).toHaveBeenCalledWith('settlement-spawn:0:1')
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('never lets two group frames overlap vertically', async () => {
    const second: TimelineSpawnGroup = {
      markerId: 'life:1',
      settlementIndex: 1,
      startMs: 200,
      endMs: 900,
      // 紧邻上一组的行（组间不留空行），这是两框最容易压线的排布。
      uBase: 3,
      bars: [
        { id: 'settlement-spawn:1:0', label: '台词', startMs: 200, endMs: 900, openEnded: false, rowInGroup: 0 },
      ],
    }
    const { container, clientWidth } = renderTimeline({
      spawnGroups: [group, second],
      pointMarkers: [
        { id: 'life:0', ms: 3_000, kind: 'lifecycle', label: '结算 · 气力 +10' },
        { id: 'life:1', ms: 200, kind: 'lifecycle', label: '结算 · 台词' },
      ],
    })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-group')).toHaveLength(2))
      const [a, b] = [...container.querySelectorAll<HTMLElement>('.gc-spawn-group')].map((frame) => ({
        top: Number.parseFloat(frame.style.top),
        bottom: Number.parseFloat(frame.style.top) + Number.parseFloat(frame.style.height),
      }))
      const gap = Math.min(a!.top, b!.top) === a!.top ? b!.top - a!.bottom : a!.top - b!.bottom
      expect(gap).toBeGreaterThanOrEqual(0)
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('highlights the whole group when its settlement diamond is selected', async () => {
    const { container, clientWidth } = renderTimeline({ selectedPointMarkerId: 'life:0' })
    try {
      await waitFor(() => expect(container.querySelector('.gc-spawn-group')).not.toBeNull())
      expect(container.querySelector('.gc-spawn-group')).toHaveClass('is-selected')
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('leaves the group unhighlighted while a different settlement is selected', async () => {
    const { container, clientWidth } = renderTimeline({ selectedPointMarkerId: 'life:7' })
    try {
      await waitFor(() => expect(container.querySelector('.gc-spawn-group')).not.toBeNull())
      expect(container.querySelector('.gc-spawn-group')).not.toHaveClass('is-selected')
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('marks the controlled bar as selected', async () => {
    const { container, clientWidth } = renderTimeline({ selectedSpawnBarId: 'settlement-spawn:0:2' })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      const [first, second] = container.querySelectorAll<HTMLElement>('.gc-spawn-bar')
      expect(first).not.toHaveClass('is-selected')
      expect(second).toHaveClass('is-selected')
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('drops the end handle in read-only preview', async () => {
    const { container, clientWidth } = renderTimeline({ editable: false })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      expect(screen.queryByRole('button', { name: '调整界面结束时间' })).toBeNull()
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('unbinds a selected bar through its own delete control', async () => {
    const onDeleteSpawnBar = vi.fn()
    const { container, clientWidth } = renderTimeline({
      onDeleteSpawnBar,
      selectedSpawnBarId: 'settlement-spawn:0:1',
    })
    try {
      await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))
      fireEvent.click(screen.getByRole('button', { name: '解除界面绑定' }))

      expect(onDeleteSpawnBar).toHaveBeenCalledWith('settlement-spawn:0:1')
    } finally {
      clientWidth.mockRestore()
    }
  })
})
