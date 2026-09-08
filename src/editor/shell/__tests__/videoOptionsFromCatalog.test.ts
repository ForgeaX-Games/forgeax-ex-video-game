import { describe, expect, it } from 'vitest'
import { EMPTY_ASSET_CATALOG, type CatalogAsset, type CatalogEntity } from '@/editor/assets/asset-catalog'
import { videoOptionsFromCatalog } from '../videoOptionsFromCatalog'

function asset(partial: Partial<CatalogAsset> & { id: string }): CatalogAsset {
  return { kind: 'video', name: partial.id, ...partial }
}

function entity(id: string, assetId?: string, name = id): CatalogEntity {
  return {
    id,
    name,
    ...(assetId ? { current: { assetId } } : {}),
    history: assetId ? [{ assetId, appliedAt: 1 }] : [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function catalog(
  assets: Record<string, CatalogAsset>,
  videos: Record<string, CatalogEntity>,
) {
  return {
    ...EMPTY_ASSET_CATALOG,
    assets,
    entities: { ...EMPTY_ASSET_CATALOG.entities, video: videos },
  }
}

describe('videoOptionsFromCatalog', () => {
  it('projects video assets to id + display label', () => {
    const options = videoOptionsFromCatalog(catalog(
      { 'v-1': asset({ id: 'v-1', name: '第一版' }) },
      { 'video-1': entity('video-1', 'v-1', '叙事·第1章·上岸') },
    ))
    expect(options).toEqual([{ id: 'v-1', label: '叙事·第1章·上岸' }])
  })

  it('projects preview URLs only for available video assets', () => {
    const options = videoOptionsFromCatalog(catalog({
      ready: asset({ id: 'ready', url: 'https://cdn.test/ready.mp4', status: 'ready' }),
      legacy: asset({ id: 'legacy', url: 'https://cdn.test/legacy.mp4' }),
      pending: asset({ id: 'pending', url: 'https://cdn.test/pending.mp4', status: 'generating' }),
    }, {
      a: entity('a', 'ready'),
      b: entity('b', 'legacy'),
      c: entity('c', 'pending'),
    }))

    expect(options.find((option) => option.id === 'ready')?.previewUrl).toBe('https://cdn.test/ready.mp4')
    expect(options.find((option) => option.id === 'legacy')?.previewUrl).toBe('https://cdn.test/legacy.mp4')
    expect(options.find((option) => option.id === 'pending')?.previewUrl).toBeUndefined()
  })

  it('skips non-video assets', () => {
    const options = videoOptionsFromCatalog(catalog({
      'v-1': asset({ id: 'v-1', name: '片段' }),
      'a-1': asset({ id: 'a-1', kind: 'audio', name: '床轨' }),
      'i-1': asset({ id: 'i-1', kind: 'image', name: '立绘' }),
    }, {
      video: entity('video', 'v-1'),
      audio: entity('audio', 'a-1'),
      image: entity('image', 'i-1'),
    }))
    expect(options.map((option) => option.id)).toEqual(['v-1'])
  })

  it('falls back to the id when the name is blank', () => {
    const options = videoOptionsFromCatalog(catalog(
      { 'v-1': asset({ id: 'v-1', name: '   ' }) },
      { 'video-1': entity('video-1', 'v-1', '   ') },
    ))
    expect(options).toEqual([{ id: 'v-1', label: 'v-1' }])
  })

  it('returns an empty list for an empty catalog', () => {
    expect(videoOptionsFromCatalog(EMPTY_ASSET_CATALOG)).toEqual([])
  })

  it('exposes only the current version and omits entity history', () => {
    const options = videoOptionsFromCatalog(catalog({
      first: asset({ id: 'first', name: '第一版' }),
      second: asset({ id: 'second', name: '第二版' }),
      third: asset({ id: 'third', name: '第三版' }),
    }, {
      'video-1': {
        ...entity('video-1', 'third', '鹰道·天隙'),
        history: [
          { assetId: 'second', appliedAt: 2 },
          { assetId: 'first', appliedAt: 1 },
        ],
      },
    }))

    expect(options).toEqual([{ id: 'third', label: '鹰道·天隙' }])
  })

  it('keeps independent entity lineages in stable entity order', () => {
    const options = videoOptionsFromCatalog(catalog({
      'a-old': asset({ id: 'a-old', name: 'A 旧版' }),
      'a-current': asset({ id: 'a-current', name: 'A 当前' }),
      'b-old': asset({ id: 'b-old', name: 'B 旧版' }),
      'b-current': asset({ id: 'b-current', name: 'B 当前' }),
    }, {
      // Deliberately reverse record insertion order: projection order is not JSON-order dependent.
      'video-b': {
        ...entity('video-b', 'b-current', 'B'),
        history: [{ assetId: 'b-old', appliedAt: 1 }],
      },
      'video-a': {
        ...entity('video-a', 'a-current', 'A'),
        history: [{ assetId: 'a-old', appliedAt: 1 }],
      },
    }))

    expect(options.map((option) => option.id)).toEqual(['a-current', 'b-current'])
    expect(options.map((option) => option.label)).toEqual(['A', 'B'])
  })

  it('deduplicates one current asset referenced by multiple entities', () => {
    const options = videoOptionsFromCatalog(catalog({
      shared: asset({ id: 'shared', name: '共享片段' }),
      other: asset({ id: 'other', name: '另一片段' }),
    }, {
      'video-a': {
        ...entity('video-a', 'shared', 'A'),
        history: [{ assetId: 'other', appliedAt: 1 }],
      },
      'video-b': entity('video-b', 'shared', 'B'),
    }))

    expect(options).toEqual([{ id: 'shared', label: 'A' }])
  })
})
