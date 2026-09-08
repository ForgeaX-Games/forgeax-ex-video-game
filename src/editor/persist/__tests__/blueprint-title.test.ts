import { describe, it, expect } from 'vitest'
import { normalizeBlueprintTitle, isBlueprintTitleTaken } from '../blueprint-title'

describe('normalizeBlueprintTitle', () => {
  it('trims and lowercases with zh-CN', () => {
    expect(normalizeBlueprintTitle('  新蓝图  ')).toBe(normalizeBlueprintTitle('新蓝图'))
    expect(normalizeBlueprintTitle('Ab')).toBe(normalizeBlueprintTitle('ab'))
  })
})

describe('isBlueprintTitleTaken', () => {
  const packs = {
    a: { id: 'a', title: '新蓝图' },
    b: { id: 'b', title: 'Other' },
  }

  it('detects trim/case duplicates', () => {
    expect(isBlueprintTitleTaken(packs, ' 新蓝图 ')).toBe(true)
    expect(isBlueprintTitleTaken(packs, 'OTHER')).toBe(true)
    expect(isBlueprintTitleTaken(packs, 'Unique')).toBe(false)
  })

  it('allows the same id when excluded', () => {
    expect(isBlueprintTitleTaken(packs, '新蓝图', 'a')).toBe(false)
    expect(isBlueprintTitleTaken(packs, ' 新蓝图 ', 'a')).toBe(false)
  })
})
