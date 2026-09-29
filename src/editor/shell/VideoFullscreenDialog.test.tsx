import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoFullscreenDialog } from './VideoFullscreenDialog'

afterEach(cleanup)

describe('VideoFullscreenDialog', () => {
  it('open 时显示视频预览与可选导入操作', () => {
    render(
      <VideoFullscreenDialog
        open
        src="/assets/intro.mp4"
        label="开场动画"
        durationMs={65_000}
        onClose={vi.fn()}
        onImport={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog', { name: '开场动画' })).toBeTruthy()
    expect(screen.getByLabelText('开场动画 视频预览').getAttribute('src')).toBe('/assets/intro.mp4')
    expect(screen.queryByText('1:05')).toBeNull()
    expect(screen.getByRole('button', { name: '导入资产' })).toBeTruthy()
  })

  it('Escape 与关闭按钮均调用 onClose', () => {
    const onClose = vi.fn()
    render(<VideoFullscreenDialog open src="/assets/intro.mp4" label="开场动画" onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '关闭视频预览' }))

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('点击导入资产时调用 onImport', () => {
    const onImport = vi.fn()
    render(<VideoFullscreenDialog open label="开场动画" onClose={vi.fn()} onImport={onImport} />)

    fireEvent.click(screen.getByRole('button', { name: '导入资产' }))

    expect(onImport).toHaveBeenCalledOnce()
  })

  it('通过下拉菜单设置视频播放倍速', () => {
    render(<VideoFullscreenDialog open src="/assets/intro.mp4" label="开场动画" onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '播放倍速' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '2.0X' }))

    expect(screen.getByLabelText('开场动画 视频预览')).toHaveProperty('playbackRate', 2)
    expect(screen.queryByRole('menu', { name: '播放倍速' })).toBeNull()
  })
})
