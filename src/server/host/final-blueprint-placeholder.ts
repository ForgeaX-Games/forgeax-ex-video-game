import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import type { AssetManifest, MediaAsset } from '@/authoring/assets/registry-types'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import type { GameGraph, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { getSubProcess } from '@/runtime/core/schema/graph-schema'
import {
  HOST_MANIFEST_LOCK,
  readHostManifest,
  writeHostManifest,
} from '../asset-registry'
import { syncProjectVideoPresets } from './asset-entity-catalog'
import {
  nextDocumentRevision,
  readDocumentRevision,
  readMutationReceipts,
  readScopeRevisions,
  stampDocumentRevision,
} from './document-revision'

const BLUEPRINT_FILE = 'blueprint.json'
const GRAPH_SAVE_LOCK = 'game-video-graph-save'

export const FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID = 'a-video-final-placeholder-v1'
export const FINAL_BLUEPRINT_PLACEHOLDER_FILE = `assets/media/${FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID}.mp4`
const MANIFEST_MEDIA_FILE = `media/${FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID}.mp4`
const PLACEHOLDER_DURATION_MS = 3_000
const PLACEHOLDER_ROLE = 'final-blueprint-placeholder'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function parseProject(bytes: Uint8Array | null): GraphLibraryDocument {
  if (!bytes) throw new Error('blueprint.json is missing')
  try {
    return normalizeDocument(JSON.parse(decoder.decode(bytes)) as GraphLibraryDocument)
  } catch (error) {
    throw new Error('blueprint.json is invalid', { cause: error })
  }
}

function bindGraphPlaceholder(graph: GameGraph): { graph: GameGraph, boundNodeCount: number } {
  let boundNodeCount = 0
  let graphChanged = false
  const nodes = graph.nodes.map((node) => {
    let data = node.data
    const subProcess = getSubProcess(data)
    if (subProcess) {
      const nested = bindGraphPlaceholder(subProcess.graph)
      boundNodeCount += nested.boundNodeCount
      if (nested.graph !== subProcess.graph) {
        data = {
          ...data,
          subProcess: { ...subProcess, graph: nested.graph },
        }
      }
    }
    if (!data.media?.ref?.trim()) {
      boundNodeCount += 1
      data = {
        ...data,
        media: {
          ...(data.media ?? {}),
          kind: 'video',
          ref: FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID,
        },
      }
    }
    if (data === node.data) return node
    graphChanged = true
    return { ...node, data }
  })
  return {
    graph: graphChanged ? { ...graph, nodes } : graph,
    boundNodeCount,
  }
}

function bindProjectPlaceholders(project: GraphLibraryDocument): {
  project: GraphLibraryDocument
  boundNodeCount: number
} {
  let boundNodeCount = 0
  let changed = false
  const packs = Object.fromEntries(Object.entries(project.manifest.packs).map(([id, pack]) => {
    const bound = bindGraphPlaceholder(pack.graph)
    boundNodeCount += bound.boundNodeCount
    if (bound.graph === pack.graph) return [id, pack]
    changed = true
    return [id, { ...pack, graph: bound.graph }]
  }))
  if (!changed) return { project, boundNodeCount }
  return {
    project: normalizeDocument({
      ...project,
      manifest: { ...project.manifest, packs },
    }),
    boundNodeCount,
  }
}

function isOwnedPlaceholder(value: unknown): value is MediaAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const asset = value as Partial<MediaAsset>
  return asset.id === FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID
    && asset.kind === 'video'
    && asset.productionType === 'video_clip'
    && asset.sourceModule === 'game-video'
    && asset.meta?.placeholderRole === PLACEHOLDER_ROLE
}

function upsertPlaceholderAsset(
  manifest: AssetManifest,
  hosted: Awaited<ReturnType<ExtensionContext['media']['put']>>,
  bytes: Uint8Array,
): AssetManifest {
  const index = manifest.assets.findIndex((asset) => (
    typeof asset === 'object'
    && asset !== null
    && !Array.isArray(asset)
    && 'id' in asset
    && asset.id === FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID
  ))
  const existing = index >= 0 ? manifest.assets[index] : undefined
  if (existing && !isOwnedPlaceholder(existing)) {
    throw new Error(`Asset id is owned by another asset domain: ${FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID}`)
  }
  const now = Date.now()
  const next: MediaAsset = {
    id: FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID,
    kind: 'video',
    productionType: 'video_clip',
    status: 'placeholder',
    label: '蓝图占位视频',
    file: MANIFEST_MEDIA_FILE,
    url: hosted.url,
    provider: { kind: 'local', ref: hosted.id },
    sourceModule: 'game-video',
    mime: 'video/mp4',
    bytes: bytes.byteLength,
    durationMs: PLACEHOLDER_DURATION_MS,
    createdAt: isOwnedPlaceholder(existing) ? existing.createdAt : now,
    updatedAt: now,
    meta: {
      placeholderRole: PLACEHOLDER_ROLE,
      hostMedia: {
          provenance: 'extension-media-capability',
        assetId: hosted.id,
        locator: hosted.url,
      },
    },
    provenance: {
      origin: 'import',
      source: { module: 'game-video', assetId: FINAL_BLUEPRINT_PLACEHOLDER_FILE },
    },
  }
  const assets = [...manifest.assets]
  if (index >= 0) assets[index] = next
  else assets.push(next)
  return { ...manifest, assets }
}

function equalBytes(left: Uint8Array | null, right: Uint8Array): boolean {
  if (!left || left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

async function bundledPlaceholderBytes(): Promise<Uint8Array> {
  const candidates = [
    new URL('../../runtime/react/assets/placeholder-video.mp4', import.meta.url),
    new URL('../assets/placeholder-video.mp4', import.meta.url),
    pathToFileURL(resolve('src/runtime/react/assets/placeholder-video.mp4')),
  ]
  for (const candidate of candidates) {
    try {
      return new Uint8Array(await readFile(candidate))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ERR_INVALID_URL_SCHEME') throw error
    }
  }
  throw new Error('Bundled final-blueprint placeholder video is missing')
}

export interface FinalBlueprintPlaceholderResult {
  changed: boolean
  boundNodeCount: number
  revision: number
}

/**
 * Give every unbound final-blueprint node one shared project-local placeholder.
 * The manifest status deliberately stays `placeholder`, so human generation can
 * distinguish it from a ready clip and replace the node binding later.
 */
export async function ensureFinalBlueprintPlaceholderVideos(
  context: ExtensionContext,
): Promise<FinalBlueprintPlaceholderResult> {
  return context.files.withLocks(
    [GRAPH_SAVE_LOCK, HOST_MANIFEST_LOCK],
    async () => {
      const blueprintBytes = await context.files.read(BLUEPRINT_FILE)
      const currentRevision = readDocumentRevision(blueprintBytes)
      const bound = bindProjectPlaceholders(parseProject(blueprintBytes))
      if (bound.boundNodeCount === 0) {
        return { changed: false, boundNodeCount: 0, revision: currentRevision }
      }

      const placeholderBytes = await bundledPlaceholderBytes()
      const operationId = `game-video:final-placeholder:${createHash('sha256').update(placeholderBytes).digest('hex')}`
      const hosted = await context.media.put(context.gameId, {
        filename: `${FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID}.mp4`,
        contentType: 'video/mp4',
        bytes: placeholderBytes,
        idempotencyKey: operationId,
        metadata: {
          source: 'game-video-reference',
          registryId: FINAL_BLUEPRINT_PLACEHOLDER_ASSET_ID,
          operationId,
        },
      })
      const manifest = syncProjectVideoPresets(
        upsertPlaceholderAsset(
          await readHostManifest(context.files),
          hosted,
          placeholderBytes,
        ),
        bound.project,
      )
      if (!equalBytes(await context.files.read(FINAL_BLUEPRINT_PLACEHOLDER_FILE), placeholderBytes)) {
        await context.files.write(FINAL_BLUEPRINT_PLACEHOLDER_FILE, placeholderBytes)
      }
      await writeHostManifest(context.files, manifest)
      const revision = nextDocumentRevision(currentRevision)
      await context.files.write(
        BLUEPRINT_FILE,
        encoder.encode(JSON.stringify(stampDocumentRevision(
          bound.project,
          revision,
          readMutationReceipts(blueprintBytes),
          { previous: readScopeRevisions(blueprintBytes), touched: ['graph'] },
        ), null, 2)),
      )
      return { changed: true, boundNodeCount: bound.boundNodeCount, revision }
    },
  )
}
