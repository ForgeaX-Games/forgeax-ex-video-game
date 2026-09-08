import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { mergeAssetEntityDefinitions } from './asset-entity-catalog'
import { validateProjectForActivity } from './project-inspection'
import { createInitialWorkflowState } from './workflow-state'

const encoder = new TextEncoder()

function graph(nodeCount: number, combatNodeCount = 0) {
  const nodes = Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index + 1}`,
    type: 'scene',
    position: { x: index * 240, y: 0 },
    data: {
      name: `节点 ${index + 1}`,
      chapterSummary: `第 ${index + 1} 节`,
      ...(index < combatNodeCount ? { interaction: { beat: 'combat' } } : {}),
    },
  }))
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${index + 1}`,
    source: nodes[index]!.id,
    target: node.id,
  }))
  return { nodes, edges }
}

function context(
  nodeCount: number,
  characterCount = 0,
  sceneCount = 0,
  combatNodeCount = 0,
): ExtensionContext {
  const mainGraph = graph(nodeCount, combatNodeCount)
  const blueprint = {
    revision: 0,
    manifest: {
      mainPackId: 'main',
      packs: {
        main: { id: 'main', title: '主蓝图', entry: 'node-1', graph: mainGraph },
        bonus: { id: 'bonus', title: '附属蓝图', entry: 'bonus-1', graph: {
          nodes: [{ id: 'bonus-1', type: 'scene', position: { x: 0, y: 0 }, data: { name: '附属节点' } }],
          edges: [],
        } },
      },
    },
    graph: mainGraph,
  }
  const characters = Object.fromEntries(Array.from({ length: characterCount }, (_, index) => {
    const id = `character-${index + 1}`
    return [id, { id, name: `角色 ${index + 1}`, appearance: { description: '', previewPrompt: '' } }]
  }))
  const scenes = Object.fromEntries(Array.from({ length: sceneCount }, (_, index) => {
    const id = `scene-${index + 1}`
    return [id, { id, name: `场景 ${index + 1}`, visual: { description: '', previewPrompt: '' } }]
  }))
  const manifest = mergeAssetEntityDefinitions({ version: 2, assets: [] }, { characters, scenes })
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(blueprint))],
    ['assets/manifest.json', encoder.encode(JSON.stringify(manifest))],
  ])
  return {
    gameId: 'scale-budget-test',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, new Uint8Array(bytes)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

function workflow(scale: string) {
  const state = createInitialWorkflowState('scale-budget-test')
  state.requirementContract = {
    schemaVersion: 1,
    rawIntent: '做一个极短互动影游',
    dimensions: { work_scale: { value: scale, source: 'author' } },
    locale: 'zh-CN',
    collectedAt: new Date().toISOString(),
  }
  return state
}

describe('work scale completion gates', () => {
  it('counts only the main blueprint and accepts exactly three nodes for micro', async () => {
    const result = await validateProjectForActivity(
      context(3),
      'blueprint.outline',
      1,
      ['outline.node-count-matches-scale'],
      workflow('极短（3个蓝图节点、2个角色、1个场景）'),
    )

    expect(result.evidence[0]).toMatchObject({ status: 'pass', checkId: 'outline.node-count-matches-scale' })
  })

  it('accepts short scale within the range of 8 to 15 nodes and warns outside', async () => {
    for (const count of [8, 10, 15]) {
      const result = await validateProjectForActivity(
        context(count),
        'blueprint.outline',
        1,
        ['outline.node-count-matches-scale'],
        workflow('短篇（10个章节）'),
      )
      expect(result.evidence[0], `count: ${count}`).toMatchObject({
        status: 'pass',
        checkId: 'outline.node-count-matches-scale',
      })
    }

    const underResult = await validateProjectForActivity(
      context(7),
      'blueprint.outline',
      1,
      ['outline.node-count-matches-scale'],
      workflow('短篇（10个章节）'),
    )
    expect(underResult.evidence[0]?.status).toBe('warn')
    expect(underResult.evidence[0]?.issues?.[0]?.code).toBe('outline.node-count-mismatch')

    const overResult = await validateProjectForActivity(
      context(16),
      'blueprint.outline',
      1,
      ['outline.node-count-matches-scale'],
      workflow('短篇（10个章节）'),
    )
    expect(overResult.evidence[0]?.status).toBe('warn')
    expect(overResult.evidence[0]?.issues?.[0]?.code).toBe('outline.node-count-mismatch')
  })

  it('counts combat nodes toward the short main-blueprint budget', async () => {
    const passing = await validateProjectForActivity(
      context(10, 0, 0, 5),
      'blueprint.outline',
      1,
      ['outline.node-count-matches-scale'],
      workflow('短篇（10个章节）'),
    )
    expect(passing.evidence[0]?.status).toBe('pass')

    const overBudget = await validateProjectForActivity(
      context(16, 0, 0, 5),
      'blueprint.outline',
      1,
      ['outline.node-count-matches-scale'],
      workflow('短篇（10个章节）'),
    )
    expect(overBudget.evidence[0]?.status).toBe('warn')
    expect(overBudget.evidence[0]?.issues?.[0]?.code).toBe('outline.node-count-mismatch')
  })

  it('fails the owning asset activity when character or scene counts differ from scale', async () => {
    const state = workflow('极短（3个蓝图节点、2个角色、1个场景）')
    const passing = await validateProjectForActivity(
      context(3, 2, 1),
      'characters.modeling',
      1,
      ['characters.count-matches-scale', 'scenes.count-matches-scale'],
      state,
    )
    expect(passing.evidence.map((item) => item.status)).toEqual(['pass', 'pass'])

    const failing = await validateProjectForActivity(
      context(3, 1, 2),
      'characters.modeling',
      1,
      ['characters.count-matches-scale', 'scenes.count-matches-scale'],
      state,
    )
    expect(failing.evidence.map((item) => item.status)).toEqual(['fail', 'fail'])
    expect(failing.evidence.map((item) => item.issues?.[0]?.code)).toEqual([
      'characters.count-mismatch',
      'scenes.count-mismatch',
    ])
    expect(failing.ok).toBe(false)
  })

  it('ignores source=catalog scenes when matching scene scale', async () => {
    const state = workflow('极短（3个蓝图节点、2个角色、1个场景）')
    const ctx = context(3, 2, 1)
    const manifestRaw = await ctx.files.read('assets/manifest.json')
    const manifest = JSON.parse(new TextDecoder().decode(manifestRaw!)) as {
      assetCatalog: { entities: { scene: Record<string, Record<string, unknown>> } }
    }
    manifest.assetCatalog.entities.scene.scene_extra = {
      id: 'scene_extra',
      name: '仅库场景',
      description: 'd',
      prompt: 'p',
      source: 'catalog',
      history: [],
      createdAt: 1,
      updatedAt: 1,
    }
    await ctx.files.write('assets/manifest.json', encoder.encode(JSON.stringify(manifest)))

    const result = await validateProjectForActivity(
      ctx,
      'scenes.modeling',
      1,
      ['scenes.count-matches-scale'],
      state,
    )
    expect(result.evidence.map((item) => item.status)).toEqual(['pass'])
  })
})
