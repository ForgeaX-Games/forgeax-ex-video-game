import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../../../i18n'
import {
  KINO_VIDEO_MAX_DURATION_SECONDS,
  KINO_VIDEO_MIN_DURATION_SECONDS,
} from '@/runtime/core/schema/kino-schema'
import type { ClipGenerationRequest, VideoGenerationTask } from './generation-api'
import {
  createKinoGeneration,
  getKinoGeneration,
  isActiveGenerationStatus,
  type CreateKinoGenerationInput,
} from './kino-generation-client'
import { generationOwnerKey } from './catalogGenerationRecovery'

export const CLIP_GENERATION_SOURCE = 'asset-library-generation'

const POLL_INTERVAL_MS = 3_000
/** 连续轮询失败达到该次数才判定任务失败，避免一次网络抖动打断生成。 */
const MAX_CONSECUTIVE_POLL_ERRORS = 5

export type ClipGenPhase = 'idle' | 'submitting' | 'generating' | 'succeeded' | 'failed'

export interface ClipGenState {
  phase: ClipGenPhase
  transport?: 'kino'
  generationId?: string
  /** 宿主 registry asset id；直连链路不产生，保留给素材库定位回落。 */
  assetId?: string
  /** Kino 直出地址，可交给 `<video>` 播放。 */
  resultUrl?: string
  resourceId?: string
  error?: string
  prompt?: string
  /** Full request metadata retained so a just-submitted task can be restored. */
  params?: Record<string, unknown>
  activeTasks?: readonly VideoGenerationTask[]
}

export interface UseClipGenerationOptions {
  gameSlug?: string
  /** Stable owner identity; changing it clears the previous scope immediately. */
  scopeKey?: string
  createGeneration?: (input: CreateKinoGenerationInput) => Promise<VideoGenerationTask>
  getGeneration?: (generationId: string, gameSlug: string) => Promise<VideoGenerationTask>
  onStarted?: (task: VideoGenerationTask, request: ClipGenerationRequest) => void | Promise<void>
  onTerminal?: () => void | Promise<void>
  restoredTask?: VideoGenerationTask
  activeTasks?: readonly VideoGenerationTask[]
}

export interface ClipGenerationController {
  state: ClipGenState
  submit: (request: ClipGenerationRequest) => void
  /** 停止本地观察；Kino 侧任务继续推进。 */
  cancel: () => void
  reset: () => void
  /** 直接观察一个已知任务（刷新恢复用）。 */
  track: (generationId: string) => void
}

const IDLE_STATE: ClipGenState = { phase: 'idle', transport: 'kino' }

export function useClipGeneration(
  options: UseClipGenerationOptions = {},
): ClipGenerationController {
  const createGeneration = options.createGeneration ?? createKinoGeneration
  const getGeneration = options.getGeneration ?? getKinoGeneration
  const gameSlug = options.gameSlug ?? ''
  const onTerminalRef = useRef(options.onTerminal)
  onTerminalRef.current = options.onTerminal

  const [state, setState] = useState<ClipGenState>(IDLE_STATE)
  const scopeIdentity = generationOwnerKey(gameSlug, options.scopeKey)
  const stateScopeRef = useRef(scopeIdentity)
  const scopeChanged = stateScopeRef.current !== scopeIdentity
  const epochRef = useRef(0)
  const mountedRef = useRef(true)
  const notifiedRef = useRef<string | null>(null)
  const requestRef = useRef<Map<string, ClipGenerationRequest>>(new Map())
  const restoredTask = options.restoredTask
  const restoredTaskKey = restoredTask ? taskIdentityKey(restoredTask) : ''
  const activeTasks = options.activeTasks ?? []
  const activeTasksKey = JSON.stringify(
    activeTasks.map((task) => [task.generationId, task.status]),
  )

  useLayoutEffect(() => {
    if (!scopeChanged) return
    stateScopeRef.current = scopeIdentity
    epochRef.current += 1
    notifiedRef.current = null
    requestRef.current.clear()
    setState(IDLE_STATE)
  }, [scopeIdentity, scopeChanged])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      epochRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!restoredTask) return
    notifiedRef.current = null
    setState(stateFromTask(restoredTask, activeTasks))
  }, [restoredTaskKey])

  useEffect(() => {
    setState((current) => {
      if (!current.generationId || tasksEqual(current.activeTasks ?? [], activeTasks)) {
        return current
      }
      return { ...current, activeTasks }
    })
  }, [activeTasksKey])

  const applyTask = useCallback((task: VideoGenerationTask): void => {
    if (stateScopeRef.current !== scopeIdentity) return
    const request = requestRef.current.get(task.generationId)
    const resolvedTask = request ? {
      ...task,
      ...(task.prompt ? {} : { prompt: request.prompt.trim() }),
      ...(task.model ? {} : request.model ? { model: request.model } : {}),
      ...(task.imageSize ? {} : request.size ? { imageSize: request.size } : {}),
      params: {
        ...(task.params ?? {}),
        ...request,
        prompt: request.prompt.trim(),
        ...(request.promptContent?.length ? { promptContent: request.promptContent } : {}),
        ...(request.mode ? { mode: request.mode } : {}),
        ...(request.model ? { model: request.model } : {}),
        ...(request.size ? { size: request.size } : {}),
        ...(request.resolution ? { resolution: request.resolution } : {}),
        durationSeconds: request.durationSeconds,
        generateAudio: request.generateAudio,
        ...(request.visualStyleKey ? { visualStyleKey: request.visualStyleKey } : {}),
        ...(request.firstFrameResourceId ? { firstFrameResourceId: request.firstFrameResourceId } : {}),
        ...(request.lastFrameResourceId ? { lastFrameResourceId: request.lastFrameResourceId } : {}),
        ...(request.referenceImageResourceIds?.length ? { referenceImageResourceIds: request.referenceImageResourceIds } : {}),
      },
    } : task
    setState((current) => {
      const next = stateFromTask(resolvedTask, current.activeTasks ?? [])
      return statesEqual(current, next) ? current : next
    })
    if (isActiveGenerationStatus(resolvedTask.status)) return
    if (notifiedRef.current === resolvedTask.generationId) return
    notifiedRef.current = resolvedTask.generationId
    void onTerminalRef.current?.()
  }, [scopeIdentity])

  // 轮询由 `generating` 阶段驱动，所以 submit 与刷新恢复共用同一条推进路径。
  useEffect(() => {
    if (state.phase !== 'generating') return
    const generationId = state.generationId
    if (!generationId || !gameSlug) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let consecutiveErrors = 0
    const schedule = (): void => {
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
    }
    const tick = async (): Promise<void> => {
      try {
        const task = await getGeneration(generationId, gameSlug)
        if (cancelled) return
        consecutiveErrors = 0
        applyTask(task)
        if (isActiveGenerationStatus(task.status)) schedule()
      } catch (error) {
        if (cancelled) return
        consecutiveErrors += 1
        if (consecutiveErrors < MAX_CONSECUTIVE_POLL_ERRORS) {
          schedule()
          return
        }
        setState((current) => ({
          ...current,
          phase: 'failed',
          error: errorMessage(error),
        }))
      }
    }
    schedule()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [state.phase, state.generationId, gameSlug, getGeneration, applyTask])

  const submit = useCallback((request: ClipGenerationRequest): void => {
    const epoch = ++epochRef.current
    const startedCallback = options.onStarted
    notifiedRef.current = null
    let input: CreateKinoGenerationInput
    try {
      input = toCreateInput(request, gameSlug)
    } catch (error) {
      setState({ phase: 'failed', transport: 'kino', error: errorMessage(error) })
      return
    }

    setState({ phase: 'submitting', transport: 'kino' })
    void createGeneration(input).then(
      (task) => {
        void Promise.resolve().then(() => startedCallback?.(task, request)).catch((error) => {
          console.error('Failed to persist started video generation', error)
        })
        if (!mountedRef.current || epochRef.current !== epoch) return
        requestRef.current.set(task.generationId, request)
        applyTask(task)
      },
      (error: unknown) => {
        if (!mountedRef.current || epochRef.current !== epoch) return
        setState({ phase: 'failed', transport: 'kino', error: errorMessage(error) })
      },
    )
  }, [applyTask, createGeneration, gameSlug, options.onStarted])

  const cancel = useCallback((): void => {
    epochRef.current += 1
    notifiedRef.current = null
    setState(IDLE_STATE)
  }, [])

  const track = useCallback((generationId: string): void => {
    if (!generationId.trim()) return
    notifiedRef.current = null
    const knownTask = activeTasks.find((task) => task.generationId === generationId)
    if (knownTask) {
      setState(stateFromTask(knownTask, activeTasks))
      return
    }
    setState((current) => ({
      ...current,
      phase: 'generating',
      transport: 'kino',
      generationId,
    }))
  }, [activeTasks])

  return { state: scopeChanged ? IDLE_STATE : state, submit, cancel, reset: cancel, track }
}

function toCreateInput(
  request: ClipGenerationRequest,
  gameSlug: string,
): CreateKinoGenerationInput {
  if (!gameSlug.trim()) {
    throw new Error(t('videoAssets.generate.validation.referenceUnavailableHttp'))
  }
  assertReferenceIdentities(request)
  return {
    gameSlug,
    prompt: request.prompt,
    ...(request.promptContent?.length ? { promptContent: request.promptContent } : {}),
    durationSeconds: Math.min(
      KINO_VIDEO_MAX_DURATION_SECONDS,
      Math.max(KINO_VIDEO_MIN_DURATION_SECONDS, Math.round(request.durationSeconds)),
    ),
    generateAudio: request.generateAudio,
    ...(request.size ? { size: request.size } : {}),
    ...(request.resolution ? { resolution: request.resolution } : {}),
    ...(request.model ? { model: request.model } : {}),
    ...(request.visualStyleKey ? { visualStyleKey: request.visualStyleKey } : {}),
    ...(request.firstFrameResourceId
      ? { firstFrameResourceId: request.firstFrameResourceId }
      : {}),
    ...(request.lastFrameResourceId
      ? { lastFrameResourceId: request.lastFrameResourceId }
      : {}),
    ...(request.referenceImageResourceIds?.length
      ? { referenceImageResourceIds: request.referenceImageResourceIds }
      : {}),
  }
}

function assertReferenceIdentities(request: ClipGenerationRequest): void {
  if (request.mode === 'strict') {
    if (!isNonEmptyId(request.firstFrameResourceId)
      || !isNonEmptyId(request.lastFrameResourceId)) {
      throw missingReferenceIdentity()
    }
    return
  }
  if (request.mode === 'firstref') {
    if (!isNonEmptyId(request.firstFrameResourceId)) throw missingReferenceIdentity()
    return
  }
  if (request.mode === 'ref' && (
    !request.referenceImageResourceIds?.length
    || !request.referenceImageResourceIds.every(isNonEmptyId)
  )) {
    throw missingReferenceIdentity()
  }
}

function missingReferenceIdentity(): Error {
  return new Error(t('videoAssets.generate.validation.referenceUnavailableHttp'))
}

function isNonEmptyId(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function phaseFromStatus(status: VideoGenerationTask['status']): ClipGenPhase {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'generating'
}

function stateFromTask(
  task: VideoGenerationTask,
  activeTasks: readonly VideoGenerationTask[],
): ClipGenState {
  const phase = phaseFromStatus(task.status)
  return {
    phase,
    transport: 'kino',
    generationId: task.generationId,
    ...(task.resultUrl !== undefined ? { resultUrl: task.resultUrl } : {}),
    ...(task.resourceId !== undefined ? { resourceId: task.resourceId } : {}),
    ...(task.prompt !== undefined ? { prompt: task.prompt } : {}),
    ...(task.params !== undefined ? { params: task.params } : {}),
    ...(phase === 'failed'
      ? { error: task.errorMessage ?? task.errorCode ?? t('videoAssets.generate.statusFailed') }
      : {}),
    activeTasks,
  }
}

function taskIdentityKey(task: VideoGenerationTask): string {
  return JSON.stringify([
    task.generationId,
    task.status,
    task.prompt,
    task.resultUrl,
    task.resourceId,
    task.errorMessage,
    task.params,
  ])
}

function statesEqual(a: ClipGenState, b: ClipGenState): boolean {
  return a.phase === b.phase
    && a.generationId === b.generationId
    && a.resultUrl === b.resultUrl
    && a.resourceId === b.resourceId
    && a.prompt === b.prompt
    && JSON.stringify(a.params ?? null) === JSON.stringify(b.params ?? null)
    && a.error === b.error
    && tasksEqual(a.activeTasks ?? [], b.activeTasks ?? [])
}

function tasksEqual(
  a: readonly VideoGenerationTask[],
  b: readonly VideoGenerationTask[],
): boolean {
  return a.length === b.length
    && a.every((task, index) => task.generationId === b[index]?.generationId
      && task.status === b[index]?.status)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
