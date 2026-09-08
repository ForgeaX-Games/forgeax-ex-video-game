import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KinoGenerationStatus, KinoGenerationTask, KinoPromptContentItem } from './generation-api'
import type { KinoImageSize } from '@/runtime/core/schema/kino-image-schema'
import {
  createKinoImageGeneration,
  getKinoGeneration,
  isActiveGenerationStatus,
  listKinoGenerations,
  type CreateKinoImageGenerationInput,
} from './kino-generation-client'
import { generationOwnerKey } from './catalogGenerationRecovery'

export const IMAGE_GENERATION_POLL_INTERVAL_MS = 3_000

export interface ImageGenerationSubmitInput {
  prompt: string
  promptContent?: KinoPromptContentItem[]
  size?: KinoImageSize
  visualStyleKey?: string
}

export interface ImageGenerationState {
  phase: 'idle' | KinoGenerationStatus
  currentTask?: KinoGenerationTask
  /** All Kino tasks this controller is still observing; currentTask owns preview. */
  activeTasks?: readonly KinoGenerationTask[]
  history: readonly KinoGenerationTask[]
  loadingHistory: boolean
  tracking: boolean
  error?: string
}

export interface UseImageGenerationOptions {
  gameSlug: string
  /** Stable owner identity; changing it resets history to the new generation scope. */
  scopeKey?: string
  selectLatestHistory?: boolean
  createGeneration?: (input: CreateKinoImageGenerationInput) => Promise<KinoGenerationTask>
  getGeneration?: (generationId: string, gameSlug: string) => Promise<KinoGenerationTask>
  listGenerations?: (gameSlug: string) => Promise<KinoGenerationTask[]>
  onStarted?: (task: KinoGenerationTask, input: ImageGenerationSubmitInput) => void | Promise<void>
  onSucceeded?: (resourceId: string, task: KinoGenerationTask) => void | Promise<void>
  pollIntervalMs?: number
}

export interface ImageGenerationController {
  state: ImageGenerationState
  submit(input: ImageGenerationSubmitInput): void
  /** Stops browser polling for every observed task. Kino tasks continue on the server. */
  stopWaiting(): void
  track(task: KinoGenerationTask): void
  refresh(): Promise<void>
}

const EMPTY_STATE: ImageGenerationState = {
  phase: 'idle',
  history: [],
  loadingHistory: true,
  tracking: false,
}

export function useImageGeneration(options: UseImageGenerationOptions): ImageGenerationController {
  const createGenerationRef = useRef(options.createGeneration ?? createKinoImageGeneration)
  const getGenerationRef = useRef(options.getGeneration ?? getKinoGeneration)
  const listGenerationsRef = useRef(options.listGenerations ?? listImageGenerations)
  createGenerationRef.current = options.createGeneration ?? createKinoImageGeneration
  getGenerationRef.current = options.getGeneration ?? getKinoGeneration
  listGenerationsRef.current = options.listGenerations ?? listImageGenerations
  const pollIntervalMs = options.pollIntervalMs ?? IMAGE_GENERATION_POLL_INTERVAL_MS
  const onSucceededRef = useRef(options.onSucceeded)
  onSucceededRef.current = options.onSucceeded
  const [state, setState] = useState<ImageGenerationState>(EMPTY_STATE)
  const mountedRef = useRef(true)
  const scopeIdentity = generationOwnerKey(options.gameSlug, options.scopeKey)
  const stateScopeRef = useRef(scopeIdentity)
  const scopeChanged = stateScopeRef.current !== scopeIdentity
  const submitEpochRef = useRef(0)
  const completedRef = useRef<Set<string>>(new Set())
  const hasTransportErrorRef = useRef(false)
  const requestRef = useRef<Map<string, ImageGenerationSubmitInput>>(new Map())

  useLayoutEffect(() => {
    if (!scopeChanged) return
    stateScopeRef.current = scopeIdentity
    submitEpochRef.current += 1
    requestRef.current.clear()
    completedRef.current.clear()
    hasTransportErrorRef.current = false
    setState(EMPTY_STATE)
  }, [scopeIdentity, scopeChanged])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      submitEpochRef.current += 1
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const requestedScopeKey = scopeIdentity
    if (!options.gameSlug.trim()) {
      setState((current) => ({ ...current, loadingHistory: false, error: 'Missing gameSlug' }))
      return
    }
    setState((current) => ({ ...current, loadingHistory: true, error: undefined }))
    try {
      const history = sortTasks(await listGenerationsRef.current(options.gameSlug))
      if (!mountedRef.current || stateScopeRef.current !== requestedScopeKey) return
      const activeTasks = history.filter((task) => isActiveGenerationStatus(task.status))
      const active = activeTasks[0]
      setState((current) => ({
        ...current,
        history,
        loadingHistory: false,
        ...(active
          ? { phase: active.status, currentTask: active, activeTasks, tracking: true }
          : options.selectLatestHistory !== false && history[0]
              ? { phase: history[0].status, currentTask: history[0], tracking: false }
              : { phase: 'idle', currentTask: undefined, activeTasks: [], tracking: false }),
        error: undefined,
      }))
    } catch (error) {
      if (!mountedRef.current || stateScopeRef.current !== requestedScopeKey) return
      setState((current) => ({
        ...current,
        loadingHistory: false,
        error: errorMessage(error),
      }))
    }
  }, [options.gameSlug, scopeIdentity, options.selectLatestHistory])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const finishSucceeded = useCallback(async (
    task: KinoGenerationTask,
    taskScopeKey: string | undefined,
  ): Promise<void> => {
    if (!task.resourceId || completedRef.current.has(task.generationId)) return
    completedRef.current.add(task.generationId)
    try {
      await onSucceededRef.current?.(task.resourceId, task)
    } catch (error) {
      completedRef.current.delete(task.generationId)
      if (mountedRef.current && stateScopeRef.current === taskScopeKey) {
        setState((current) => ({ ...current, error: errorMessage(error) }))
      }
    }
  }, [])

  const applyTask = useCallback((task: KinoGenerationTask, select = true): void => {
    if (stateScopeRef.current !== scopeIdentity) return
    const request = requestRef.current.get(task.generationId)
    const resolvedTask = request ? {
      ...task,
      ...(task.prompt ? {} : { prompt: request.prompt.trim() }),
      ...(task.imageSize ? {} : request.size ? { imageSize: request.size } : {}),
      ...(task.visualStyleKey ? {} : request.visualStyleKey ? { visualStyleKey: request.visualStyleKey } : {}),
      params: {
        ...(task.params ?? {}),
        prompt: request.prompt.trim(),
        ...(request.promptContent?.length ? { promptContent: request.promptContent } : {}),
        ...(request.size ? { size: request.size } : {}),
        ...(request.visualStyleKey ? { visualStyleKey: request.visualStyleKey } : {}),
      },
    } : task
    setState((current) => {
      const activeTasks = upsertActiveTask(current.activeTasks ?? [], resolvedTask)
      const currentIsUpdatedTask = current.currentTask?.generationId === resolvedTask.generationId
      const selectTask = Boolean(select && (
        current.phase !== 'submitting'
        || current.currentTask?.generationId !== resolvedTask.generationId
      )) || !current.currentTask
      const error = resolvedTask.status === 'failed' || resolvedTask.status === 'cancelled'
        ? resolvedTask.errorMessage ?? resolvedTask.errorCode ?? 'Image generation failed'
        : undefined
      return {
        ...current,
        ...(selectTask
          ? { phase: resolvedTask.status, currentTask: resolvedTask, error }
          : currentIsUpdatedTask && current.phase !== 'submitting'
            ? { phase: resolvedTask.status, currentTask: resolvedTask, error }
            : {}),
        activeTasks,
        tracking: activeTasks.length > 0,
        history: sortTasks([resolvedTask, ...current.history.filter(
          (item) => item.generationId !== resolvedTask.generationId,
        )]),
      }
    })
    if (resolvedTask.status === 'succeeded') void finishSucceeded(resolvedTask, scopeIdentity)
  }, [finishSucceeded, scopeIdentity])

  useEffect(() => {
    const activeTasks = state.activeTasks ?? []
    if (!state.tracking || activeTasks.length === 0) return
    let disposed = false
    let timer: number | undefined
    const schedule = (): void => {
      timer = window.setTimeout(() => {
        void Promise.all(activeTasks.map(async (task) => {
          try {
            const next = await getGenerationRef.current(task.generationId, options.gameSlug)
            return { next, select: task.generationId === state.currentTask?.generationId }
          } catch (error) {
            return { error: errorMessage(error) }
          }
        })).then((results) => {
          if (disposed) return
          const errors = results.flatMap((result) => result.error ? [result.error] : [])
          if (!errors.length && hasTransportErrorRef.current) {
            hasTransportErrorRef.current = false
            setState((current) => ({ ...current, error: undefined }))
          }
          results.forEach((result) => {
            if (result.next) applyTask(result.next, result.select)
          })
          if (errors.length) {
            hasTransportErrorRef.current = true
            setState((current) => ({ ...current, error: errors.join('; ') }))
          }
          schedule()
        })
      }, pollIntervalMs)
    }
    schedule()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [applyTask, options.gameSlug, pollIntervalMs, state.activeTasks, state.currentTask?.generationId, state.tracking])

  const submit = useCallback((input: ImageGenerationSubmitInput): void => {
    const prompt = input.prompt.trim()
    if (!prompt) {
      setState((current) => ({ ...current, phase: 'failed', tracking: false, error: 'Missing image prompt' }))
      return
    }
    const epoch = ++submitEpochRef.current
    const startedCallback = options.onStarted
    setState((current) => ({ ...current, phase: 'submitting', error: undefined }))
    void createGenerationRef.current({
      gameSlug: options.gameSlug,
      prompt,
      ...(input.promptContent?.length ? { promptContent: input.promptContent } : {}),
      ...(input.size ? { size: input.size } : {}),
      ...(input.visualStyleKey ? { visualStyleKey: input.visualStyleKey } : {}),
    }).then(
      (task) => {
        void Promise.resolve().then(() => startedCallback?.(task, input)).catch((error) => {
          console.error('Failed to persist started image generation', error)
        })
        if (!mountedRef.current || submitEpochRef.current !== epoch) return
        requestRef.current.set(task.generationId, input)
        applyTask(task)
      },
      (error: unknown) => {
        if (!mountedRef.current || submitEpochRef.current !== epoch) return
        setState((current) => {
          const fallback = current.activeTasks?.[0]
          return fallback
            ? { ...current, phase: fallback.status, currentTask: fallback, tracking: true, error: errorMessage(error) }
            : { ...current, phase: 'failed', currentTask: undefined, activeTasks: [], tracking: false, error: errorMessage(error) }
        })
      },
    )
  }, [applyTask, options.gameSlug, options.onStarted])

  const stopWaiting = useCallback((): void => {
    submitEpochRef.current += 1
    setState((current) => ({ ...current, activeTasks: [], tracking: false }))
  }, [])

  const track = useCallback((task: KinoGenerationTask): void => {
    setState((current) => {
      const activeTasks = upsertActiveTask(current.activeTasks ?? [], task)
      return {
        ...current,
        currentTask: task,
        phase: task.status,
        activeTasks,
        tracking: activeTasks.length > 0,
        error: task.status === 'failed' || task.status === 'cancelled'
          ? task.errorMessage ?? task.errorCode ?? 'Image generation failed'
          : undefined,
      }
    })
  }, [])

  return { state: scopeChanged ? EMPTY_STATE : state, submit, stopWaiting, track, refresh }
}

function sortTasks(tasks: readonly KinoGenerationTask[]): KinoGenerationTask[] {
  return [...tasks].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
}

function upsertActiveTask(
  activeTasks: readonly KinoGenerationTask[],
  task: KinoGenerationTask,
): KinoGenerationTask[] {
  const remaining = activeTasks.filter((item) => item.generationId !== task.generationId)
  return isActiveGenerationStatus(task.status) ? [...remaining, task] : remaining
}

function listImageGenerations(gameSlug: string): Promise<KinoGenerationTask[]> {
  return listKinoGenerations(gameSlug, 'image')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
