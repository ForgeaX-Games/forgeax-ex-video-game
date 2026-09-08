import { describe, expect, it } from 'vitest'
import { clampRect } from '../GraphMiniMap'

describe('minimap clampRect', () => {
  const box = { x: 0, y: 0, width: 100, height: 100 }

  it('keeps viewport inside viewBox when viewport is larger than the graph', () => {
    const clipped = clampRect({ x: -50, y: -50, width: 400, height: 300 }, box)
    expect(clipped).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('intersects partial overlap', () => {
    const clipped = clampRect({ x: 80, y: 80, width: 40, height: 40 }, box)
    expect(clipped).toEqual({ x: 80, y: 80, width: 20, height: 20 })
  })
})
