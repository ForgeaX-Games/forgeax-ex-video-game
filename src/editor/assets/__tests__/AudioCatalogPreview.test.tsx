import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioCatalogPreview } from '../AudioCatalogPreview'

vi.mock('@/editor/video/audioWaveform', () => ({
  AudioWaveform: () => <canvas data-testid="audio-waveform" />,
}))

afterEach(cleanup)

describe('AudioCatalogPreview', () => {
  it('uses the shared media controls with a disabled fullscreen button', () => {
    render(<AudioCatalogPreview open src="/assets/theme.mp3" label="主题曲" onClose={vi.fn()} />)

    const audio = screen.getByLabelText('主题曲 音频预览') as HTMLAudioElement
    Object.defineProperty(audio, 'duration', { configurable: true, value: 65 })
    fireEvent.loadedMetadata(audio)

    expect(screen.getByTestId('audio-waveform')).toBeTruthy()
    expect(screen.getByRole('button', { name: '播放' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新播放' })).toBeTruthy()
    expect(screen.getByText('0:00')).toBeTruthy()
    expect(screen.getByText('1:05')).toBeTruthy()
    expect(screen.getByRole('button', { name: '1.0x' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全屏' })).toBeDisabled()
  })

  it('plays, seeks, and changes speed through the shared controls', () => {
    render(<AudioCatalogPreview open src="/assets/theme.mp3" label="主题曲" onClose={vi.fn()} />)

    const audio = screen.getByLabelText('主题曲 音频预览') as HTMLAudioElement
    const play = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(audio, 'play', { configurable: true, value: play })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 10 })
    fireEvent.loadedMetadata(audio)
    fireEvent.click(screen.getByRole('button', { name: '播放' }))
    fireEvent.change(screen.getByRole('slider', { name: '媒体进度' }), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '1.0x' }))

    expect(play).toHaveBeenCalledOnce()
    expect(audio.currentTime).toBe(4)
    expect(audio.playbackRate).toBe(1.5)
  })
})
