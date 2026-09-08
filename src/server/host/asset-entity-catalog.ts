import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  nodeVideoEntityId,
  type AssetCatalogState,
  type AssetManifest,
  type CatalogEntity,
  type CatalogEntityKind,
  type CharacterDefinition,
  type SceneDefinition,
  type VideoDefinition,
} from '@/authoring/assets/registry-types'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { getSubProcess, type GameGraph } from '@/runtime/core/schema/graph-schema'
import { readHostManifest, writeHostManifest } from '../asset-registry'

const ENTITY_KINDS: readonly CatalogEntityKind[] = [
  'character', 'scene', 'video', 'icon', 'control', 'audio', 'font',
]

function emptyEntityTables(): AssetCatalogState['entities'] {
  return {
    character: {},
    scene: {},
    video: {},
    icon: {},
    control: {},
    audio: {},
    font: {},
  }
}

export function normalizeAssetCatalogState(value: unknown): AssetCatalogState {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<AssetCatalogState>
    : {}
  const rawEntities = raw.entities && typeof raw.entities === 'object'
    ? raw.entities
    : emptyEntityTables()
  const entities = emptyEntityTables()
  for (const kind of ENTITY_KINDS) {
    const table = rawEntities[kind]
    entities[kind] = table && typeof table === 'object' && !Array.isArray(table)
      ? { ...table }
      : {}
  }
  return {
    ...raw,
    version: 1,
    folders: Array.isArray(raw.folders) ? raw.folders : [],
    placements: raw.placements && typeof raw.placements === 'object' && !Array.isArray(raw.placements)
      ? { ...raw.placements }
      : {},
    entities,
  }
}

function entityFromCharacter(
  character: CharacterDefinition,
  previous?: CatalogEntity,
  now = Date.now(),
): CatalogEntity {
  return {
    ...previous,
    id: character.id,
    name: character.name,
    ...(character.summary !== undefined ? { summary: character.summary } : {}),
    description: character.appearance?.description ?? previous?.description ?? '',
    prompt: character.appearance?.previewPrompt ?? previous?.prompt ?? '',
    ...(character.entityId !== undefined ? { entityId: character.entityId } : {}),
    ...(character.currentAssetId
      ? { current: { assetId: character.currentAssetId } }
      : previous?.current ? { current: previous.current } : {}),
    history: previous?.history ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}

function entityFromScene(
  scene: SceneDefinition,
  previous?: CatalogEntity,
  now = Date.now(),
): CatalogEntity {
  return {
    ...previous,
    id: scene.id,
    name: scene.name,
    ...(scene.summary !== undefined ? { summary: scene.summary } : {}),
    description: scene.visual?.description ?? previous?.description ?? '',
    prompt: scene.visual?.previewPrompt ?? previous?.prompt ?? '',
    ...(scene.source !== undefined
      ? { source: scene.source }
      : previous?.source !== undefined
        ? { source: previous.source }
        : {}),
    ...(scene.currentAssetId
      ? { current: { assetId: scene.currentAssetId } }
      : previous?.current ? { current: previous.current } : {}),
    history: previous?.history ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}

function entityFromVideo(
  video: VideoDefinition,
  previous?: CatalogEntity,
  now = Date.now(),
): CatalogEntity {
  return {
    ...previous,
    id: video.id,
    name: video.name,
    ...(video.summary !== undefined ? { summary: video.summary } : {}),
    description: video.description ?? previous?.description ?? '',
    prompt: video.prompt ?? previous?.prompt ?? '',
    ...(video.source !== undefined
      ? { source: video.source }
      : previous?.source !== undefined
        ? { source: previous.source }
        : {}),
    ...(video.currentAssetId
      ? { current: { assetId: video.currentAssetId } }
      : previous?.current ? { current: previous.current } : {}),
    history: previous?.history ?? [],
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}

export function characterFromCatalogEntity(entity: CatalogEntity): CharacterDefinition {
  return {
    id: entity.id,
    name: entity.name,
    ...(entity.entityId ? { entityId: entity.entityId } : {}),
    ...(entity.summary !== undefined ? { summary: entity.summary } : {}),
    appearance: {
      description: entity.description ?? '',
      previewPrompt: entity.prompt ?? '',
    },
    ...(entity.current ? { currentAssetId: entity.current.assetId } : {}),
  }
}

export function sceneFromCatalogEntity(entity: CatalogEntity): SceneDefinition {
  return {
    id: entity.id,
    name: entity.name,
    ...(entity.summary !== undefined ? { summary: entity.summary } : {}),
    visual: {
      description: entity.description ?? '',
      previewPrompt: entity.prompt ?? '',
    },
    ...(entity.current ? { currentAssetId: entity.current.assetId } : {}),
    ...(entity.source !== undefined ? { source: entity.source } : {}),
  }
}

export function videoFromCatalogEntity(entity: CatalogEntity): VideoDefinition {
  return {
    id: entity.id,
    name: entity.name,
    ...(entity.summary !== undefined ? { summary: entity.summary } : {}),
    description: entity.description ?? '',
    prompt: entity.prompt ?? '',
    ...(entity.current ? { currentAssetId: entity.current.assetId } : {}),
    ...(entity.source !== undefined ? { source: entity.source } : {}),
  }
}

export function mergeAssetEntityDefinitions(
  manifest: AssetManifest,
  definitions: {
    characters?: Readonly<Record<string, CharacterDefinition>>
    scenes?: Readonly<Record<string, SceneDefinition>>
    videos?: Readonly<Record<string, VideoDefinition>>
  },
): AssetManifest {
  const assetCatalog = normalizeAssetCatalogState(manifest.assetCatalog)
  const now = Date.now()
  for (const character of Object.values(definitions.characters ?? {})) {
    assetCatalog.entities.character[character.id] = entityFromCharacter(
      character,
      assetCatalog.entities.character[character.id],
      now,
    )
    assetCatalog.placements[`character:${character.id}`] ??= {
      folderId: 'root:character', sortKey: character.name, createdAt: now, updatedAt: now,
    }
  }
  for (const scene of Object.values(definitions.scenes ?? {})) {
    assetCatalog.entities.scene[scene.id] = entityFromScene(
      scene,
      assetCatalog.entities.scene[scene.id],
      now,
    )
    assetCatalog.placements[`scene:${scene.id}`] ??= {
      folderId: 'root:scene', sortKey: scene.name, createdAt: now, updatedAt: now,
    }
  }
  for (const video of Object.values(definitions.videos ?? {})) {
    assetCatalog.entities.video[video.id] = entityFromVideo(
      video,
      assetCatalog.entities.video[video.id],
      now,
    )
    assetCatalog.placements[`video:${video.id}`] ??= {
      folderId: 'root:video', sortKey: video.name, createdAt: now, updatedAt: now,
    }
  }
  return { ...manifest, assetCatalog }
}

export function assetEntityDefinitions(manifest: AssetManifest): {
  characters: Record<string, CharacterDefinition>
  scenes: Record<string, SceneDefinition>
  videos: Record<string, VideoDefinition>
} {
  const catalog = normalizeAssetCatalogState(manifest.assetCatalog)
  const characters = Object.fromEntries(Object.entries(catalog.entities.character)
    .map(([id, entity]) => [id, characterFromCatalogEntity(entity)]))
  const scenes = Object.fromEntries(Object.entries(catalog.entities.scene)
    .map(([id, entity]) => [id, sceneFromCatalogEntity(entity)]))
  const videos = Object.fromEntries(Object.entries(catalog.entities.video)
    .map(([id, entity]) => [id, videoFromCatalogEntity(entity)]))
  return { characters, scenes, videos }
}

export function videoDefinitionsFromProject(
  project: GraphLibraryDocument | null | undefined,
): Record<string, VideoDefinition> {
  if (!project) return {}
  const videos: Record<string, VideoDefinition> = {}
  const collectGraphVideos = (
    blueprintId: string,
    graph: GameGraph,
    graphPath: readonly string[],
  ): void => {
    for (const node of graph.nodes) {
      const media = node.data?.media
      const hasVideoMedia = media?.kind === 'video'
        || typeof media?.prompt === 'string'
        || Boolean(media?.generation)
      const isVideoCandidate = hasVideoMedia || node.type === 'perf' || node.type === 'scene'
      if (isVideoCandidate) {
        const id = nodeVideoEntityId({ blueprintId, nodeId: node.id, graphPath })
        const name = (node.data?.name || node.data?.chapterSummary || node.id).trim()
        const summary = node.data?.chapterSummary?.trim() || node.data?.storyText?.trim() || undefined
        const description = node.data?.storyText?.trim() || node.data?.chapterSummary?.trim() || ''
        const prompt = typeof media?.prompt === 'string' ? media.prompt.trim() : ''
        const currentAssetId = typeof media?.ref === 'string' && media.ref.trim() ? media.ref.trim() : undefined

        videos[id] = {
          id,
          name: name || id,
          ...(summary ? { summary } : {}),
          description,
          prompt,
          ...(currentAssetId ? { currentAssetId } : {}),
          source: 'outline',
        }
      }

      const subProcess = getSubProcess(node.data)
      if (subProcess) collectGraphVideos(blueprintId, subProcess.graph, [...graphPath, node.id])
    }
  }
  for (const [blueprintId, pack] of Object.entries(project.manifest?.packs ?? {})) {
    collectGraphVideos(blueprintId, pack.graph, [])
  }
  return videos
}

export function syncProjectVideoPresets(
  manifest: AssetManifest,
  project: GraphLibraryDocument | null | undefined,
): AssetManifest {
  const videos = videoDefinitionsFromProject(project)
  const nextManifest = mergeAssetEntityDefinitions(manifest, { videos })
  const assetCatalog = normalizeAssetCatalogState(nextManifest.assetCatalog)
  const activeIds = new Set(Object.keys(videos))

  for (const [entityId, entity] of Object.entries(assetCatalog.entities.video)) {
    // Only prune outline-generated node video entities that no longer exist and have no assets
    if (
      entityId.startsWith('node:')
      && !activeIds.has(entityId)
      && !entity.current?.assetId
      && (!entity.history || entity.history.length === 0)
    ) {
      delete assetCatalog.entities.video[entityId]
      delete assetCatalog.placements[`video:${entityId}`]
    }
  }
  return { ...nextManifest, assetCatalog }
}

export async function updateCatalogEntityCurrent(
  context: ExtensionContext,
  kind: 'character' | 'scene' | 'video',
  entityId: string,
  assetId: string,
  source: 'generate' | 'upload' | 'select' = 'generate',
): Promise<void> {
  const manifest = await readHostManifest(context.files)
  const assetCatalog = normalizeAssetCatalogState(manifest.assetCatalog)
  const entity = assetCatalog.entities[kind][entityId]
  if (!entity) throw new Error(`${kind} does not exist: ${entityId}`)
  const now = Date.now()
  const history = entity.history.some((entry) => entry.assetId === assetId)
    ? entity.history
    : [...entity.history, { assetId, appliedAt: now, source }]
  assetCatalog.entities[kind][entityId] = {
    ...entity,
    current: { assetId },
    history,
    updatedAt: now,
  }
  await writeHostManifest(context.files, { ...manifest, assetCatalog })
}
