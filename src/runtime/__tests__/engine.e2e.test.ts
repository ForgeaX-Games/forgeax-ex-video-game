import { describe, expect, it } from 'vitest'
import { makeNodiaFixture } from '../../editor/demo/__tests__/fixtures/nodia-fixture'
import { validateScenario } from '../core/validate/validate'
import { getSubProcess } from '../core/schema/graph-schema'

describe('nodia graph e2e (runs on GraphRuntime)', () => {
  it('authored graph passes the validator', () => {
    const scn = makeNodiaFixture()
    const issues = validateScenario(scn)
    expect(
      issues.filter((issue) =>
        issue.level === 'error'
        && issue.code !== 'component.unknown'
        && issue.code !== 'edge.handle.missing'),
    ).toEqual([])
  })

  it('combat turn containers are subflows (我方回合/敌方回合)', () => {
    const scn = makeNodiaFixture()
    const aMy = scn.graph.nodes.find((n) => n.id === 'a_my')
    const bAi = scn.graph.nodes.find((n) => n.id === 'b_ai')
    expect(getSubProcess(aMy!.data)?.entry).toBe('wait')
    expect(getSubProcess(bAi!.data)?.entry).toBe('tele')
  })

})
