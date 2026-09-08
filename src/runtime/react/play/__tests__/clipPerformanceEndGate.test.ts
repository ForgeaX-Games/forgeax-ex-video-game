import { describe, it, expect } from 'vitest'
import { ClipPerformanceEndGate } from '../clipPerformanceEndGate'

describe('ClipPerformanceEndGate', () => {
  it('same node only ends once until reset', () => {
    const g = new ClipPerformanceEndGate()
    expect(g.tryBegin('n_open')).toBe('n_open')
    expect(g.tryBegin('n_open')).toBeNull()
    g.reset()
    expect(g.tryBegin('n_open')).toBe('n_open')
  })

  it('after ending, blocks the next node until reset (stale onEnded after sync descend)', () => {
    const g = new ClipPerformanceEndGate()
    // 序章收尾（随后引擎同步下钻到子流程入口 sf）
    expect(g.tryBegin('n_open')).toBe('n_open')
    // 旧 video 的 onEnded 落到已经是 sf 的 currentNodeId → 必须挡住
    expect(g.tryBegin('sf')).toBeNull()
    // 新 clip 挂载后 reset，才允许真正结束子流程
    g.reset()
    expect(g.tryBegin('sf')).toBe('sf')
  })
})
