// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../../../../i18n'
import { CharacterPreview } from '../CharacterPreview'
import { ControlPreview } from '../ControlPreview'
import { GenerationPreviewFrame } from '../GenerationPreviewFrame'
import { IconPreview } from '../IconPreview'
import { ImagePreview } from '../ImagePreview'
import { ScenePreview } from '../ScenePreview'
import { VideoPreview } from '../VideoPreview'

function imageAsset<K extends 'image' | 'icon' | 'scene' | 'character' | 'control'>(assetKind: K) {
  return {
    id: `${assetKind}-1`,
    assetKind,
    media: 'image' as const,
    resourceId: `${assetKind}-resource-1`,
    label: `${assetKind} result`,
    url: `https://example.com/${assetKind}.png`,
  }
}

describe('generation preview atoms', () => {
  beforeEach(() => setLocale('en'))

  it('keeps frame state/layout separate from media operations', () => {
    const { container } = render(
      <GenerationPreviewFrame
        phase="generating"
        interaction={{ disabled: false, readOnly: true, busy: true }}
        ariaLabel="preview frame"
      >
        <span>content</span>
      </GenerationPreviewFrame>,
    )
    const frame = container.querySelector('[aria-label="preview frame"]')
    expect(frame).toHaveAttribute('data-phase', 'generating')
    expect(frame).toHaveAttribute('data-read-only', 'true')
    expect(frame).toHaveAttribute('aria-busy', 'true')
    expect(frame).toHaveTextContent('content')
    expect(frame?.querySelector('.generation-preview-frame__footer')).toBeNull()
  })

  it('omits redundant succeeded status chrome but keeps failure feedback', () => {
    const { container, rerender } = render(
      <GenerationPreviewFrame phase="succeeded"><span>result</span></GenerationPreviewFrame>,
    )
    expect(container.querySelector('.generation-preview-frame__footer')).toBeNull()

    rerender(
      <GenerationPreviewFrame phase="failed" error="request failed"><span>result</span></GenerationPreviewFrame>,
    )
    expect(container.querySelector('.generation-preview-frame__status')).toBeTruthy()
    expect(container.querySelector('[role="alert"]')).toHaveTextContent('request failed')
  })

  it('exposes explicit image-like contracts while honoring read-only mutation rules', () => {
    const onInspect = vi.fn()
    const onSelect = vi.fn()
    const onApply = vi.fn()
    const onLocate = vi.fn()
    const { getByLabelText } = render(
      <ImagePreview
        asset={imageAsset('image')}
        interaction={{ disabled: false, readOnly: true, busy: false }}
        onInspect={onInspect}
        onSelect={onSelect}
        onApply={onApply}
        onLocate={onLocate}
        ariaLabel="image preview"
      />,
    )
    const preview = getByLabelText('image preview')
    const inspectButton = preview.querySelector('[data-action="inspect"]') as HTMLButtonElement
    const selectButton = preview.querySelector('[data-action="select"]') as HTMLButtonElement
    const applyButton = preview.querySelector('[data-action="apply"]') as HTMLButtonElement
    const locateButton = preview.querySelector('[data-action="locate"]') as HTMLButtonElement
    expect(inspectButton).not.toBeDisabled()
    expect(selectButton).not.toBeDisabled()
    expect(applyButton).toBeDisabled()
    expect(locateButton).not.toBeDisabled()
    fireEvent.click(inspectButton)
    fireEvent.click(selectButton)
    fireEvent.click(locateButton)
    expect(onInspect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onLocate).toHaveBeenCalledWith('image-resource-1')
    expect(onApply).not.toHaveBeenCalled()
  })

  it('keeps the icon image-like contract explicit', () => {
    const { container } = render(<IconPreview asset={imageAsset('icon')} />)
    expect(container.querySelector('[data-asset-kind="icon"]')).toBeTruthy()
    expect(container.querySelector('.generation-preview-image-like__actions')).toBeNull()
  })

  it('keeps the scene image-like contract explicit', () => {
    const { container } = render(<ScenePreview asset={imageAsset('scene')} />)
    expect(container.querySelector('[data-asset-kind="scene"]')).toBeTruthy()
  })

  it('keeps the character image-like contract explicit', () => {
    const { container } = render(<CharacterPreview asset={imageAsset('character')} />)
    expect(container.querySelector('[data-asset-kind="character"]')).toBeTruthy()
  })

  it('keeps the control image-like contract explicit', () => {
    const { container } = render(<ControlPreview asset={imageAsset('control')} />)
    expect(container.querySelector('[data-asset-kind="control"]')).toBeTruthy()
  })

  it('supports video playback, application and location as distinct operations', () => {
    const play = vi.fn()
    const apply = vi.fn()
    const locate = vi.fn()
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    const asset = {
      id: 'video-1',
      assetKind: 'video' as const,
      media: 'video' as const,
      resourceId: 'video-resource-1',
      label: 'Video result',
      url: 'https://example.com/video.mp4',
      durationSeconds: 4,
    }
    const { getByLabelText, getByRole } = render(
      <VideoPreview
        asset={asset}
        onPlay={play}
        onApply={apply}
        onLocate={locate}
        ariaLabel="video preview"
      />,
    )
    const preview = getByLabelText('video preview')
    const video = preview.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 })
    fireEvent.loadedMetadata(video)
    expect(video).not.toHaveAttribute('poster')
    expect(video.currentTime).toBe(0.001)
    fireEvent.click(preview.querySelector('[data-action="play"]') as HTMLButtonElement)
    fireEvent.click(preview.querySelector('[data-action="rate"]') as HTMLButtonElement)
    fireEvent.click(preview.querySelector('[data-action="fullscreen"]') as HTMLButtonElement)
    fireEvent.click(preview.querySelector('[data-action="apply"]') as HTMLButtonElement)
    fireEvent.click(preview.querySelector('[data-action="locate"]') as HTMLButtonElement)
    expect(getByRole('button', { name: 'Change playback speed' })).toHaveTextContent('1.5x')
    expect(play).toHaveBeenCalledWith(asset)
    expect(apply).toHaveBeenCalledWith(asset)
    expect(locate).toHaveBeenCalledWith('video-resource-1')
    playSpy.mockRestore()
    pauseSpy.mockRestore()
  })

  it('blocks every video action when disabled but permits playback/location in read-only mode', () => {
    const apply = vi.fn()
    const locate = vi.fn()
    const asset = {
      id: 'video-2',
      assetKind: 'video' as const,
      media: 'video' as const,
      resourceId: 'video-resource-2',
      url: 'https://example.com/video-2.mp4',
    }
    const { getByLabelText, rerender } = render(
      <VideoPreview asset={asset} interaction={{ disabled: false, readOnly: true, busy: false }} onApply={apply} onLocate={locate} ariaLabel="video preview" />,
    )
    let preview = getByLabelText('video preview')
    expect(preview.querySelector('[data-action="apply"]')).toBeDisabled()
    expect(preview.querySelector('[data-action="locate"]')).not.toBeDisabled()
    rerender(<VideoPreview asset={asset} interaction={{ disabled: true, readOnly: false, busy: false }} onApply={apply} onLocate={locate} ariaLabel="video preview" />)
    preview = getByLabelText('video preview')
    expect(preview.querySelector('[data-action="apply"]')).toBeDisabled()
    expect(preview.querySelector('[data-action="locate"]')).toBeDisabled()
  })

  it('shows applied video state without allowing a duplicate apply', () => {
    const apply = vi.fn()
    const asset = {
      id: 'video-applied',
      assetKind: 'video' as const,
      media: 'video' as const,
      url: 'https://example.com/video-applied.mp4',
    }
    const { getByLabelText } = render(
      <VideoPreview asset={asset} applied onApply={apply} ariaLabel="video preview" />,
    )
    const button = getByLabelText('video preview').querySelector('[data-action="apply"]') as HTMLButtonElement
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Applied')
    fireEvent.click(button)
    expect(apply).not.toHaveBeenCalled()
  })
})
