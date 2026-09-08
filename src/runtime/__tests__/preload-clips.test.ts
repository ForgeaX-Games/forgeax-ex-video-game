import { describe, expect, it } from 'vitest'
import { GraphSession } from '../core/engine/session'
import type { GameGraph } from '../core/schema/graph-schema'
import { node, scnOf } from './test-fixtures'

describe('GraphSession preload clips', () => {
  it('returns every reachable next media without selecting a branch', () => {
    const graph: GameGraph = {
      nodes: [
        node('current', { media: { kind: 'video', ref: 'current.mp4' } }),
        node('logic'),
        node('left', { media: { kind: 'video', ref: 'left.mp4' } }),
        node('right', { media: { kind: 'video', ref: 'right.mp4' } }),
      ],
      edges: [
        { id: 'to-logic', source: 'current', target: 'logic', sourceHandle: 'left', targetHandle: 'in' },
        { id: 'to-right', source: 'current', target: 'right', sourceHandle: 'right', targetHandle: 'in' },
        { id: 'logic-to-left', source: 'logic', target: 'left', sourceHandle: 'default', targetHandle: 'in' },
      ],
    }
    const session = new GraphSession(scnOf(graph))
    session.start()

    expect(session.preloadClips().map((candidate) => candidate.mediaId)).toEqual([
      'right.mp4',
      'left.mp4',
    ])
    expect(session.snapshot.currentNodeId).toBe('current')
  })
})
