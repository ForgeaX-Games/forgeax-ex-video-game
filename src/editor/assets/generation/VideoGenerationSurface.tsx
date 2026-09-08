import { useEffect, useMemo, useRef, useState } from 'react'
import generationFrameIcon from '@/editor/ui-assets/video-generation-frame.svg?url'
import generationFrameRemoveIcon from '@/editor/ui-assets/video-generation-frame-remove.svg?url'
import generationEmptyIcon from '@/editor/ui-assets/video-generation-empty.svg?url'
import generationStyleSwapIcon from '@/editor/ui-assets/video-generation-style-swap.svg?url'
import generationUndoIcon from '@/editor/ui-assets/video-generation-undo.svg?url'
import generationSendIcon from '@/editor/ui-assets/video-generation-send.svg?url'
import { useT } from '../../../i18n'
import type { KinoPromptContentItem, KinoVideoGenerationParams } from '@/runtime/core/schema/kino-schema'
import {
  KINO_VIDEO_MAX_DURATION_SECONDS,
  KINO_VIDEO_MIN_DURATION_SECONDS,
} from '@/runtime/core/schema/kino-schema'
import type { ClipGenState } from './useClipGeneration'
import type { ClipGenerationRequest } from './generation-api'
import {
  GenerationDialog,
  GenerationHistoryList,
  GenerationPageLayout,
  GenerationPromptComposer,
  GenerationPreviewFrame,
  GenerationSurface,
  GenerationSurfaceComposer,
  GenerationSurfaceHistory,
  GenerationSurfaceParameters,
  GenerationSurfacePreview,
  VideoParameters,
  VideoPreview,
  adaptVideoAsset,
  type GenerationInteractionState,
  type VideoGenerationParameterValue,
} from './components'
import {
  VgenImagePicker,
  type VgenImageAsset,
} from './VgenImagePicker'
import type { KinoVisualStylePreset } from './visual-style-api'
import { listVideoVisualStyles } from './visual-style-api'
import { VisualStylePicker } from './VisualStylePicker'
import type { PromptMentionAsset } from './PromptMentionEditor'
import {
  isPromptPolishUnavailableError,
  polishVideoPrompt,
} from './prompt-polish-api'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { VGEN_CSS } from './vgenStyles'
import { ensureGenerationComponentsStyles } from './generationComponentsStyles'
import { useGenerationResultSelection } from './components/history/useGenerationResultSelection'

injectStyleOnce('game-video-vgen', VGEN_CSS)
ensureGenerationComponentsStyles()

export type VideoGenerationMode = ClipGenerationRequest['mode']

export interface RecentGeneratedClip {
  id: string
  generationId?: string
  resourceId?: string
  label: string
  createdAt: number
  status: 'generating' | 'ready' | 'failed'
  posterUrl?: string
  playbackUrl?: string
  prompt?: string
  model?: string
  params?: Record<string, unknown>
  durationSeconds?: number
  mode?: VideoGenerationMode
  size?: KinoVideoGenerationParams['size']
  resolution?: KinoVideoGenerationParams['resolution']
  generateAudio?: boolean
  firstFrameResourceId?: string
  lastFrameResourceId?: string
  referenceImageResourceIds?: string[]
  visualStyleKey?: string
}

export type VideoGenerationInitialValues = Partial<Omit<KinoVideoGenerationParams, 'promptContent'>> & {
  promptContent?: KinoPromptContentItem[]
}

export interface VideoGenerationSurfaceProps {
  open: boolean
  layout: 'page' | 'dialog'
  gameSlug: string
  imageAssets: readonly VgenImageAsset[]
  recentClips: readonly RecentGeneratedClip[]
  mentionAssets?: readonly PromptMentionAsset[]
  genState: ClipGenState
  availableModels?: readonly string[]
  initialValues?: VideoGenerationInitialValues
  /** Manifest video to show as the restored completed result while no Kino task is active. */
  initialResultAssetId?: string
  resetKey?: string | number
  submissionError?: string | null
  interaction?: Partial<Pick<GenerationInteractionState, 'disabled' | 'readOnly'>>
  generationDisabledReason?: string
  /** Current entity version. Newly generated results are applied by the workspace adapter. */
  appliedAssetId?: string
  /** Explicitly applies the currently previewed historical result. */
  onApplyResult?: (assetId: string) => Promise<void>
  onSubmit: (request: ClipGenerationRequest) => void
  onCancel: () => void
  onTrack: (generationId: string) => void
  onClose: () => void
  loadVisualStyles?: () => Promise<readonly KinoVisualStylePreset[]>
  polishPrompt?: (prompt: string) => Promise<string>
}

type PickerTarget = 'first' | 'last'
type EditableVideoGenerationMode = Exclude<VideoGenerationMode, 'ref'>
type ValidationErrors = Partial<Record<'prompt' | 'frames' | 'first', string>>

const DEFAULT_PARAMS: VideoGenerationParameterValue = {
  mode: 't2v',
  durationSeconds: 5,
  size: '2560x1440',
  resolution: '720p',
  generateAudio: true,
}
const EMPTY_MODELS: readonly string[] = []

function defaultParameters(layout: 'page' | 'dialog'): VideoGenerationParameterValue {
  return layout === 'page'
    ? { ...DEFAULT_PARAMS }
    : { ...DEFAULT_PARAMS, mode: 'strict', durationSeconds: 8, generateAudio: false }
}

export function VideoGenerationSurface({
  open,
  layout,
  gameSlug,
  imageAssets,
  recentClips,
  mentionAssets: projectMentionAssets,
  genState,
  availableModels = EMPTY_MODELS,
  initialValues,
  initialResultAssetId,
  resetKey,
  submissionError,
  interaction,
  generationDisabledReason,
  appliedAssetId,
  onApplyResult,
  onSubmit,
  onCancel,
  onTrack,
  onClose,
  loadVisualStyles = listVideoVisualStyles,
  polishPrompt = polishVideoPrompt,
}: VideoGenerationSurfaceProps): React.JSX.Element | null {
  const t = useT()
  const modelOptions = useMemo(
    () => [...new Set([
      ...availableModels,
      ...(initialValues?.model ? [initialValues.model] : []),
    ].map((item) => item.trim()).filter(Boolean))],
    [availableModels, initialValues?.model],
  )
  const initialValuesKey = JSON.stringify(initialValues ?? {})
  const initialValuesRef = useRef(initialValues)
  initialValuesRef.current = initialValues
  const imageAssetsRef = useRef(imageAssets)
  imageAssetsRef.current = imageAssets
  const pendingInitialFirstFrameRef = useRef<string | undefined>()
  const pendingInitialLastFrameRef = useRef<string | undefined>()
  const styleValidationIdRef = useRef(0)
  const polishRequestIdRef = useRef(0)
  const promptRevisionRef = useRef(0)
  const pendingSubmissionRef = useRef<{ prompt: string, content: readonly KinoPromptContentItem[] } | null>(null)
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? '')
  // PromptMentionEditor cannot hydrate structured chips from initial values;
  // only visible prompt text is restored, so submit state starts empty.
  const [promptContent, setPromptContent] = useState<KinoPromptContentItem[]>([])
  const [promptResetRevision, setPromptResetRevision] = useState(0)
  const [parameters, setParameters] = useState<VideoGenerationParameterValue>(() => ({
    ...defaultParameters(layout),
    ...initialValues,
    mode: editableMode(initialValues?.mode ?? defaultParameters(layout).mode),
  }))
  const [visualStyleKey, setVisualStyleKey] = useState(initialValues?.visualStyleKey ?? '')
  const [prefilledReferenceImageResourceIds, setPrefilledReferenceImageResourceIds] = useState<readonly string[]>(
    () => [...(initialValues?.referenceImageResourceIds ?? [])],
  )
  const [firstFrame, setFirstFrame] = useState<VgenImageAsset | null>(null)
  const [lastFrame, setLastFrame] = useState<VgenImageAsset | null>(null)
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const [pickerUploading, setPickerUploading] = useState(false)
  const [visualStyles, setVisualStyles] = useState<readonly KinoVisualStylePreset[]>([])
  const [visualStylesLoading, setVisualStylesLoading] = useState(false)
  const [visualStylesError, setVisualStylesError] = useState<string | null>(null)
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const [errors, setErrors] = useState<ValidationErrors>({})
  const [polishError, setPolishError] = useState<string | null>(null)
  const resultSelection = useGenerationResultSelection({
    appliedAssetId,
    resetKey: JSON.stringify([initialResultAssetId, initialValuesKey, layout, open, resetKey]),
    onApplyResult,
  })

  const generationActive = genState.phase === 'submitting' || genState.phase === 'generating'
  // A task is durable once Kino returns its generation id. From that point the
  // Catalog tracker owns its progress, so the composer can start another task.
  // Only the create request itself stays exclusive to prevent duplicate POSTs.
  const submissionBusy = genState.phase === 'submitting'
  const formInteraction = {
    busy: submissionBusy,
    disabled: interaction?.disabled ?? false,
    readOnly: interaction?.readOnly ?? false,
  }
  const previewInteraction = { ...formInteraction, busy: generationActive }
  const formDisabled = formInteraction.disabled || formInteraction.readOnly || submissionBusy
  const submitDisabledReason = submissionBusy
    ? t('videoAssets.generate.submitUnavailable.running')
    : formInteraction.disabled
      ? generationDisabledReason ?? t('videoAssets.generate.submitUnavailable.disabled')
      : formInteraction.readOnly
        ? t('videoAssets.generate.submitUnavailable.readOnly')
        : !prompt.trim()
          ? t('videoAssets.generate.validation.needPrompt')
          : t('videoAssets.generate.submitUnavailable.polishing')
  const selectedStyle = visualStyles.find((style) => style.key === visualStyleKey)
  const fallbackMentionAssets = useMemo<PromptMentionAsset[]>(() => {
    const items: PromptMentionAsset[] = imageAssets.flatMap((asset) => asset.resourceId ? [{
      id: asset.id,
      resourceId: asset.resourceId,
      label: asset.label,
      category: asset.kind === 'character_ref' ? 'character' : asset.kind === 'scene_ref' ? 'scene' : 'image',
      ...(asset.thumbUrl ? { thumbUrl: asset.thumbUrl } : {}),
    }] : [])
    for (const clip of recentClips) {
      if (clip.status !== 'ready' || !clip.resourceId) continue
      items.push({
        id: clip.id,
        resourceId: clip.resourceId,
        label: clip.label,
        ...(clip.posterUrl ? { thumbUrl: clip.posterUrl } : {}),
        ...(clip.playbackUrl ? { mediaUrl: clip.playbackUrl } : {}),
        ...(clip.prompt ? { prompt: clip.prompt } : {}),
        category: 'video',
      })
    }
    return [...new Map(items.map((asset) => [asset.resourceId, asset])).values()]
  }, [imageAssets, recentClips])
  const mentionAssets = projectMentionAssets ?? fallbackMentionAssets
  const prefilledReferenceAssets = useMemo(() => {
    const assetsByResourceId = new Map(mentionAssets.flatMap((asset) => (
      asset.resourceId ? [[asset.resourceId, asset] as const] : []
    )))
    return prefilledReferenceImageResourceIds.map((resourceId) => ({
      resourceId,
      asset: assetsByResourceId.get(resourceId),
    }))
  }, [mentionAssets, prefilledReferenceImageResourceIds])

  const validateVisualStyle = (candidate: string): void => {
    const requestId = ++styleValidationIdRef.current
    if (!candidate) {
      setVisualStyleKey('')
      return
    }
    if (visualStyles.length > 0) {
      setVisualStyleKey(visualStyles.some((style) => style.key === candidate) ? candidate : '')
      return
    }
    setVisualStylesLoading(true)
    setVisualStylesError(null)
    void loadVisualStyles().then((items) => {
      if (styleValidationIdRef.current !== requestId) return
      setVisualStyles(items)
      setVisualStyleKey(items.some((style) => style.key === candidate) ? candidate : '')
    }, (error: unknown) => {
      if (styleValidationIdRef.current !== requestId) return
      setVisualStylesError(error instanceof Error ? error.message : String(error))
      setVisualStyleKey('')
    }).finally(() => {
      if (styleValidationIdRef.current === requestId) setVisualStylesLoading(false)
    })
  }

  useEffect(() => {
    if (!open) return
    const values = initialValuesRef.current ?? {}
    promptRevisionRef.current += 1
    polishRequestIdRef.current += 1
    const defaults = defaultParameters(layout)
    setPrompt(values.prompt ?? '')
    setPromptContent([])
    pendingSubmissionRef.current = null
    setParameters({ ...defaults, ...values, mode: editableMode(values.mode ?? defaults.mode) })
    setPrefilledReferenceImageResourceIds([...(values.referenceImageResourceIds ?? [])])
    const initialFirstFrame = findImageAsset(imageAssetsRef.current, values.firstFrameResourceId)
    const initialLastFrame = findImageAsset(imageAssetsRef.current, values.lastFrameResourceId)
    setFirstFrame(initialFirstFrame)
    setLastFrame(initialLastFrame)
    pendingInitialFirstFrameRef.current = initialFirstFrame ? undefined : values.firstFrameResourceId
    pendingInitialLastFrameRef.current = initialLastFrame ? undefined : values.lastFrameResourceId
    validateVisualStyle(values.visualStyleKey ?? '')
    setErrors({})
    setPickerTarget(null)
    setStylePickerOpen(false)
    setPolishError(null)
  }, [initialResultAssetId, initialValuesKey, layout, open, resetKey])

  useEffect(() => {
    if (!open) return
    const firstFrameResourceId = pendingInitialFirstFrameRef.current
    const initialFirstFrame = findImageAsset(imageAssets, firstFrameResourceId)
    if (initialFirstFrame) {
      pendingInitialFirstFrameRef.current = undefined
      setFirstFrame((current) => current ?? initialFirstFrame)
    }
    const lastFrameResourceId = pendingInitialLastFrameRef.current
    const initialLastFrame = findImageAsset(imageAssets, lastFrameResourceId)
    if (initialLastFrame) {
      pendingInitialLastFrameRef.current = undefined
      setLastFrame((current) => current ?? initialLastFrame)
    }
  }, [imageAssets, open])

  useEffect(() => {
    setParameters((current) => {
      if (current.model && modelOptions.includes(current.model)) return current
      const nextModel = initialValuesRef.current?.model ?? (modelOptions.length === 1 ? modelOptions[0] : undefined)
      if (current.model === nextModel) return current
      return { ...current, model: nextModel }
    })
  }, [modelOptions])

  useEffect(() => {
    if (!open || (pickerTarget === null && !stylePickerOpen)) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (pickerTarget !== null && !pickerUploading) {
        setPickerTarget(null)
      } else {
        setStylePickerOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, pickerTarget, pickerUploading, stylePickerOpen])

  useEffect(() => {
    if (!formDisabled) return
    setStylePickerOpen(false)
    // Uploading owns its lifecycle and must not be unmounted mid-request. Once
    // it settles, this effect closes the picker before it can mutate the form.
    if (!pickerUploading) setPickerTarget(null)
  }, [formDisabled, pickerUploading])

  useEffect(() => {
    if (!open || resultSelection.selectedAssetId || !genState.generationId || genState.prompt === undefined) return
    const pendingSubmission = pendingSubmissionRef.current
    if (pendingSubmission?.prompt === genState.prompt) {
      pendingSubmissionRef.current = null
      return
    }
    promptRevisionRef.current += 1
    polishRequestIdRef.current += 1
    setPromptResetRevision((current) => current + 1)
    setPrompt(genState.prompt)
    // PromptMentionEditor cannot hydrate structured chips. A tracked task
    // therefore starts with its visible plain text only; stale
    // content from the previously selected task must never leak into submit.
    setPromptContent([])
  }, [genState.generationId, genState.prompt, open, resultSelection.selectedAssetId])

  const openStyles = (): void => {
    if (formDisabled) return
    setStylePickerOpen(true)
    if (visualStyles.length > 0 || visualStylesLoading) return
    const requestId = ++styleValidationIdRef.current
    setVisualStylesLoading(true)
    setVisualStylesError(null)
    void loadVisualStyles().then((items) => {
      if (styleValidationIdRef.current !== requestId) return
      setVisualStyles(items)
      setVisualStyleKey((current) => current && items.some((style) => style.key === current) ? current : '')
    }, (error: unknown) => {
      if (styleValidationIdRef.current !== requestId) return
      setVisualStylesError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (styleValidationIdRef.current === requestId) setVisualStylesLoading(false)
    })
  }

  const historyItems = useMemo(() => {
    return recentClips.map((clip) => adaptVideoAsset({
      ...clip,
      status: clip.status === 'ready' ? 'succeeded' : clip.status === 'generating' ? 'polling' : 'failed',
    }))
      .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
  }, [recentClips])
  const showHistory = historyItems.length > 0

  const restoredResultAssetId = resultSelection.selectedAssetId
    ?? (genState.phase === 'idle' ? initialResultAssetId : undefined)
  const restoredClip = restoredResultAssetId
    ? recentClips.find((clip) => clip.id === restoredResultAssetId)
    : undefined
  const historySelectionActive = Boolean(resultSelection.selectedAssetId && restoredClip)
  const selectedClip = restoredClip ?? recentClips.find((clip) => (
    (genState.assetId && clip.id === genState.assetId)
      || (genState.resourceId && clip.resourceId === genState.resourceId)
  ))
  const generationOwnsPreview = !historySelectionActive
  const selectedResult = genState.resultUrl || genState.resourceId || genState.assetId || selectedClip
    ? {
        id: generationOwnsPreview
          ? genState.assetId ?? selectedClip?.id ?? genState.resourceId ?? genState.generationId ?? 'generation'
          : selectedClip?.id ?? 'generation',
        assetKind: 'video' as const,
        media: 'video' as const,
        resourceId: generationOwnsPreview
          ? genState.resourceId ?? selectedClip?.resourceId ?? genState.assetId
          : selectedClip?.resourceId,
        url: generationOwnsPreview
          ? genState.resultUrl ?? selectedClip?.playbackUrl
          : selectedClip?.playbackUrl,
        posterUrl: selectedClip?.posterUrl,
        label: generationOwnsPreview ? genState.prompt ?? selectedClip?.label : selectedClip?.label,
      }
    : undefined
  const restoredResultSelected = Boolean(restoredResultAssetId && selectedClip)
  const selectedHistoryGenerationId = historySelectionActive
    ? selectedClip?.generationId ?? selectedClip?.id
    : genState.generationId ?? selectedClip?.generationId ?? selectedClip?.id
  const phase = restoredResultSelected
    ? 'succeeded'
    : genState.phase === 'submitting'
      ? 'submitting'
      : genState.phase === 'generating'
        ? 'generating'
        : genState.phase
  const status = genState.phase === 'succeeded' || restoredResultSelected
    ? t('videoAssets.generate.statusDone')
    : genState.phase === 'failed'
      ? t('videoAssets.generate.statusFailed')
      : generationActive
        ? t('videoAssets.generate.statusRunning')
        : t('videoAssets.generate.statusIdle')

  const submit = (nextPrompt: string, nextContent: KinoPromptContentItem[]): void => {
    if (formDisabled) return
    const mode = editableMode(parameters.mode ?? 't2v')
    const nextErrors: ValidationErrors = {}
    const textPresent = nextContent.some((item) => item.type === 'text' && item.text.trim()) || nextPrompt.trim().length > 0
    if (!textPresent) nextErrors.prompt = t('videoAssets.generate.validation.needPrompt')
    if (mode === 'strict' && (!firstFrame?.resourceId || !lastFrame?.resourceId)) nextErrors.frames = t('videoAssets.generate.validation.needFirstLast')
    if (mode === 'firstref' && !firstFrame?.resourceId) nextErrors.first = t('videoAssets.generate.validation.needFirst')
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    resultSelection.clearSelection()
    pendingSubmissionRef.current = { prompt: nextPrompt.trim(), content: [...nextContent] }
    onSubmit({
      gameSlug,
      prompt: nextPrompt.trim(),
      promptContent: nextContent.length ? nextContent : undefined,
      mode,
      durationSeconds: Math.min(
        KINO_VIDEO_MAX_DURATION_SECONDS,
        Math.max(KINO_VIDEO_MIN_DURATION_SECONDS, Math.round(parameters.durationSeconds ?? 5)),
      ),
      generateAudio: Boolean(parameters.generateAudio),
      ...(parameters.model ? { model: parameters.model } : {}),
      ...(parameters.size ? { size: parameters.size } : {}),
      ...(parameters.resolution ? { resolution: parameters.resolution } : {}),
      ...(visualStyleKey ? { visualStyleKey } : {}),
      ...(mode === 'strict' || mode === 'firstref' ? firstFrame?.resourceId ? { firstFrameResourceId: firstFrame.resourceId } : {} : {}),
      ...(mode === 'strict' ? lastFrame?.resourceId ? { lastFrameResourceId: lastFrame.resourceId } : {} : {}),
      ...(prefilledReferenceImageResourceIds.length > 0
        ? { referenceImageResourceIds: [...prefilledReferenceImageResourceIds] }
        : {}),
    })
  }

  const promptSlot = (
    <GenerationPromptComposer
      value={prompt}
      content={promptContent}
      assets={mentionAssets}
      onChange={(nextPrompt, nextContent) => {
        promptRevisionRef.current += 1
        setPrompt(nextPrompt)
        setPromptContent(nextContent)
        setPolishError(null)
      }}
      onSubmit={submit}
      onCancel={onCancel}
      onClear={() => {
        promptRevisionRef.current += 1
        setPrompt('')
        setPromptContent([])
      }}
      polishPrompt={async (value) => {
        const requestId = ++polishRequestIdRef.current
        const sourceRevision = promptRevisionRef.current
        try { return await polishPrompt(value) } catch (error) {
          if (polishRequestIdRef.current !== requestId || promptRevisionRef.current !== sourceRevision) return value
          setPolishError(t(isPromptPolishUnavailableError(error) ? 'videoAssets.generate.polishUnavailable' : 'videoAssets.generate.polishFailed'))
          return value
        }
      }}
      onOpenStylePicker={openStyles}
      selectedStyle={selectedStyle ? { key: selectedStyle.key, label: selectedStyle.label } : null}
      styleLabel={t('videoAssets.generate.style')}
      styleIcon={<span className="vgen-style-swap" aria-hidden><img src={generationStyleSwapIcon} alt="" /></span>}
      clearIcon={<img src={generationUndoIcon} alt="" />}
      cancelIcon={<img src={generationUndoIcon} alt="" />}
      submitIcon={<img src={generationSendIcon} alt="" />}
      prefix={prefilledReferenceAssets.length > 0 ? (
        <div className="vgen-prefilled-reference-list" role="group" aria-label={t('videoAssets.generate.nodeReferences')}>
          {prefilledReferenceAssets.map(({ resourceId, asset }) => (
            <span
              key={resourceId}
              className={`vgen-mention-chip vgen-prefilled-reference${asset ? '' : ' is-missing is-orphaned'}`}
              data-resource-id={resourceId}
              title={asset?.label ?? resourceId}
            >
              {asset?.thumbUrl
                ? <img className="vgen-mention-chip-thumb" src={asset.thumbUrl} alt="" />
                : <span className="vgen-mention-chip-thumb is-placeholder" aria-hidden />}
              <span className="vgen-mention-at">@</span>
              <span className="vgen-mention-name">{asset?.label ?? resourceId}</span>
              <button
                type="button"
                disabled={formDisabled}
                aria-label={t('videoAssets.generate.removeNodeReference')}
                title={t('videoAssets.generate.removeNodeReference')}
                onClick={() => setPrefilledReferenceImageResourceIds((current) => (
                  current.filter((candidate) => candidate !== resourceId)
                ))}
              />
            </span>
          ))}
        </div>
      ) : undefined}
      interaction={formInteraction}
      resetKey={`${String(resetKey)}:${promptResetRevision}`}
      label={t('videoAssets.generate.prompt')}
      placeholder={t('videoAssets.generate.promptPlaceholder')}
      mentionLabel={t('videoAssets.generate.mentionAssets')}
      mentionEmptyLabel={t('videoAssets.generate.mentionEmpty')}
      mentionPresentation="dialog"
      mentionButtonLabel={t('videoAssets.generate.mentionButton')}
      submitLabel={submissionBusy ? t('videoAssets.generate.submitRunning') : t('videoAssets.generate.submit')}
      submitDisabledReason={submitDisabledReason}
      cancelLabel={t('videoAssets.generate.cancel')}
      clearLabel={t('videoAssets.generate.clearPrompt')}
      polishLabel={t('videoAssets.generate.polishPrompt')}
      polishingLabel={t('videoAssets.generate.polishingPrompt')}
      top={<>
        {layout === 'page' ? <ModeTabs mode={parameters.mode ?? 't2v'} disabled={formDisabled} onChange={(mode) => {
          setParameters((current) => ({ ...current, mode }))
          setErrors({})
        }} /> : null}
        <ReferenceStrip
          mode={editableMode(parameters.mode ?? 't2v')}
          firstFrame={firstFrame}
          lastFrame={lastFrame}
          interaction={formInteraction}
          onPick={(target) => setPickerTarget(target)}
          onRemove={(target) => {
            if (target === 'first') {
              pendingInitialFirstFrameRef.current = undefined
              setFirstFrame(null)
            } else {
              pendingInitialLastFrameRef.current = undefined
              setLastFrame(null)
            }
          }}
          onSwapFrames={() => {
            pendingInitialFirstFrameRef.current = undefined
            pendingInitialLastFrameRef.current = undefined
            setFirstFrame(lastFrame)
            setLastFrame(firstFrame)
          }}
        />
      </>}
    >
      {layout === 'page' ? <label className="vgen-audio-toggle">
        <span className="vgen-audio-label">{t('videoAssets.generate.audio')}</span>
        <input type="checkbox" checked={Boolean(parameters.generateAudio)} disabled={formDisabled} onChange={(event) => setParameters((current) => ({ ...current, generateAudio: event.target.checked }))} />
        <span className="vgen-audio-switch" aria-hidden />
      </label> : null}
    </GenerationPromptComposer>
  )

  const surface = (
    <GenerationPageLayout className={`vgen-generation-layout${layout === 'page' ? ' is-page' : ''}`}>
      <GenerationSurface className={`vgen-generation-surface${layout === 'page' ? ` vgen-design-workspace${showHistory ? ' has-history' : ''}` : ''}`}>
        <GenerationSurfaceParameters className={`vgen-generation-parameters${layout === 'page' ? ' vgen-settings' : ''}`}>
          <VideoParameters value={parameters} modelOptions={modelOptions} onChange={setParameters} showMode={layout !== 'page'} showAudio={layout !== 'page'} interaction={formInteraction} />
          {errors.frames || errors.first ? <p className="vgen-tip error" role="alert">{errors.frames ?? errors.first}</p> : null}
        </GenerationSurfaceParameters>
        <GenerationSurfacePreview className={layout === 'page' ? 'vgen-preview-stage' : undefined}>
          <GenerationPreviewFrame phase={phase} interaction={previewInteraction} ariaLabel={t('videoAssets.generate.output')} statusLabel={status} error={genState.error} showFooter={!selectedResult?.url || Boolean(genState.error)}>
            {selectedResult?.url ? <VideoPreview
              asset={selectedResult}
              src={selectedResult.url}
              interaction={previewInteraction}
              showFooter={false}
              applying={selectedResult.id === resultSelection.applyingAssetId}
              applyError={resultSelection.applyError}
              onApply={resultSelection.canApply(selectedResult.id)
                ? (asset) => resultSelection.apply(asset.id)
                : undefined}
            /> : (
              <div className={`vgen-generation-empty${generationActive ? ' is-running' : ''}`}>
                <img src={generationEmptyIcon} alt="" />
                <p>{generationActive ? t('videoAssets.generate.outputRunning') : t('videoAssets.generate.outputIdle')}</p>
                {generationActive ? <div className="vgen-out-progress" role="progressbar" aria-label={t('videoAssets.generate.submitRunning')}><div className="fill" /></div> : null}
              </div>
            )}
          </GenerationPreviewFrame>
        </GenerationSurfacePreview>
        {showHistory ? <GenerationSurfaceHistory className={layout === 'page' ? 'vgen-page-history' : undefined}>
          <div className="vgen-generation-history-head"><strong>{t('videoAssets.generate.history')}</strong><span>{historyItems.length}</span></div>
          <GenerationHistoryList items={historyItems} loading={false} selectedGenerationId={selectedHistoryGenerationId} ariaLabel={t('videoAssets.generate.history')} interaction={formInteraction} onInspect={(item) => {
            if (item.status === 'pending' || item.status === 'submitting' || item.status === 'polling') {
              resultSelection.clearSelection()
              onTrack(item.generationId)
            } else {
              resultSelection.selectAsset(item.id)
            }
          }} onSelectResult={(item) => {
            resultSelection.selectAsset(item.id)
          }} />
        </GenerationSurfaceHistory> : null}
        <GenerationSurfaceComposer className={layout === 'page' ? 'vgen-composer' : undefined}>
          {submissionError ? <p className="vgen-tip error" role="alert">{submissionError}</p> : null}
          {errors.prompt ? <p className="vgen-tip error" role="alert">{errors.prompt}</p> : null}
          {polishError ? <p className="vgen-tip error" role="alert">{polishError}</p> : null}
          {promptSlot}
        </GenerationSurfaceComposer>
      </GenerationSurface>
    </GenerationPageLayout>
  )

  const overlays = <>
    <VgenImagePicker
      open={pickerTarget !== null}
      gameSlug={gameSlug}
      imageAssets={imageAssets}
      requireResourceId
      onPick={(asset) => {
        if (formDisabled) {
          setPickerTarget(null)
          setPickerUploading(false)
          return
        }
        if (pickerTarget === 'first') {
          pendingInitialFirstFrameRef.current = undefined
          setFirstFrame(asset)
        } else if (pickerTarget === 'last') {
          pendingInitialLastFrameRef.current = undefined
          setLastFrame(asset)
        }
        setPickerTarget(null)
        setPickerUploading(false)
      }}
      onClose={() => setPickerTarget(null)}
      onUploadingChange={setPickerUploading}
    />
    <VisualStylePicker
      open={stylePickerOpen}
      styles={visualStyles}
      loading={visualStylesLoading}
      error={visualStylesError}
      selectedKey={visualStyleKey || undefined}
      onSelect={(style) => {
        if (!formDisabled) setVisualStyleKey(style.key)
        setStylePickerOpen(false)
      }}
      onClose={() => setStylePickerOpen(false)}
      t={t}
    />
  </>

  if (!open) return null
  if (layout === 'page') return <>{surface}{overlays}</>
  return <GenerationDialog open title={t('videoAssets.generate.title')} onClose={onClose} closeLabel={t('videoAssets.generate.close')} dismissBlocked={pickerTarget !== null || pickerUploading || stylePickerOpen} panelClassName="vgen-generation-dialog">{surface}{overlays}</GenerationDialog>
}

function findImageAsset(assets: readonly VgenImageAsset[], resourceId: string | undefined): VgenImageAsset | null {
  return resourceId ? assets.find((asset) => asset.resourceId === resourceId) ?? null : null
}

function ModeTabs({
  mode,
  disabled,
  onChange,
}: {
  mode: VideoGenerationMode
  disabled: boolean
  onChange: (mode: VideoGenerationMode) => void
}): React.JSX.Element {
  const t = useT()
  const modes: readonly EditableVideoGenerationMode[] = ['t2v', 'firstref', 'strict']
  return <div className="vgen-mode-tabs" role="tablist" aria-label={t('videoAssets.generate.modeLabel')}>
    {modes.map((option) => <button
      key={option}
      type="button"
      aria-pressed={mode === option}
      className={mode === option ? 'is-on' : ''}
      disabled={disabled}
      onClick={() => onChange(option)}
    >
      {t(`videoAssets.generate.mode.${option}`)}
    </button>)}
  </div>
}

function ReferenceStrip({
  mode,
  firstFrame,
  lastFrame,
  interaction,
  onPick,
  onRemove,
  onSwapFrames,
}: {
  mode: VideoGenerationMode
  firstFrame: VgenImageAsset | null
  lastFrame: VgenImageAsset | null
  interaction?: { busy: boolean, disabled?: boolean, readOnly?: boolean }
  onPick: (target: PickerTarget) => void
  onRemove: (target: PickerTarget) => void
  onSwapFrames: () => void
}): React.JSX.Element {
  const t = useT()
  const inert = Boolean(interaction?.busy || interaction?.disabled || interaction?.readOnly)
  return <div className="vgen-generation-references vgen-media-row">
    {mode === 'strict' ? <div className="vgen-frame-sequence">
      <FrameButton asset={firstFrame} label={t('videoAssets.generate.firstFrame')} removeLabel={t('videoAssets.generate.removeFirstFrame')} disabled={inert} onClick={() => { if (!inert) onPick('first') }} onRemove={() => { if (!inert) onRemove('first') }} />
      <button type="button" className="vgen-frame-swap" aria-label={t('videoAssets.generate.swapFrames')} disabled={inert || (!firstFrame && !lastFrame)} onClick={() => { if (!inert) onSwapFrames() }}><img src={generationStyleSwapIcon} alt="" /></button>
      <FrameButton asset={lastFrame} label={t('videoAssets.generate.lastFrame')} removeLabel={t('videoAssets.generate.removeLastFrame')} disabled={inert} onClick={() => { if (!inert) onPick('last') }} onRemove={() => { if (!inert) onRemove('last') }} />
    </div> : null}
    {mode === 'firstref' ? <FrameButton asset={firstFrame} label={t('videoAssets.generate.firstFrame')} removeLabel={t('videoAssets.generate.removeFirstFrame')} disabled={inert} onClick={() => { if (!inert) onPick('first') }} onRemove={() => { if (!inert) onRemove('first') }} /> : null}
  </div>
}

function editableMode(mode: VideoGenerationMode | undefined): EditableVideoGenerationMode {
  if (!mode) return 't2v'
  return mode === 'ref' ? 't2v' : mode
}

function FrameButton({ asset, label, removeLabel, onClick, onRemove, disabled = false }: { asset: VgenImageAsset | null, label: string, removeLabel: string, onClick: () => void, onRemove: () => void, disabled?: boolean }): React.JSX.Element {
  return <div className="vgen-frame-input">
    <button type="button" className={`vgen-frame-tile${asset ? ' has-image' : ''}`} style={asset?.thumbUrl ? { backgroundImage: `url(${JSON.stringify(asset.thumbUrl)})` } : undefined} aria-label={label} disabled={disabled} onClick={onClick}>{asset ? asset.label : <><img src={generationFrameIcon} alt="" /><span>{label}</span></>}</button>
    {asset ? <button type="button" className="vgen-frame-remove" aria-label={removeLabel} title={removeLabel} disabled={disabled} onClick={onRemove}><img src={generationFrameRemoveIcon} alt="" /></button> : null}
  </div>
}
