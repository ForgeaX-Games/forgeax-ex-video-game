import { describe, expect, it } from 'vitest'
import type { BlueprintDoc, GameScenario } from '@/runtime/core/schema/graph-schema'
import { findVideoReferences } from '../video-references'

function node(id: string, name: string, ref?: string) {
  return {
    id,
    type: 'perf' as const,
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name, ...(ref ? { media: { kind: 'video' as const, ref } } : {}) },
  }
}

function scenario(partial: Partial<GameScenario> & Pick<GameScenario, 'graph'>): GameScenario {
  return {
    version: 'game-video.graph.v1',
    ...partial,
  }
}

function pack(
  partial: Pick<BlueprintDoc, 'id' | 'graph'> & Partial<Omit<BlueprintDoc, 'id' | 'graph'>>,
): BlueprintDoc {
  return {
    id: partial.id,
    title: partial.title ?? partial.id,
    entry: partial.entry ?? partial.graph.nodes[0]?.id ?? 'entry',
    version: partial.version,
    requires: partial.requires,
    graph: partial.graph,
  }
}

describe('findVideoReferences', () => {
  it('finds references in the main graph', () => {
    const scn = scenario({
      graph: {
        nodes: [node('n1', 'Intro', 'vid-abc'), node('n2', 'Other', 'other-id')],
        edges: [],
      },
    })
    expect(findVideoReferences(scn, 'vid-abc')).toEqual([
      { graphId: 'main', graphLabel: '主图', nodeId: 'n1', nodeName: 'Intro' },
    ])
  })

  it('finds references inside pack subgraphs', () => {
    const scn = scenario({
      graph: { nodes: [], edges: [] },
    })
    const blueprints = {
      'bp-main': pack({
        id: 'bp-main',
        title: 'Main',
        graph: { nodes: [], edges: [] },
      }),
      'enemy-turn': pack({
        id: 'enemy-turn',
        title: '敌方回合',
        version: '1',
        entry: 'e1',
        graph: {
          nodes: [node('e1', 'Attack', 'vid-abc')],
          edges: [],
        },
      }),
    }
    expect(findVideoReferences(scn, 'vid-abc', { blueprints, mainPackId: 'bp-main' })).toEqual([
      { graphId: 'enemy-turn', graphLabel: '敌方回合', nodeId: 'e1', nodeName: 'Attack' },
    ])
  })

  it('returns empty when no exact ref match (no m-/bare alias guessing)', () => {
    const scn = scenario({
      graph: {
        nodes: [node('n1', 'Legacy', 'm-idle01'), node('n2', 'Other', 'other-id')],
        edges: [],
      },
    })
    expect(findVideoReferences(scn, 'idle01')).toEqual([])
    expect(findVideoReferences(scn, 'm-idle01')).toEqual([
      { graphId: 'main', graphLabel: '主图', nodeId: 'n1', nodeName: 'Legacy' },
    ])
  })

  it('deduplicates repeated scans of the same node', () => {
    const scn = scenario({
      graph: {
        nodes: [node('n1', 'Dup', 'vid-dup')],
        edges: [],
      },
    })
    const blueprints = {
      'bp-main': pack({
        id: 'bp-main',
        title: 'Main',
        graph: {
          nodes: [node('n1', 'Dup', 'vid-dup')],
          edges: [],
        },
      }),
      'pack-a': pack({
        id: 'pack-a',
        version: '1',
        entry: 'p1',
        graph: {
          nodes: [node('p1', 'Pack node', 'vid-dup')],
          edges: [],
        },
      }),
    }
    const refs = findVideoReferences(scn, 'vid-dup', { blueprints, mainPackId: 'bp-main' })
    expect(refs).toHaveLength(2)
    expect(new Set(refs.map((r) => `${r.graphId}:${r.nodeId}`)).size).toBe(2)
  })
})
