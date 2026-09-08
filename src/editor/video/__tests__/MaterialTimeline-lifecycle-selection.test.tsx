import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialTimeline } from '../MaterialTimeline'
import { FLOAT_TEXT_TIMELINE_WIDTH_PX, TIMELINE_LAYER_STEP } from '../materialTimelineShared'

afterEach(cleanup)

describe('MaterialTimeline · 结算选中联动', () => {
  it('自计时飘字使用固定宽度且不提供时间轴拉伸手柄', () => {
    const onSelectMaterial = vi.fn()
    const onPatchMaterial = vi.fn()
    const { container } = render(
      <MaterialTimeline
        materials={[{
          key: 'overlay:damage',
          id: 'damage',
          kind: 'overlay',
          label: '-25',
          startMs: 0,
          endMs: 3_000,
          zIndex: 1,
          fixedWidthPx: FLOAT_TEXT_TIMELINE_WIDTH_PX,
        }]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey="overlay:damage"
        onSelectMaterial={onSelectMaterial}
        onPatchMaterial={onPatchMaterial}
      />,
    )

    const clip = container.querySelector<HTMLElement>('.gc-mclip')!
    const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1_000, bottom: 240,
      width: 1_000, height: 240, toJSON: () => ({}),
    })
    vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})
    expect(clip).toHaveClass('is-fixed-width')
    expect(clip).toHaveStyle({ width: `${FLOAT_TEXT_TIMELINE_WIDTH_PX}px` })
    expect(screen.queryByRole('button', { name: '调整起点' })).toBeNull()
    expect(screen.queryByRole('button', { name: '调整终点' })).toBeNull()

    fireEvent.pointerDown(clip, { pointerId: 1, clientX: 100, clientY: 60 })
    expect(onSelectMaterial).toHaveBeenCalledWith('overlay:damage')
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 60 })
    expect(onPatchMaterial).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: 'overlay:damage' }),
      expect.objectContaining({ startMs: 600 }),
    )
  })

  describe('拖手柄调时间不进选中态', () => {
    const MOUNT = {
      key: 'mount:hud',
      id: 'hud',
      kind: 'mount' as const,
      label: '我方血条',
      startMs: 1_000,
      endMs: 2_000,
      zIndex: 0,
    }

    function renderBar() {
      const onSelectMaterial = vi.fn()
      const onPatchMaterial = vi.fn()
      const onScrubStart = vi.fn()
      const { container } = render(
        <MaterialTimeline
          materials={[MOUNT]}
          maxMs={4_000}
          playheadMs={0}
          selectedMaterialKey={null}
          onSelectMaterial={onSelectMaterial}
          onPatchMaterial={onPatchMaterial}
          onScrubStart={onScrubStart}
        />,
      )
      const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        x: 0, y: 0, left: 0, top: 0, right: 1_000, bottom: 240,
        width: 1_000, height: 240, toJSON: () => ({}),
      })
      vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})
      return { container, canvas, onSelectMaterial, onPatchMaterial, onScrubStart }
    }

    it('adjusts the end without selecting the interface', () => {
      const { canvas, onSelectMaterial, onPatchMaterial } = renderBar()
      const handle = screen.getByRole('button', { name: '调整终点' })

      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 600 })

      expect(onPatchMaterial).toHaveBeenCalled()
      expect(onSelectMaterial).not.toHaveBeenCalled()
    })

    it('adjusts the start without selecting the interface', () => {
      const { canvas, onSelectMaterial, onPatchMaterial } = renderBar()
      const handle = screen.getByRole('button', { name: '调整起点' })

      fireEvent.pointerDown(handle, { pointerId: 2, clientX: 250 })
      fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 300 })

      expect(onPatchMaterial).toHaveBeenCalled()
      expect(onSelectMaterial).not.toHaveBeenCalled()
    })

    it('still pauses playback while a handle is being dragged', () => {
      const { onScrubStart } = renderBar()

      fireEvent.pointerDown(screen.getByRole('button', { name: '调整终点' }), { pointerId: 3, clientX: 500 })

      expect(onScrubStart).toHaveBeenCalled()
    })

    it('still selects when the bar body itself is pressed', () => {
      const { container, onSelectMaterial } = renderBar()

      fireEvent.pointerDown(container.querySelector('.gc-mclip')!, { pointerId: 4, clientX: 400, clientY: 60 })

      expect(onSelectMaterial).toHaveBeenCalledWith('mount:hud')
    })
  })

  it('按下某个效果菱形时上抛其 id，并只点亮受控选中项', () => {
    const onSelectPointMarker = vi.fn()
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        editable={false}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
        pointMarkers={[
          { id: 'life:0', ms: 0, kind: 'lifecycle', label: '结算 · ent-player.attack add 0' },
          { id: 'life:1', ms: 3_000, kind: 'lifecycle', label: '结算 · ent-boss.attack add 0' },
        ]}
        selectedPointMarkerId="life:1"
        onSelectPointMarker={onSelectPointMarker}
      />,
    )

    const first = screen.getByRole('slider', { name: /ent-player\.attack add 0/ })
    const second = screen.getByRole('slider', { name: /ent-boss\.attack add 0/ })
    const viewport = container.querySelector('.gc-mtimeline-viewport')!
    const laneLabel = screen.getByText('时间轴结算')
    expect(container.querySelectorAll('.gc-mtrackline')).toHaveLength(6)
    // 视口地板高度 = 6 轨；有 flex 定界的宿主里还会继续生长占满剩余空间。
    expect(getComputedStyle(viewport).minHeight).toBe('264px')
    expect(laneLabel).toBeTruthy()
    expect(getComputedStyle(laneLabel).left).toBe('50%')
    expect(first).toHaveStyle({ left: '9px' })
    expect(second).toHaveStyle({ left: '-9px' })
    expect(first.closest('.gc-point-mark')).not.toHaveClass('is-selected')
    const selectedMarker = second.closest('.gc-point-mark')!
    expect(selectedMarker).toHaveClass('is-selected')
    expect(getComputedStyle(selectedMarker).borderLeftStyle).toBe('dashed')
    expect(getComputedStyle(selectedMarker).height).toBe('84px')

    fireEvent.pointerDown(first)
    expect(onSelectPointMarker).toHaveBeenCalledWith('life:0')
  })

  it('时刻参考线止于菱形，不再贯穿菱形下方的轨道', () => {
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        editable={false}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
        pointMarkers={[
          { id: 'settlement', ms: 1_000, kind: 'settlement', label: '路由结算' },
          { id: 'life:0', ms: 2_000, kind: 'lifecycle', label: '播到 2000ms 时结算' },
        ]}
      />,
    )

    const routeMarker = screen.getByRole('slider', { name: '路由结算' }).closest('.gc-point-mark')!
    const lifecycleMarker = screen.getByRole('slider', { name: '播到 2000ms 时结算' }).closest('.gc-point-mark')!
    expect(getComputedStyle(routeMarker).height).toBe('10px')
    expect(getComputedStyle(lifecycleMarker).height).toBe('84px')
  })

  it('第 7 条轨道出现后才开启纵向滚动', () => {
    const { container } = render(
      <MaterialTimeline
        materials={[{
          key: 'mount:track-6',
          id: 'track-6',
          kind: 'mount',
          label: '第六轨组件',
          startMs: 0,
          endMs: 1_000,
          zIndex: 5,
        }]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        editable={false}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )

    const viewport = container.querySelector('.gc-mtimeline-viewport')!
    const canvas = container.querySelector('.gc-mtimeline-canvas')!
    expect(container.querySelectorAll('.gc-mtrackline')).toHaveLength(7)
    expect(getComputedStyle(viewport).overflow).toBe('auto')
    expect(Number.parseFloat(getComputedStyle(canvas).height)).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(viewport).minHeight),
    )
  })

  it('流程预览可同时关闭编辑和选中交互', () => {
    const onSelectMaterial = vi.fn()
    const onSelectPointMarker = vi.fn()
    const { container } = render(
      <MaterialTimeline
        materials={[{
          key: 'mount:hud', id: 'hud', kind: 'mount', label: '血条',
          startMs: 0, endMs: 1_000, zIndex: 0,
        }]}
        maxMs={2_000}
        playheadMs={300}
        selectedMaterialKey={null}
        editable={false}
        selectable={false}
        segments={[
          { id: 'a', label: '战斗', startMs: 0, endMs: 1_000, active: true },
          { id: 'b', label: '失败', startMs: 1_000, endMs: 2_000 },
        ]}
        pointMarkers={[{ id: 'life:0', ms: 500, kind: 'lifecycle', label: '结算' }]}
        onSelectMaterial={onSelectMaterial}
        onSelectPointMarker={onSelectPointMarker}
        onPatchMaterial={vi.fn()}
      />,
    )

    fireEvent.pointerDown(container.querySelector('.gc-mclip')!)
    fireEvent.pointerDown(screen.getByRole('slider', { name: '结算' }))
    expect(onSelectMaterial).not.toHaveBeenCalled()
    expect(onSelectPointMarker).not.toHaveBeenCalled()
    expect(screen.getAllByTitle(/战斗|失败/)).toHaveLength(2)
  })

  it('流程预览保持首段像素比例并把后续视频追加到右侧', async () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(559)
    try {
      const { container } = render(
        <MaterialTimeline
          materials={[]}
          maxMs={22_000}
          playheadMs={0}
          selectedMaterialKey={null}
          editable={false}
          selectable={false}
          widthMode="append"
          segments={[
            { id: 'knock', label: '叩门', startMs: 0, endMs: 15_000, active: true },
            { id: 'next', label: '下一节点', startMs: 15_000, endMs: 22_000 },
          ]}
          onSelectMaterial={vi.fn()}
          onPatchMaterial={vi.fn()}
        />,
      )

      await waitFor(() => expect(container.querySelector('.gc-mtimeline-canvas')).toHaveStyle({
        width: `${559 * (22 / 15)}px`,
      }))
      const segments = container.querySelectorAll<HTMLElement>('.gc-flow-segment')
      expect(segments[0]).toHaveStyle({ left: '0px', width: '559px' })
      expect(segments[1]).toHaveStyle({
        left: '559px',
        width: `${559 * (7 / 15)}px`,
      })
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('流程预览按下时直接定位，并可配置持续拖动灵敏度', () => {
    const onSeek = vi.fn()
    const onScrubStart = vi.fn()
    const onScrubEnd = vi.fn()
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={10_000}
        playheadMs={0}
        selectedMaterialKey={null}
        editable={false}
        selectable={false}
        onSeek={onSeek}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        seekDragSensitivity={0.8}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
      />,
    )
    const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1_000, bottom: 240,
      width: 1_000, height: 240, toJSON: () => ({}),
    })
    vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})

    fireEvent.pointerDown(container.querySelector('.gc-mtimeline-ruler')!, {
      pointerId: 3,
      clientX: 200,
    })
    expect(onSeek).toHaveBeenLastCalledWith(2_000)
    expect(onScrubStart).toHaveBeenCalledTimes(1)

    fireEvent.pointerMove(canvas, { pointerId: 3, clientX: 400 })
    // 200px 在 10s / 1000px 下原本会前进 2000ms；0.8x 后前进 1600ms。
    expect(onSeek).toHaveBeenLastCalledWith(3_600)

    fireEvent.pointerUp(canvas, { pointerId: 3, clientX: 400 })
    expect(onScrubEnd).toHaveBeenCalledTimes(1)
  })

  it('派生界面时刻显示空心菱形且不可拖，非定时触发显示条件条', () => {
    const onSelectPointMarker = vi.fn()
    const onPointMarkerChange = vi.fn()
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
        pointMarkers={[
          { id: 'life:0', ms: 800, kind: 'derived', draggable: false, label: 'n_door 出现 → 效果' },
        ]}
        conditionMarkers={[
          {
            id: 'life:1',
            label: 'ent-player.hp 减少 → 添加连线',
            conditionChips: ['ent-player.hp', '减少'],
            actionChips: ['添加连线'],
          },
        ]}
        selectedPointMarkerId="life:1"
        onSelectPointMarker={onSelectPointMarker}
        onPointMarkerChange={onPointMarkerChange}
      />,
    )

    const derived = screen.getByRole('slider', { name: /n_door 出现/ })
    expect(derived).toHaveClass('is-derived')
    expect(derived.closest('.gc-point-mark')).toHaveClass('is-derived')
    fireEvent.pointerDown(derived)
    expect(onSelectPointMarker).toHaveBeenCalledWith('life:0')
    expect(onPointMarkerChange).not.toHaveBeenCalled()

    const condition = screen.getByRole('button', { name: /ent-player\.hp 减少/ })
    expect(condition).toHaveClass('is-selected')
    fireEvent.pointerDown(condition)
    expect(onSelectPointMarker).toHaveBeenLastCalledWith('life:1')
    expect(container.querySelector('.gc-condition-band')).toBeTruthy()
  })

  it('条件结算每增加一个就独占一行轨道，行内是 ↻ 条件 chips → 动作 chips', () => {
    const { container } = render(
      <MaterialTimeline
        materials={[]}
        maxMs={3_000}
        playheadMs={0}
        selectedMaterialKey={null}
        onSelectMaterial={vi.fn()}
        onPatchMaterial={vi.fn()}
        conditionMarkers={[
          { id: 'life:0', label: '分数 增加 → 变量一 add 5', conditionChips: ['分数', '增加'], actionChips: ['变量一 add 5'] },
          { id: 'life:1', label: '满足 2 项条件 → 未配置动作', conditionChips: ['满足 2 项条件'], actionChips: ['未配置动作'] },
        ]}
        onSelectPointMarker={vi.fn()}
      />,
    )

    const bands = Array.from(container.querySelectorAll<HTMLElement>('.gc-condition-band'))
    expect(bands).toHaveLength(2)
    const [first, second] = bands as [HTMLElement, HTMLElement]
    const topOf = (el: HTMLElement) => Number(el.style.top.replace('px', ''))
    // 两行恰好相差一个轨距：每个条件结算新起一行。
    expect(topOf(second) - topOf(first)).toBe(TIMELINE_LAYER_STEP)
    // 首行 = 2 个条件 chip + 1 个动作 chip。
    expect(first.querySelectorAll('.gc-cond-chip')).toHaveLength(3)
    expect(second.querySelectorAll('.gc-cond-chip')).toHaveLength(2)
  })
})
