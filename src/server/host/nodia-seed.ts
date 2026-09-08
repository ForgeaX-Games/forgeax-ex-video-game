import blueprintFixture from './fixtures/nodia.blueprint.json'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { NODIA_ASSETS_MANIFEST, type NodiaAssetsManifest } from './nodia-assets'

export interface NodiaProject {
  id: 'nodia'
  title: 'Nodia'
  platform: 'game-video'
  platformVersion: '1'
  entry: {
    blueprint: 'blueprint.json'
    components: 'dist/components'
  }
}

export interface NodiaSeed extends Record<string, unknown> {
  project: NodiaProject
  blueprint: GraphLibraryDocument
  assetsManifest: NodiaAssetsManifest
}

const NODIA_PROJECT: NodiaProject = {
  id: 'nodia',
  title: 'Nodia',
  platform: 'game-video',
  platformVersion: '1',
  entry: {
    blueprint: 'blueprint.json',
    components: 'dist/components',
  },
}

const UNSAFE_SEED_VALUE = /\/Users\/|\/workspace\/|\.forgeax\/games|file:\/\//
const BASENAME_ID = /^[^/\\.\0]+$/

/** Returns a fully independent, extension-owned seed; video bytes remain in the extension bundle. */
export async function createNodiaSeed(): Promise<NodiaSeed> {
  return structuredClone({
    project: NODIA_PROJECT,
    blueprint: blueprintFixture as GraphLibraryDocument,
    assetsManifest: NODIA_ASSETS_MANIFEST,
  })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Nodia seed: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertPortable(value: unknown, at = 'seed'): void {
  if (typeof value === 'string') {
    assert(!UNSAFE_SEED_VALUE.test(value), `${at} contains a machine or game path`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPortable(item, `${at}[${index}]`))
    return
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) assertPortable(item, `${at}.${key}`)
  }
}

function validateProject(project: unknown): asserts project is NodiaProject {
  assert(isRecord(project), 'project must be an object')
  assert(project.id === 'nodia', 'project.id must be nodia')
  assert(project.title === 'Nodia', 'project.title must be Nodia')
  assert(project.platform === 'game-video', 'project.platform must be game-video')
  assert(project.platformVersion === '1', 'project.platformVersion must be 1')
  assert(isRecord(project.entry), 'project.entry must be an object')
  assert(project.entry.blueprint === 'blueprint.json', 'project.entry.blueprint must be blueprint.json')
  assert(project.entry.components === 'dist/components', 'project.entry.components must be dist/components')
}

function validateAssets(manifest: unknown): asserts manifest is NodiaAssetsManifest {
  assert(isRecord(manifest), 'assets manifest must be an object')
  assert(manifest.version === 2, 'assets manifest.version must be 2')
  assert(Array.isArray(manifest.assets), 'assets manifest.assets must be an array')
  assert(manifest.assets.length === 31, 'assets manifest must contain exactly 31 bundled videos')

  const ids = new Set<string>()
  for (const [index, asset] of manifest.assets.entries()) {
    assert(isRecord(asset), `assets[${index}] must be an object`)
    assert(typeof asset.id === 'string' && BASENAME_ID.test(asset.id), `assets[${index}].id must be basename-only`)
    assert(!ids.has(asset.id), `duplicate asset id '${asset.id}'`)
    ids.add(asset.id)
    assert(asset.kind === 'video', `assets[${index}].kind must be video`)
    assert(asset.productionType === 'bundled_video', `assets[${index}].productionType must be bundled_video`)
    assert(asset.status === 'ready', `assets[${index}].status must be ready`)
    assert(isRecord(asset.file), `assets[${index}].file must be an object`)
    assert(asset.file.provider === 'extension', `assets[${index}].file.provider must be extension`)
    assert(asset.file.key === `zhandou/${asset.id}.mp4`, `assets[${index}].file.key must match the logical id`)
    assert(asset.file.mime === 'video/mp4', `assets[${index}].file.mime must be video/mp4`)
  }
}

function collectMediaRefs(value: unknown, refs: Array<{ ref: string; at: string }>, at: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMediaRefs(item, refs, `${at}[${index}]`))
    return
  }
  if (!isRecord(value)) return
  if (isRecord(value.media) && Object.prototype.hasOwnProperty.call(value.media, 'ref')) {
    const ref = value.media.ref
    assert(typeof ref === 'string' && ref.trim().length > 0, `${at}.media.ref must be a nonempty string logical id`)
    refs.push({ ref, at: `${at}.media.ref` })
  }
  for (const [key, item] of Object.entries(value)) collectMediaRefs(item, refs, `${at}.${key}`)
}

function subFlowPackId(value: unknown): string | undefined {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'subFlowPack')) return undefined
  assert(isRecord(value.subFlowPack), 'subFlowPack must be an object')
  const id = value.subFlowPack.id
  assert(typeof id === 'string' && id.trim().length > 0, 'subFlowPack.id must be a nonempty string')
  if (value.subFlowPack.version !== undefined) {
    assert(typeof value.subFlowPack.version === 'string' && value.subFlowPack.version.trim().length > 0,
      'subFlowPack.version must be a nonempty string when present')
  }
  if (value.subFlowPack.entry !== undefined) {
    assert(typeof value.subFlowPack.entry === 'string' && value.subFlowPack.entry.trim().length > 0,
      'subFlowPack.entry must be a nonempty string when present')
  }
  return id
}

function validateBlueprint(blueprint: unknown, assetIds: Set<string>): asserts blueprint is GraphLibraryDocument {
  assert(isRecord(blueprint), 'blueprint must be an object')
  assert(blueprint.version === 'game-video.graph.v1', 'blueprint.version is invalid')
  assert(isRecord(blueprint.graph), 'blueprint.graph must be an object')
  assert(isRecord(blueprint.manifest), 'blueprint.manifest must be an object')
  const manifest = blueprint.manifest
  assert(manifest.version === 'game-video.blueprint-manifest.v1', 'blueprint manifest.version is invalid')
  assert(typeof manifest.mainPackId === 'string' && manifest.mainPackId.length > 0, 'blueprint manifest.mainPackId is required')
  assert(isRecord(manifest.packs), 'blueprint manifest.packs must be an object')
  assert(isRecord(manifest.packs[manifest.mainPackId]), 'blueprint main pack is missing')

  const packIds = new Set<string>()
  const packReferences = new Map<string, string[]>()
  for (const [packId, rawPack] of Object.entries(manifest.packs)) {
    assert(!packIds.has(packId), `duplicate pack id '${packId}'`)
    packIds.add(packId)
    assert(isRecord(rawPack), `pack '${packId}' must be an object`)
    assert(rawPack.id === packId, `pack '${packId}' id must match its manifest key`)
    assert(typeof rawPack.entry === 'string' && rawPack.entry.length > 0, `pack '${packId}' entry is required`)
    assert(isRecord(rawPack.graph), `pack '${packId}' graph must be an object`)
    assert(Array.isArray(rawPack.graph.nodes) && Array.isArray(rawPack.graph.edges), `pack '${packId}' graph is invalid`)

    const nodeIds = new Set<string>()
    for (const [index, node] of rawPack.graph.nodes.entries()) {
      assert(isRecord(node) && typeof node.id === 'string' && node.id.length > 0, `pack '${packId}' node ${index} has no id`)
      assert(!nodeIds.has(node.id), `pack '${packId}' has duplicate node id '${node.id}'`)
      nodeIds.add(node.id)
    }
    assert(nodeIds.has(rawPack.entry), `pack '${packId}' entry '${rawPack.entry}' does not exist`)

    const edgeIds = new Set<string>()
    const adjacency = new Map<string, string[]>()
    for (const [index, edge] of rawPack.graph.edges.entries()) {
      assert(isRecord(edge) && typeof edge.id === 'string' && edge.id.length > 0, `pack '${packId}' edge ${index} has no id`)
      assert(!edgeIds.has(edge.id), `pack '${packId}' has duplicate edge id '${edge.id}'`)
      edgeIds.add(edge.id)
      assert(typeof edge.source === 'string' && nodeIds.has(edge.source), `pack '${packId}' edge '${edge.id}' has an unknown source`)
      assert(typeof edge.target === 'string' && nodeIds.has(edge.target), `pack '${packId}' edge '${edge.id}' has an unknown target`)
      const targets = adjacency.get(edge.source) ?? []
      targets.push(edge.target)
      adjacency.set(edge.source, targets)
    }

    // Traverse from the declared entry so malformed adjacency cannot hide behind a valid node list.
    const visited = new Set<string>([rawPack.entry])
    const pending = [rawPack.entry]
    while (pending.length > 0) {
      const current = pending.shift()!
      for (const target of adjacency.get(current) ?? []) {
        if (!visited.has(target)) {
          visited.add(target)
          pending.push(target)
        }
      }
    }
    const unreachable = [...nodeIds].find((nodeId) => !visited.has(nodeId))
    assert(!unreachable, `pack '${packId}' has unreachable node '${unreachable}' from entry '${rawPack.entry}'`)

    for (const node of rawPack.graph.nodes) {
      const packRefId = isRecord(node) ? subFlowPackId(node.data) : undefined
      assert(!packRefId || isRecord(manifest.packs[packRefId]), `pack '${packId}' references missing subflow '${packRefId}'`)
      if (packRefId) {
        const references = packReferences.get(packId) ?? []
        references.push(packRefId)
        packReferences.set(packId, references)
      }
    }
  }

  const visiting = new Set<string>()
  const visitedPacks = new Set<string>()
  const traversePack = (packId: string): void => {
    if (visiting.has(packId)) throw new Error(`Invalid Nodia seed: subflow reference cycle at '${packId}'`)
    if (visitedPacks.has(packId)) return
    visiting.add(packId)
    for (const next of packReferences.get(packId) ?? []) traversePack(next)
    visiting.delete(packId)
    visitedPacks.add(packId)
  }
  for (const packId of packIds) traversePack(packId)

  assert(JSON.stringify(blueprint.graph) === JSON.stringify((manifest.packs[manifest.mainPackId] as { graph: unknown }).graph),
    'blueprint.graph must mirror the main pack graph')

  const refs: Array<{ ref: string; at: string }> = []
  collectMediaRefs(blueprint, refs, 'blueprint')
  for (const { ref, at } of refs) assert(assetIds.has(ref), `${at} '${ref}' is not in the seeded asset manifest`)
}

/** Fail loudly before a package is materialized; it never manufactures a fallback manifest. */
export function validateNodiaSeed(seed: unknown): asserts seed is NodiaSeed {
  assert(isRecord(seed), 'seed must be an object')
  assertPortable(seed)
  validateProject(seed.project)
  validateAssets(seed.assetsManifest)
  validateBlueprint(seed.blueprint, new Set(seed.assetsManifest.assets.map((asset) => asset.id)))
}
