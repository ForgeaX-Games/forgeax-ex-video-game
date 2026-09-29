import { describe, expect, it } from 'vitest'
import {
  assessPatchGraphBudget,
  FINALIZATION_PATCH_GRAPH_BUDGET,
} from './patch-graph-budget'

describe('patch_graph budget', () => {
  it('accepts a bounded finalization chunk', () => {
    const result = assessPatchGraphBudget({
      blueprintId: 'main',
      ops: [
        { op: 'set-node-data', nodeId: 'node-1', patch: { storyText: 'a' } },
        { op: 'set-node-data', nodeId: 'node-2', patch: { storyText: 'b' } },
      ],
    }, FINALIZATION_PATCH_GRAPH_BUDGET)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.usage.ops).toBe(2)
      expect(result.usage.nodesTouched).toBe(2)
    }
  })

  it('rejects oversized chunks with structured usage and the first failed dimension', () => {
    const result = assessPatchGraphBudget({
      blueprintId: 'main',
      ops: Array.from({ length: 4 }, (_, index) => ({
        op: 'set-node-data',
        nodeId: `node-${index}`,
        patch: { storyText: 'x' },
      })),
    }, FINALIZATION_PATCH_GRAPH_BUDGET)

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'patch.budget.exceeded',
      failedDimension: 'ops',
      failedOpIndex: 3,
      usage: { ops: 4, nodesTouched: 4 },
      budget: FINALIZATION_PATCH_GRAPH_BUDGET,
    })
  })

  it('rejects requests whose serialized payload exceeds the host byte budget', () => {
    const result = assessPatchGraphBudget({
      blueprintId: 'main',
      ops: [{ op: 'set-node-data', nodeId: 'node-1', patch: { storyText: 'x'.repeat(70_000) } }],
    }, FINALIZATION_PATCH_GRAPH_BUDGET)

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'patch.budget.exceeded',
      failedDimension: 'requestBytes',
    })
  })

  it('counts insert, duplicate, and reconnect targets', () => {
    const result = assessPatchGraphBudget({
      ops: [
        { op: 'insert-node-before', beforeId: 'ending', node: { id: 'memory' } },
        {
          op: 'duplicate-nodes',
          copies: [
            { sourceId: 'choice-a', targetId: 'choice-a-copy' },
            { sourceId: 'choice-b', targetId: 'choice-b-copy' },
          ],
        },
        { op: 'reconnect', edgeId: 'edge-ending', target: 'hidden-ending' },
      ],
    }, {
      ...FINALIZATION_PATCH_GRAPH_BUDGET,
      maxNodesTouched: 20,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.usage.nodesTouched).toBe(7)
      expect(result.usage.edgesTouched).toBe(1)
    }
  })
})
