import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.hoisted(() => vi.fn())

vi.mock('../../assets/kino-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../assets/kino-api')>()
  return {
    ...actual,
    createKinoVideoClient: () => ({
      list,
      playbackUrl: (id: string, gameId: string) =>
        `/api/v1/kino/resources/${id}/content?game_id=${gameId}`,
    }),
  }
})

import { MAX_KINO_RESOURCE_PAGE_SIZE } from '../../assets/kino-api'
import { listVideoAssetInfos } from '../media'

function resource(id: string) {
  return {
    resource_id: id,
    game_id: 'demo',
    media_type: 'video' as const,
    url: `http://object/${id}`,
    name: id,
    created_at: 1,
    updated_at: 2,
  }
}

describe('listVideoAssetInfos', () => {
  beforeEach(() => {
    list.mockReset()
  })

  it('loads Kino pages until total is reached', async () => {
    list
      .mockResolvedValueOnce({
        items: [resource('res-1'), resource('res-2')],
        total: 3,
        page: 1,
        page_size: 2,
      })
      .mockResolvedValueOnce({
        items: [resource('res-3')],
        total: 3,
        page: 2,
        page_size: 2,
      })

    const assets = await listVideoAssetInfos('demo')

    expect(assets.map((asset) => asset.id)).toEqual(['res-1', 'res-2', 'res-3'])
    expect(list).toHaveBeenCalledTimes(2)
    expect(list.mock.calls[1]?.[0]).toMatchObject({ page: 2 })
  })

  it('uses a page size accepted by the Kino service', async () => {
    list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: MAX_KINO_RESOURCE_PAGE_SIZE,
    })

    await listVideoAssetInfos('demo')

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, page_size: MAX_KINO_RESOURCE_PAGE_SIZE }),
      expect.anything(),
    )
    expect(MAX_KINO_RESOURCE_PAGE_SIZE).toBe(100)
  })

  it('stops on an empty page even when total is inconsistent', async () => {
    list
      .mockResolvedValueOnce({
        items: [resource('res-1')],
        total: 99_999,
        page: 1,
        page_size: 200,
      })
      .mockResolvedValueOnce({
        items: [],
        total: 99_999,
        page: 2,
        page_size: 200,
      })

    const assets = await listVideoAssetInfos('demo')

    expect(assets.map((asset) => asset.id)).toEqual(['res-1'])
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('forwards an abort signal to every Kino page request', async () => {
    const controller = new AbortController()
    list.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 200,
    })

    await listVideoAssetInfos('demo', { signal: controller.signal })

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1 }),
      { signal: controller.signal },
    )
  })

  it('stops at the configured page cap for inconsistent upstream totals', async () => {
    list.mockImplementation(async (query: { page: number }) => ({
      items: [resource(`res-${query.page}`)],
      total: 99_999,
      page: query.page,
      page_size: 200,
    }))

    const assets = await listVideoAssetInfos('demo', { maxPages: 2 })

    expect(assets.map((asset) => asset.id)).toEqual(['res-1', 'res-2'])
    expect(list).toHaveBeenCalledTimes(2)
  })
})
