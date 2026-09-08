import { describe, expect, it } from 'vitest'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { documentFromBlueprints, metaFromDocument, normalizeDocument } from '@/authoring/blueprint/blueprint-project'

function documentWithAssetReferences(): GraphLibraryDocument {
  return documentFromBlueprints(
    {
      'bp-main': {
        id: 'bp-main',
        title: '主蓝图',
        entry: 'entry',
        graph: {
          nodes: [{
            id: 'entry',
            type: 'perf',
            position: { x: 0, y: 0 },
            inputs: [],
            outputs: [],
            data: {
              name: '开场',
              cast: [{ characterId: 'hero', role: 'primary' }],
              scenes: [{ sceneId: 'yard', role: 'primary' }],
            },
          }],
          edges: [],
        },
      },
    },
    'bp-main',
    {},
  )
}

describe('blueprint asset references', () => {
  it('keeps only stable character and scene ids on nodes', () => {
    const normalized = normalizeDocument(documentWithAssetReferences())
    const node = normalized.manifest.packs['bp-main']!.graph.nodes[0]!

    expect(node.data.cast).toEqual([{ characterId: 'hero', role: 'primary' }])
    expect(node.data.scenes).toEqual([{ sceneId: 'yard', role: 'primary' }])
    expect(normalized).not.toHaveProperty('characters')
    expect(normalized).not.toHaveProperty('scenes')
    expect(metaFromDocument(normalized)).not.toHaveProperty('characters')
    expect(metaFromDocument(normalized)).not.toHaveProperty('scenes')
  })
})
