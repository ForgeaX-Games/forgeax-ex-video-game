import { useEffect } from 'react'
import { create } from 'zustand'
import type { KinoRequestOptions } from '../kino-api'
import type { VideoGenerationTask } from './generation-api'
import {
  getKinoGeneration,
  isActiveGenerationStatus,
} from './kino-generation-client'
import {
  generationScopeKey,
  listRecoverableKinoGenerations,
  recoverCatalogGenerations,
  type VideoGenerationScope,
} from './catalogGenerationRecovery'

export const VIDEO_GENERATION_POLL_INTERVAL_MS = 3_000

export interface VideoGenerationStoreEntry {
  tasks: readonly VideoGenerationTask[]
  selectedGenerationId?: string
  selectedTask?: VideoGenerationTask
  loading: boolean
  error: string | null
  revision: number
  completionRevision: number
}
interface VideoGenerationStore {
  byScope: Record<string, VideoGenerationStoreEntry | undefined>
  refresh: (gameSlug: string, scope: VideoGenerationScope, options?: KinoRequestOptions) => Promise<void>
  select: (gameSlug: string, scope: VideoGenerationScope, generationId?: string) => void
}

const EMPTY_ENTRY: VideoGenerationStoreEntry = {
  tasks: [],
  loading: false,
  error: null,
  revision: 0,
  completionRevision: 0,
}

/**
 * Kino owns task execution; Catalog durably owns which generation ids belong
 * to this game so refresh recovery does not depend on list visibility.
 */
export async function listActiveVideoGenerationTasks(
  gameSlug: string,
  scope: VideoGenerationScope,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask[]> {
  const tasks = await listRecoverableKinoGenerations(gameSlug, 'video', scope, options)
  return tasks.filter((task) => isActiveGenerationStatus(task.status))
}

export async function getVideoGenerationTask(
  gameSlug: string,
  generationId: string,
  options: KinoRequestOptions = {},
): Promise<VideoGenerationTask> {
  return getKinoGeneration(generationId, gameSlug, options)
}

export const useVideoGenerationStore = create<VideoGenerationStore>((set, get) => ({
  byScope: {},

  async refresh(gameSlug, scope, options) {
    const key = videoGenerationStoreKey(gameSlug, scope)
    const current = get().byScope[key] ?? EMPTY_ENTRY
    const revision = current.revision + 1
    set((state) => ({
      byScope: {
        ...state.byScope,
        [key]: { ...current, loading: current.tasks.length === 0, error: null, revision },
      },
    }))
    try {
      const tasks = await listActiveVideoGenerationTasks(gameSlug, scope, options)
      const selectedGenerationId = current.selectedGenerationId
      const selectedTask = selectedGenerationId === undefined
        ? tasks[0]
        : tasks.find((task) => task.generationId === selectedGenerationId)
          ?? await getVideoGenerationTask(gameSlug, selectedGenerationId, options)
      if ((get().byScope[key]?.revision ?? 0) !== revision) return
      set((state) => ({
        byScope: (() => {
          const previous = state.byScope[key] ?? EMPTY_ENTRY
          const activeIds = new Set(tasks.map((task) => task.generationId))
          const completed = previous.tasks.some((task) => !activeIds.has(task.generationId))
          return {
            ...state.byScope,
            [key]: {
              ...previous,
              completionRevision: previous.completionRevision + (completed ? 1 : 0),
              tasks,
              selectedTask,
              loading: false,
              error: null,
              revision,
            },
          }
        })(),
      }))
    } catch (error) {
      if (options?.signal?.aborted || (get().byScope[key]?.revision ?? 0) !== revision) return
      set((state) => ({
        byScope: {
          ...state.byScope,
          [key]: {
            ...(state.byScope[key] ?? EMPTY_ENTRY),
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            revision,
          },
        },
      }))
    }
  },

  select(gameSlug, scope, generationId) {
    const key = videoGenerationStoreKey(gameSlug, scope)
    set((state) => {
      const current = state.byScope[key] ?? EMPTY_ENTRY
      return {
        byScope: {
          ...state.byScope,
          [key]: generationId === undefined
            ? {
                ...current,
                revision: current.revision + 1,
                selectedGenerationId: undefined,
                selectedTask: undefined,
              }
            : {
                ...current,
                revision: current.revision + 1,
                selectedGenerationId: generationId,
                selectedTask: current.tasks.find((task) => task.generationId === generationId),
              },
        },
      }
    })
  },
}))

/** One app-level subscriber owns polling; page components only consume snapshots. */
export function useGlobalVideoGenerationTracker(gameSlug: string): void {
  useEffect(() => {
    const controller = new AbortController()
    const recover = (): void => { void recoverCatalogGenerations(gameSlug, undefined, { signal: controller.signal }).catch((error) => {
      if (!controller.signal.aborted) console.error('Catalog generation recovery failed', error)
      }) }
    recover()
    const timer = window.setInterval(() => {
      recover()
    }, VIDEO_GENERATION_POLL_INTERVAL_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [gameSlug])
}

export function videoGenerationStoreKey(gameSlug: string, scope: VideoGenerationScope): string {
  return `${videoGenerationStoreGamePrefix(gameSlug)}${generationScopeKey(scope)}`
}

export function videoGenerationStoreGamePrefix(gameSlug: string): string {
  return `${encodeURIComponent(gameSlug)}|`
}
