import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VideoAudioToggle } from '../VideoAudioToggle'

describe('VideoAudioToggle', () => {
  it('exposes its state and toggles from a user gesture', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<VideoAudioToggle enabled={false} onToggle={onToggle} />)

    const muted = screen.getByRole('button', { name: '开启视频原声' })
    expect(muted).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(muted)
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(<VideoAudioToggle enabled onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: '关闭视频原声' })).toHaveAttribute('aria-pressed', 'true')
  })
})
