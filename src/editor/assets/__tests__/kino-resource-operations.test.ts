import { describe, expect, it, vi } from 'vitest'
import { renameKinoResource } from '../kino-resource-operations'
import type { KinoResourceDTO, KinoVideoClient } from '../kino-api'

describe('renameKinoResource', () => {
  it('preserves the complete Kino resource payload and only changes the name', async () => {
    const current: KinoResourceDTO = {
      resource_id: 'video-1',
      game_id: 'game-1',
      media_type: 'video',
      name: 'old',
      url: 'https://cdn.test/video.mp4',
      type: 'UPLOAD',
      remark: 'keep',
      source: 'upload',
      source_meta: { duration_ms: 1200 },
      created_at: 1,
      updated_at: 2,
    }
    const get = vi.fn(async () => current)
    const update = vi.fn(async (_id, input) => ({ ...current, ...input, updated_at: 3 }))

    await renameKinoResource(
      { get, update } as unknown as KinoVideoClient,
      'video-1',
      'game-1',
      'new',
    )

    expect(update).toHaveBeenCalledWith('video-1', {
      resource_id: 'video-1',
      game_id: 'game-1',
      media_type: 'video',
      url: current.url,
      name: 'new',
      type: current.type,
      remark: current.remark,
      source: current.source,
      source_meta: current.source_meta,
    }, undefined)
  })
})
