import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  CATALOG_ROOT_TARGET,
  catalogFolderChildren,
  catalogFolderPath,
  catalogFolderSubtree,
  catalogItemsIn,
  catalogEntityOptions,
  isCatalogRootTarget,
  isCatalogTabRootTarget,
  parseAssetCatalog,
  parseAssetCatalogResponse,
  parseCatalogAssets,
  parseCatalogPlacementKey,
  resolveCatalogItemLocation,
  parseCatalogTabRoot,
  resolveCatalogAsset,
  resolveCatalogEntityAsset,
  EMPTY_ASSET_CATALOG,
  useAssetCatalog,
} from '../asset-catalog'
import {
  ASSET_CATALOG_INVALIDATION_CHANNEL,
  ASSET_CATALOG_INVALIDATION_EVENT,
} from '../asset-catalog-events'

const stamps = { createdAt: 1, updatedAt: 1 }

/** 目录段只存目录与实体；图片/视频等本体一律住在 manifest.assets。 */
const MANIFEST = {
  version: 2,
  assets: [
    { id: 'img-hero-v1', kind: 'image', label: '主角立绘 v1', url: 'https://example.com/hero.png', ...stamps },
    {
      id: 'img-boss-room-v2',
      kind: 'image',
      label: 'Boss 大殿 v2',
      // 没有顶层 url，只有宿主媒体 locator。
      meta: { hostMedia: { locator: '/__extension__/media/boss-room-v2' } },
      ...stamps,
    },
    { id: 'doc-intake', kind: 'document', name: '需求收集', ...stamps },
    { id: 'no-kind' },
  ],
  assetCatalog: {
    version: 1,
    folders: [
      { id: 'folder-testSecond', parentId: null, tabKind: 'scene', name: 'testSecond', sortKey: 'a1', ...stamps },
      { id: 'folder-first', parentId: null, tabKind: 'scene', name: 'first', sortKey: 'a0', ...stamps },
      { id: 'folder-testThird', parentId: 'folder-testSecond', tabKind: 'scene', name: 'testThird', sortKey: 'a0', ...stamps },
      { id: 'folder-character-images', parentId: null, tabKind: 'image', name: '角色图片', sortKey: 'a0', ...stamps },
      { id: 'folder-broken', parentId: null, tabKind: 'scene', name: 'broken', ...stamps },
    ],
    placements: {
      'scene:scene-boss-room': { folderId: 'folder-testSecond', sortKey: 'a1', ...stamps },
      'scene:scene-altar': { folderId: 'folder-testSecond', sortKey: 'a0', ...stamps },
      'scene:scene-yard': { folderId: 'folder-testThird', sortKey: 'a0', ...stamps },
      'scene:scene-village': { folderId: 'root:scene', sortKey: 'a0', ...stamps },
      'image:img-hero-v1': { folderId: 'folder-character-images', sortKey: 'a1', ...stamps },
      'image:img-boss-room-v2': { folderId: 'root:image', sortKey: 'a0', ...stamps },
      // 非图片资产摆进图片 Tab 应被忽略。
      'image:doc-intake': { folderId: 'root:image', sortKey: 'a1', ...stamps },
      'nope:scene-village': { folderId: 'root:scene', sortKey: 'a0', ...stamps },
    },
    entities: {
      scene: {
        'scene-boss-room': {
          id: 'scene-boss-room',
          name: 'Boss 大殿',
          current: { assetId: 'img-boss-room-v2' },
          history: [
            { assetId: 'img-hero-v1', appliedAt: 1000, source: 'generate' },
            { assetId: 'img-boss-room-v2', appliedAt: 2000 },
          ],
          // Bindings belong to the apply operation, never to the catalog entity schema.
          binding: { kind: 'character-preview', characterId: 'scene-boss-room' },
          ...stamps,
        },
        'scene-altar': {
          id: 'scene-altar',
          name: '祭坛',
          // 指向一条不存在的资产，应渲染为「无资产」而不是整行消失。
          current: { assetId: 'img-missing' },
          history: [],
          ...stamps,
        },
        'scene-yard': {
          id: 'scene-yard',
          name: '院子',
          current: { assetId: 'img-hero-v1' },
          history: [],
          ...stamps,
        },
        'scene-village': {
          id: 'scene-village',
          name: '村庄',
          current: { assetId: 'img-hero-v1' },
          history: [],
          ...stamps,
        },
      },
      // 图片 Tab 不建业务实体，即便误写也应被忽略。
      image: {
        'img-hero-v1': { id: 'img-hero-v1', name: 'should be ignored', current: { assetId: 'x' }, history: [], ...stamps },
      },
    },
  },
}

describe('parseCatalogAssets', () => {
  it('indexes manifest assets by id and falls back for name and url', () => {
    const assets = parseCatalogAssets(MANIFEST.assets)
    expect(Object.keys(assets).sort()).toEqual(['doc-intake', 'img-boss-room-v2', 'img-hero-v1'])
    expect(assets['img-hero-v1']!.url).toBe('https://example.com/hero.png')
    expect(assets['img-boss-room-v2']!.url).toBe('/__extension__/media/boss-room-v2')
    expect(assets['doc-intake']!.name).toBe('需求收集')
  })

  it('returns an empty index when assets is missing or not an array', () => {
    expect(parseCatalogAssets(undefined)).toEqual({})
    expect(parseCatalogAssets({})).toEqual({})
  })
})

describe('catalogEntityOptions', () => {
  it('projects only ready audio entities with matching current assets and keeps entity ids', () => {
    const catalog = parseAssetCatalog({
      version: 2,
      assets: [
        { id: 'audio-current', kind: 'audio', label: 'resource name', url: 'https://cdn.test/current.mp3', status: 'ready' },
        { id: 'wrong-kind', kind: 'image', label: 'not audio', url: 'https://cdn.test/image.png', status: 'ready' },
      ],
      assetCatalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: {
          audio: {
            battle: { id: 'battle', name: '战斗床轨', current: { assetId: 'audio-current' }, history: [], createdAt: 1, updatedAt: 1 },
            missing: { id: 'missing', name: '缺失', current: { assetId: 'missing-asset' }, history: [], createdAt: 1, updatedAt: 1 },
            wrong: { id: 'wrong', name: '类型错误', current: { assetId: 'wrong-kind' }, history: [], createdAt: 1, updatedAt: 1 },
          },
        },
      },
    })!

    expect(catalogEntityOptions(catalog, 'audio')).toEqual([{
      id: 'battle',
      label: '战斗床轨',
      assetId: 'audio-current',
      url: 'https://cdn.test/current.mp3',
      mime: undefined,
    }])
  })

  it('resolves a stable entity id through current.assetId', () => {
    const catalog = parseAssetCatalog({
      version: 2,
      assets: [{ id: 'audio-v2', kind: 'audio', label: 'v2', url: 'https://cdn.test/v2.mp3', status: 'ready' }],
      assetCatalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: {
          audio: {
            battle: { id: 'battle', name: '战斗床轨', current: { assetId: 'audio-v2' }, history: [], createdAt: 1, updatedAt: 1 },
          },
        },
      },
    })!

    expect(resolveCatalogEntityAsset(catalog, 'audio', 'battle')).toMatchObject({
      id: 'audio-v2',
      kind: 'audio',
      url: 'https://cdn.test/v2.mp3',
    })
    expect(resolveCatalogEntityAsset(catalog, 'audio', 'audio-v2')).toBeUndefined()
  })
})

describe('parseAssetCatalog', () => {
  it('rejects a manifest whose catalog section lacks the declared version', () => {
    expect(parseAssetCatalog({ assetCatalog: { folders: [] } })).toBeNull()
    expect(parseAssetCatalog({})).toBeNull()
    expect(parseAssetCatalog(null)).toBeNull()
  })

  it('drops malformed rows instead of failing the whole catalog', () => {
    const catalog = parseAssetCatalog(MANIFEST)!
    expect(catalog.folders.map((folder) => folder.id)).not.toContain('folder-broken')
    expect(Object.keys(catalog.placements)).not.toContain('nope:scene-village')
  })

  it('keeps image folders and image placements as a first-class tab', () => {
    const catalog = parseAssetCatalog(MANIFEST)!
    expect(catalog.folders.map((folder) => folder.id)).toContain('folder-character-images')
    expect(Object.keys(catalog.placements)).toEqual(
      expect.arrayContaining(['image:img-hero-v1', 'image:img-boss-room-v2']),
    )
  })

  it('does not create a business-entity table for the image tab', () => {
    const catalog = parseAssetCatalog(MANIFEST)!
    expect('image' in catalog.entities).toBe(false)
  })

  it('carries the manifest assets as the single source for resource bodies', () => {
    const catalog = parseAssetCatalog(MANIFEST)!
    expect(Object.keys(catalog.assets)).toContain('img-hero-v1')
    expect(catalog.entities.scene['scene-boss-room']!.current).toEqual({ assetId: 'img-boss-room-v2' })
    expect(catalog.entities.scene['scene-boss-room']).not.toHaveProperty('binding')
  })

  it('fills every entity table so lookups never hit undefined', () => {
    const catalog = parseAssetCatalog({ assetCatalog: { version: 1 } })!
    expect(catalog.entities.control).toEqual({})
    expect(catalog.assets).toEqual({})
  })
})

describe('asset catalog capability response', () => {
  it('accepts a catalog section nested beside canonical asset rows', () => {
    const catalog = parseAssetCatalogResponse({
      catalog: { version: 1, folders: [], placements: {}, entities: {} },
      assets: [{ id: 'image-1', kind: 'image', label: '图', meta: { kinoResourceId: 'resource-1' } }],
      revision: 7,
    })!
    expect(catalog.assets['image-1']).toMatchObject({ id: 'image-1', resourceId: 'resource-1' })
  })
})

describe('catalog queries', () => {
  const catalog = parseAssetCatalog(MANIFEST)!

  it('lists sibling folders ordered by sortKey', () => {
    expect(catalogFolderChildren(catalog, 'root:scene', 'scene').map((folder) => folder.name))
      .toEqual(['first', 'testSecond'])
    expect(catalogFolderChildren(catalog, 'folder-testSecond', 'scene').map((folder) => folder.id))
      .toEqual(['folder-testThird'])
  })

  it('lists image-tab folders under the image root', () => {
    expect(catalogFolderChildren(catalog, 'root:image', 'image').map((folder) => folder.id))
      .toEqual(['folder-character-images'])
  })

  it('resolves entity-tab membership from placements only', () => {
    expect(catalogItemsIn(catalog, 'folder-testSecond', 'scene').map((row) => row.name))
      .toEqual(['祭坛', 'Boss 大殿'])
    expect(catalogItemsIn(catalog, 'folder-testThird', 'scene').map((row) => row.itemId))
      .toEqual(['scene-yard'])
    expect(catalogItemsIn(catalog, 'root:scene', 'scene').map((row) => row.itemId))
      .toEqual(['scene-village'])
  })

  it('lists image-tab items straight from manifest assets, not entities', () => {
    const rootImages = catalogItemsIn(catalog, 'root:image', 'image')
    expect(rootImages.map((row) => row.itemId)).toEqual(['img-boss-room-v2'])
    expect(rootImages[0]!.entity).toBeNull()
    expect(rootImages[0]!.asset?.name).toBe('Boss 大殿 v2')

    const folderImages = catalogItemsIn(catalog, 'folder-character-images', 'image')
    expect(folderImages.map((row) => row.name)).toEqual(['主角立绘 v1'])
  })

  it('exposes the applied asset for entity-tab items, or null when it is gone', () => {
    const [altar, bossRoom] = catalogItemsIn(catalog, 'folder-testSecond', 'scene')
    expect(bossRoom!.entity?.id).toBe('scene-boss-room')
    expect(bossRoom!.asset?.name).toBe('Boss 大殿 v2')
    expect(altar!.name).toBe('祭坛')
    expect(altar!.asset).toBeNull()
  })

  it('collects a folder subtree for recursive listings', () => {
    expect([...catalogFolderSubtree(catalog, 'folder-testSecond', 'scene')].sort())
      .toEqual(['folder-testSecond', 'folder-testThird'])
  })

  it('builds a breadcrumb from the root down to the folder', () => {
    expect(catalogFolderPath(catalog, 'folder-testThird').map((folder) => folder.name))
      .toEqual(['testSecond', 'testThird'])
  })

  it('resolves an applied asset ref, or undefined when missing', () => {
    expect(resolveCatalogAsset(catalog, { assetId: 'img-boss-room-v2' })?.name).toBe('Boss 大殿 v2')
    expect(resolveCatalogAsset(catalog, { assetId: 'missing' })).toBeUndefined()
  })

  it('parses placement keys (including the image tab) and rejects unknown roots', () => {
    expect(parseCatalogPlacementKey('scene:scene-yard')).toEqual({ tabKind: 'scene', itemId: 'scene-yard' })
    expect(parseCatalogPlacementKey('image:img-hero-v1')).toEqual({ tabKind: 'image', itemId: 'img-hero-v1' })
    expect(parseCatalogPlacementKey('nope:x')).toBeNull()
    expect(parseCatalogPlacementKey('scene:')).toBeNull()
  })

  it('distinguishes the catalog root from tab roots and ordinary folders', () => {
    expect(CATALOG_ROOT_TARGET).toBe('root:catalog')
    expect(isCatalogRootTarget('root:catalog')).toBe(true)
    expect(isCatalogRootTarget('root:image')).toBe(false)
    expect(isCatalogTabRootTarget('root:image')).toBe(true)
    expect(isCatalogTabRootTarget('root:catalog')).toBe(false)
    expect(isCatalogTabRootTarget('folder-scene-images')).toBe(false)
    expect(parseCatalogTabRoot('root:image')).toBe('image')
    expect(parseCatalogTabRoot('root:catalog')).toBeNull()
  })

  it('resolves entry ids through the global placement table instead of assuming a type root', () => {
    expect(resolveCatalogItemLocation(catalog, { tabKind: 'scene', itemId: 'scene-yard' })).toEqual({
      tabKind: 'scene', itemId: 'scene-yard', placementKey: 'scene:scene-yard', target: 'folder-testThird',
    })
    expect(resolveCatalogItemLocation(catalog, { tabKind: 'scene', itemId: 'img-hero-v1' })).toEqual({
      tabKind: 'scene', itemId: 'scene-yard', placementKey: 'scene:scene-yard', target: 'folder-testThird',
    })
  })
})

describe('useAssetCatalog synchronization', () => {
  it('refreshes a separate pane through the catalog BroadcastChannel', async () => {
    const originalBroadcastChannel = globalThis.BroadcastChannel
    class FakeBroadcastChannel {
      static latest: FakeBroadcastChannel | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      closed = false

      constructor(readonly name: string) { FakeBroadcastChannel.latest = this }
      postMessage(): void {}
      close(): void { this.closed = true }
    }
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel
    try {
      const load = vi.fn(async () => EMPTY_ASSET_CATALOG)
      const { unmount } = renderHook(() => useAssetCatalog('game-cross-pane', load))
      await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
      const channel = FakeBroadcastChannel.latest!
      expect(channel.name).toBe(ASSET_CATALOG_INVALIDATION_CHANNEL)

      await act(async () => { channel.onmessage?.(new MessageEvent('message')) })
      await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
      unmount()
      expect(channel.closed).toBe(true)
    } finally {
      globalThis.BroadcastChannel = originalBroadcastChannel
    }
  })

  it('performs one read for an invalidation without an explicit second refresh', async () => {
    const load = vi.fn(async () => EMPTY_ASSET_CATALOG)
    renderHook(() => useAssetCatalog('game-1', load))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await act(async () => { window.dispatchEvent(new Event(ASSET_CATALOG_INVALIDATION_EVENT)) })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  it('ignores an older response when a newer refresh wins the request epoch', async () => {
    let resolveFirst!: (catalog: typeof EMPTY_ASSET_CATALOG) => void
    let resolveSecond!: (catalog: typeof EMPTY_ASSET_CATALOG) => void
    const first = new Promise<typeof EMPTY_ASSET_CATALOG>((resolve) => { resolveFirst = resolve })
    const second = new Promise<typeof EMPTY_ASSET_CATALOG>((resolve) => { resolveSecond = resolve })
    const load = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const { result } = renderHook(() => useAssetCatalog('game-2', load))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    act(() => { void result.current.refresh() })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    const latest = { ...EMPTY_ASSET_CATALOG, assets: { latest: { id: 'latest', kind: 'image', name: 'latest' } } }
    const stale = { ...EMPTY_ASSET_CATALOG, assets: { stale: { id: 'stale', kind: 'image', name: 'stale' } } }
    await act(async () => { resolveSecond(latest) })
    await waitFor(() => expect(result.current.catalog.assets.latest).toBeDefined())
    await act(async () => { resolveFirst(stale) })
    expect(result.current.catalog.assets.latest).toBeDefined()
    expect(result.current.catalog.assets.stale).toBeUndefined()
  })
})
