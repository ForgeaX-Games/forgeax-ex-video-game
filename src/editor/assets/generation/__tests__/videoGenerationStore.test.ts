import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoGenerationTask } from '../generation-api'
import {
  listActiveVideoGenerationTasks,
  getVideoGenerationTask,
  videoGenerationStoreKey,
  useVideoGenerationStore,
} from '../videoGenerationStore'
import type { VideoGenerationScope } from '../catalogGenerationRecovery'

const listRecoverableKinoGenerations = vi.fn()
const getKinoGeneration = vi.fn()

vi.mock('../catalogGenerationRecovery', () => ({
  listRecoverableKinoGenerations: (...args: unknown[]) => listRecoverableKinoGenerations(...args),
  recoverCatalogGenerations: vi.fn(async () => {}),
  generationScopeKey: (scope: VideoGenerationScope) => JSON.stringify(scope),
}))

vi.mock('../kino-generation-client', async () => {
  const actual = await import('../kino-generation-client')
  return {
    isActiveGenerationStatus: actual.isActiveGenerationStatus,
    getKinoGeneration: (...args: unknown[]) => getKinoGeneration(...args),
  }
})

function task(
  generationId: string,
  status: VideoGenerationTask['status'],
  overrides: Partial<VideoGenerationTask> = {},
): VideoGenerationTask {
  return { generationId, status, createdAt: 123, ...overrides }
}

const NODE_A: VideoGenerationScope = { mediaType: 'video', owner: 'node', blueprintId: 'bp-a', nodeId: 'node-a' }
const NODE_B: VideoGenerationScope = { mediaType: 'video', owner: 'node', blueprintId: 'bp-b', nodeId: 'node-b' }
const ENTITY_A: VideoGenerationScope = { mediaType: 'video', owner: 'entity', entityId: 'entity-a' }

describe('scoped video generation store', () => {
  beforeEach(() => {
    useVideoGenerationStore.setState({ byScope: {} })
    listRecoverableKinoGenerations.mockReset()
    getKinoGeneration.mockReset()
  })

  it('keeps only the still-advancing Kino tasks in the requested scope', async () => {
    listRecoverableKinoGenerations.mockResolvedValue([
      task('generation-1', 'polling', { prompt: '雨夜追逐镜头' }),
      task('generation-2', 'succeeded'),
    ])

    await expect(listActiveVideoGenerationTasks('game-a', NODE_A)).resolves.toEqual([
      task('generation-1', 'polling', { prompt: '雨夜追逐镜头' }),
    ])
    expect(listRecoverableKinoGenerations).toHaveBeenCalledWith('game-a', 'video', NODE_A, {})
  })

  it('stores task selection outside page component lifetime', async () => {
    listRecoverableKinoGenerations.mockResolvedValue([])
    await useVideoGenerationStore.getState().refresh('game-a', NODE_A)
    useVideoGenerationStore.getState().select('game-a', NODE_A, 'generation-1')

    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', NODE_A)]?.selectedGenerationId)
      .toBe('generation-1')
  })

  it('restores the latest active task from the requested scope when no explicit selection exists', async () => {
    listRecoverableKinoGenerations.mockResolvedValue([
      task('generation-1', 'polling', { prompt: '上一入口创建的任务' }),
    ])

    await useVideoGenerationStore.getState().refresh('game-a', NODE_A)

    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', NODE_A)]).toMatchObject({
      tasks: [expect.objectContaining({ generationId: 'generation-1' })],
      selectedTask: expect.objectContaining({ generationId: 'generation-1' }),
    })
  })

  it('loads the selected task detail from the same-origin Kino endpoint', async () => {
    getKinoGeneration.mockResolvedValue(task('generation-1', 'succeeded', {
      prompt: '已完成的提示词',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/generation-1.mp4',
    }))

    await expect(getVideoGenerationTask('game-a', 'generation-1')).resolves.toMatchObject({
      generationId: 'generation-1',
      status: 'succeeded',
      prompt: '已完成的提示词',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/generation-1.mp4',
    })
    expect(getKinoGeneration).toHaveBeenCalledWith('generation-1', 'game-a', {})
  })

  it('publishes a completion revision independently for each scope', async () => {
    listRecoverableKinoGenerations
      .mockResolvedValueOnce([task('generation-1', 'polling')])
      .mockResolvedValueOnce([])

    await useVideoGenerationStore.getState().refresh('game-a', NODE_A)
    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', NODE_A)]?.completionRevision).toBe(0)
    await useVideoGenerationStore.getState().refresh('game-a', NODE_A)
    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', NODE_A)]?.completionRevision).toBe(1)
    expect(listRecoverableKinoGenerations).toHaveBeenCalledTimes(2)
  })

  it('keeps current tasks isolated between node and entity scopes', async () => {
    listRecoverableKinoGenerations.mockImplementation(async (_game: string, _media: string, scope: VideoGenerationScope) => (
      scope === NODE_A
        ? [task('node-a-task', 'polling')]
        : scope === NODE_B
          ? [task('node-b-task', 'polling')]
          : [task('entity-a-task', 'polling')]
    ))

    await useVideoGenerationStore.getState().refresh('game-a', NODE_A)
    await useVideoGenerationStore.getState().refresh('game-a', NODE_B)
    await useVideoGenerationStore.getState().refresh('game-a', ENTITY_A)

    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', NODE_A)]?.selectedTask?.generationId)
      .toBe('node-a-task')
    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', NODE_B)]?.selectedTask?.generationId)
      .toBe('node-b-task')
    expect(useVideoGenerationStore.getState().byScope[videoGenerationStoreKey('game-a', ENTITY_A)]?.selectedTask?.generationId)
      .toBe('entity-a-task')
  })
})
