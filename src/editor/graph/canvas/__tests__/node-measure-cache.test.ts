import { describe, expect, it } from 'vitest'
import {
  createNodeMeasureCache,
  nodeLayoutSignature,
  pruneNodeMeasures,
  rememberNodeMeasures,
  reuseNodeMeasure,
  type NodeLayoutSignatureInput,
} from '../node-measure-cache'

const base: NodeLayoutSignatureInput = {
  label: '选项',
  outputs: [{ id: 'source:default', label: '默认' }, { id: 'source:optionA', label: '进洞' }],
  inputCount: 1,
  interfaces: [],
  settlements: [],
  isEntry: false,
  isGroup: false,
  isPack: false,
  readOnly: false,
}

describe('node measure cache', () => {
  it('replays the measured size for an unchanged card', () => {
    const cache = createNodeMeasureCache()
    const signature = nodeLayoutSignature(base)

    rememberNodeMeasures(
      cache,
      [{ type: 'dimensions', id: 'choice', dimensions: { width: 180, height: 120 } }],
      () => signature,
    )

    expect(reuseNodeMeasure(cache, 'choice', signature)).toEqual({ width: 180, height: 120 })
  })

  it('forgets the size once the card layout changes', () => {
    const cache = createNodeMeasureCache()
    const before = nodeLayoutSignature(base)
    rememberNodeMeasures(
      cache,
      [{ type: 'dimensions', id: 'choice', dimensions: { width: 180, height: 120 } }],
      () => before,
    )

    // 多一个出口 = 多一行，旧高度和旧 handleBounds 都过期了，必须让 xyflow 重量。
    const grown = nodeLayoutSignature({
      ...base,
      outputs: [...base.outputs, { id: 'source:optionB', label: '绕行' }],
    })
    expect(reuseNodeMeasure(cache, 'choice', grown)).toBeUndefined()

    // 摘要行同理（演出名会把卡片撑宽）。
    const detailed = nodeLayoutSignature({ ...base, performance: '第1章·上岸' })
    expect(reuseNodeMeasure(cache, 'choice', detailed)).toBeUndefined()
  })

  it('ignores changes that carry no usable measurement', () => {
    const cache = createNodeMeasureCache()
    const signature = nodeLayoutSignature(base)

    rememberNodeMeasures(cache, [
      { type: 'position', id: 'choice' },
      { type: 'dimensions', id: 'choice', dimensions: { width: 0, height: 0 } },
      { type: 'dimensions', dimensions: { width: 180, height: 120 } },
    ], () => signature)

    expect(reuseNodeMeasure(cache, 'choice', signature)).toBeUndefined()
  })

  it('drops nodes that left the graph', () => {
    const cache = createNodeMeasureCache()
    const signature = nodeLayoutSignature(base)
    rememberNodeMeasures(cache, [
      { type: 'dimensions', id: 'choice', dimensions: { width: 180, height: 120 } },
      { type: 'dimensions', id: 'gone', dimensions: { width: 100, height: 60 } },
    ], () => signature)

    pruneNodeMeasures(cache, ['choice'])

    expect(reuseNodeMeasure(cache, 'choice', signature)).toBeTruthy()
    expect(reuseNodeMeasure(cache, 'gone', signature)).toBeUndefined()
  })
})
