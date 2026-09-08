import {
  MAIN_ID,
  documentFromBlueprints,
  emptyBlueprintDoc,
  normalizeDocument,
  validateDocument,
} from '@/authoring/blueprint/blueprint-project'
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
  assetsManifest: { version: 2; assets: [] }
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

  const main = emptyBlueprintDoc({ id: MAIN_ID, title: '主蓝图' })
  // emptyBlueprintDoc already creates id=entry perf node; set a stable placeholder name
  const entry = main.graph.nodes.find((n) => n.id === main.entry)
  if (entry) entry.data = { ...entry.data, name: '起点' }

  const blueprint = normalizeDocument(
    documentFromBlueprints({ [MAIN_ID]: main }, MAIN_ID, {
      entities: {},
      variables: {},
    }),
  )

  return {
    project: {
      id: gameId,
      title: gameId,
      platform: 'game-video',
      platformVersion: '1',
      entry: { blueprint: 'blueprint.json', components: 'dist/components' },
    },
    blueprint,
    assetsManifest: { version: 2, assets: [] },
  }
}

export function validateEmptyLibrarySeed(seed: unknown): asserts seed is EmptyLibrarySeed {
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
  assert(Array.isArray(seed.assetsManifest.assets) && seed.assetsManifest.assets.length === 0, 'assets must be empty')

  const blueprint = normalizeDocument(seed.blueprint as GraphLibraryDocument)
  assert(blueprint.version === 'game-video.graph.v1', 'blueprint.version')
  assert(blueprint.manifest?.mainPackId === MAIN_ID, 'mainPackId')
  assert(blueprint.graph.nodes.length === 1, 'exactly one node')
  assert(blueprint.graph.nodes[0]?.id === 'entry', 'entry node id')
  assert(blueprint.graph.nodes[0]?.type === 'perf', 'entry type')
  assert(blueprint.graph.edges.length === 0, 'no edges')
  const errors = validateDocument(blueprint)
  assert(errors.length === 0, errors.join('; ') || 'validateDocument')
}
