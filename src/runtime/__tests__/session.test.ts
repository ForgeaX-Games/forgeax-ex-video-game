import { describe, expect, it } from 'vitest'
import { GraphSession } from '../core/engine/session'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'
import type { GameGraph } from '../core/schema/graph-schema'
import { node, scnOf } from './test-fixtures'

describe('GraphSession (playable view model)', () => {
  it('uses the injected session seed for weighted routing', () => {
    const graph: GameGraph = {
      nodes: [node('start', { durationMs: 100 }), node('first'), node('second')],
      edges: [
        { id: 'first-edge', source: 'start', target: 'first', sourceHandle: 'default', targetHandle: 'in', data: { weight: 1 } },
        { id: 'second-edge', source: 'start', target: 'second', sourceHandle: 'default', targetHandle: 'in', data: { weight: 2 } },
      ],
    }
    const scenario = scnOf(graph)

    const first = new GraphSession(scenario, { rngSeed: 0 })
    first.start()
    expect(first.performanceEnd().currentNodeId).toBe('first')

    const second = new GraphSession(scenario, { rngSeed: 1 })
    second.start()
    expect(second.performanceEnd().currentNodeId).toBe('second')
  })

  it('returns a fresh snapshot reference each call (so React re-renders)', () => {
    const session = new GraphSession(structuredClone(NODIA_DEMO_PROJECT))
    const a = session.start()
    const b = session.performanceEnd()
    expect(a).not.toBe(b) // 不同引用，否则 React setState 会跳过重渲染
  })

})
