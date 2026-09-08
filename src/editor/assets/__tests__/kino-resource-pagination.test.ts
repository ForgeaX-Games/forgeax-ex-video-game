import { describe, expect, it, vi } from 'vitest'
import { listAllKinoResources } from '../kino-resource-pagination'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'

function resource(id: string, mediaType: KinoResourceDTO['media_type']): KinoResourceDTO {
  return {
    resource_id: id,
    game_id: 'game-1',
    media_type: mediaType,
    url: `https://cdn.test/${id}`,
    created_at: 1,
    updated_at: 1,
  }
}

describe('listAllKinoResources', () => {
  it('deduplicates pages and applies the caller media guard without changing upstream total', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [resource('video-1', 'video'), resource('wrong', 'image')], total: 3, page: 1, page_size: 2 })
      .mockResolvedValueOnce({ items: [resource('video-1', 'video')], total: 3, page: 2, page_size: 2 })
    const result = await listAllKinoResources(
      { list } as unknown as KinoVideoClient,
      { game_id: 'game-1', media_type: 'video' },
      { accept: (item) => item.media_type === 'video' },
    )

    expect(list).toHaveBeenCalledTimes(2)
    expect(result.items.map((item) => item.resource_id)).toEqual(['video-1'])
    expect(result.total).toBe(3)
  })

  it('can keep paging until the unique resource count reaches total', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [resource('image-1', 'image')], total: 2, page: 1, page_size: 1 })
      .mockResolvedValueOnce({ items: [resource('image-1', 'image')], total: 2, page: 2, page_size: 1 })
      .mockResolvedValueOnce({ items: [resource('image-2', 'image')], total: 2, page: 3, page_size: 1 })

    const result = await listAllKinoResources(
      { list } as unknown as KinoVideoClient,
      { game_id: 'game-1', media_type: 'image' },
      { completion: 'unique' },
    )

    expect(list).toHaveBeenCalledTimes(3)
    expect(result.items.map((item) => item.resource_id)).toEqual(['image-1', 'image-2'])
  })
})
