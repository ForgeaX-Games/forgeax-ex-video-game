import { describe, expect, it } from 'vitest'
import { adaptiveCatalogGridLayout } from '../useAdaptiveCatalogGrid'

describe('adaptiveCatalogGridLayout', () => {
  const options = { cardWidth: 140, minColumnGap: 52 }

  it('keeps the minimum gap when all items fit on one line', () => {
    expect(adaptiveCatalogGridLayout(716, { ...options, itemCount: 3 })).toEqual({
      columns: 3,
      columnGap: 52,
    })
  })

  it('evenly distributes the remaining width after wrapping', () => {
    expect(adaptiveCatalogGridLayout(716, { ...options, itemCount: 4 })).toEqual({
      columns: 4,
      columnGap: 52,
    })
    expect(adaptiveCatalogGridLayout(900, { ...options, itemCount: 5 })).toEqual({
      columns: 4,
      columnGap: 340 / 3,
    })
  })

  it('uses one column in a narrow viewport', () => {
    expect(adaptiveCatalogGridLayout(100, { ...options, itemCount: 2 })).toEqual({
      columns: 1,
      columnGap: 52,
    })
  })
})
