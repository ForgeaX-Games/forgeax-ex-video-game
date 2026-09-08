import { describe, expect, it } from 'vitest'
import type { EdgeRouting, NodeData } from '../graph-schema'

describe('inspector UI cleanup schema', () => {
  it('NodeData / EdgeRouting no longer expose removed authoring fields in assignable shapes', () => {
    const node: NodeData = { name: 'x' }
    const edge: EdgeRouting = {}
    // Dead branch: exercise @ts-expect-error at compile time without mutating runtime objects.
    if (false as boolean) {
      // @ts-expect-error styleScheme removed from current NodeData
      node.styleScheme = 'ov-x'
      // @ts-expect-error label removed from current EdgeRouting
      edge.label = 'note'
    }
    expect(node.name).toBe('x')
    expect(edge).toEqual({})
  })
})
