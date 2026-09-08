import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssetResolver } from '../assets'
import { GamePackageError, parseGamePackage } from '../package'

const blueprint = {
  graph: { nodes: [], edges: [] },
  manifest: { mainPackId: 'main', packs: {} },
}

afterEach(() => vi.unstubAllGlobals())

describe('standalone SDK package', () => {
  it('parses a Extension package payload independently of transport', () => {
    const gamePackage = parseGamePackage({
      project: { id: '0728-02' },
      blueprint,
      assetsManifest: {
        version: 2,
        assets: [{ id: 'intro', kind: 'video' }],
        assetCatalog: { entities: { audio: {} } },
      },
    })

    expect(gamePackage.assetsManifest.assets[0]?.id).toBe('intro')
    expect(gamePackage.assetsManifest.assetCatalog?.entities.audio).toEqual({})
  })

  it('rejects an invalid Extension package payload', () => {
    expect(() => parseGamePackage({ blueprint })).toThrow(GamePackageError)
  })

  it.each([
    ['video', 'video-1', '/__extension__/v1/games/demo/media/video-1'],
    ['image', 'image-1', '/__extension__/v1/games/demo/media/image-1'],
  ])('resolves %s assets through the same manifest locator rule', (kind, id, url) => {
    const resolveAsset = createAssetResolver({
      version: 2,
      assets: [{ id, kind, url }],
    })

    expect(resolveAsset(id, 'demo')).toBe(url)
  })

  it('resolves an audio entity id through its current manifest asset', () => {
    const resolveAsset = createAssetResolver({
      version: 2,
      assets: [{ id: 'audio-v2', kind: 'audio', url: 'https://cdn.test/battle-v2.mp3' }],
      assetCatalog: {
        entities: {
          audio: {
            battle: { id: 'battle', current: { assetId: 'audio-v2' } },
          },
        },
      },
    })

    expect(resolveAsset('battle', 'demo')).toBe('https://cdn.test/battle-v2.mp3')
    expect(resolveAsset('audio-v2', 'demo')).toBeUndefined()
  })

  it('passes through direct root-relative and opaque URLs', () => {
    const resolveAsset = createAssetResolver({ version: 2, assets: [] })

    expect(resolveAsset('/__extension__/v1/games/demo/media/direct', 'demo')).toBe(
      '/__extension__/v1/games/demo/media/direct',
    )
    expect(resolveAsset('blob:https://example.test/id', 'demo')).toBe('blob:https://example.test/id')
  })

  it('does not fabricate a fallback route for an asset without a locator', () => {
    const resolveAsset = createAssetResolver({
      version: 2,
      assets: [
        { id: 'intro', kind: 'video' },
        { id: 'remote', kind: 'video', url: 'https://cdn.example.test/remote.mp4' },
      ],
    })

    expect(resolveAsset('intro', '0728-02')).toBeUndefined()
    expect(resolveAsset('remote', '0728-02')).toBe('https://cdn.example.test/remote.mp4')
    expect(resolveAsset('missing', '0728-02')).toBeUndefined()
  })
})
