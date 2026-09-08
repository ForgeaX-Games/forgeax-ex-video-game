import { describe, expect, it } from 'vitest'
import {
  canAcceptCatalogItemDrag,
  canDropCatalogItem,
  readCatalogItemDrag,
  writeCatalogItemDrag,
} from '../asset-catalog-drag'

function transfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    getData: (type: string) => values.get(type) ?? '',
    setData: (type: string, value: string) => values.set(type, value),
    get types() { return [...values.keys()] },
  } as unknown as DataTransfer
}

describe('catalog asset drag payload', () => {
  it('exposes a tab marker during protected dragover mode and parses data on drop', () => {
    const dataTransfer = transfer()
    const payload = {
      placementKey: 'image:image-1',
      tabKind: 'image' as const,
      name: '庭院',
      sourceTarget: 'root:image' as const,
    }
    writeCatalogItemDrag(dataTransfer, payload)

    expect(canAcceptCatalogItemDrag(dataTransfer, 'image')).toBe(true)
    expect(canAcceptCatalogItemDrag(dataTransfer, 'video')).toBe(false)
    expect(readCatalogItemDrag(dataTransfer)).toEqual(payload)
    expect(canDropCatalogItem(payload, 'image', 'folder-yard')).toBe(true)
    expect(canDropCatalogItem(payload, 'image', 'root:image')).toBe(false)
  })

  it('rejects a payload whose placement kind disagrees with its tab marker', () => {
    const dataTransfer = transfer()
    dataTransfer.setData('application/x-game-video-catalog-item', JSON.stringify({
      placementKey: 'video:video-1',
      tabKind: 'image',
      name: '伪造素材',
      sourceTarget: 'root:image',
    }))

    expect(readCatalogItemDrag(dataTransfer)).toBeNull()
  })
})
