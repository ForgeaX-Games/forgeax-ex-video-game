import { describe, expect, it } from 'vitest'
import { normalizeDocument, validateDocument, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { applyPatchGraphOps } from './patch-graph-ops'
import { createEmptyLibrarySeed, validateEmptyLibrarySeed } from './empty-library-seed'

describe('createEmptyLibrarySeed', () => {
  it('uses host gameId and a single entry perf node (not nodia)', async () => {
    const seed = await createEmptyLibrarySeed({ gameId: 'game-abc' })
    validateEmptyLibrarySeed(seed)
    expect(seed.project.id).toBe('game-abc')
    expect(seed.project.id).not.toBe('nodia')
    expect(seed.project.platform).toBe('game-video')
    expect(seed.assetsManifest).toEqual({ version: 2, assets: [] })

    const doc = normalizeDocument(seed.blueprint)
    expect(doc.version).toBe('game-video.graph.v1')
    expect(doc.manifest.mainPackId).toBe(MAIN_ID)
    expect(doc.graph.nodes).toHaveLength(1)
    expect(doc.graph.nodes[0]).toMatchObject({
      id: 'entry',
      type: 'perf',
    })
    expect(doc.graph.edges).toEqual([])
    expect(validateDocument(doc)).toEqual([])
  })

  it('can patch a linear path with one binary choice from the empty shell', async () => {
    const seed = await createEmptyLibrarySeed({ gameId: 'game-abc' })
    const doc = normalizeDocument(seed.blueprint)
    const result = applyPatchGraphOps(doc, {
      ops: [
        { op: 'set-node-data', nodeId: 'entry', patch: { storyText: '你站在殿门前。' } },
        {
          op: 'add-node',
          node: {
            id: 'beat_1',
            type: 'perf',
            position: { x: 300, y: 80 },
            inputs: [],
            outputs: [],
            data: { name: '升堂', storyText: '堂上鼓响。' },
          },
        },
        {
          op: 'add-node',
          node: {
            id: 'choice',
            type: 'perf',
            position: { x: 520, y: 80 },
            inputs: [],
            outputs: [],
            data: {
              name: '判词',
              storyText: '你要轻判，还是重判？',
            },
          },
        },
        {
          op: 'add-node',
          node: {
            id: 'path_a',
            type: 'perf',
            position: { x: 740, y: 0 },
            inputs: [],
            outputs: [],
            data: { name: '轻判', storyText: '你落笔轻判。' },
          },
        },
        {
          op: 'add-node',
          node: {
            id: 'path_b',
            type: 'perf',
            position: { x: 740, y: 160 },
            inputs: [],
            outputs: [],
            data: { name: '重判', storyText: '你落笔重判。' },
          },
        },
        {
          op: 'add-node',
          node: {
            id: 'merge',
            type: 'perf',
            position: { x: 960, y: 80 },
            inputs: [],
            outputs: [],
            data: { name: '回响', storyText: '判词已入册。' },
          },
        },
        {
          op: 'add-node',
          node: {
            id: 'ending',
            type: 'perf',
            position: { x: 1180, y: 80 },
            inputs: [],
            outputs: [],
            data: { name: '终', storyText: '殿门合上。' },
          },
        },
        { op: 'connect', source: 'entry', target: 'beat_1', sourceHandle: 'default', targetHandle: 'in' },
        { op: 'connect', source: 'beat_1', target: 'choice', sourceHandle: 'default', targetHandle: 'in' },
        { op: 'connect', source: 'choice', target: 'path_a', sourceHandle: 'opt_a', targetHandle: 'in' },
        { op: 'connect', source: 'choice', target: 'path_b', sourceHandle: 'opt_b', targetHandle: 'in' },
        { op: 'connect', source: 'path_a', target: 'merge', sourceHandle: 'default', targetHandle: 'in' },
        { op: 'connect', source: 'path_b', target: 'merge', sourceHandle: 'default', targetHandle: 'in' },
        { op: 'connect', source: 'merge', target: 'ending', sourceHandle: 'default', targetHandle: 'in' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(validateDocument(result.document)).toEqual([])
    const choiceOut = result.document.graph.edges.filter((e) => e.source === 'choice')
    expect(choiceOut).toHaveLength(2)
    expect(result.document.graph.nodes.every((n) => typeof (n.data as { storyText?: string }).storyText === 'string')).toBe(true)
  })
})
