import { describe, expect, it } from 'vitest'
import {
  buildCharacterPreviewPrompt,
  CHARACTER_PREVIEW_DEFAULT_MODE,
  CHARACTER_PREVIEW_MODES,
  CHARACTER_PREVIEW_PRESETS,
  characterPreviewSize,
} from '../character-preview'

const target = {
  name: '沈雁',
  description: '雨夜古城中的女剑客',
  sourcePrompt: 'ink wash swordswoman',
}

describe('character preview contract', () => {
  it('uses the shared three-view prompt and landscape size for turnaround mode', () => {
    const prompt = buildCharacterPreviewPrompt(target, 'turnaround')

    expect(prompt).toContain('专业角色设定三视图')
    expect(prompt).toContain('正面、侧面、背面')
    expect(prompt).toContain('ink wash swordswoman')
    expect(characterPreviewSize('turnaround')).toBe('2560x1440')
    expect(CHARACTER_PREVIEW_DEFAULT_MODE).toBe('turnaround')
    expect(CHARACTER_PREVIEW_MODES).toEqual(['turnaround', 'portrait'])
    expect(CHARACTER_PREVIEW_PRESETS.turnaround).toEqual({
      aspectRatio: '16:9',
      size: '2560x1440',
    })
  })

  it('keeps portrait as an explicit single-character mode', () => {
    expect(buildCharacterPreviewPrompt(target, 'portrait')).toContain('单角色全身立绘')
    expect(characterPreviewSize('portrait')).toBe('1664x2496')
  })
})
