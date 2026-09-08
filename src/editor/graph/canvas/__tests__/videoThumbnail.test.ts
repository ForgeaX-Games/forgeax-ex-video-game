import { describe, expect, it, vi } from 'vitest'
import { loadVideoThumbnail } from '../videoThumbnail'

describe('loadVideoThumbnail', () => {
  it('deduplicates concurrent requests for the same URL', async () => {
    const capture = vi.fn(async () => 'data:image/jpeg;base64,frame')

    const [first, second] = await Promise.all([
      loadVideoThumbnail('https://cdn.test/shared.mp4', capture),
      loadVideoThumbnail('https://cdn.test/shared.mp4', capture),
    ])

    expect(first).toBe('data:image/jpeg;base64,frame')
    expect(second).toBe(first)
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('returns an empty result when frame capture fails', async () => {
    const capture = vi.fn(async () => {
      throw new Error('decode failed')
    })

    await expect(
      loadVideoThumbnail('https://cdn.test/broken.mp4', capture),
    ).resolves.toBe('')
  })
})
