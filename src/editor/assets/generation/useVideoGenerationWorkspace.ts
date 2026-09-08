import { useEffect, useMemo, useState } from 'react'
import { nodeVideoEntityId, type MediaAsset } from '@/authoring/assets/registry-types'
import type { VideoAssetsController } from '../useVideoAssets'
import { useClipGeneration } from './useClipGeneration'
import { toVgenImageAsset, type VgenImageAsset } from './VgenImagePicker'
import { listRegistryAssets, resolveAssetSrc } from '../../shell/media'
import type { RecentGeneratedClip } from './VideoGenSheet'
import type { ClipGenerationRequest, VideoGenerationTask } from './generation-api'
import { useVideoGenerationStore, videoGenerationStoreKey } from './videoGenerationStore'
import {
  catalogAssetMatchesGenerationScope,
  generationScopeKey,
  type VideoGenerationScope,
} from './catalogGenerationRecovery'
import type { PromptMentionAsset } from './PromptMentionEditor'
import { catalogVideoPosterUrl, useAssetCatalog, useAssetCatalogHistory, type AssetCatalog } from '../asset-catalog'
import { catalogPromptMentionAssets } from './catalogPromptMentionAssets'

export function useVideoGenerationWorkspace(
  game: string,
  videoController: VideoAssetsController,
  generationScope: VideoGenerationScope,
  onStarted?: (task: VideoGenerationTask, request: ClipGenerationRequest) => void | Promise<void>,
) {
  const [regAssets, setRegAssets] = useState<MediaAsset[]>([])
  const { catalog } = useAssetCatalog(game)
  const historyEntityId = generationScope.owner === 'node'
    ? nodeVideoEntityId(generationScope)
    : generationScope.owner === 'entity' && 'entityId' in generationScope
      ? generationScope.entityId
      : undefined
  const { catalog: historyCatalog } = useAssetCatalogHistory(
    historyEntityId ? 'video' : undefined,
    historyEntityId,
  )
  const generationScopeId = generationScopeKey(generationScope)
  const generationEntry = useVideoGenerationStore((state) => state.byScope[videoGenerationStoreKey(game, generationScope)])
  const selectedTask = generationEntry?.selectedTask
  const refreshGenerations = useVideoGenerationStore((state) => state.refresh)

  useEffect(() => {
    const controller = new AbortController()
    void refreshGenerations(game, generationScope, { signal: controller.signal })
    return () => controller.abort()
  }, [game, generationScopeId, refreshGenerations])

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const pull = async (): Promise<void> => {
      try {
        const assets = await listRegistryAssets(game, undefined, { signal: controller.signal })
        if (alive) setRegAssets(assets)
      } catch (error) {
        if (!controller.signal.aborted) throw error
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 5000)
    return () => {
      alive = false
      controller.abort()
      window.clearInterval(timer)
    }
  }, [game])

  const imageAssets = useMemo<VgenImageAsset[]>(() => {
    return regAssets.flatMap((asset) => {
      if (asset.kind !== 'image' || asset.status !== 'ready') return []
      const kind = asset.productionType === 'character_ref'
        ? 'character_ref'
        : asset.productionType === 'scene_ref'
          ? 'scene_ref'
          : asset.productionType === 'shot_image'
            ? 'keyframe'
            : null
      if (!kind) return []
      return [{ ...toVgenImageAsset(asset, game), kind, thumbUrl: resolveAssetSrc(asset, game) }]
    })
  }, [game, regAssets])

  const recentClips = useMemo<RecentGeneratedClip[]>(() => {
    return toManifestVideoHistory(historyEntityId ? historyCatalog : catalog, generationScope)
  }, [catalog, generationScope, generationScopeId, historyCatalog, historyEntityId])

  const mentionAssets = useMemo<PromptMentionAsset[]>(() => {
    return catalogPromptMentionAssets(catalog)
  }, [catalog])

  const clipGeneration = useClipGeneration({
    gameSlug: game,
    scopeKey: generationScopeId,
    onStarted,
    onTerminal: videoController.refresh,
    restoredTask: selectedTask,
    activeTasks: generationEntry?.tasks,
  })

  return { regAssets, imageAssets, recentClips, mentionAssets, clipGeneration }
}

export function toManifestVideoHistory(
  catalog: AssetCatalog,
  scope: VideoGenerationScope,
): RecentGeneratedClip[] {
  // The root entry creates a new video asset and therefore has no asset-owned
  // history yet. Showing every catalog video here mixes unrelated assets.
  if (scope.owner === 'root') return []
  const entityId = scope.owner === 'node'
    ? nodeVideoEntityId(scope)
    : scope.owner === 'entity' && 'entityId' in scope ? scope.entityId : undefined
  const entity = entityId ? catalog.entities.video[entityId] : undefined
  const entityAssetIds = entity
    ? new Set([
        ...(entity?.history.map((item) => item.assetId) ?? []),
        ...(entity?.current ? [entity.current.assetId] : []),
      ])
    : undefined
  return Object.values(catalog.assets)
    .filter((asset) => asset.kind === 'video')
    .filter((asset) => {
      if ('assetId' in scope && scope.assetId) {
        return asset.id === scope.assetId || catalogAssetMatchesGenerationScope(asset, scope)
      }
      return entityAssetIds
        ? entityAssetIds.has(asset.id)
        : catalogAssetMatchesGenerationScope(asset, scope)
    })
    .map((asset) => ({
        id: asset.id,
        ...(asset.generationId ? { generationId: asset.generationId } : {}),
        ...(asset.resourceId ? { resourceId: asset.resourceId } : {}),
        label: asset.name,
        createdAt: asset.createdAt ?? asset.updatedAt ?? 0,
        status: videoHistoryStatus(asset.status),
        posterUrl: catalogVideoPosterUrl(catalog, asset),
        playbackUrl: videoHistoryStatus(asset.status) === 'ready' && asset.url ? asset.url : undefined,
        ...(asset.prompt ? { prompt: asset.prompt } : {}),
        ...(stringMeta(asset.meta, 'kinoModel')
          ? { model: stringMeta(asset.meta, 'kinoModel') }
          : stringMeta(asset.meta, 'model') ? { model: stringMeta(asset.meta, 'model') } : {}),
        ...(asset.provenance?.recipe?.parameters ? { params: asset.provenance.recipe.parameters } : {}),
        ...(numberMeta(asset.meta, 'durationSeconds') ? { durationSeconds: numberMeta(asset.meta, 'durationSeconds') } : {}),
        ...(stringMeta(asset.meta, 'mode') ? { mode: stringMeta(asset.meta, 'mode') as RecentGeneratedClip['mode'] } : {}),
        ...(stringMeta(asset.meta, 'resolution') ? { resolution: stringMeta(asset.meta, 'resolution') as RecentGeneratedClip['resolution'] } : {}),
        ...(booleanMeta(asset.meta, 'generateAudio') !== undefined ? { generateAudio: booleanMeta(asset.meta, 'generateAudio') } : {}),
        ...(stringMeta(asset.meta, 'visualStyleKey') ? { visualStyleKey: stringMeta(asset.meta, 'visualStyleKey') } : {}),
      }))
    .sort((left, right) => right.createdAt - left.createdAt)
}

function stringMeta(meta: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = meta?.[key]
  return typeof value === 'string' ? value : undefined
}

function numberMeta(meta: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const value = meta?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanMeta(meta: Readonly<Record<string, unknown>> | undefined, key: string): boolean | undefined {
  const value = meta?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function videoHistoryStatus(status: string | undefined): RecentGeneratedClip['status'] {
  if (status === 'generating' || status === 'placeholder') return 'generating'
  if (status === 'failed') return 'failed'
  return 'ready'
}
