import { describe, expect, it } from 'vitest'

import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'

describe('authoringOptionLabel', () => {
  it('只展示中文名称，并移除已有的技术 id 后缀', () => {
    expect(authoringOptionLabel('敌方水墨血条', 'base:TEST_HUD')).toBe('敌方水墨血条')
    expect(authoringOptionLabel('战斗床 (a-aud-battle)', 'a-aud-battle')).toBe('战斗床')
  })

  it('有英文名称时也只展示名称；没有名称时才回退技术 id', () => {
    expect(authoringOptionLabel('Enemy HP Bar', 'base:TEST_HUD'))
      .toBe('Enemy HP Bar')
    expect(authoringOptionLabel('zhonggongji2.mp4', 'zhonggongji2')).toBe('zhonggongji2.mp4')
    expect(authoringOptionLabel(undefined, 'edge-ms9xy8nc')).toBe('edge-ms9xy8nc')
  })
})
