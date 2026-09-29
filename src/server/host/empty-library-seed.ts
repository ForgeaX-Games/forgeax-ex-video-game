import { MAIN_ID, normalizeDocument, validateDocument } from '@/authoring/blueprint/blueprint-project'
import { createEmptyLibraryDocument } from '@/authoring/blueprint/empty-library'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

export interface EmptyProject {
  id: string
  title: string
  platform: 'game-video'
  platformVersion: '1'
  entry: { blueprint: 'blueprint.json'; components: 'dist/components' }
}

export interface EmptyLibrarySeed extends Record<string, unknown> {
  project: EmptyProject
  blueprint: GraphLibraryDocument
  // 开局模板复用同一 seed 形状，模板可以带自己的资产清单。
  assetsManifest: { version: 2; assets: unknown[] }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid empty library seed: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function createEmptyLibrarySeed(context: { gameId: string }): Promise<EmptyLibrarySeed> {
  const gameId = context.gameId
  assert(typeof gameId === 'string' && gameId.length > 0, 'gameId required')

  return {
    project: {
      id: gameId,
      title: gameId,
      platform: 'game-video',
      platformVersion: '1',
      entry: { blueprint: 'blueprint.json', components: 'dist/components' },
    },
    blueprint: createEmptyLibraryDocument(),
    assetsManifest: { version: 2, assets: [] },
  }
}

/**
 * 任意视频游戏 seed（出厂空库或开局模板）都要满足的结构契约：项目头正确、资产清单成形、
 * 蓝图能过 `validateDocument` 且首节点仍是 `entry`。节点数与连线交给各模板自己决定。
 */
export function validateVideoGameSeed(seed: unknown): asserts seed is EmptyLibrarySeed {
  assert(isRecord(seed), 'seed must be an object')
  assert(isRecord(seed.project), 'project required')
  assert(typeof seed.project.id === 'string' && seed.project.id.length > 0, 'project.id')
  assert(seed.project.id !== 'nodia', 'project.id must not be nodia')
  assert(seed.project.platform === 'game-video', 'platform')
  assert(seed.project.platformVersion === '1', 'platformVersion')
  assert(isRecord(seed.project.entry), 'entry')
  assert(seed.project.entry.blueprint === 'blueprint.json', 'entry.blueprint')
  assert(seed.project.entry.components === 'dist/components', 'entry.components')

  assert(isRecord(seed.assetsManifest), 'assetsManifest')
  assert(seed.assetsManifest.version === 2, 'assetsManifest.version')
  assert(Array.isArray(seed.assetsManifest.assets), 'assetsManifest.assets must be an array')

  const blueprint = normalizeDocument(seed.blueprint as GraphLibraryDocument)
  assert(blueprint.version === 'game-video.graph.v1', 'blueprint.version')
  assert(blueprint.manifest?.mainPackId === MAIN_ID, 'mainPackId')
  assert(blueprint.graph.nodes[0]?.id === 'entry', 'entry node id')
  assert(blueprint.graph.nodes[0]?.type === 'perf', 'entry type')
  // seed 是按原样落盘的，而 `normalizeDocument` 会用主包重建根图：只改根图（或只改主包）
  // 的 seed 仍能过下面的 validateDocument，却会在加载时静默丢掉那些节点。
  assertRootGraphMatchesMainPack(seed.blueprint as GraphLibraryDocument, blueprint)
  const errors = validateDocument(blueprint)
  assert(errors.length === 0, errors.join('; ') || 'validateDocument')
}

function assertRootGraphMatchesMainPack(
  seeded: GraphLibraryDocument,
  normalized: GraphLibraryDocument,
): void {
  const ids = (graph: GraphLibraryDocument['graph'] | undefined) => [
    (graph?.nodes ?? []).map((node) => node.id).join(','),
    (graph?.edges ?? []).map((edge) => edge.id).join(','),
  ]
  assert(
    ids(seeded.graph).join('|') === ids(normalized.graph).join('|'),
    'root graph must match the main pack graph',
  )
}

/** 出厂空库 seed 的严格契约：只有 `entry` 一个节点，没有连线，也没有资产。 */
export function validateEmptyLibrarySeed(seed: unknown): asserts seed is EmptyLibrarySeed {
  validateVideoGameSeed(seed)
  const blueprint = normalizeDocument(seed.blueprint)
  assert(blueprint.graph.nodes.length === 1, 'exactly one node')
  assert(blueprint.graph.edges.length === 0, 'no edges')
  assert(seed.assetsManifest.assets.length === 0, 'assets must be empty')
}
