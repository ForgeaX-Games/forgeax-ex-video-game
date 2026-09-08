import { describe, expect, it } from 'vitest'
import {
  readScopeRevisions,
  revisionConflict,
  scopedRevisionConflict,
  stampDocumentRevision,
} from './document-revision'

const encoder = new TextEncoder()

function bytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

describe('写域级乐观锁', () => {
  it('三条线各写自己的域时全部通过，即便文档修订号已前进', () => {
    // 角色线在 revision 5 写过 characters，场景线与数值线基于 revision 4 读取。
    const scopeRevisions = { characters: 5 }
    expect(scopedRevisionConflict(4, 5, scopeRevisions, ['scenes'])).toBeNull()
    expect(scopedRevisionConflict(4, 5, scopeRevisions, ['rules'])).toBeNull()
  })

  it('两条线抢同一个域时才判冲突', () => {
    const conflict = scopedRevisionConflict(4, 5, { characters: 5 }, ['characters'])
    expect(conflict?.code).toBe('revision.conflict')
    expect(conflict?.message).toContain('characters')
  })

  it('多域写入中任一域被动过就判冲突', () => {
    // 整装同时写 graph 与 ui；只要其中一个被动过就必须拦。
    expect(scopedRevisionConflict(4, 6, { ui: 6 }, ['graph', 'ui'])?.code).toBe('revision.conflict')
    expect(scopedRevisionConflict(4, 6, { audio: 6 }, ['graph', 'ui'])).toBeNull()
  })

  it('修订号一致时直接通过，不看写域', () => {
    expect(scopedRevisionConflict(5, 5, { characters: 5 }, ['characters'])).toBeNull()
  })

  it('省略 expectedRevision 表示不做检查', () => {
    expect(scopedRevisionConflict(undefined, 9, { characters: 9 }, ['characters'])).toBeNull()
  })

  it('没有写域信息时退回整文件比较，宁可多报也不放过覆盖', () => {
    expect(scopedRevisionConflict(4, 5, { characters: 5 }, [])?.code).toBe('revision.conflict')
    expect(scopedRevisionConflict(4, 5, { characters: 5 }, undefined)?.code).toBe('revision.conflict')
  })

  it('历史文件没有 scopeRevisions 时按整文件比较', () => {
    // 旧数据里所有域都视为 0，因此不会误放；但整文件不一致仍然拦。
    expect(scopedRevisionConflict(4, 5, {}, ['characters'])).toBeNull()
    expect(revisionConflict(4, 5)?.code).toBe('revision.conflict')
  })
})

describe('写域修订号落盘', () => {
  it('只把本次真正改动的域推到新修订号', () => {
    const stamped = stampDocumentRevision({ a: 1 }, 7, [], {
      previous: { characters: 3, scenes: 5 },
      touched: ['characters'],
    })
    expect(stamped.scopeRevisions).toEqual({ characters: 7, scenes: 5 })
  })

  it('不传写域时不写入该字段，保持旧行为', () => {
    const stamped = stampDocumentRevision({ a: 1 }, 7, [])
    expect(stamped.scopeRevisions).toBeUndefined()
  })

  it('能从落盘字节读回，非法值被忽略', () => {
    expect(readScopeRevisions(bytes({ scopeRevisions: { characters: 4, bad: 'x', neg: -1 } })))
      .toEqual({ characters: 4 })
    expect(readScopeRevisions(bytes({}))).toEqual({})
    expect(readScopeRevisions(null)).toEqual({})
  })

  it('并发场景端到端：角色线先落盘，场景线随后不受影响', () => {
    // 角色线基于 revision 4 写 characters → 落盘 revision 5
    const afterCharacter = stampDocumentRevision({}, 5, [], { previous: {}, touched: ['characters'] })
    const scopeRevisions = readScopeRevisions(bytes(afterCharacter))
    // 场景线也基于 revision 4 读取，此时写 scenes 不应撞冲突
    expect(scopedRevisionConflict(4, 5, scopeRevisions, ['scenes'])).toBeNull()
    // 但另一个角色线写入必须撞
    expect(scopedRevisionConflict(4, 5, scopeRevisions, ['characters'])?.code).toBe('revision.conflict')
  })
})
