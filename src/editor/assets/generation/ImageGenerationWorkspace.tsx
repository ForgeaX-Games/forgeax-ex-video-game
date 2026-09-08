import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { tf, useT } from '../../../i18n'
import { catalogPlacementKey, useAssetCatalog, useAssetCatalogHistory } from '../asset-catalog'
import type { ImageGenerationCatalogLocation } from './imageGenerationNavigation'
import { useCatalogNav } from '../../persist/catalogNavStore'
import {
  ImageGenerationSurface,
  type ImageGenerationInitialValues,
} from './ImageGenerationSurface'
import { imageGenerationAssetsFromManifest } from './image-generation-manifest'
import { catalogPromptMentionAssets } from './catalogPromptMentionAssets'
import { listVideoVisualStyles, type KinoVisualStylePreset } from './visual-style-api'
import { useImageGeneration } from './useImageGeneration'
import type { KinoGenerationTask } from './generation-api'
import type { ImageGenerationSubmitInput } from './useImageGeneration'
import {
  listRecoverableKinoGenerations,
  generationOwnerKey,
  generationScopeKey,
  type ImageGenerationScope,
} from './catalogGenerationRecovery'
import { generatedDisplayName, nextGeneratedName } from './generation-naming'
import { reportImageGenerationLifecycle } from './image-generation-lifecycle-client'
const ignoreClose = (): void => {}

export interface ImageGenerationWorkspaceProps {
  gameId: string
  open?: boolean
  variant?: 'sheet' | 'page'
  initialValues?: ImageGenerationInitialValues
  initialAssetId?: string
  initialTask?: KinoGenerationTask
  initialResourceId?: string
  selectLatestHistory?: boolean
  targetRoot?: 'image' | 'icon' | 'control' | 'character' | 'scene'
  characterId?: string
  /** Blueprint character id; kept separate from a catalog business entity id. */
  entityId?: string
  entityName?: string
  catalogLocation?: ImageGenerationCatalogLocation
  resetKey?: string | number
  onClose?: () => void
  appliedAssetId?: string
  onApplyResult?: (assetId: string) => Promise<void>
  onGenerationSucceeded?: (assetId: string, task: KinoGenerationTask) => void | Promise<void>
}
/** Reusable data-connected image generation surface for route pages and dialogs. */
export function ImageGenerationWorkspace({
  gameId,
  open = true,
  variant = 'page',
  initialValues,
  initialAssetId,
  initialTask,
  initialResourceId,
  selectLatestHistory = true,
  targetRoot: explicitTargetRoot,
  characterId,
  entityId: explicitEntityId,
  entityName,
  catalogLocation,
  resetKey,
  onClose = ignoreClose,
  appliedAssetId,
  onApplyResult,
  onGenerationSucceeded,
}: ImageGenerationWorkspaceProps): JSX.Element | null {
  const { catalog } = useAssetCatalog(gameId)
  const setCatalogLocation = useCatalogNav((state) => state.setLocation)
  const targetRoot = explicitTargetRoot ?? 'image'
  const generationScope: ImageGenerationScope = useMemo(() => ({
    mediaType: 'image',
    targetRoot,
    ...(targetRoot !== 'image' && (explicitEntityId ?? characterId)
      ? { entityId: explicitEntityId ?? characterId }
      : {}),
    ...(targetRoot === 'image' && initialAssetId ? { assetId: initialAssetId } : {}),
  }), [characterId, explicitEntityId, initialAssetId, targetRoot])
  const [styles, setStyles] = useState<readonly KinoVisualStylePreset[]>([])
  const [stylesLoading, setStylesLoading] = useState(false)
  const [stylesError, setStylesError] = useState<string | null>(null)
  const [registrationRetry, setRegistrationRetry] = useState<(() => Promise<void>) | null>(null)
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  const scopeIdentity = generationOwnerKey(gameId, generationScopeKey(generationScope))
  const currentScopeRef = useRef(scopeIdentity)
  const scopeChanged = currentScopeRef.current !== scopeIdentity
  const generationRef = useRef<ReturnType<typeof useImageGeneration> | null>(null)
  const t = useT()
  const stylesRequestActiveRef = useRef(false)
  const stylesLoadedRef = useRef(false)
  useLayoutEffect(() => {
    if (!scopeChanged) return
    currentScopeRef.current = scopeIdentity
    setRegistrationRetry(null)
    setRegistrationError(null)
  }, [scopeChanged, scopeIdentity])
  const imageRegistration = useCallback((
    task: KinoGenerationTask,
    status: 'generating' | 'ready',
    parameters: Record<string, unknown>,
  ) => {
    const assetId = manifestAssetId(task.generationId)
    const targetEntityId = targetRoot === 'image' ? undefined : explicitEntityId ?? characterId ?? task.generationId
    const existingName = targetRoot === 'image'
      ? initialAssetId ? catalog.assets[initialAssetId]?.name : undefined
      : targetEntityId ? catalog.entities[targetRoot][targetEntityId]?.name : undefined
    const defaultNameKey = targetRoot === 'character'
      ? 'imageGeneration.defaultCharacterName'
      : targetRoot === 'scene'
        ? 'imageGeneration.defaultSceneName'
        : targetRoot === 'image'
          ? 'imageGeneration.defaultImageName'
          : undefined
    const existingNames = targetRoot === 'image'
      ? Object.values(catalog.assets).filter((asset) => asset.kind === 'image').map((asset) => asset.name)
      : Object.values(catalog.entities[targetRoot]).map((entity) => entity.name)
    const displayName = generatedDisplayName({
      preferredName: entityName ?? existingName,
      ...(defaultNameKey ? { newName: nextGeneratedName(
        existingNames,
        (number) => tf(defaultNameKey, { number }),
      ) } : {}),
      ...(task.prompt ? { prompt: task.prompt } : {}),
      fallback: targetEntityId ?? assetId,
    })
    const isBusinessImage = targetRoot !== 'image' && targetEntityId !== undefined
    const placementTarget = placementTargetFor(catalogLocation, targetRoot)
    return {
      task,
      status,
      scope: {
        ...generationScope,
        ...(isBusinessImage ? { entityId: targetEntityId } : {}),
      },
      ...(characterId ? { characterId } : {}),
      displayName,
      placementTarget,
      parameters,
    }
  }, [catalog.assets, catalog.entities, catalogLocation, characterId, entityName, explicitEntityId, generationScope, initialAssetId, targetRoot])
  const generation = useImageGeneration({
    gameSlug: gameId,
    scopeKey: generationScopeKey(generationScope),
    selectLatestHistory,
    listGenerations: (gameSlug) => listRecoverableKinoGenerations(gameSlug, 'image', generationScope),
    onStarted: async (task, input) => {
      const startedScope = scopeIdentity
      const parameters = imageGenerationParameters(input)
      const pendingTask = {
        ...task,
        prompt: task.prompt ?? input.prompt.trim(),
        params: parameters,
      }
      const registrationInput = imageRegistration(pendingTask, 'generating', parameters)
      const register = async (): Promise<void> => {
        if (currentScopeRef.current === startedScope) setRegistrationError(null)
        await reportImageGenerationLifecycle(registrationInput)
        if (currentScopeRef.current !== startedScope) return
        setRegistrationRetry(null)
      }
      try {
        await register()
      } catch (error) {
        if (currentScopeRef.current !== startedScope) return
        setRegistrationRetry(() => register)
        setRegistrationError(error instanceof Error ? error.message : String(error))
      }
    },
    onSucceeded: async (resourceId, task) => {
      const terminalScope = scopeIdentity
      const assetId = manifestAssetId(task.generationId)
      const targetEntityId = targetRoot === 'image' ? undefined : explicitEntityId ?? characterId ?? task.generationId
      const isBusinessImage = targetRoot !== 'image' && targetEntityId !== undefined
      const placementTarget = placementTargetFor(catalogLocation, targetRoot)
      const registrationInput = imageRegistration({ ...task, resourceId }, 'ready', generationParameters(task))
      const register = async (): Promise<void> => {
        if (currentScopeRef.current === terminalScope) setRegistrationError(null)
        await reportImageGenerationLifecycle(registrationInput)
        if (currentScopeRef.current !== terminalScope) return
        const locationTab = isBusinessImage ? targetRoot : 'image'
        const locationId = isBusinessImage ? targetEntityId : assetId
        setCatalogLocation({ kind: 'item', tabKind: locationTab, itemId: locationId, placementKey: catalogPlacementKey(locationTab, locationId), target: placementTarget })
        await onGenerationSucceeded?.(assetId, task)
        if (currentScopeRef.current !== terminalScope) return
        generationRef.current?.track(task)
        setRegistrationRetry(null)
      }
      try {
        await register()
      } catch (error) {
        if (currentScopeRef.current !== terminalScope) return
        setRegistrationRetry(() => register)
        throw error
      }
    },
  })
  generationRef.current = generation
  const initialSelectionKey = JSON.stringify([
    gameId,
    resetKey,
    initialAssetId,
    initialResourceId,
    initialTask?.generationId,
  ])
  const restoredInitialSelectionRef = useRef<string>()

  useEffect(() => {
    if (restoredInitialSelectionRef.current === initialSelectionKey) return
    const matchingTask = initialResourceId
      ? generation.state.history.find((task) => task.resourceId === initialResourceId)
      : undefined
    const task = matchingTask ?? initialTask
    if (!task) return
    restoredInitialSelectionRef.current = initialSelectionKey
    if (generation.state.currentTask?.generationId !== task.generationId) generation.track(task)
  }, [generation.state.currentTask?.generationId, generation.state.history, generation.track, initialResourceId, initialSelectionKey, initialTask])

  const loadVisualStyles = useCallback(() => {
    if (stylesRequestActiveRef.current || stylesLoadedRef.current) return
    stylesRequestActiveRef.current = true
    setStylesLoading(true)
    setStylesError(null)
    void listVideoVisualStyles().then(
      (items) => {
        stylesLoadedRef.current = true
        setStyles(items)
      },
      (error: unknown) => {
        setStylesError(error instanceof Error ? error.message : String(error))
      },
    ).finally(() => {
      stylesRequestActiveRef.current = false
      setStylesLoading(false)
    })
  }, [])

  const targetEntityId = explicitEntityId ?? characterId
  const { catalog: historyCatalog } = useAssetCatalogHistory(
    targetRoot === 'image' || !targetEntityId ? undefined : targetRoot,
    targetEntityId,
  )
  const { historyAssets } = useMemo(
    () => imageGenerationAssetsFromManifest(
      targetRoot === 'image' || !targetEntityId ? catalog : historyCatalog,
      targetRoot,
      targetEntityId,
      initialAssetId,
    ),
    [catalog, historyCatalog, initialAssetId, targetEntityId, targetRoot],
  )
  const mentionAssets = useMemo(() => catalogPromptMentionAssets(catalog), [catalog])
  return <>
    <ImageGenerationSurface
      open={open}
      layout={variant === 'sheet' ? 'dialog' : 'page'}
      targetRoot={targetRoot}
      historyAssets={historyAssets}
      mentionAssets={mentionAssets}
      visualStyles={styles}
      visualStylesLoading={stylesLoading}
      visualStylesError={stylesError}
      onRequestVisualStyles={loadVisualStyles}
      state={generation.state}
      initialValues={initialValues}
      initialHistoryAssetId={initialAssetId}
      resetKey={resetKey}
      onSubmit={generation.submit}
      onStopWaiting={generation.stopWaiting}
      appliedAssetId={appliedAssetId}
      onApplyResult={onApplyResult}
      onClose={onClose}
    />
    {registrationRetry ? <button type="button" onClick={() => { const retry = registrationRetry; if (retry) void retry().catch((error) => setRegistrationError(error instanceof Error ? error.message : String(error))) }}>{t('videoAssets.generate.retryRegistration')}</button> : null}
    {registrationError ? <p role="alert">{registrationError}</p> : null}
  </>
}

function placementTargetFor(
  location: ImageGenerationCatalogLocation | undefined,
  targetRoot: ImageGenerationWorkspaceProps['targetRoot'],
): string {
  if (location && location.tabKind === targetRoot) return location.target
  return `root:${targetRoot ?? 'image'}`
}

function manifestAssetId(generationId: string): string {
  const canonical = generationId.trim()
  if (!canonical) throw new Error('Kino generation id cannot be used as a manifest asset id')
  return `asset_kino_${encodeURIComponent(canonical)}`
}

function generationParameters(task: KinoGenerationTask): Record<string, unknown> {
  return {
    ...(task.params ?? {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.imageSize ? { size: task.imageSize } : {}),
    ...(task.visualStyleKey ? { visualStyleKey: task.visualStyleKey } : {}),
  }
}

function imageGenerationParameters(input: ImageGenerationSubmitInput): Record<string, unknown> {
  return {
    prompt: input.prompt.trim(),
    ...(input.promptContent?.length ? { promptContent: input.promptContent } : {}),
    ...(input.size ? { size: input.size } : {}),
    ...(input.visualStyleKey ? { visualStyleKey: input.visualStyleKey } : {}),
  }
}
