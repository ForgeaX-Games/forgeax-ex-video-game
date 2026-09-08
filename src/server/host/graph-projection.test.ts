import { describe, expect, it } from 'vitest'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { projectGraphShard } from './graph-projection'

function document(): GraphLibraryDocument {
  const node = (id: string) => ({
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    data: {
      name: id,
      storyText: `${id} story`,
      chapterSummary: `${id} summary`,
      interaction: { beat: 'choice' },
      overlayNodes: [{ overlay: 'base:InkYingMo', id: `choice@${id}` }],
    },
  })
  return {
    version: '1',
    graph: { nodes: [node('main-1'), node('main-2')], edges: [{ id: 'edge-1', source: 'main-1', target: 'main-2' }] },
    manifest: {
      version: 'game-video.blueprint-manifest.v1',
      mainPackId: 'main',
      packs: {
        main: {
          id: 'main',
          title: 'Main',
          entry: 'main-1',
          graph: { nodes: [node('main-1'), node('main-2')], edges: [{ id: 'edge-1', source: 'main-1', target: 'main-2' }] },
        },
      },
    },
  } as unknown as GraphLibraryDocument
}

describe('projectGraphShard', () => {
  it('returns only selected nodes and fields with connecting edges', () => {
    const result = projectGraphShard(document(), {
      blueprintId: 'main',
      nodeIds: ['main-1'],
      fields: ['summary', 'interaction', 'storyText'],
    })

    expect(result.blueprintId).toBe('main')
    expect(result.graph.nodes).toHaveLength(1)
    expect(result.graph.edges).toEqual([])
    expect(result.graph.nodes[0]?.data).toEqual({
      name: 'main-1',
      chapterSummary: 'main-1 summary',
      interaction: { beat: 'choice' },
      storyText: 'main-1 story',
    })
    const projectedData = result.graph.nodes[0]?.data as Record<string, unknown> | undefined
    expect(projectedData?.overlayNodes).toBeUndefined()
  })

  it('keeps the full pack when no selector is supplied', () => {
    const result = projectGraphShard(document(), {})
    expect(result.graph.nodes).toHaveLength(2)
    expect(result.graph.edges).toHaveLength(1)
    const fullData = result.graph.nodes[0]?.data as { overlayNodes?: unknown[] } | undefined
    expect(fullData?.overlayNodes).toHaveLength(1)
  })
})
