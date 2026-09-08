import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { useVideoAssets } from '../useVideoAssets'
import type { ClipGenerationRequest, KinoGenerationTask } from './generation-api'
import {
  VideoGenerationSurface,
  type VideoGenerationInitialValues,
} from './VideoGenerationSurface'
import type { GenerationInteractionState } from './components'
import { useVideoGenerationWorkspace } from './useVideoGenerationWorkspace'
import { generationOwnerKey, generationScopeKey, type VideoGenerationScope } from './catalogGenerationRecovery'

export interface VideoGenerationWorkspaceProps {
  gameId: string
  open?: boolean
  variant?: 'sheet' | 'page'
  initialValues?: VideoGenerationInitialValues
  initialResultAssetId?: string
  /** Change when an open workspace switches to a different generation target. */
  resetKey?: string | number
  interaction?: Partial<Pick<GenerationInteractionState, 'disabled' | 'readOnly'>>
  generationDisabledReason?: string
  generationScope: VideoGenerationScope
  appliedAssetId?: string
  onApplyResult?: (assetId: string) => Promise<void>
  onClose: () => void
  onSubmitRequest?: (request: ClipGenerationRequest) => void
  validateSubmit?: (request: ClipGenerationRequest) => Promise<void>
  onGenerationStarted?: (task: KinoGenerationTask, request: ClipGenerationRequest) => void | Promise<void>
  onGenerationSucceeded?: (resourceId: string, task: KinoGenerationTask) => void | Promise<void>
}

/**
 * Reusable, data-connected video generation surface. Route pages and dialogs
 * provide presentation/initial values while this component owns assets and
 * Kino task orchestration.
 */
export function VideoGenerationWorkspace({
  gameId,
  open = true,
  variant = 'page',
  initialValues,
  initialResultAssetId,
  resetKey,
  interaction,
  generationDisabledReason,
  generationScope,
  appliedAssetId,
  onApplyResult,
  onClose,
  onSubmitRequest,
  validateSubmit,
  onGenerationStarted,
  onGenerationSucceeded,
}: VideoGenerationWorkspaceProps): JSX.Element | null {
  const videoController = useVideoAssets(gameId)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [registrationRetry, setRegistrationRetry] = useState<(() => Promise<void>) | null>(null)
  const scopeIdentity = generationOwnerKey(gameId, generationScopeKey(generationScope))
  const currentScopeRef = useRef(scopeIdentity)
  const scopeEpochRef = useRef(0)
  const scopeChanged = currentScopeRef.current !== scopeIdentity
  const startedGenerationIdsRef = useRef<Set<string>>(new Set())
  const handledGenerationIdsRef = useRef<Set<string>>(new Set())
  const persistStarted = useCallback(async (task: KinoGenerationTask, request: ClipGenerationRequest): Promise<void> => {
    const startedScope = scopeIdentity
    if (currentScopeRef.current === startedScope) startedGenerationIdsRef.current.add(task.generationId)
    const register = async (): Promise<void> => {
      await onGenerationStarted?.(task, request)
      if (currentScopeRef.current !== startedScope) return
      setRegistrationRetry(null)
      setSubmissionError(null)
    }
    try {
      await register()
    } catch (error) {
      if (currentScopeRef.current !== startedScope) return
      setRegistrationRetry(() => register)
      setSubmissionError(error instanceof Error ? error.message : String(error))
    }
  }, [onGenerationStarted, scopeIdentity])
  const { imageAssets, recentClips, mentionAssets, clipGeneration } = useVideoGenerationWorkspace(
    gameId,
    videoController,
    generationScope,
    persistStarted,
  )
  const validatingRef = useRef(false)
  const t = useT()
  useLayoutEffect(() => {
    if (!scopeChanged) return
    currentScopeRef.current = scopeIdentity
    scopeEpochRef.current += 1
    validatingRef.current = false
    startedGenerationIdsRef.current.clear()
    handledGenerationIdsRef.current.clear()
    setRegistrationRetry(null)
    setSubmissionError(null)
  }, [scopeIdentity, scopeChanged])
  useEffect(() => {
    const { phase, generationId, resourceId } = clipGeneration.state
    if (phase !== 'succeeded' || !generationId || !resourceId) return
    if (currentScopeRef.current !== scopeIdentity || !startedGenerationIdsRef.current.has(generationId)) return
    if (handledGenerationIdsRef.current.has(generationId)) return
    const terminalScope = scopeIdentity
    void (async () => {
      try {
        const terminalTask: KinoGenerationTask = {
          generationId,
          status: 'succeeded',
          resourceId,
          ...(clipGeneration.state.resultUrl ? { resultUrl: clipGeneration.state.resultUrl } : {}),
          ...(clipGeneration.state.prompt ? { prompt: clipGeneration.state.prompt } : {}),
          ...(clipGeneration.state.params?.model ? { model: String(clipGeneration.state.params.model) } : {}),
          ...(clipGeneration.state.params ? { params: clipGeneration.state.params } : {}),
        }
        const register = async (): Promise<void> => {
          if (currentScopeRef.current !== terminalScope) return
          await onGenerationSucceeded?.(resourceId, terminalTask)
          if (currentScopeRef.current !== terminalScope) return
          handledGenerationIdsRef.current.add(generationId)
          setRegistrationRetry(null)
          setSubmissionError(null)
        }
        try {
          await register()
        } catch (error) {
          if (currentScopeRef.current === terminalScope) setRegistrationRetry(() => register)
          throw error
        }
      } catch (error) {
        if (currentScopeRef.current !== terminalScope) return
        setSubmissionError(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [clipGeneration.state, onGenerationSucceeded, scopeIdentity])
  const submit = useCallback((request: ClipGenerationRequest): void => {
    if (validatingRef.current) return
    const submitScopeEpoch = scopeEpochRef.current
    validatingRef.current = true
    setSubmissionError(null)
    void (async () => {
      try {
        await validateSubmit?.(request)
        if (scopeEpochRef.current !== submitScopeEpoch) return
        onSubmitRequest?.(request)
        clipGeneration.submit(request)
      } catch (error) {
        if (scopeEpochRef.current !== submitScopeEpoch) return
        setSubmissionError(error instanceof Error ? error.message : String(error))
      } finally {
        if (scopeEpochRef.current === submitScopeEpoch) validatingRef.current = false
      }
    })()
  }, [clipGeneration.submit, onSubmitRequest, validateSubmit])

  const retry = registrationRetry
    ? <button type="button" onClick={() => { const action = registrationRetry; if (action) void action().catch((error) => setSubmissionError(error instanceof Error ? error.message : String(error))) }} disabled={validatingRef.current}>{t('videoAssets.generate.retryRegistration')}</button>
    : null
  return (
    <>
      <VideoGenerationSurface
      open={open}
    layout={variant === 'sheet' ? 'dialog' : 'page'}
      gameSlug={gameId}
      imageAssets={imageAssets}
      recentClips={recentClips}
      mentionAssets={mentionAssets}
      genState={clipGeneration.state}
      initialValues={initialValues}
      initialResultAssetId={initialResultAssetId}
      resetKey={resetKey}
      interaction={interaction}
      generationDisabledReason={generationDisabledReason}
      appliedAssetId={appliedAssetId}
      onApplyResult={onApplyResult}
      submissionError={submissionError}
      onSubmit={submit}
      onCancel={() => {
        clipGeneration.cancel()
      }}
      onTrack={clipGeneration.track}
      onClose={onClose}
      />
      {retry}
    </>
  )
}
