import { useCallback, useMemo, useState } from 'react'
import { useT } from '../../i18n'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { ImageGenerationWorkspace } from '../assets/generation/ImageGenerationWorkspace'
import type { ImageGenerationInitialValues } from '../assets/generation/ImageGenerationSurface'
import { consumeImageGenerationTarget } from '../assets/generation/imageGenerationNavigation'
import type { KinoGenerationTask } from '../assets/generation/generation-api'
import { useAssetCatalog, type CatalogAsset } from '@/editor/assets/asset-catalog'
import { assetCatalogClient } from '@/editor/assets/asset-catalog-client'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useCatalogNav } from '../persist/catalogNavStore'
import { resolveAssetSrc } from './media'
import { KINO_IMAGE_SIZES, type KinoImageSize } from '@/runtime/core/schema/kino-image-schema'

type ReturnView = 'assets' | 'characters'
type SelectedImageGeneration = {
  initialValues: ImageGenerationInitialValues
  resourceId?: string
  task?: KinoGenerationTask
}

export function ImageGenerationPage({ onBack }: { onBack: (view: ReturnView) => void }): JSX.Element {
  injectStyleOnce('image-generation-page', CSS)
  const t = useT()
  const game = useGraphScenario((state) => state.game)
  const { catalog } = useAssetCatalog(game)
  const [target] = useState(() => consumeImageGenerationTarget(game))
  const asset = target?.assetId ? catalog.assets[target.assetId] ?? null : null

  const characterId = target?.characterId
    ?? (target?.targetRoot === 'character' ? target.entityId : undefined)
  const character = characterId
    ? catalog.entities.character[characterId]
    : undefined
  const selected = useMemo<SelectedImageGeneration | undefined>(() => asset
    ? selectedGeneration(asset, game)
    : character ? {
      initialValues: {
        prompt: character.prompt ?? '',
        model: 'lite',
        size: '1664x2496' as const,
      },
    } : undefined, [asset, character, game])
  const setCatalogLocation = useCatalogNav((state) => state.setLocation)
  const targetRoot = character ? 'character' : target?.targetRoot
  const businessTargetRoot = targetRoot && targetRoot !== 'image' ? targetRoot : undefined
  const imageEntityId = businessTargetRoot ? character?.id ?? target?.entityId : undefined
  const imageEntity = businessTargetRoot && imageEntityId
    ? catalog.entities[businessTargetRoot][imageEntityId]
    : undefined
  const applyHistoricalImage = useCallback(async (assetId: string): Promise<void> => {
    if (!businessTargetRoot || !imageEntityId || !imageEntity) {
      throw new Error(t('imageGeneration.applyMissingEntity'))
    }
    await assetCatalogClient.apply({
      operationId: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `image-history-apply-${Date.now()}`,
      assetId,
      tabKind: businessTargetRoot,
      mode: 'catalog',
      entityId: imageEntityId,
      source: 'select',
    })
  }, [businessTargetRoot, imageEntity, imageEntityId, t])
  const close = (): void => {
    if (target?.returnView === 'assets' && target.catalogLocation) setCatalogLocation(target.catalogLocation)
    onBack(target?.returnView ?? 'assets')
  }
  return (
    <div className="ig-page">
      <header className="ig-page-head">
        <button type="button" onClick={close}>{t('imageGeneration.assets')}</button>
        <span aria-hidden>/</span>
      <strong>{asset?.name ?? character?.name ?? t('imageGeneration.title')}</strong>
      </header>
      <ImageGenerationWorkspace
        key={asset ? `${asset.id}:${asset.updatedAt}` : character ? `character:${character.id}` : 'image-generation'}
        variant="page"
        gameId={game}
        initialValues={selected?.initialValues}
        // The catalog can lag behind navigation by one render. The validated
        // target id still owns the history scope; the lookup above only
        // enriches the initial values and title when the asset is available.
        initialAssetId={target?.assetId}
        initialTask={selected?.task}
        initialResourceId={selected?.resourceId}
        selectLatestHistory={Boolean(asset)}
        targetRoot={targetRoot}
        characterId={character?.id}
        entityId={character?.id ?? target?.entityId}
        entityName={imageEntity?.name ?? character?.name}
        catalogLocation={target?.catalogLocation}
        resetKey={asset ? `${asset.id}:${asset.updatedAt}` : character ? `character:${character.id}` : undefined}
        appliedAssetId={imageEntity?.current?.assetId}
        onApplyResult={imageEntity ? applyHistoricalImage : undefined}
        onClose={close}
      />
    </div>
  )
}

function selectedGeneration(asset: CatalogAsset, game: string): SelectedImageGeneration {
  const parameters = asset.provenance?.recipe?.parameters
  const preview = record(asset.meta?.characterPreview)
  const mode = stringValue(preview?.mode)
  const resourceId = asset.resourceId
    ?? stringValue(asset.meta?.kinoResourceId)
    ?? (asset.provider?.kind === 'kino' ? stringValue(asset.provider.upstreamResourceId) : undefined)
  const model = stringValue(asset.meta?.kinoModel)
    ?? stringValue(parameters?.model)
    ?? (resourceId ? 'lite' : undefined)
  const size = kinoImageSize(parameters?.size)
    ?? (mode === 'portrait' ? '1664x2496' : mode === 'turnaround' ? '2560x1440' : undefined)
  const resultUrl = resolveAssetSrc(asset, game)
  const generationId = stringValue(asset.meta?.kinoGenerationId) ?? `asset:${asset.id}`
  const task = resultUrl ? {
    generationId,
    mediaType: 'image' as const,
    status: 'succeeded' as const,
    ...(asset.prompt ? { prompt: asset.prompt } : {}),
    ...(model ? { model } : {}),
    resultUrl,
    ...(resourceId ? { resourceId } : {}),
    createdAt: asset.createdAt,
  } : undefined
  return {
    initialValues: {
      ...(asset.prompt ? { prompt: asset.prompt } : {}),
      ...(model ? { model } : {}),
      ...(size ? { size } : {}),
      ...(stringValue(parameters?.visualStyleKey)
        ? { visualStyleKey: stringValue(parameters?.visualStyleKey)! }
        : {}),
    },
    ...(resourceId ? { resourceId } : {}),
    ...(task ? { task } : {}),
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function kinoImageSize(value: unknown): KinoImageSize | undefined {
  return typeof value === 'string' && (KINO_IMAGE_SIZES as readonly string[]).includes(value)
    ? value as KinoImageSize
    : undefined
}

const CSS = `
.ig-page { display:flex; flex:1; min-width:0; min-height:0; flex-direction:column; background:#1a1a1a; color:#fff; }
.ig-page-head { display:flex; min-height:48px; flex:none; align-items:center; gap:8px; padding:0 24px; border-bottom:1px solid rgba(255,255,255,.1); background:#333; color:rgba(255,255,255,.45); font-size:13px; }
.ig-page-head button { border:0; padding:0; color:inherit; background:transparent; font:inherit; cursor:pointer; }.ig-page-head strong { color:#fff; }
`
