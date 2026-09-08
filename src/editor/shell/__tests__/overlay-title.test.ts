import { describe, expect, it } from 'vitest'
import { nextUniqueOverlayTitle, overlayTitleExists } from '../overlay-title'

const overlays = {
  a: { id: 'a', title: '新方案', children: [] },
  b: { id: 'b', title: '新方案 2', children: [] },
  c: { id: 'c', title: '战斗 HUD', children: [] },
}

describe('overlay titles', () => {
  it('allocates a unique title and ignores the current scheme during rename checks', () => {
    expect(nextUniqueOverlayTitle(overlays)).toBe('新方案 3')
    expect(overlayTitleExists(overlays, '战斗 HUD', 'c')).toBe(false)
    expect(overlayTitleExists(overlays, '战斗 HUD', 'a')).toBe(true)
  })
})
