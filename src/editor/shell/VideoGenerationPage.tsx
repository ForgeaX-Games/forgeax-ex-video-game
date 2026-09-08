import { useCallback, useEffect, useMemo, useState } from 'react'
import { tf, useT } from '../../i18n'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { useGraphScenario } from '../persist/graphScenarioStore'
import {
  consumeNodeGenerationTarget,
  consumeCatalogVideoGenerationTarget,
  catalogVideoGenerationScope,
  nodeVideoEntityId,
  nodeVideoTargetFromEntityId,
  nodeVideoGenerationScope,
  resolveVideoGenerationCatalogTarget,
  type NodeGenerationTarget,
} from '../assets/generation/videoGenerationNavigation'
import type { ClipGenerationRequest } from '../assets/generation/generation-api'
import type { KinoGenerationTask } from '../assets/generation/generation-api'
import type { KinoVideoGenerationParams } from '@/runtime/core/schema/kino-schema'
import { pluginFetch } from '../../lib/plugin-http'
import { getExtensionHost } from '../../lib/extension-host'
import {
  assetCatalogClient,
  type AssetCatalogGeneratedInput,
} from '@/editor/assets/asset-catalog-client'
import { useAssetCatalog } from '@/editor/assets/asset-catalog'
import { useCatalogNav } from '../persist/catalogNavStore'
import { useGraphView } from '../persist/graphViewStore'
import { createHostMediaClient } from '../assets/host-media-client'
import { uploadReferenceImage } from '../assets/image-assets'
import {
  VideoGenerationWorkspace,
  type VideoGenerationWorkspaceProps,
} from '../assets/generation/VideoGenerationWorkspace'
import { withCatalogGenerationTracking } from '../assets/generation/catalogGenerationRecovery'
import { nextGeneratedName } from '../assets/generation/generation-naming'
import { generatedVideoDisplayName } from '../assets/generation/video-generation-naming'
import { videoGenerationInitialValuesFromAsset } from '../assets/generation/video-generation-manifest'

export interface VideoGenerationPageProps {
  onBack: () => void
  initialValues?: VideoGenerationWorkspaceProps['initialValues']
  resetKey?: VideoGenerationWorkspaceProps['resetKey']
  showBreadcrumb?: boolean
  nodeTarget?: NodeGenerationTarget
}

interface NodeProductionContext {
  nodeRef: { blueprintId: string; nodeId: string }
  node: { name?: string }
  video: {
    prompt?: string
    submission: KinoVideoGenerationParams | null
    binding: {
      state: 'unconfigured' | 'processing' | 'ready' | 'failed' | 'missing' | 'invalid'
      bound: boolean
      ready: boolean
      assetId?: string
      assetStatus?: string
      source?: 'upload' | 'generation' | 'import' | 'derived' | 'unknown'
    }
    assetRefs: Array<{
      id: string
      asset: null | {
        label?: string
        name?: string
        mime?: string
        productionType?: string
        provider?: { kind?: string; upstreamResourceId?: string }
        meta?: { kinoResourceId?: string; hostMedia?: { assetId?: string } }
      }
    }>
  }
  readiness: { readyToSubmit: boolean; issues: string[] }
}

function isNodeVideoPresetPending(context: NodeProductionContext | null): boolean {
  return Boolean(context && !context.readiness.readyToSubmit && !context.video.prompt?.trim())
}

async function publishNodeReferences(
  gameId: string,
  target: NodeGenerationTarget,
  context: NodeProductionContext,
): Promise<boolean> {
  const pending = context.video.assetRefs.filter(({ asset }) => {
    if (!asset) return false
    const kinoId = asset.provider?.kind === 'kino'
      ? asset.provider.upstreamResourceId
      : asset.meta?.kinoResourceId
    return !kinoId && Boolean(asset.meta?.hostMedia?.assetId)
  })
  if (pending.length === 0) return false
  const host = getExtensionHost()
  if (typeof host.ready !== 'function') throw new Error('当前 Host 无法发布节点参考图')
  const media = createHostMediaClient({ ready: host.ready.bind(host) })
  const mappings: Array<{ assetId: string; resourceId: string }> = []
  for (const { id, asset } of pending) {
    const hostAssetId = asset?.meta?.hostMedia?.assetId
    if (!asset || !hostAssetId) continue
    const response = await fetch(await media.contentUrl(hostAssetId))
    if (!response.ok) throw new Error(`参考图 ${asset.label ?? id} 读取失败（HTTP ${response.status}）`)
    const blob = await response.blob()
    const mime = blob.type || asset.mime || 'image/png'
    const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
    const file = new File([blob], `${asset.label ?? asset.name ?? id}.${extension}`, { type: mime })
    const uploaded = await uploadReferenceImage(
      gameId,
      file,
      asset.productionType === 'character_ref' ? 'character' : 'scene',
    )
    const resourceId = uploaded.provider?.upstreamResourceId
    if (!resourceId) throw new Error(`参考图 ${asset.label ?? id} 未返回 Kino resource id`)
    mappings.push({ assetId: id, resourceId })
  }
  if (mappings.length === 0) return false
  const response = await pluginFetch('node-production-context/kino-references', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blueprintId: target.blueprintId, nodeId: target.nodeId, assetMappings: mappings }),
  })
  if (!response.ok) throw new Error(`参考图映射写入失败（HTTP ${response.status}）`)
  return true
}

async function loadNodeProductionContext(target: NodeGenerationTarget): Promise<NodeProductionContext> {
  const query = new URLSearchParams({ blueprintId: target.blueprintId, nodeId: target.nodeId })
  const response = await pluginFetch(`node-production-context?${query.toString()}`)
  if (!response.ok) throw new Error(`节点视频上下文加载失败（HTTP ${response.status}）`)
  return response.json() as Promise<NodeProductionContext>
}

function assertNodeSubmission(
  target: NodeGenerationTarget,
  context: NodeProductionContext,
  request: ClipGenerationRequest,
): void {
  if (!context.readiness.readyToSubmit || !context.video.submission) {
    throw new Error(`该节点尚未满足生成条件：${context.readiness.issues.join('；') || '缺少视频预设'}`)
  }
  if (context.nodeRef.blueprintId !== target.blueprintId || context.nodeRef.nodeId !== target.nodeId) {
    throw new Error('节点生产上下文已变化，请返回蓝图后重新选择节点')
  }
  const expected = context.video.submission
  const actualRefs = new Set(request.referenceImageResourceIds ?? [])
  const missingRefs = (expected.referenceImageResourceIds ?? []).filter((id) => !actualRefs.has(id))
  if (missingRefs.length > 0) throw new Error('节点所需角色或场景参考图已被移除，请恢复预填参考图后再生成')
  if (expected.firstFrameResourceId && request.firstFrameResourceId !== expected.firstFrameResourceId) {
    throw new Error('节点所需首帧已被替换，请恢复预填首帧后再生成')
  }
  if (expected.lastFrameResourceId && request.lastFrameResourceId !== expected.lastFrameResourceId) {
    throw new Error('节点所需尾帧已被替换，请恢复预填尾帧后再生成')
  }
}

/**
 * Route-only shell: breadcrumb/navigation stay here; generation data and form
 * behavior live in the reusable VideoGenerationWorkspace.
 */
export function VideoGenerationPage({
  onBack,
  initialValues,
  resetKey,
  showBreadcrumb = true,
  nodeTarget,
}: VideoGenerationPageProps): JSX.Element {
  const t = useT()
  const game = useGraphScenario((s) => s.game)
  const { catalog } = useAssetCatalog(game)
  const catalogLocation = useCatalogNav((state) => state.location)
  const setCatalogLocation = useCatalogNav((state) => state.setLocation)
  const [standaloneTarget] = useState(() => consumeNodeGenerationTarget(game))
  const explicitNodeTarget = nodeTarget ?? standaloneTarget
  const [requestedCatalogVideoTarget] = useState(() => consumeCatalogVideoGenerationTarget(game))
  const [catalogVideoTarget] = useState(() => resolveVideoGenerationCatalogTarget(
    game,
    explicitNodeTarget,
    requestedCatalogVideoTarget,
    catalogLocation,
  ))
  const target = useMemo<NodeGenerationTarget | undefined>(() => {
    if (explicitNodeTarget) return explicitNodeTarget
    const recovered = catalogVideoTarget?.entityId
      ? nodeVideoTargetFromEntityId(catalogVideoTarget.entityId)
      : undefined
    return recovered ? { gameId: game, ...recovered } : undefined
  }, [catalogVideoTarget?.entityId, explicitNodeTarget, game])
  const generationScope = useMemo(
    () => target ? nodeVideoGenerationScope(target) : catalogVideoGenerationScope(catalogVideoTarget ?? {}),
    [catalogVideoTarget, target],
  )
  const videoEntityId = explicitNodeTarget
    ? nodeVideoEntityId(explicitNodeTarget)
    : catalogVideoTarget?.entityId
  const selectedVideoAsset = useMemo(() => {
    const direct = catalogVideoTarget?.assetId
    const entityAsset = videoEntityId
      ? catalog.entities.video[videoEntityId]?.current?.assetId
      : undefined
    return catalog.assets[direct ?? entityAsset ?? '']
  }, [catalog.assets, catalog.entities.video, catalogVideoTarget?.assetId, videoEntityId])
  const appliedVideoAssetId = videoEntityId
    ? catalog.entities.video[videoEntityId]?.current?.assetId
    : undefined
  const [nodeContext, setNodeContext] = useState<NodeProductionContext | null>(null)
  const [contextError, setContextError] = useState<string | null>(null)
  const [publishingReferences, setPublishingReferences] = useState(false)
  const nodeContextCatalogKey = JSON.stringify({
    character: catalog.entities.character,
    scene: catalog.entities.scene,
    assets: Object.fromEntries(Object.entries(catalog.assets).map(([id, asset]) => [id, {
      status: asset.status,
      resourceId: asset.resourceId,
      updatedAt: asset.updatedAt,
    }])),
  })

  useEffect(() => {
    if (!target) return
    let active = true
    void (async () => {
      try {
        let context = await loadNodeProductionContext(target)
        if (active) setPublishingReferences(true)
        if (await publishNodeReferences(game, target, context)) context = await loadNodeProductionContext(target)
        if (active) { setNodeContext(context); setContextError(null) }
      } catch (error) {
        if (active) setContextError(error instanceof Error ? error.message : String(error))
      } finally {
        if (active) setPublishingReferences(false)
      }
    })()
    return () => { active = false }
  }, [game, nodeContextCatalogKey, target])

  useEffect(() => {
    setNodeContext(null)
    setContextError(null)
  }, [target?.blueprintId, target?.nodeId])

  const selectedAssetInitialValues = useMemo(
    () => selectedVideoAsset ? videoGenerationInitialValuesFromAsset(selectedVideoAsset) : undefined,
    [selectedVideoAsset],
  )
  const nodeInitialValues = nodeContext?.video.submission ?? selectedAssetInitialValues ?? initialValues
  const nodeResetKey = nodeContext
    ? `${nodeContext.nodeRef.blueprintId}:${nodeContext.nodeRef.nodeId}:${JSON.stringify(nodeContext.video.submission)}`
    : selectedVideoAsset
      ? `${selectedVideoAsset.id}:${selectedVideoAsset.updatedAt ?? selectedVideoAsset.createdAt ?? 0}`
      : resetKey
  const nodeGenerationDisabled = Boolean(target && (
    publishingReferences
    || contextError
    || !nodeContext
    || !nodeContext.readiness.readyToSubmit
  ))
  const nodeVideoPresetPending = isNodeVideoPresetPending(nodeContext)
  const nodeContextMessage = contextError
    ? contextError
    : publishingReferences
      ? t('videoAssets.generate.nodeContext.publishingReferences')
      : !nodeContext
        ? t('videoAssets.generate.nodeContext.loading')
        : !nodeContext.readiness.readyToSubmit
          ? nodeVideoPresetPending
            ? t('videoAssets.generate.nodeContext.presetPending')
            : tf('videoAssets.generate.nodeContext.notReady', {
                issues: nodeContext.readiness.issues.join('；') || t('videoAssets.generate.nodeContext.missingPreset'),
              })
          : tf('videoAssets.generate.nodeContext.node', { name: nodeContext.node.name || nodeContext.nodeRef.nodeId })
  const nodeContextHasError = Boolean(
    contextError || (nodeContext && !nodeContext.readiness.readyToSubmit && !nodeVideoPresetPending),
  )
  const validateSubmit = useMemo(() => target ? async (request: ClipGenerationRequest): Promise<void> => {
    const latest = await loadNodeProductionContext(target)
    assertNodeSubmission(target, latest, request)
  } : undefined, [target])
  const videoRegistration = useCallback((
    task: KinoGenerationTask,
    status: 'generating' | 'ready',
    parameters: Record<string, unknown>,
  ): AssetCatalogGeneratedInput => {
    const assetId = manifestVideoAssetId(task.generationId)
    const entityId = target
      ? nodeVideoEntityId(target)
      : catalogVideoTarget?.entityId ?? task.generationId
    const existingName = catalog.entities.video[entityId]?.name
    const displayName = generatedVideoDisplayName({
      ...(target && nodeContext?.node.name ? { nodeName: nodeContext.node.name } : {}),
      ...(existingName ? { existingName } : {}),
      newVideoName: nextGeneratedName(
        Object.values(catalog.entities.video).map((entity) => entity.name),
        (number) => tf('videoAssets.generate.defaultVideoName', { number }),
      ),
      fallback: assetId,
    })
    const existingPlacement = catalog.placements[`video:${entityId}`]
    const placementTarget = target
      ? existingPlacement?.folderId ?? 'root:video'
      : catalogVideoTarget?.catalogLocation?.tabKind === 'video'
        ? catalogVideoTarget.catalogLocation.target
        : 'root:video'
    const input: AssetCatalogGeneratedInput = {
      operationId: `${task.generationId}:register-${status}`,
      asset: {
        id: assetId,
        kind: 'video',
        status,
        label: displayName,
        ...(task.prompt ? { prompt: task.prompt } : {}),
        ...(status === 'ready' && task.resourceId && task.resultUrl ? {
          provider: { kind: 'kino', ref: task.resourceId, upstreamResourceId: task.resourceId },
          url: task.resultUrl,
        } : {}),
        productionType: 'video_clip',
        sourceModule: 'game-video',
        meta: {
          ...(typeof parameters.durationSeconds === 'number' ? { durationSeconds: parameters.durationSeconds } : {}),
          ...(typeof parameters.mode === 'string' ? { mode: parameters.mode } : {}),
          ...(typeof parameters.resolution === 'string' ? { resolution: parameters.resolution } : {}),
          ...(typeof parameters.generateAudio === 'boolean' ? { generateAudio: parameters.generateAudio } : {}),
          ...(typeof parameters.visualStyleKey === 'string' ? { visualStyleKey: parameters.visualStyleKey } : {}),
        },
        provenance: { origin: 'generation', recipe: { version: 1, parameters } },
      },
      placement: {
        placementKey: `video:${entityId}`,
        folderId: placementTarget,
        sortKey: target
          ? existingPlacement?.sortKey ?? displayName
          : task.createdAt ? String(task.createdAt) : task.generationId,
      },
      apply: {
        mode: 'catalog' as const,
        tabKind: 'video' as const,
        entityId,
        ...(!target ? { createEntity: { name: displayName } } : {}),
        source: 'generate' as const,
      },
      ...(target ? { blueprintApply: {
        mode: 'blueprint' as const,
        tabKind: 'video' as const,
        target: {
          kind: 'node-video' as const,
          blueprintId: target.blueprintId,
          nodeId: target.nodeId,
          ...(target.graphPath?.length ? { graphPath: [...target.graphPath] } : {}),
        },
      } } : {}),
    }
    return withCatalogGenerationTracking(input, task, 'video', generationScope, parameters)
  }, [catalog.entities.video, catalog.placements, catalogVideoTarget, generationScope, nodeContext?.node.name, target])
  const registerStartedVideo = useCallback(async (
    task: KinoGenerationTask,
    request: ClipGenerationRequest,
  ): Promise<void> => {
    const parameters = {
      ...request,
      prompt: request.prompt.trim(),
    }
    await assetCatalogClient.registerGenerated(videoRegistration({
      ...task,
      prompt: task.prompt ?? request.prompt.trim(),
      params: parameters,
    }, 'generating', parameters))
  }, [videoRegistration])
  const bindGeneratedVideo = useCallback(async (resourceId: string, task: KinoGenerationTask): Promise<void> => {
    const scenario = useGraphScenario.getState()
    if (target && scenario.isDraft) throw new Error('请先保存蓝图，再应用生成素材')
    if (!task.resultUrl) throw new Error('Generated video has no CDN URL; catalog registration was not applied')
    await assetCatalogClient.registerGenerated(videoRegistration({ ...task, resourceId }, 'ready', {
      ...(task.params ?? {}),
      ...(task.model ? { model: task.model } : {}),
    }))
    if (target) {
      const syncResult = await scenario.syncTipIfClean()
      if (syncResult !== 'applied' && syncResult !== 'unchanged') throw new Error('蓝图未能同步到已应用素材，请重试')
    }
    if (!target) {
      const entityId = catalogVideoTarget?.entityId ?? task.generationId
      const placementTarget = catalogVideoTarget?.catalogLocation?.tabKind === 'video'
        ? catalogVideoTarget.catalogLocation.target
        : 'root:video'
      setCatalogLocation({
        kind: 'item',
        tabKind: 'video',
        itemId: entityId,
        placementKey: `video:${entityId}`,
        target: placementTarget,
      })
    }
  }, [catalogVideoTarget?.catalogLocation, catalogVideoTarget?.entityId, setCatalogLocation, target, videoRegistration])

  const applyHistoricalVideo = useCallback(async (assetId: string): Promise<void> => {
    if (!videoEntityId) throw new Error(t('videoAssets.generate.apply.missingEntity'))
    await assetCatalogClient.apply({
      operationId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `video-history-apply-${Date.now()}`,
      assetId,
      tabKind: 'video',
      mode: 'catalog',
      entityId: videoEntityId,
      source: 'select',
    })
  }, [t, videoEntityId])

  const returnFromGeneration = useCallback((): void => {
    if (catalogVideoTarget) {
      if (catalogVideoTarget.catalogLocation) setCatalogLocation(catalogVideoTarget.catalogLocation)
      useGraphView.getState().setView('assets')
      return
    }
    onBack()
  }, [catalogVideoTarget, onBack, setCatalogLocation])

  return (
    <div className="wgv-generation-page">
      {showBreadcrumb ? (
        <header className="wgv-generation-page-head">
          <div className="wgv-generation-breadcrumb" aria-label={t('videoAssets.generate.breadcrumbAria')}>
            <button type="button" onClick={returnFromGeneration}>{t('videoAssets.title')}</button>
            <span aria-hidden>/</span>
            <strong>{t('videoAssets.generate.pageTitle')}</strong>
          </div>
        </header>
      ) : null}
      {target ? (
        <div className="wgv-generation-node-context" role={nodeContextHasError ? 'alert' : 'status'}>
          {nodeContextMessage}
        </div>
      ) : null}
      <VideoGenerationWorkspace
        variant="page"
        gameId={game}
        initialValues={nodeInitialValues}
        initialResultAssetId={selectedVideoAsset?.id}
        resetKey={nodeResetKey}
        interaction={target ? { disabled: nodeGenerationDisabled } : undefined}
        generationDisabledReason={nodeGenerationDisabled ? nodeContextMessage : undefined}
        generationScope={generationScope}
        appliedAssetId={appliedVideoAssetId}
        onApplyResult={videoEntityId ? applyHistoricalVideo : undefined}
        validateSubmit={validateSubmit}
        onGenerationStarted={registerStartedVideo}
        onGenerationSucceeded={bindGeneratedVideo}
        onClose={returnFromGeneration}
      />
    </div>
  )
}

function manifestVideoAssetId(generationId: string): string {
  const canonical = generationId.trim()
  if (!canonical) throw new Error('Kino generation id cannot be used as a manifest asset id')
  return `asset_kino_${encodeURIComponent(canonical)}`
}

const VIDEO_GENERATION_PAGE_CSS = `
.wgv-generation-page {
  --wgv-page-bg: #1a1a1a;
  --wgv-page-panel: #333;
  --wgv-page-text: #fff;
  --wgv-page-muted: rgba(255,255,255,.4);
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--wgv-page-bg);
  color: var(--wgv-page-text);
}
.wgv-generation-page-head {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: none;
  min-height: 48px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255,255,255,.1);
  background: var(--wgv-page-panel);
}
.wgv-generation-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--wgv-page-muted);
  font-size: 13px;
}
.wgv-generation-breadcrumb button { padding: 0; border: 0; background: transparent; color: var(--wgv-page-muted); cursor: pointer; font: inherit; }
.wgv-generation-breadcrumb button:hover, .wgv-generation-breadcrumb button:focus-visible { color: #fff; outline: none; }
.wgv-generation-breadcrumb strong { color: var(--wgv-page-text); font-weight: 700; }
.wgv-generation-page > .vgen-sheet {
  position: relative;
  inset: auto;
  z-index: auto;
  flex: 1;
  min-height: 0;
}
.wgv-generation-node-context {
  flex: none;
  min-height: 34px;
  padding: 8px 24px;
  border-bottom: 1px solid rgba(255,156,42,.45);
  background: #292929;
  color: #f5f5f5;
  font-size: 13px;
}
@media (max-width: 820px) {
  .wgv-generation-page-head { min-height: 44px; padding: 0 14px; }
}
`

injectStyleOnce('video-generation-page', VIDEO_GENERATION_PAGE_CSS)
