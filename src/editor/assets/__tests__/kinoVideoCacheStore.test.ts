import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installKinoVideoCacheSync,
  useKinoVideoCache,
  useKinoVideoResources,
} from '../kinoVideoCacheStore'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'

const defaultList = vi.hoisted(() => vi.fn())

vi.mock('../kino-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kino-api')>()
  return {
    ...actual,
    createKinoVideoClient: () => client(defaultList),
  }
})

function resource(id: string): KinoResourceDTO {
  return {
    resource_id: id,
    game_id: 'demo',
    media_type: 'video',
    url: `http://object/${id}`,
    created_at: 1,
    updated_at: 1,
  }
}

function client(list: KinoVideoClient['list']): KinoVideoClient {
  return {
    capabilities: vi.fn(),
    prepareUpload: vi.fn(),
    list,
    get: vi.fn(),
    create: vi.fn(),
    batch: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    playbackUrl: vi.fn(),
  }
}

describe('kinoVideoCacheStore', () => {
  beforeEach(() => {
    useKinoVideoCache.setState({ byGame: {} })
    defaultList.mockReset()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('loads every Kino page into only the requested project cache', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [resource('one')], total: 2, page: 1, page_size: 100 })
      .mockResolvedValueOnce({ items: [resource('two')], total: 2, page: 2, page_size: 100 })

    await useKinoVideoCache.getState().refresh('project-a', client(list))

    expect(useKinoVideoCache.getState().byGame['project-a']?.items.map((item) => item.resource_id))
      .toEqual(['one', 'two'])
    expect(useKinoVideoCache.getState().byGame['project-b']).toBeUndefined()
  })

  it('excludes non-video records from an upstream video response', async () => {
    const image = { ...resource('cover'), media_type: 'image' as const }
    const list = vi.fn().mockResolvedValue({
      items: [resource('clip'), image],
      total: 2,
      page: 1,
      page_size: 100,
    })

    await useKinoVideoCache.getState().refresh('project-a', client(list))

    expect(useKinoVideoCache.getState().byGame['project-a']?.items.map((item) => item.resource_id))
      .toEqual(['clip'])
  })

  it('updates a cached resource immediately', () => {
    useKinoVideoCache.getState().upsert('project-a', resource('one'))
    useKinoVideoCache.getState().remove('project-a', 'one')

    expect(useKinoVideoCache.getState().byGame['project-a']?.items).toEqual([])
  })

  it('synchronizes upserts and removals between Extension panes', () => {
    class FakeBroadcastChannel {
      static instance: FakeBroadcastChannel | undefined
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage = vi.fn()
      close = vi.fn()

      constructor(readonly name: string) {
        FakeBroadcastChannel.instance = this
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const dispose = installKinoVideoCacheSync()
    const channel = FakeBroadcastChannel.instance!

    useKinoVideoCache.getState().upsert('demo', resource('one'))
    expect(channel.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'upsert',
      gameId: 'demo',
    }))

    channel.onmessage?.({
      data: { type: 'remove', gameId: 'demo', resourceId: 'one' },
    } as MessageEvent)
    expect(useKinoVideoCache.getState().byGame.demo?.items).toEqual([])
    expect(channel.postMessage).toHaveBeenCalledTimes(1)

    dispose()
    expect(channel.close).toHaveBeenCalledOnce()
  })

  it('shares one cache hydration between resource consumers', async () => {
    defaultList.mockResolvedValue({
      items: [resource('one')],
      total: 1,
      page: 1,
      page_size: 100,
    })

    const first = renderHook(() => useKinoVideoResources('project-a'))
    const second = renderHook(() => useKinoVideoResources('project-a'))

    await waitFor(() => expect(first.result.current.items).toHaveLength(1))
    expect(second.result.current.items).toHaveLength(1)
    // ensure() dedupes: two consumers of the same project hydrate the cache once.
    expect(defaultList).toHaveBeenCalledTimes(1)

    first.unmount()
    second.unmount()
  })
})
