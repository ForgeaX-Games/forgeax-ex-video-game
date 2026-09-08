// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../../../i18n'
import { VideoParameters } from '../VideoParameters'
import { GenerationUpload } from '../GenerationUpload'
import { UploadedAssetList } from '../UploadedAssetList'

describe('generation input atoms', () => {
  beforeEach(() => setLocale('en'))

  it('exposes only the Kino video parameter fields and emits controlled patches', () => {
    const onChange = vi.fn()
    render(
      <VideoParameters
        value={{ mode: 't2v', model: 'lite', resolution: '720p', durationSeconds: 5, size: '2560x1440', generateAudio: false }}
        modelOptions={['lite', 'pro']}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'pro' } })
    fireEvent.click(screen.getByRole('button', { name: '1080p' }))
    const durationSlider = screen.getByRole('slider', { name: 'Duration slider' })
    expect(durationSlider).toHaveAttribute('min', '4')
    expect(durationSlider).toHaveAttribute('max', '15')
    fireEvent.change(durationSlider, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Increase duration' }))
    fireEvent.click(screen.getByRole('button', { name: 'First & last frames to video' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Audio' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ model: 'pro' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ resolution: '1080p' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 12 }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 6 }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'strict' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ generateAudio: true }))
  })

  it('does not make a file input actionable without a caller upload action', () => {
    render(<GenerationUpload />)
    expect(screen.getByLabelText('Upload files')).toBeDisabled()
  })

  it('forwards selected files only through the supplied upload action', async () => {
    const upload = vi.fn(async () => undefined)
    render(<GenerationUpload onUpload={upload} multiple accept="image/*" />)
    const input = screen.getByLabelText('Upload files') as HTMLInputElement
    const first = new File(['one'], 'one.png', { type: 'image/png' })
    const second = new File(['two'], 'two.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [first, second] } })
    await waitFor(() => expect(upload).toHaveBeenCalledWith([first, second]))
    expect(input.value).toBe('')
  })

  it('keeps UploadedAssetList controlled and gates removal on the action and interaction', () => {
    const onRemove = vi.fn()
    const assets = [{ id: 'hero', label: 'Hero', url: '/hero.png' }]
    const { rerender } = render(<UploadedAssetList assets={assets} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hero' }))
    expect(onRemove).toHaveBeenCalledWith(assets[0])

    rerender(<UploadedAssetList assets={assets} onRemove={onRemove} readOnly />)
    expect(screen.getByRole('button', { name: 'Remove Hero' })).toBeDisabled()
  })
})
