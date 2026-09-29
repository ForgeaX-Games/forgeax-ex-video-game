import { describe, expect, test } from 'vitest'
import { documentFromBlueprints } from '@/authoring/blueprint/blueprint-project'
import {
  captureOutlineDesignSnapshot,
  outlineDesignDrift,
  outlineDesignMutationDrift,
} from './outline-design-snapshot'

function project() {
  return documentFromBlueprints({
    main: {
      id: 'main',
      title: '主蓝图',
      entry: 'choice',
      graph: {
        nodes: [
          {
            id: 'choice', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [],
            data: {
              name: '选择', chapterSummary: '做出选择',
              interaction: { beat: 'choice', sourcePillarBeatId: 'B01' },
            },
          },
          {
            id: 'result', type: 'perf', position: { x: 240, y: 0 }, inputs: [], outputs: [],
            data: {
              name: '结果', chapterSummary: '呈现结果', interaction: { beat: 'narrative' },
              outcomeEvidence: [{ id: 'B01/choose', sourceEdgeId: 'edge-result', presentation: '呈现选择结果' }],
            },
          },
        ],
        edges: [{
          id: 'edge-result', source: 'choice', sourceHandle: 'activate', target: 'result', targetHandle: 'in',
          data: {
            design: {
              pillarBeatId: 'B01',
              producer: { kind: 'component-event', ref: 'TextOption.activate' },
              narrativePayoff: '呈现选择结果',
              outcomeEvidenceId: 'B01/choose',
            },
          },
        }],
      },
    },
  }, 'main', {})
}

describe('outline design snapshot', () => {
  test('allows finalization content while freezing topology and causal design', () => {
    const before = project()
    const snapshot = captureOutlineDesignSnapshot(before, 3, '2026-01-01T00:00:00.000Z')
    const contentOnly = structuredClone(before)
    contentOnly.graph.nodes[0]!.data.storyText = '玩家按下按钮。'
    contentOnly.graph.nodes[0]!.data.overlayNodes = []
    contentOnly.manifest.packs.main!.graph = contentOnly.graph
    expect(outlineDesignDrift(contentOnly, snapshot)).toEqual([])

    const changed = structuredClone(contentOnly)
    changed.graph.edges[0]!.target = 'choice'
    changed.manifest.packs.main!.graph = changed.graph
    expect(outlineDesignDrift(changed, snapshot)).toContain('main 的边端点/handle/design 发生变化')
  })

  test('legacy workflow compares this mutation instead of disabling the boundary', () => {
    const before = project()
    const contentOnly = structuredClone(before)
    contentOnly.graph.nodes[0]!.data.storyText = '合法正文'
    contentOnly.manifest.packs.main!.graph = contentOnly.graph
    expect(outlineDesignMutationDrift(before, contentOnly)).toEqual([])

    const changed = structuredClone(before)
    changed.graph.nodes[1]!.data.outcomeEvidence = []
    changed.manifest.packs.main!.graph = changed.graph
    expect(outlineDesignMutationDrift(before, changed)).toContain('main 的节点/章节/interaction/outcomeEvidence 发生变化')
  })
})
