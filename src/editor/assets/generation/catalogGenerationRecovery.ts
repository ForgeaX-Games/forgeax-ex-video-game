import type { KinoRequestOptions } from '../kino-api'
import { nodeVideoEntityId } from '@/authoring/assets/registry-types'
import {
  assetCatalogClient,
  type AssetCatalogGeneratedInput,
} from '../asset-catalog-client'
import type { CatalogAsset } from '../asset-catalog'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import type {
  KinoGenerationMediaType,
  KinoGenerationTask,
} from './generation-api'
import {
  getKinoGeneration,
  isActiveGenerationStatus,
} from './kino-generation-client'
import { reportImageGenerationLifecycle } from './image-generation-lifecycle-client'

const TRACKING_VERSION = 3

export type ImageGenerationScope = {
  mediaType: 'image'
  targetRoot: 'image' | 'icon' | 'control' | 'character' | 'scene'
  entityId?: string
  assetId?: string
}

export type VideoGenerationScope =
  | {
    mediaType: 'video'
    owner: 'root'
  }
  | {
    mediaType: 'video'
    owner: 'node'
    blueprintId: string
    nodeId: string
    graphPath?: string[]
  }
  | {
    mediaType: 'video'
    owner: 'entity'
    entityId: string
    assetId?: never
  }
  | {
    mediaType: 'video'
    owner: 'entity'
    entityId?: never
    assetId: string
  }

export type CatalogGenerationScope = ImageGenerationScope | VideoGenerationScope

interface CatalogGenerationTracking {
  version: 3
  scope: CatalogGenerationScope
  generationId: string
  mediaType: KinoGenerationMediaType
  placement: AssetCatalogGeneratedInput['placement']
  apply?: AssetCatalogGeneratedInput['apply']
  blueprintApply?: AssetCatalogGeneratedInput['blueprintApply']
  parameters: Record<string, unknown>
}

interface TrackedCatalogAsset {
  asset: CatalogAsset
  tracking: CatalogGenerationTracking
}

export function withCatalogGenerationTracking(
  input: AssetCatalogGeneratedInput,
  task: Pick<KinoGenerationTask, 'generationId' | 'mediaType' | 'params'>,
  mediaType: KinoGenerationMediaType,
  scope: CatalogGenerationScope,
  parameters: Record<string, unknown> = task.params ?? {},
): AssetCatalogGeneratedInput {
  if (scope.mediaType !== mediaType) {
    throw new Error(`Generation scope media type mismatch: ${mediaType}`)
  }
  const meta = record(input.asset.meta) ?? {}
  const tracking: CatalogGenerationTracking = {
    version: TRACKING_VERSION,
    scope,
    generationId: task.generationId,
    mediaType,
    placement: input.placement,
    ...(input.apply ? { apply: input.apply } : {}),
    ...(input.blueprintApply ? { blueprintApply: input.blueprintApply } : {}),
    parameters,
  }
  return {
    ...input,
    asset: {
      ...input.asset,
      meta: { ...meta, kinoGenerationId: task.generationId, catalogGeneration: tracking },
    },
  }
}

/**
 * Return only durable tasks owned by the requested scope. Kino's game-level
 * list is intentionally not used here: an individual workspace must never
 * receive another entry's generation history.
 */
export async function listRecoverableKinoGenerations(
  gameSlug: string,
  mediaType: KinoGenerationMediaType,
  scope: CatalogGenerationScope,
  options: KinoRequestOptions = {},
): Promise<KinoGenerationTask[]> {
  if (scope.mediaType !== mediaType) throw new Error(`Generation scope media type mismatch: ${mediaType}`)
  const tracked = await readTrackedCatalogAssets(mediaType, scope, false)
  const trackedTasks = await Promise.all(tracked.map(async (entry) => {
    if (!isGeneratingAsset(entry.asset)) return taskFromCatalogAsset(entry)
    const task = await getKinoGeneration(entry.tracking.generationId, gameSlug, options)
    if (!isActiveGenerationStatus(task.status)) await persistTerminalTask(entry, task)
    return task
  }))
  return trackedTasks.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
}

/** App-level recovery keeps image and video Catalog cards moving after refresh. */
export async function recoverCatalogGenerations(
  gameSlug: string,
  mediaType?: KinoGenerationMediaType,
  options: KinoRequestOptions = {},
): Promise<void> {
  const tracked = await readTrackedCatalogAssets(mediaType)
  await Promise.all(tracked.map(async (entry) => {
    const task = await getKinoGeneration(entry.tracking.generationId, gameSlug, options)
    if (!isActiveGenerationStatus(task.status)) await persistTerminalTask(entry, task)
  }))
}

async function readTrackedCatalogAssets(
  mediaType?: KinoGenerationMediaType,
  scope?: CatalogGenerationScope,
  onlyGenerating = true,
): Promise<TrackedCatalogAsset[]> {
  const historyTarget = scope ? generationHistoryTarget(scope) : undefined
  const { catalog } = historyTarget
    ? await assetCatalogClient.readHistory(historyTarget)
    : await assetCatalogClient.read()
  return Object.values(catalog.assets).flatMap((asset) => {
    if (onlyGenerating && !isGeneratingAsset(asset)) return []
    const tracking = parseTracking(asset.meta?.catalogGeneration)
    if (!tracking || (mediaType && tracking.mediaType !== mediaType)) return []
    if (scope && !sameGenerationScope(tracking.scope, scope)) return []
    return [{ asset, tracking }]
  })
}

function generationHistoryTarget(
  scope: CatalogGenerationScope,
): { tabKind: 'character' | 'scene' | 'video' | 'icon' | 'control'; entityId: string } | undefined {
  if (scope.mediaType === 'image') {
    return scope.targetRoot !== 'image' && scope.entityId
      ? { tabKind: scope.targetRoot, entityId: scope.entityId }
      : undefined
  }
  if (scope.owner === 'node') {
    return { tabKind: 'video', entityId: nodeVideoEntityId(scope) }
  }
  return scope.owner === 'entity' && 'entityId' in scope && scope.entityId
    ? { tabKind: 'video', entityId: scope.entityId }
    : undefined
}

async function persistTerminalTask(
  { asset, tracking }: TrackedCatalogAsset,
  task: KinoGenerationTask,
): Promise<void> {
  const succeeded = task.status === 'succeeded'
  if (succeeded && (!task.resourceId || !task.resultUrl)) {
    throw new Error(`Kino generation ${task.generationId} succeeded without a resource URL`)
  }
  // A generated blueprint reference and its Catalog history are one recovery
  // transaction. Keep the placeholder recoverable until the in-memory draft is
  // saved; writing the disk blueprint underneath a draft would split the two.
  if (succeeded && tracking.blueprintApply && useGraphScenario.getState().isDraft) return
  const parameters = {
    ...tracking.parameters,
    ...(task.params ?? {}),
    ...(task.model ? { model: task.model } : {}),
  }
  if (tracking.mediaType === 'image' && tracking.scope.mediaType === 'image') {
    const legacyApply = tracking.apply as { tabKind?: unknown; entityId?: unknown } | undefined
    const legacyRoot = legacyApply?.tabKind === 'character' || legacyApply?.tabKind === 'scene'
      ? legacyApply.tabKind
      : undefined
    const legacyEntityId = typeof legacyApply?.entityId === 'string' ? legacyApply.entityId : undefined
    const lifecycleScope: ImageGenerationScope = legacyRoot && legacyEntityId
      ? { mediaType: 'image', targetRoot: legacyRoot, entityId: legacyEntityId }
      : tracking.scope
    await reportImageGenerationLifecycle({
      task,
      status: succeeded ? 'ready' : 'failed',
      scope: lifecycleScope,
      ...(lifecycleScope.targetRoot === 'character' && lifecycleScope.entityId
        ? { characterId: lifecycleScope.entityId }
        : {}),
      displayName: asset.name || task.prompt?.slice(0, 48) || asset.id,
      placementTarget: tracking.placement.folderId,
      parameters,
    })
    return
  }
  await assetCatalogClient.registerGenerated(withCatalogGenerationTracking({
    operationId: `${task.generationId}:recover-${succeeded ? 'succeeded' : 'failed'}`,
    asset: {
      id: asset.id,
      kind: tracking.mediaType,
      status: succeeded ? 'ready' : 'failed',
      label: asset.name || task.prompt?.slice(0, 48) || asset.id,
      ...(task.prompt ?? asset.prompt ? { prompt: task.prompt ?? asset.prompt } : {}),
      productionType: asset.productionType ?? (tracking.mediaType === 'video' ? 'video_clip' : 'shot_image'),
      sourceModule: 'game-video',
      provenance: { origin: 'generation', recipe: { version: 1, parameters } },
      meta: {
        ...(asset.meta ?? {}),
        kinoGenerationId: task.generationId,
        ...(task.resourceId ? { kinoResourceId: task.resourceId } : {}),
        ...(task.model ? { kinoModel: task.model } : {}),
      },
      ...(succeeded ? {
        url: task.resultUrl,
        provider: { kind: 'kino', ref: task.resourceId, upstreamResourceId: task.resourceId },
      } : {
        error: task.errorMessage ?? task.errorCode ?? 'Generation failed',
      }),
    },
    placement: tracking.placement,
    ...(tracking.apply ? { apply: tracking.apply } : {}),
    ...(tracking.blueprintApply ? { blueprintApply: tracking.blueprintApply } : {}),
  }, task, tracking.mediaType, tracking.scope, parameters))
}

function parseTracking(value: unknown): CatalogGenerationTracking | null {
  const candidate = record(value)
  if (!candidate || candidate.version !== TRACKING_VERSION) return null
  if (typeof candidate.generationId !== 'string' || !candidate.generationId.trim()) return null
  if (candidate.mediaType !== 'image' && candidate.mediaType !== 'video') return null
  const placement = record(candidate.placement)
  if (!placement || typeof placement.placementKey !== 'string' || typeof placement.folderId !== 'string' || typeof placement.sortKey !== 'string') return null
  const scope = parseScope(candidate.scope)
  if (!scope || scope.mediaType !== candidate.mediaType) return null
  const apply = candidate.apply === undefined ? undefined : record(candidate.apply)
  if (candidate.apply !== undefined && !apply) return null
  const blueprintApply = candidate.blueprintApply === undefined ? undefined : record(candidate.blueprintApply)
  if (candidate.blueprintApply !== undefined && !blueprintApply) return null
  const parameters = record(candidate.parameters)
  if (!parameters) return null
  return {
    version: TRACKING_VERSION,
    scope,
    generationId: candidate.generationId,
    mediaType: candidate.mediaType,
    placement: {
      placementKey: placement.placementKey,
      folderId: placement.folderId,
      sortKey: placement.sortKey,
    },
    ...(apply ? { apply: apply as AssetCatalogGeneratedInput['apply'] } : {}),
    ...(blueprintApply ? { blueprintApply: blueprintApply as AssetCatalogGeneratedInput['blueprintApply'] } : {}),
    parameters,
  }
}

function isGeneratingAsset(asset: CatalogAsset): boolean {
  return asset.status === 'generating' || asset.status === 'placeholder'
}

function taskFromCatalogAsset({ asset, tracking }: TrackedCatalogAsset): KinoGenerationTask {
  const status = asset.status === 'failed'
    ? 'failed'
    : asset.status === 'cancelled'
      ? 'cancelled'
      : asset.status === 'placeholder'
        ? 'pending'
      : 'succeeded'
  const resourceId = asset.resourceId
    ?? asset.provider?.upstreamResourceId
    ?? asset.provider?.ref
  return {
    generationId: tracking.generationId,
    mediaType: tracking.mediaType,
    status,
    ...(asset.prompt ? { prompt: asset.prompt } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(asset.url ? { resultUrl: asset.url } : {}),
    ...(asset.error ? { errorMessage: asset.error } : {}),
    ...(asset.createdAt ? { createdAt: asset.createdAt } : {}),
    params: tracking.parameters,
  }
}

function parseScope(value: unknown): CatalogGenerationScope | null {
  const candidate = record(value)
  if (!candidate || (candidate.mediaType !== 'image' && candidate.mediaType !== 'video')) return null
  if (candidate.mediaType === 'image') {
    if (!isImageTargetRoot(candidate.targetRoot)) return null
    const entityId = stringValue(candidate.entityId)
    const assetId = stringValue(candidate.assetId)
    if (candidate.targetRoot === 'image' ? Boolean(entityId) : Boolean(assetId)) return null
    return {
      mediaType: 'image',
      targetRoot: candidate.targetRoot,
      ...(entityId ? { entityId } : {}),
      ...(assetId ? { assetId } : {}),
    }
  }
  if (candidate.owner === 'root') {
    return { mediaType: 'video', owner: 'root' }
  }
  if (candidate.owner === 'node') {
    if (!stringValue(candidate.blueprintId) || !stringValue(candidate.nodeId)) return null
    if (candidate.graphPath !== undefined && (
      !Array.isArray(candidate.graphPath)
      || !candidate.graphPath.every((item) => typeof item === 'string' && Boolean(item.trim()))
    )) return null
    const graphPath = candidate.graphPath as string[] | undefined
    return {
      mediaType: 'video',
      owner: 'node',
      blueprintId: stringValue(candidate.blueprintId)!,
      nodeId: stringValue(candidate.nodeId)!,
      ...(graphPath?.length ? { graphPath } : {}),
    }
  }
  if (candidate.owner === 'entity') {
    const entityId = stringValue(candidate.entityId)
    const assetId = stringValue(candidate.assetId)
    if (Boolean(entityId) === Boolean(assetId)) return null
    if (entityId) {
      return { mediaType: 'video', owner: 'entity', entityId }
    }
    return {
      mediaType: 'video',
      owner: 'entity',
      assetId: assetId!,
    }
  }
  return null
}

function isImageTargetRoot(value: unknown): value is ImageGenerationScope['targetRoot'] {
  return value === 'image' || value === 'icon' || value === 'control'
    || value === 'character' || value === 'scene'
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function generationScopeKey(scope: CatalogGenerationScope): string {
  if (scope.mediaType === 'image') {
    return [
      'image',
      scope.targetRoot,
      scope.entityId ?? '',
      scope.assetId ?? '',
    ].map(encodeURIComponent).join('|')
  }
  if (scope.owner === 'node') {
    return [
      'video',
      'node',
      scope.blueprintId,
      scope.nodeId,
      JSON.stringify(scope.graphPath ?? []),
    ].map(encodeURIComponent).join('|')
  }
  if (scope.owner === 'root') return 'video|root'
  return [
    'video',
    'entity',
    scope.entityId ?? '',
    scope.assetId ?? '',
  ].map(encodeURIComponent).join('|')
}

export function generationOwnerKey(gameSlug: string, scopeKey: string | undefined): string {
  return JSON.stringify([gameSlug, scopeKey ?? ''])
}

export function catalogAssetMatchesGenerationScope(
  asset: CatalogAsset,
  scope: CatalogGenerationScope,
): boolean {
  const tracking = parseTracking(asset.meta?.catalogGeneration)
  return Boolean(tracking && sameGenerationScope(tracking.scope, scope))
}

function sameGenerationScope(left: CatalogGenerationScope, right: CatalogGenerationScope): boolean {
  return generationScopeKey(left) === generationScopeKey(right)
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
