import { describe, expect, it, vi } from 'vitest'
import { projectAssetCatalogMediaUrls } from '../asset-catalog-media-projection'
import { EMPTY_ASSET_CATALOG, type AssetCatalog } from '../asset-catalog-model'

function catalogWithAssets(assets: AssetCatalog['assets']): AssetCatalog {
  return { ...EMPTY_ASSET_CATALOG, assets }
}

describe('projectAssetCatalogMediaUrls', () => {
  it('derives a current-runtime URL from an authenticated Host media reference', () => {
    const resolve = vi.fn((assetId: string) => `/current-runtime/media/assets/${assetId}`)
    const catalog = catalogWithAssets({
      'image-1': {
        id: 'image-1',
        kind: 'image',
        name: 'Image',
        url: '/__extension__/v1/extension/stale-runtime/media/assets/media-1',
        provider: { kind: 'local', ref: 'media-1' },
        meta: {
          hostMedia: {
            provenance: 'extension-media-capability',
            assetId: 'media-1',
          },
        },
      },
    })

    const projected = projectAssetCatalogMediaUrls(catalog, resolve)

    expect(resolve).toHaveBeenCalledWith('media-1')
    expect(projected.assets['image-1']?.url).toBe('/current-runtime/media/assets/media-1')
    expect(catalog.assets['image-1']?.url).toContain('stale-runtime')
  })

  it('does not reinterpret Kino URLs or unverified local provider refs', () => {
    const resolve = vi.fn((assetId: string) => `/media/${assetId}`)
    const catalog = catalogWithAssets({
      kino: {
        id: 'kino', kind: 'image', name: 'Kino', url: 'https://cdn.example/kino.jpg',
        provider: { kind: 'kino', upstreamResourceId: 'resource-1' },
      },
      document: {
        id: 'document', kind: 'document', name: 'Document', url: '/documents/design.md',
        provider: { kind: 'local', ref: 'documents/design.md' },
      },
    })

    const projected = projectAssetCatalogMediaUrls(catalog, resolve)

    expect(projected).toBe(catalog)
    expect(resolve).not.toHaveBeenCalled()
  })
})
