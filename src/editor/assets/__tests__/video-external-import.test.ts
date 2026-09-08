import { describe, expect, it, vi } from 'vitest'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'
import {
  ExternalVideoImportError,
  createExternalVideoImportInput,
  listExternalProjectVideos,
  listExternalVideoImportProjects,
} from '../video-external-import'

const extension = vi.hoisted(() => ({
  fetch: vi.fn((path: string, init?: RequestInit) => fetch(path, init)),
  url: vi.fn((path: string) => path),
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => ({ extension, ready: vi.fn(async () => undefined) }),
}))

function resource(overrides: Partial<KinoResourceDTO> = {}): KinoResourceDTO {
  return {
    resource_id: 'source-video',
    game_id: 'source-game',
    media_type: 'video',
    url: 'https://cdn.example.com/videos/outdoor.mp4',
    name: 'Outdoor',
    source_meta: { duration_ms: 4_000 },
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

describe('video external import helpers', () => {
  it('loads importable projects through the Kino endpoint and excludes the target game', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/media/import-projects?exclude_game_id=target%20game')
      return new Response(JSON.stringify({ code: 0, message: 'ok', data: [{ game_id: 'source-game', name: 'Source' }] }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchImpl)
    try {
      await expect(listExternalVideoImportProjects('target game')).resolves.toEqual([
        { game_id: 'source-game', name: 'Source' },
      ])
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('normalizes the documented paged import-project response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: 'ok',
      data: { items: [{ game_id: 'source-game', game_name: 'Source' }], total: 1 },
    }), { headers: { 'content-type': 'application/json' } }))
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchImpl)
    try {
      await expect(listExternalVideoImportProjects('target-game')).resolves.toEqual([
        { game_id: 'source-game', game_name: 'Source' },
      ])
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('loads video choices from the selected source project', async () => {
    const list = vi.fn(async () => ({ items: [resource()], total: 1, page: 1, page_size: 100 }))
    const client = { list } as unknown as KinoVideoClient

    await expect(listExternalProjectVideos(client, 'source-game')).resolves.toEqual([resource()])
    expect(list).toHaveBeenCalledWith({
      game_id: 'source-game', media_type: 'video', page: 1, page_size: 100,
    }, {})
  })

  it('creates the documented external-import payload without folder or tag fields', () => {
    expect(createExternalVideoImportInput('target-game', resource(), '  Imported outdoor  ')).toEqual({
      game_id: 'target-game',
      media_type: 'video',
      url: 'https://cdn.example.com/videos/outdoor.mp4',
      name: 'Imported outdoor',
      type: 'OTHER',
      source: 'external-import',
      source_meta: { duration_ms: 4_000 },
    })
  })

  it.each(['http://cdn.example.com/video.mp4', 'https://', 'not a URL'])(
    'rejects an unsafe external video URL: %s',
    (url) => {
      expect(() => createExternalVideoImportInput('target-game', resource({ url }), 'Video'))
        .toThrow(ExternalVideoImportError)
    },
  )
})
