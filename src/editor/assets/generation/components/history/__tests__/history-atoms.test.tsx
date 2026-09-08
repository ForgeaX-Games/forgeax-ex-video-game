// @vitest-environment happy-dom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  adaptImageKinoTask,
  adaptVideoAsset,
  adaptVideoKinoTask,
} from '../adapters'
import { GenerationHistoryList } from '../GenerationHistoryList'
import type { GenerationHistoryItemData } from '../types'

describe('generation history adapters', () => {
  it('restores only prompt and image parameters that the Kino task actually carries', () => {
    const item = adaptImageKinoTask({
      generationId: 'image-task-1',
      status: 'succeeded',
      mediaType: 'image',
      prompt: 'A painted hero',
      model: 'lite',
      imageSize: '2496x1664',
      visualStyleKey: 'cinematic',
      resultUrl: 'https://example.com/hero.png',
    })
    expect(item.restorePayload).toEqual({
      prompt: 'A painted hero',
      model: 'lite',
      size: '2496x1664',
      visualStyleKey: 'cinematic',
    })
  })

  it('adapts full video task params when they are present, without defaults', () => {
    const item = adaptVideoKinoTask({
      generationId: 'video-task-1',
      status: 'succeeded',
      mediaType: 'video',
      prompt: 'Rain over the city',
      resultUrl: 'https://example.com/city.mp4',
      params: {
        durationSeconds: 12,
        resolution: '1080p',
        generateAudio: true,
        mode: 'ref',
        size: '1440x2560',
        referenceImageResourceIds: ['character-1', 'scene-1'],
      },
    })
    expect(item.restorePayload).toEqual({
      prompt: 'Rain over the city',
      size: '1440x2560',
      durationSeconds: 12,
      resolution: '1080p',
      generateAudio: true,
      mode: 'ref',
      referenceImageResourceIds: ['character-1', 'scene-1'],
    })
    expect(item.restorePayload).not.toHaveProperty('model')
  })

  it('adapts video assets and does not manufacture a prompt or model', () => {
    const item = adaptVideoAsset({
      id: 'registry-video-1',
      resourceId: 'kino-video-1',
      label: 'Rain clip',
      url: 'https://example.com/rain.mp4',
      durMs: 4500,
      updatedAt: 10,
    })
    expect(item.id).toBe('registry-video-1')
    expect(item.id).not.toBe(item.resourceId)
    expect(item.result).toMatchObject({ id: 'registry-video-1', resourceId: 'kino-video-1', durationSeconds: 4.5 })
    expect(item.restorePayload).toBeUndefined()
  })

  it('does not promote a Kino video resource id to a host registry identity', () => {
    const item = adaptVideoKinoTask({
      generationId: 'video-task-2',
      status: 'succeeded',
      mediaType: 'video',
      resourceId: 'kino-video-2',
      resultUrl: 'https://example.com/rain-2.mp4',
    })
    expect(item.id).toBeUndefined()
    expect(item.result?.id).toBe('kino-video-2')
  })
})

function historyItem(overrides: Partial<GenerationHistoryItemData> = {}): GenerationHistoryItemData {
  return {
    generationId: 'history-1',
    source: 'image-task',
    media: 'image',
    assetKind: 'image',
    status: 'succeeded',
    prompt: 'A hero',
    resultUrl: 'https://example.com/hero.png',
    id: 'registry-image-1',
    result: { id: 'registry-image-1', assetKind: 'image', media: 'image' },
    restorePayload: { prompt: 'A hero', size: '2560x1440' },
    ...overrides,
  }
}

describe('GenerationHistoryList', () => {
  it('renders a cover-only item as one immediate selection target', () => {
    const onActivate = vi.fn()
    const { container } = render(
      <GenerationHistoryList items={[historyItem()]} presentation="cover" onActivate={onActivate} />,
    )

    const item = container.querySelector('[role="listitem"]') as HTMLElement
    fireEvent.click(item.querySelector('button') as HTMLButtonElement)

    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'history-1' }))
    expect(item.querySelector('.generation-history-item__content')).toBeNull()
    expect(item.querySelector('.generation-history-item__actions')).toBeNull()
    expect(item).not.toHaveTextContent('A hero')
  })

  it('preloads only video metadata so history cards can render a frame', () => {
    const { container } = render(<GenerationHistoryList items={[historyItem({
      media: 'video',
      assetKind: 'video',
      source: 'video-asset',
      resultUrl: 'https://example.com/clip.mp4',
      result: { id: 'registry-video-1', assetKind: 'video', media: 'video' },
    })]} />)

    const video = container.querySelector('video') as HTMLVideoElement
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 })
    fireEvent.loadedMetadata(video)
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).not.toHaveAttribute('poster')
    expect(video.currentTime).toBe(0.001)
  })

  it('does not render a standalone poster as a video history result', () => {
    const { container } = render(<GenerationHistoryList items={[historyItem({
      media: 'video',
      assetKind: 'video',
      source: 'video-asset',
      resultUrl: undefined,
      posterUrl: 'https://example.com/clip-poster.jpg',
      result: { id: 'registry-video-1', assetKind: 'video', media: 'video' },
    })]} />)

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps inspect/select-result separate from settings restore', () => {
    const onInspect = vi.fn()
    const onSelectResult = vi.fn()
    const onRestoreSettings = vi.fn()
    const { container } = render(
      <GenerationHistoryList
        items={[historyItem()]}
        selectedGenerationId="history-1"
        onInspect={onInspect}
        onSelectResult={onSelectResult}
        onRestoreSettings={onRestoreSettings}
      />,
    )
    const item = container.querySelector('[role="listitem"]') as HTMLElement
    fireEvent.click(item.querySelector('[data-action="inspect"]') as HTMLButtonElement)
    fireEvent.click(item.querySelector('[data-action="select-result"]') as HTMLButtonElement)
    fireEvent.click(item.querySelector('[data-action="restore-settings"]') as HTMLButtonElement)
    expect(onInspect).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'history-1' }))
    expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'history-1' }))
    expect(onRestoreSettings).toHaveBeenCalledWith({ prompt: 'A hero', size: '2560x1440' }, expect.anything())
    expect(item.querySelector('[data-action="reuse-settings"]')).toBeNull()
    expect(item).toHaveAttribute('aria-selected', 'true')
  })

  it('allows inspect/select in read-only mode but disables settings restore/reuse', () => {
    const onInspect = vi.fn()
    const onSelectResult = vi.fn()
    const onRestoreSettings = vi.fn()
    const { container } = render(
      <GenerationHistoryList
        items={[historyItem()]}
        readOnly
        onInspect={onInspect}
        onSelectResult={onSelectResult}
        onRestoreSettings={onRestoreSettings}
      />,
    )
    const item = container.querySelector('[role="listitem"]') as HTMLElement
    const inspect = item.querySelector('[data-action="inspect"]') as HTMLButtonElement
    const select = item.querySelector('[data-action="select-result"]') as HTMLButtonElement
    const restore = item.querySelector('[data-action="restore-settings"]') as HTMLButtonElement
    expect(inspect).not.toBeDisabled()
    expect(select).not.toBeDisabled()
    expect(restore).toBeDisabled()
    fireEvent.click(inspect)
    fireEvent.click(select)
    expect(onInspect).toHaveBeenCalledOnce()
    expect(onSelectResult).toHaveBeenCalledOnce()
    expect(onRestoreSettings).not.toHaveBeenCalled()
  })

  it('does not expose restore controls for entries without a real prompt', () => {
    const { container } = render(
      <GenerationHistoryList
        items={[historyItem({ prompt: undefined, restorePayload: undefined })]}
        onRestoreSettings={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-action="restore-settings"]')).toBeNull()
  })

  it('disables result selection when a result has no host registry id', () => {
    const { container } = render(
      <GenerationHistoryList
        items={[historyItem({ media: 'video', source: 'video-task', id: undefined })]}
        onSelectResult={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-action="select-result"]')).toBeDisabled()
  })

  it('disables result selection when an entry has no result', () => {
    const { container } = render(
      <GenerationHistoryList
        items={[historyItem({ result: undefined, id: 'registry-image-1' })]}
        onSelectResult={vi.fn()}
      />,
    )
    expect(container.querySelector('[data-action="select-result"]')).toBeDisabled()
  })
})
