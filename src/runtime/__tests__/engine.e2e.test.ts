import { describe, expect, it } from 'vitest'
import { validateScenario } from '../core/validate/validate'
import { getSubProcess } from '../core/schema/graph-schema'
import { node, scnOf } from './test-fixtures'

describe('graph e2e (runs on GraphRuntime)', () => {
  it('a small authored graph passes the validator', () => {
    const scn = scnOf({
      nodes: [node('entry'), node('next')],
      edges: [{ id: 'e1', source: 'entry', target: 'next', sourceHandle: 'default', targetHandle: 'in' }],
    })
    const issues = validateScenario(scn)
    expect(
      issues.filter((issue) =>
        issue.level === 'error'
        && issue.code !== 'component.unknown'
        && issue.code !== 'edge.handle.missing'),
    ).toEqual([])
  })

  it('combat turn containers are subflows', () => {
    const scn = scnOf({
      nodes: [
        node('a_my', {
          subProcess: { entry: 'wait', graph: { nodes: [node('wait')], edges: [] } },
        }),
        node('b_ai', {
          subProcess: { entry: 'tele', graph: { nodes: [node('tele')], edges: [] } },
        }),
      ],
      edges: [],
    })
    const aMy = scn.graph.nodes.find((n) => n.id === 'a_my')
    const bAi = scn.graph.nodes.find((n) => n.id === 'b_ai')
    expect(getSubProcess(aMy!.data)?.entry).toBe('wait')
    expect(getSubProcess(bAi!.data)?.entry).toBe('tele')
  })
})
