import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { validateProjectForActivity } from './project-inspection'
import { activityContract } from '../../workflow/activity-contracts'
import { expandCheckIds } from '../../workflow/validation-check-groups'

const encoder = new TextEncoder()

type NodeSpec = {
  id: string
  data?: Record<string, unknown>
  /** When true, omit position to simulate agent add-node without coordinates. */
  noPosition?: boolean
}
type EdgeSpec = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  data?: Record<string, unknown>
}

function doc(options: {
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  entry: string
}) {
  const graph = {
    nodes: options.nodes.map((node) => ({
      id: node.id,
      type: 'scene',
      ...(node.noPosition ? {} : { position: { x: 0, y: 0 } }),
      data: { name: node.id, chapterSummary: node.id, storyText: node.id, ...(node.data ?? {}) },
    })),
    edges: options.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? 'default',
      targetHandle: 'in',
      data: edge.data ?? {},
    })),
  }
  return {
    revision: 1,
    version: 'game-video.graph.v1',
    graph,
    manifest: {
      mainPackId: 'bp-main',
      packs: { 'bp-main': { id: 'bp-main', title: 'main', entry: options.entry, graph } },
    },
    variables: {},
    entities: {
      wukong: { id: 'wukong', attrs: { hp: 10 }, attrMeta: { hp: { max: 10 } } },
    },
    formulas: {},
    ui: { overlays: {} },
  }
}

function context(document: unknown): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(document))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  return {
    gameId: 'runtime-shape',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

async function shapeCodes(document: unknown): Promise<string[]> {
  const result = await validateProjectForActivity(
    context(document),
    'playtest.validating',
    1,
    ['runtime.shape.valid'],
  )
  return (result.evidence[0]!.issues ?? []).map((entry) => entry.code)
}

const hpClause = { type: 'attr', entityId: 'wukong', attr: 'hp', op: 'lte', value: 0 }

describe('runtime.shape.valid — reaction / condition 形状', () => {
  it('正确的 state reaction（condition 在 when 内）通过', async () => {
    const codes = await shapeCodes(doc({
      entry: 'a',
      nodes: [{
        id: 'a',
        data: {
          reactions: [{
            when: { type: 'state', condition: { all: [hpClause] } },
            do: [{ kind: 'advance', edgeId: 'e1' }],
          }],
        },
      }, { id: 'b' }],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'settlement-advance:e1' }],
    }))
    expect(codes).toEqual([])
  })

  it('condition 挂在 reaction 顶层时报 reaction.condition.misplaced', async () => {
    // 实测崩溃形态：when 只有 type:state，condition 与 when/do 平级
    const codes = await shapeCodes(doc({
      entry: 'a',
      nodes: [{
        id: 'a',
        data: {
          reactions: [{
            when: { type: 'state' },
            condition: { all: [hpClause] },
            do: [{ kind: 'advance', edgeId: 'e1' }],
          }],
        },
      }, { id: 'b' }],
      edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'settlement-advance:e1' }],
    }))
    expect(codes).toContain('reaction.condition.misplaced')
    expect(codes).toContain('reaction.when.state.condition-missing')
  })

  it('state 缺少 when.condition 时报 reaction.when.state.condition-missing', async () => {
    const codes = await shapeCodes(doc({
      entry: 'a',
      nodes: [{
        id: 'a',
        data: {
          reactions: [{
            when: { type: 'state' },
            do: [{ kind: 'effect', effects: [] }],
          }],
        },
      }],
      edges: [],
    }))
    expect(codes).toContain('reaction.when.state.condition-missing')
  })

  it('字符串 condition 报 condition.shape.invalid', async () => {
    const codes = await shapeCodes(doc({
      entry: 'a',
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [{
        id: 'e1',
        source: 'a',
        target: 'b',
        data: { condition: 'entity.wukong.attr.hp <= 0' },
      }],
    }))
    expect(codes).toContain('condition.shape.invalid')
  })

  it('condition 缺 all 数组时报 condition.shape.invalid', async () => {
    const codes = await shapeCodes(doc({
      entry: 'a',
      nodes: [{
        id: 'a',
        data: {
          reactions: [{
            when: { type: 'state', condition: { any: [hpClause] } },
            do: [],
          }],
        },
      }],
      edges: [],
    }))
    expect(codes).toContain('condition.shape.invalid')
  })

  it('节点缺少 position 时报 node.position.missing', async () => {
    const codes = await shapeCodes(doc({
      entry: 'a',
      nodes: [{ id: 'a' }, { id: 'b', noPosition: true }],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    }))
    expect(codes).toContain('node.position.missing')
  })

  it('playtest.validating hardChecks 通过 blueprint.data.valid 覆盖 runtime.shape.valid', () => {
    expect(activityContract('playtest.validating').hardChecks).toContain('blueprint.data.valid')
    expect(expandCheckIds(activityContract('playtest.validating').hardChecks)).toContain('runtime.shape.valid')
  })
})
