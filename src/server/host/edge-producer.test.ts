import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { validateProjectForActivity } from './project-inspection'
import { activityContract } from '../../workflow/activity-contracts'

const encoder = new TextEncoder()

type NodeSpec = { id: string; data?: Record<string, unknown> }
type EdgeSpec = { id: string; source: string; target: string; sourceHandle?: string; data?: Record<string, unknown> }

function inkKouOverlay(overlayId: string) {
  return {
    id: overlayId,
    kind: 'group',
    children: [{
      id: `${overlayId}-kou`,
      component: 'InkKou',
      layout: { left: 0.1, top: 0.75, width: 0.8, height: 0.2 },
      trigger: { when: 'at', ms: 800 },
      window: { startMs: 800, endMs: 2_800 },
      inputs: {},
    }],
  }
}

function doc(options: {
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  entry: string
  overlays?: Record<string, unknown>
  variables?: Record<string, unknown>
  entities?: Record<string, unknown>
}) {
  const graph = {
    nodes: options.nodes.map((node) => ({
      id: node.id,
      type: 'scene',
      position: { x: 0, y: 0 },
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
    manifest: { mainPackId: 'bp-main', packs: { 'bp-main': { id: 'bp-main', title: 'main', entry: options.entry, graph } } },
    variables: options.variables ?? {},
    entities: options.entities ?? {},
    formulas: {},
    ui: { overlays: options.overlays ?? {} },
  }
}

function context(document: unknown): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(document))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  return {
    gameId: 'edge-producer',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

async function codesFor(document: unknown, checkId: string): Promise<string[]> {
  const result = await validateProjectForActivity(context(document), 'playtest.validating', 1, [checkId])
  return (result.evidence[0]!.issues ?? []).map((entry) => entry.code)
}

describe('出边生产者 edge.no-producer', () => {
  it('默认出边永远有生产者（引擎默认推进）', async () => {
    const codes = await codesFor(
      doc({ entry: 'a', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e1', source: 'a', target: 'b' }] }),
      'edge.no-producer',
    )
    expect(codes).not.toContain('edge.no-producer')
  })

  it('多条带条件的默认出边合法，不报生产者错误也不报 warn', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        edges: [
          { id: 'e1', source: 'a', target: 'b', data: { condition: { all: [] } } },
          { id: 'e2', source: 'a', target: 'c', data: { condition: { all: [] } } },
        ],
      }),
      'edge.no-producer',
    )
    expect(codes).toEqual([])
  })

  it('handle 由挂载元件事件提供时算接上了', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{ id: 'a', data: { overlayNodes: [{ overlay: 'node:a' }] } }, { id: 'b' }],
        edges: [{ id: 'e-kou', source: 'a', target: 'b', sourceHandle: 'kou' }],
        overlays: { 'node:a': inkKouOverlay('node:a') },
      }),
      'edge.no-producer',
    )
    expect(codes).not.toContain('edge.no-producer')
  })

  it('handle 无元件事件、也无 reaction advance 时报 edge.no-producer', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{ id: 'a', data: { overlayNodes: [{ overlay: 'node:a' }] } }, { id: 'b' }],
        edges: [{ id: 'e-x', source: 'a', target: 'b', sourceHandle: 'choice-A' }],
        overlays: { 'node:a': inkKouOverlay('node:a') },
      }),
      'edge.no-producer',
    )
    expect(codes).toContain('edge.no-producer')
  })

  it('handle 由 reaction advance 推进时算接上了', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{
          id: 'a',
          data: { reactions: [{ when: { type: 'event', id: 'foo' }, do: [{ kind: 'advance', edgeId: 'e-x' }] }] },
        }, { id: 'b' }],
        edges: [{ id: 'e-x', source: 'a', target: 'b', sourceHandle: 'branch-x' }],
      }),
      'edge.no-producer',
    )
    expect(codes).not.toContain('edge.no-producer')
  })

  it('settlement-advance 出边缺 reaction advance 时报 edge.no-producer', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ id: 'e-next', source: 'a', target: 'b', sourceHandle: 'settlement-advance:e-next' }],
      }),
      'edge.no-producer',
    )
    expect(codes).toContain('edge.no-producer')
  })

  it('settlement-advance 出边有 reaction advance 时算接上了', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{
          id: 'a',
          data: { reactions: [{ when: { type: 'watch', of: 'x', on: 'change' }, do: [{ kind: 'advance', edgeId: 'e-next' }] }] },
        }, { id: 'b' }],
        edges: [{ id: 'e-next', source: 'a', target: 'b', sourceHandle: 'settlement-advance:e-next' }],
      }),
      'edge.no-producer',
    )
    expect(codes).not.toContain('edge.no-producer')
  })
})

describe('playtest.paths-not-illegally-stuck', () => {
  it('可停留的线性蓝图通过', async () => {
    const codes = await codesFor(
      doc({ entry: 'a', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e1', source: 'a', target: 'b' }] }),
      'playtest.paths-not-illegally-stuck',
    )
    expect(codes).toEqual([])
  })

  it('全默认出边成环、无停留点时判非法卡死', async () => {
    const codes = await codesFor(
      doc({
        entry: 'a',
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }],
      }),
      'playtest.paths-not-illegally-stuck',
    )
    expect(codes).toContain('playtest.no-rest-point')
  })
})

describe('playtest.validating 硬门集合', () => {
  it('收窄为数据合法性 + 玩法合理性两组', () => {
    expect(activityContract('playtest.validating').hardChecks).toEqual([
      'blueprint.data.valid',
      'playtest.playability.valid',
    ])
  })

  it('干净线性蓝图通过全部硬门', async () => {
    const document = doc({ entry: 'a', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e1', source: 'a', target: 'b' }] })
    const result = await validateProjectForActivity(
      context(document),
      'playtest.validating',
      1,
      activityContract('playtest.validating').hardChecks,
    )
    expect(result.ok, JSON.stringify(result.evidence)).toBe(true)
  })

  it('存在死分支时被拦截', async () => {
    const document = doc({
      entry: 'a',
      nodes: [{ id: 'a', data: { overlayNodes: [{ overlay: 'node:a' }] } }, { id: 'b' }, { id: 'c' }],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e-dead', source: 'a', target: 'c', sourceHandle: 'choice-A' },
      ],
      overlays: { 'node:a': inkKouOverlay('node:a') },
    })
    const result = await validateProjectForActivity(
      context(document),
      'playtest.validating',
      1,
      activityContract('playtest.validating').hardChecks,
    )
    expect(result.ok).toBe(false)
  })
})
