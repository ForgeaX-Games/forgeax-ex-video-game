import { useEffect, useMemo, useState } from 'react'
import generationEmptyIcon from '@/editor/ui-assets/video-generation-empty.svg?url'
import generationStyleSwapIcon from '@/editor/ui-assets/video-generation-style-swap.svg?url'
import generationUndoIcon from '@/editor/ui-assets/video-generation-undo.svg?url'
import generationSendIcon from '@/editor/ui-assets/video-generation-send.svg?url'
import { useT } from '../../../i18n'
import type { KinoGenerationTask, KinoPromptContentItem } from './generation-api'
import {
  CharacterParameters,
  CharacterPreview,
  ControlParameters,
  ControlPreview,
  GenerationHistoryList,
  GenerationDialog,
  GenerationPageLayout,
  GenerationPromptComposer,
  GenerationPreviewFrame,
  GenerationSurface,
  GenerationSurfaceComposer,
  GenerationSurfaceHistory,
  GenerationSurfaceParameters,
  GenerationSurfacePreview,
  IconParameters,
  IconPreview,
  ImageParameters,
  ImagePreview,
  SceneParameters,
  ScenePreview,
  adaptImageAsset,
  adaptImageKinoTask,
  type GenerationHistoryItemData,
  type ImageGenerationAssetKind,
} from './components'
import type { ImageGenerationState, ImageGenerationSubmitInput } from './useImageGeneration'
import type { KinoVisualStylePreset } from './visual-style-api'
import { VisualStylePicker } from './VisualStylePicker'
import type { KinoImageSize } from '@/runtime/core/schema/kino-image-schema'
import type { PromptMentionAsset } from './PromptMentionEditor'
import { polishVideoPrompt } from './prompt-polish-api'
import { ensureImageGenerationSurfaceStyles } from './imageGenerationSurfaceStyles'
import { ensureGenerationComponentsStyles } from './generationComponentsStyles'
import { useGenerationResultSelection } from './components/history/useGenerationResultSelection'

ensureImageGenerationSurfaceStyles()
ensureGenerationComponentsStyles()

export interface ImageGenerationAsset {
  id: string
  resourceId?: string
  generationId?: string
  label: string
  url?: string
  prompt?: string
  model?: string
  params?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
  status?: KinoGenerationTask['status']
}

export interface ImageGenerationInitialValues {
  prompt?: string
  model?: string
  size?: KinoImageSize
  visualStyleKey?: string
}

export interface ImageGenerationSurfaceProps {
  open: boolean
  layout: 'page' | 'dialog'
  targetRoot?: ImageGenerationAssetKind
  imageAssets?: readonly ImageGenerationAsset[]
  historyAssets?: readonly ImageGenerationAsset[]
  mentionAssets?: readonly PromptMentionAsset[]
  visualStyles: readonly KinoVisualStylePreset[]
  visualStylesLoading?: boolean
  visualStylesError?: string | null
  onRequestVisualStyles?: () => void
  state: ImageGenerationState
  initialValues?: ImageGenerationInitialValues
  initialHistoryAssetId?: string
  resetKey?: string | number
  onSubmit: (input: ImageGenerationSubmitInput) => void
  onStopWaiting: () => void
  appliedAssetId?: string
  onApplyResult?: (assetId: string) => Promise<void>
  onClose: () => void
  polishPrompt?: (prompt: string) => Promise<string>
}

const DEFAULT_SIZE: KinoImageSize = '2560x1440'
const EMPTY_IMAGE_ASSETS: readonly ImageGenerationAsset[] = []

/**
 * Image generation composition.  The data-connected workspace owns request
 * state; this component only maps that state to the shared surface atoms.
 */
export function ImageGenerationSurface({
  open,
  layout,
  targetRoot = 'image',
  imageAssets = EMPTY_IMAGE_ASSETS,
  historyAssets = imageAssets,
  mentionAssets: projectMentionAssets,
  visualStyles,
  visualStylesLoading = false,
  visualStylesError,
  onRequestVisualStyles,
  state,
  initialValues,
  initialHistoryAssetId,
  resetKey,
  onSubmit,
  onStopWaiting,
  appliedAssetId,
  onApplyResult,
  onClose,
  polishPrompt = polishVideoPrompt,
}: ImageGenerationSurfaceProps): React.JSX.Element | null {
  const t = useT()
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? '')
  const [promptContent, setPromptContent] = useState<KinoPromptContentItem[]>([])
  const [promptResetRevision, setPromptResetRevision] = useState(0)
  const [parameters, setParameters] = useState<{ model?: string, size?: KinoImageSize }>({
    model: initialValues?.model,
    size: initialValues?.size ?? DEFAULT_SIZE,
  })
  const [visualStyleKey, setVisualStyleKey] = useState(initialValues?.visualStyleKey ?? '')
  const [stylePickerOpen, setStylePickerOpen] = useState(false)
  const resultSelection = useGenerationResultSelection({
    initialSelectedAssetId: initialHistoryAssetId,
    appliedAssetId,
    resetKey: JSON.stringify([
      initialValues?.model,
      initialValues?.prompt,
      initialValues?.size,
      initialValues?.visualStyleKey,
      resetKey,
    ]),
    onApplyResult,
  })
  const fallbackMentionAssets = useMemo<PromptMentionAsset[]>(() => imageAssets.map((asset) => ({
    id: asset.id,
    ...(asset.resourceId ? { resourceId: asset.resourceId } : {}),
    label: asset.label,
    category: 'image',
    ...(asset.url ? { thumbUrl: asset.url } : {}),
  })), [imageAssets])
  const mentionAssets = projectMentionAssets ?? fallbackMentionAssets

  useEffect(() => {
    setPromptResetRevision((current) => current + 1)
    setPrompt(initialValues?.prompt ?? '')
    setPromptContent([])
    setParameters({ model: initialValues?.model, size: initialValues?.size ?? DEFAULT_SIZE })
    setVisualStyleKey(initialValues?.visualStyleKey ?? '')
    setStylePickerOpen(false)
  }, [initialHistoryAssetId, initialValues?.model, initialValues?.prompt, initialValues?.size, initialValues?.visualStyleKey, resetKey])

  useEffect(() => {
    if (!open || !stylePickerOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setStylePickerOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, stylePickerOpen])

  useEffect(() => {
    const task = state.currentTask
    if (!open || resultSelection.selectedAssetId || !task || task.prompt === undefined) return
    setPromptResetRevision((current) => current + 1)
    setPrompt(task.prompt)
    // PromptMentionEditor cannot hydrate resource chips; inspecting another
    // task must not submit the previous task's invisible structured content.
    setPromptContent([])
  }, [open, resultSelection.selectedAssetId, state.currentTask?.generationId, state.currentTask?.prompt])

  useEffect(() => {
    if (open && visualStyleKey) onRequestVisualStyles?.()
  }, [onRequestVisualStyles, open, visualStyleKey])

  const submissionBusy = state.phase === 'submitting'
  const running = submissionBusy || state.tracking
  const current = state.currentTask
  const selectedStyle = visualStyles.find((style) => style.key === visualStyleKey)
  const previewKind = targetRoot
  const historyItems = useMemo(
    () => historyAssets
      .map((asset) => adaptImageAsset(asset, previewKind))
      .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)),
    [historyAssets, previewKind],
  )
  const showHistory = historyItems.length > 0
  const selectedHistoryItem = resultSelection.selectedAssetId
    ? historyItems.find((item) => item.id === resultSelection.selectedAssetId)
    : undefined
  const trackedItem = current && (current.resultUrl || current.resourceId)
    ? adaptImageKinoTask(current, previewKind)
    : undefined
  const currentItem = selectedHistoryItem?.result ? selectedHistoryItem : trackedItem
  const currentItemCanApply = currentItem?.status === 'succeeded'
    && Boolean(currentItem.resultUrl || currentItem.resourceId)
  const status = statusLabel(state, t)
  const parametersSlot = (
    <ParametersForRoot
      targetRoot={targetRoot}
      value={parameters}
      modelOptions={parameters.model ? [parameters.model] : []}
      onChange={setParameters}
      modelDisabled
      interaction={{ busy: submissionBusy }}
    />
  )
  const previewSlot = (
    <div className="igen-preview" aria-label={t('imageGeneration.output')}>
      <div className="igen-stage">
        {currentItem?.result ? (
          <>
            <PreviewForRoot
              targetRoot={targetRoot}
              item={currentItem}
            />
            {currentItemCanApply && resultSelection.canApply(currentItem.id) ? (
              <div className="igen-preview-actions">
                <button
                  type="button"
                  disabled={resultSelection.applyingAssetId === currentItem.id}
                  aria-label={t('imageGeneration.apply')}
                  onClick={() => resultSelection.apply(currentItem.id as string)}
                >
                  {t(resultSelection.applyingAssetId === currentItem.id
                    ? 'imageGeneration.applying'
                    : 'imageGeneration.apply')}
                </button>
                {resultSelection.applyError ? <p role="alert">{resultSelection.applyError}</p> : null}
              </div>
            ) : null}
          </>
        ) : (
          <GenerationPreviewFrame
            phase={previewPhase(state)}
            interaction={{ busy: running, disabled: false, readOnly: false }}
            statusLabel={layout === 'page' && state.phase === 'idle' ? '' : status.label}
            className="igen-empty-frame"
          >
            <div className={`igen-empty${running ? ' is-running' : ''}`}>
              <img src={generationEmptyIcon} alt="" />
              <p>{running ? t('imageGeneration.generating') : t('imageGeneration.outputEmpty')}</p>
              <span>{t('imageGeneration.outputSubtitle')}</span>
              {running ? <div className="igen-progress" role="progressbar" aria-label={t('imageGeneration.generating')}><i /></div> : null}
            </div>
          </GenerationPreviewFrame>
        )}
        {!currentItem?.result && !running && state.phase !== 'succeeded' && (layout !== 'page' || state.phase !== 'idle')
          ? <span className={`igen-status ${status.className}`}>{status.label}</span>
          : null}
        {(state.error || current?.errorMessage) ? <p className="igen-preview-error" role="alert">{state.error ?? current?.errorMessage}</p> : null}
      </div>
    </div>
  )
  const historySlot = useMemo(() => (
    <div className="igen-history">
      <div className="igen-history-head"><strong>{t('imageGeneration.history')}</strong><span>{historyItems.length}</span></div>
      <GenerationHistoryList
        items={historyItems}
        loading={false}
        selectedGenerationId={selectedHistoryItem?.generationId ?? current?.generationId}
        ariaLabel={t('imageGeneration.history')}
        className="igen-history-list"
        presentation="cover"
        onActivate={(item) => {
          resultSelection.selectAsset(item.id)
        }}
      />
    </div>
  ), [current?.generationId, historyItems, resultSelection.selectAsset, selectedHistoryItem?.generationId, t])
  const composerSlot = (
    <div className="igen-composer" aria-label={t('imageGeneration.composer')}>
      <GenerationPromptComposer
        value={prompt}
        content={promptContent}
        assets={mentionAssets}
        onChange={(nextPrompt, nextContent) => {
          setPrompt(nextPrompt)
          setPromptContent(nextContent.some((item) => item.type === 'resource') ? nextContent : [])
        }}
        onSubmit={(nextPrompt, nextContent) => {
          resultSelection.clearSelection()
          onSubmit({
            prompt: nextPrompt,
            ...(nextContent.some((item) => item.type === 'resource') ? { promptContent: nextContent } : {}),
            ...(parameters.size ? { size: parameters.size } : {}),
            ...(visualStyleKey ? { visualStyleKey } : {}),
          })
        }}
        onCancel={onStopWaiting}
        onClear={() => { setPrompt(''); setPromptContent([]) }}
        polishPrompt={polishPrompt}
        onOpenStylePicker={() => {
          setStylePickerOpen(true)
          onRequestVisualStyles?.()
        }}
        selectedStyle={selectedStyle ? { key: selectedStyle.key, label: selectedStyle.label } : null}
        styleIcon={<img src={generationStyleSwapIcon} alt="" />}
        clearIcon={<img src={generationUndoIcon} alt="" />}
        cancelIcon={<img src={generationUndoIcon} alt="" />}
        submitIcon={<img src={generationSendIcon} alt="" />}
        polishSuffix={<i className="igen-polish-chevron" aria-hidden />}
        interaction={{ busy: submissionBusy }}
        cancelWhileEditing={state.tracking && !submissionBusy}
        resetKey={`${String(resetKey)}:${promptResetRevision}`}
        label={t('imageGeneration.prompt')}
        placeholder={t('imageGeneration.promptPlaceholder')}
        mentionLabel={t('imageGeneration.mentionAssets')}
        mentionEmptyLabel={t('imageGeneration.mentionEmpty')}
        mentionButtonLabel={t('imageGeneration.mentionButton')}
        mentionPresentation={layout === 'page' ? 'dialog' : 'menu'}
        submitLabel={t('imageGeneration.submit')}
        clearLabel={t('imageGeneration.clearPrompt')}
        polishLabel={t('imageGeneration.polishPrompt')}
        polishingLabel={t('imageGeneration.polishingPrompt')}
        cancelLabel={t('imageGeneration.stopWaiting')}
      />
      {!state.tracking && current && isActive(current.status) ? <p className="igen-stopped">{t('imageGeneration.stoppedNote')}</p> : null}
    </div>
  )
  const body = (
    <GenerationPageLayout className={layout === 'page' ? 'igen-panel is-page' : undefined}>
      <GenerationSurface className={`igen-workspace${showHistory ? ' has-history' : ''}`}>
        <GenerationSurfaceParameters className="igen-settings">{parametersSlot}</GenerationSurfaceParameters>
        <GenerationSurfacePreview>{previewSlot}</GenerationSurfacePreview>
        {showHistory ? <GenerationSurfaceHistory>{historySlot}</GenerationSurfaceHistory> : null}
        <GenerationSurfaceComposer>{composerSlot}</GenerationSurfaceComposer>
      </GenerationSurface>
    </GenerationPageLayout>
  )
  const stylePicker = <VisualStylePicker
    open={stylePickerOpen}
    styles={visualStyles}
    loading={visualStylesLoading}
    error={visualStylesError ?? null}
    selectedKey={visualStyleKey}
    onSelect={(style) => { setVisualStyleKey(style.key); setStylePickerOpen(false) }}
    onClose={() => setStylePickerOpen(false)}
    t={t}
  />
  if (!open) return null
  return layout === 'dialog'
    ? <GenerationDialog open title={t('imageGeneration.title')} closeLabel={t('imageGeneration.close')} onClose={onClose} dismissBlocked={stylePickerOpen} className="igen-sheet on" panelClassName="igen-panel">{body}{stylePicker}</GenerationDialog>
    : <div className="igen-page">{body}{stylePicker}</div>
}

function ParametersForRoot({
  targetRoot,
  ...props
}: {
  targetRoot: ImageGenerationAssetKind
  value: { model?: string, size?: KinoImageSize }
  modelOptions: readonly string[]
  modelDisabled: boolean
  onChange: (value: { model?: string, size?: KinoImageSize }) => void
  interaction: { busy: boolean }
}): React.JSX.Element {
  if (targetRoot === 'icon') return <IconParameters {...props} />
  if (targetRoot === 'scene') return <SceneParameters {...props} />
  if (targetRoot === 'character') return <CharacterParameters {...props} />
  if (targetRoot === 'control') return <ControlParameters {...props} />
  return <ImageParameters {...props} />
}

function PreviewForRoot({
  targetRoot,
  item,
}: {
  targetRoot: ImageGenerationAssetKind
  item: GenerationHistoryItemData
}): React.JSX.Element {
  const asset = item.result && item.result.media === 'image' ? item.result : undefined
  if (!asset) return <GenerationPreviewFrame ariaLabel="" />
  const props = { asset, className: 'igen-result-preview', showFooter: false }
  if (targetRoot === 'icon') return <IconPreview {...props} asset={asset as Extract<typeof asset, { assetKind: 'icon' }>} />
  if (targetRoot === 'scene') return <ScenePreview {...props} asset={asset as Extract<typeof asset, { assetKind: 'scene' }>} />
  if (targetRoot === 'character') return <CharacterPreview {...props} asset={asset as Extract<typeof asset, { assetKind: 'character' }>} />
  if (targetRoot === 'control') return <ControlPreview {...props} asset={asset as Extract<typeof asset, { assetKind: 'control' }>} />
  return <ImagePreview {...props} asset={asset as Extract<typeof asset, { assetKind: 'image' }>} />
}

function previewPhase(state: ImageGenerationState): 'idle' | 'submitting' | 'generating' | 'succeeded' | 'failed' | 'cancelled' {
  if (state.phase === 'polling' || state.phase === 'pending' || state.tracking) return 'generating'
  return state.phase
}

function statusLabel(state: ImageGenerationState, t: (key: string) => string): { label: string, className: string } {
  const phase = state.phase
  const active = phase === 'pending' || phase === 'submitting' || phase === 'polling' || state.tracking
  return {
    label: t(`imageGeneration.status.${phase}`),
    className: phase === 'succeeded' ? 'done' : phase === 'failed' || phase === 'cancelled' ? 'failed' : active ? 'running' : '',
  }
}

function isActive(status: KinoGenerationTask['status']): boolean {
  return status === 'pending' || status === 'submitting' || status === 'polling'
}
