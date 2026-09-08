import { describe, expect, it } from 'vitest'
import { GraphRuntime } from '../core/engine/engine'
import { isPlayClip } from '../core/engine/directives'
import { node, scnOf } from './test-fixtures'

describe('GraphRuntime.start', () => {
  it('enters entry node, emits playClip, applies enter-phase reaction effect', () => {
    const graph = {
      nodes: [
        node('open', {
          durationMs: 1000,
          reactions: [{ when: { type: 'enter' }, do: [{ kind: 'effect', effects: [{ id: 'q', kind: 'var', varId: 'qi', op: 'add', value: 1 }] }] }],
        }),
      ],
      edges: [],
    }
    const scn = scnOf(graph, {
      variables: { qi: { id: 'qi', name: '气力', initial: 1, min: 0, max: 5 } },
      entities: {
        'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } },
      },
    })
    const rt = new GraphRuntime(scn.graph, scn)
    const dirs = rt.start()
    expect(dirs.some(isPlayClip)).toBe(true)
    expect(rt.state.currentNodeId).toBe('open')
    expect(rt.state.vars.qi).toBe(2)
  })
})
