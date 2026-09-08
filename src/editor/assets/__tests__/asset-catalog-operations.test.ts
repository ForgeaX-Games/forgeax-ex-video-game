import { describe, expect, it, vi } from 'vitest'
import { createAssetCatalogOperations } from '../asset-catalog-operations'

describe('asset catalog operations', () => {
  it('uploads once and defers catalog registration so a failed registration can retry safely', async () => {
    const registerGenerated = vi.fn(async () => {})
    const upload = vi.fn(async () => ({
      resource_id: 'kino-1',
      game_id: 'game-1',
      media_type: 'image' as const,
      url: 'https://cdn.test/one.png',
      created_at: 1,
      updated_at: 1,
    }))
    const operations = createAssetCatalogOperations({
      catalogClient: { registerGenerated } as never,
      kinoClient: {} as never,
      upload,
      operationId: () => 'operation-1',
    })
    const file = new File(['image'], 'hero.png', { type: 'image/png' })

    const register = await operations.createUploadRegistration({
      gameId: 'game-1',
      location: { kind: 'tab-root', tabKind: 'character', target: 'root:character' },
      file,
      kind: 'image',
      targetTabKind: 'character',
    })

    expect(upload).toHaveBeenCalledOnce()
    expect(registerGenerated).not.toHaveBeenCalled()
    await register()
    await register()
    expect(upload).toHaveBeenCalledOnce()
    expect(registerGenerated).toHaveBeenCalledTimes(2)
    expect(registerGenerated).toHaveBeenLastCalledWith(expect.objectContaining({
      operationId: 'operation-1',
      asset: expect.objectContaining({
        id: 'asset_upload_kino-1',
        productionType: 'character_ref',
        url: 'https://cdn.test/one.png',
      }),
      placement: expect.objectContaining({ folderId: 'root:character' }),
    }))
  })

  it('registers audio with a stable entity id independent from the uploaded resource asset id', async () => {
    const registerGenerated = vi.fn(async (_input: unknown) => {})
    const upload = vi.fn(async () => ({
      resource_id: 'kino-audio-1',
      game_id: 'game-1',
      media_type: 'audio' as const,
      url: 'https://cdn.test/battle.mp3',
      created_at: 1,
      updated_at: 1,
    }))
    const operations = createAssetCatalogOperations({
      catalogClient: { registerGenerated } as never,
      kinoClient: {} as never,
      upload,
      operationId: () => 'entity-1',
    })

    const register = await operations.createUploadRegistration({
      gameId: 'game-1',
      location: { kind: 'tab-root', tabKind: 'audio', target: 'root:audio' },
      file: new File(['audio'], 'battle.mp3', { type: 'audio/mpeg' }),
      kind: 'audio',
    })
    await register()

    expect(registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'entity-1',
      asset: expect.objectContaining({
        id: 'asset_upload_kino-audio-1',
        kind: 'audio',
        productionType: 'audio_track',
      }),
      placement: expect.objectContaining({
        placementKey: 'audio:audio_entity-1',
        folderId: 'root:audio',
      }),
      apply: expect.objectContaining({
        tabKind: 'audio',
        entityId: 'audio_entity-1',
        createEntity: { name: 'battle' },
      }),
    }))
  })
})
