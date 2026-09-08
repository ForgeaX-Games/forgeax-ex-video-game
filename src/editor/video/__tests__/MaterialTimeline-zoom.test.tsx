import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MaterialTimeline } from '../MaterialTimeline'

afterEach(cleanup)

describe('MaterialTimeline · 缩放控件', () => {
  function renderTimeline() {
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
    return container
  }

  it('头部右侧渲染缩放控件（缩小 / 滑轨 / 放大），初始 1× 时缩小禁用', () => {
    renderTimeline()

    expect(screen.getByText('控件时间轴')).toBeTruthy()
    expect(screen.getByRole('button', { name: '时间轴缩小' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '时间轴放大' })).toBeEnabled()
    expect(screen.getByRole('slider', { name: '时间轴缩放' })).toHaveAttribute('aria-valuenow', '1')
  })

  it('点击放大推进 zoom（滑轨 aria 与画布宽度联动）；拖滑轨到中点约为量程中值', () => {
    const container = renderTimeline()
    const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
    const initialWidth = canvas.style.width

    fireEvent.click(screen.getByRole('button', { name: '时间轴放大' }))
    expect(screen.getByRole('slider', { name: '时间轴缩放' })).toHaveAttribute('aria-valuenow', '1.2')
    expect(canvas.style.width).not.toBe(initialWidth)
    expect(screen.getByRole('button', { name: '时间轴缩小' })).toBeEnabled()

    // 拖滑轨到轨道中点 → zoom ≈ ZOOM_MIN + 0.5 × (ZOOM_MAX - ZOOM_MIN) = 3。
    const track = screen.getByRole('slider', { name: '时间轴缩放' })
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 112, bottom: 12,
      width: 112, height: 12, toJSON: () => ({}),
    })
    vi.spyOn(track, 'setPointerCapture').mockImplementation(() => {})
    fireEvent.pointerDown(track, { pointerId: 1, clientX: 56, clientY: 6 })
    expect(screen.getByRole('slider', { name: '时间轴缩放' })).toHaveAttribute('aria-valuenow', '3')
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 112, clientY: 6 })
    expect(screen.getByRole('slider', { name: '时间轴缩放' })).toHaveAttribute('aria-valuenow', '5')
    expect(screen.getByRole('button', { name: '时间轴放大' })).toBeDisabled()
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 112, clientY: 6 })
  })
})
