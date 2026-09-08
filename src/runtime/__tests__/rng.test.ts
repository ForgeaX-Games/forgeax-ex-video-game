import { describe, expect, it } from 'vitest'
import { createRng } from '../core/engine/rng'

describe('rng', () => {
  it('same seed → same sequence (reproducible)', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = [a.next(), a.next(), a.next()]
    const seqB = [b.next(), b.next(), b.next()]
    expect(seqA).toEqual(seqB)
    expect(seqA[0]).toBeGreaterThanOrEqual(0)
    expect(seqA[0]).toBeLessThan(1)
  })

  it('different seeds → different sequences', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  it('randInt in [min,max] inclusive integers', () => {
    const r = createRng(7)
    for (let i = 0; i < 50; i++) {
      const v = r.randInt(1, 6)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('chance deterministic by seed', () => {
    const r1 = createRng(7)
    const r2 = createRng(7)
    expect(r1.chance(0.5)).toBe(r2.chance(0.5))
  })

  it('serializable state: restore resumes identical sequence', () => {
    const r = createRng(99)
    r.next()
    r.next()
    const snap = r.getState()
    const cont = r.next()
    const r2 = createRng(99)
    r2.setState(snap)
    expect(r2.next()).toBe(cont)
  })
})
