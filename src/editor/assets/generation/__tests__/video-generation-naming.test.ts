import { describe, expect, it } from 'vitest'
import { nextGeneratedName } from '../generation-naming'
import { generatedVideoDisplayName } from '../video-generation-naming'

describe('generatedVideoDisplayName', () => {
  it('uses the blueprint node name for node-scoped generation', () => {
    expect(generatedVideoDisplayName({
      nodeName: '鹰道·天隙',
      existingName: '已有视频',
      newVideoName: '新视频 1',
      fallback: 'asset_kino_generation-1',
    })).toBe('鹰道·天隙')
  })

  it('preserves an existing catalog entity name before allocating a new name', () => {
    expect(generatedVideoDisplayName({ existingName: '开场', newVideoName: '新视频 1', fallback: 'asset-1' })).toBe('开场')
    expect(generatedVideoDisplayName({ newVideoName: '新视频 1', fallback: 'asset-1' })).toBe('新视频 1')
    expect(generatedVideoDisplayName({ fallback: 'asset-1' })).toBe('asset-1')
  })

  it('allocates the first unused numbered video name', () => {
    const format = (number: number) => `新视频 ${number}`
    expect(nextGeneratedName(['开场', '新视频 1', '新视频 2'], format)).toBe('新视频 3')
    expect(nextGeneratedName(['新视频 2'], format)).toBe('新视频 1')
  })
})
