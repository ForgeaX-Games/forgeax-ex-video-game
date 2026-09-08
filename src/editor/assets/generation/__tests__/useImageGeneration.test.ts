// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KinoGenerationTask } from '../generation-api'
import { useImageGeneration } from '../useImageGeneration'

const ACTIVE: KinoGenerationTask = {
  generationId: 'image-gen-1',
  mediaType: 'image',
  status: 'polling',
  prompt: '雨夜霓虹街道',
  createdAt: 10,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

afterEach(() => vi.useRealTimers())

describe('useImageGeneration', () => {
  it('announces a newly created task so its id can be persisted immediately', async () => {
    const onStarted = vi.fn(async () => {})
    const createGeneration = vi.fn(async () => ACTIVE)
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => []),
      createGeneration,
      onStarted,
    }))
    await waitFor(() => expect(result.current.state.loadingHistory).toBe(false))

    const input = { prompt: '雨夜霓虹街道' }
    act(() => result.current.submit(input))

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(ACTIVE, input))
    expect(result.current.state.currentTask?.generationId).toBe(ACTIVE.generationId)
  })

  it('accepts another image submission while the previous task is tracked', async () => {
    const createGeneration = vi.fn()
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce({ ...ACTIVE, generationId: 'image-gen-2', prompt: '第二张图' })
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => []),
      createGeneration,
    }))
    await waitFor(() => expect(result.current.state.loadingHistory).toBe(false))

    act(() => result.current.submit({ prompt: '第一张图' }))
    await waitFor(() => expect(result.current.state.tracking).toBe(true))
    act(() => result.current.submit({ prompt: '第二张图' }))

    await waitFor(() => expect(createGeneration).toHaveBeenCalledTimes(2))
    expect(result.current.state).toMatchObject({
      phase: 'polling',
      tracking: true,
      currentTask: { generationId: 'image-gen-2' },
    })
  })

  it('polls every submitted task to completion while keeping the newest task selected', async () => {
    vi.useFakeTimers()
    const second = { ...ACTIVE, generationId: 'image-gen-2', prompt: '第二张图' }
    const getGeneration = vi.fn(async (generationId: string) => {
      if (generationId === ACTIVE.generationId) {
        return { ...ACTIVE, status: 'succeeded' as const, resourceId: 'resource-1', resultUrl: 'https://cdn.example.com/1.png' }
      }
      return getGeneration.mock.calls.filter(([id]) => id === second.generationId).length === 1
        ? second
        : { ...second, status: 'succeeded' as const, resourceId: 'resource-2', resultUrl: 'https://cdn.example.com/2.png' }
    })
    const onSucceeded = vi.fn(async () => {})
    const createGeneration = vi.fn().mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(second)
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => []),
      createGeneration,
      getGeneration,
      onSucceeded,
      pollIntervalMs: 1,
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => result.current.submit({ prompt: '第一张图' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.submit({ prompt: '第二张图' }))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(createGeneration).toHaveBeenCalledTimes(2)
    expect(result.current.state.currentTask).toMatchObject({ generationId: 'image-gen-2' })
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })

    expect(result.current.state.currentTask).toMatchObject({ generationId: 'image-gen-2', status: 'polling' })
    expect(onSucceeded).toHaveBeenCalledWith('resource-1', expect.objectContaining({ generationId: 'image-gen-1' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(onSucceeded).toHaveBeenCalledTimes(2)
    expect(onSucceeded).toHaveBeenCalledWith('resource-2', expect.objectContaining({ generationId: 'image-gen-2' }))
    expect(result.current.state.currentTask).toMatchObject({ generationId: 'image-gen-2', status: 'succeeded' })
    await act(async () => { await vi.advanceTimersByTimeAsync(5) })
    expect(onSucceeded).toHaveBeenCalledTimes(2)
  })

  it('keeps an existing active task observed when a later submit fails', async () => {
    vi.useFakeTimers()
    const createGeneration = vi.fn()
      .mockResolvedValueOnce(ACTIVE)
      .mockRejectedValueOnce(new Error('submit failed'))
    const getGeneration = vi.fn(async () => ({
      ...ACTIVE, status: 'succeeded' as const, resourceId: 'resource-1', resultUrl: 'https://cdn.example.com/1.png',
    }))
    const onSucceeded = vi.fn(async () => {})
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo', listGenerations: vi.fn(async () => []), createGeneration, getGeneration, onSucceeded, pollIntervalMs: 1,
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => result.current.submit({ prompt: '第一张图' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.submit({ prompt: '失败的第二张图' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.state).toMatchObject({ phase: 'polling', tracking: true, currentTask: { generationId: 'image-gen-1' }, error: 'submit failed' })

    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(onSucceeded).toHaveBeenCalledWith('resource-1', expect.objectContaining({ generationId: 'image-gen-1' }))
  })

  it('keeps the submitting lock while an older task poll completes during a deferred create', async () => {
    vi.useFakeTimers()
    const second = deferred<KinoGenerationTask>()
    const createGeneration = vi.fn().mockResolvedValueOnce(ACTIVE).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo', listGenerations: vi.fn(async () => []),
      createGeneration,
      getGeneration: vi.fn(async () => ({ ...ACTIVE, status: 'succeeded' as const, resourceId: 'resource-1' })), pollIntervalMs: 1,
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.submit({ prompt: '第一张图' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.submit({ prompt: '第二张图' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(result.current.state.phase).toBe('submitting')
    await act(async () => { second.resolve({ ...ACTIVE, generationId: 'image-gen-2' }); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.state.currentTask?.generationId).toBe('image-gen-2')
  })

  it('waits for out-of-order sibling poll responses before consuming the batch', async () => {
    const firstPoll = deferred<KinoGenerationTask>()
    const secondPoll = deferred<KinoGenerationTask>()
    const second = { ...ACTIVE, generationId: 'image-gen-2' }
    const createGeneration = vi.fn().mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(second)
    const onSucceeded = vi.fn(async () => {})
    const getGeneration = vi.fn((id: string) => id === ACTIVE.generationId ? firstPoll.promise : secondPoll.promise)
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo', listGenerations: vi.fn(async () => []),
      createGeneration,
      getGeneration, onSucceeded, pollIntervalMs: 1,
    }))
    await waitFor(() => expect(result.current.state.loadingHistory).toBe(false))
    act(() => result.current.submit({ prompt: '第一张图' }))
    await waitFor(() => expect(result.current.state.currentTask?.generationId).toBe(ACTIVE.generationId))
    act(() => result.current.submit({ prompt: '第二张图' }))
    await waitFor(() => expect(result.current.state.currentTask?.generationId).toBe(second.generationId))
    await waitFor(() => expect(getGeneration.mock.calls.some(([id]) => id === second.generationId)).toBe(true))
    await act(async () => { secondPoll.resolve({ ...second, status: 'succeeded', resourceId: 'resource-2' }) })
    expect(result.current.state.currentTask?.generationId).toBe('image-gen-2')
    expect(result.current.state.phase).toBe('polling')
    expect(onSucceeded).not.toHaveBeenCalled()
    await act(async () => { firstPoll.resolve({ ...ACTIVE, status: 'succeeded', resourceId: 'resource-1' }) })
    await waitFor(() => expect(onSucceeded).toHaveBeenCalledTimes(2))
    expect(onSucceeded).toHaveBeenCalledWith('resource-1', expect.objectContaining({ generationId: 'image-gen-1' }))
    expect(onSucceeded).toHaveBeenCalledWith('resource-2', expect.objectContaining({ generationId: 'image-gen-2' }))
    expect(result.current.state.activeTasks).toEqual([])
    expect(result.current.state.currentTask).toMatchObject({ generationId: 'image-gen-2', status: 'succeeded' })
  })

  it('keeps a transport poll error explicit and clears it after a later successful retry', async () => {
    const retry = deferred<KinoGenerationTask>()
    const getGeneration = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockReturnValueOnce(retry.promise)
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo', listGenerations: vi.fn(async () => [ACTIVE]), getGeneration, pollIntervalMs: 1,
    }))
    await waitFor(() => expect(result.current.state).toMatchObject({ phase: 'polling', tracking: true, error: 'network down' }))
    await waitFor(() => expect(getGeneration).toHaveBeenCalledTimes(2))
    await act(async () => { retry.resolve({ ...ACTIVE, status: 'succeeded', resourceId: 'resource-1' }) })
    await waitFor(() => expect(result.current.state).toMatchObject({ phase: 'succeeded', tracking: false }))
    expect(result.current.state.error).toBeUndefined()
  })

  it('preserves a server failure returned after a transport retry', async () => {
    const retry = deferred<KinoGenerationTask>()
    const getGeneration = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockReturnValueOnce(retry.promise)
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo', listGenerations: vi.fn(async () => [ACTIVE]), getGeneration, pollIntervalMs: 1,
    }))
    await waitFor(() => expect(result.current.state.error).toBe('network down'))
    await waitFor(() => expect(getGeneration).toHaveBeenCalledTimes(2))
    await act(async () => { retry.resolve({ ...ACTIVE, status: 'failed', errorMessage: '内容安全校验未通过' }) })
    await waitFor(() => expect(result.current.state).toMatchObject({ phase: 'failed', tracking: false, error: '内容安全校验未通过' }))
  })

  it('restores an active image task on page entry and polls it to success', async () => {
    const getGeneration = vi.fn(async () => ({
      ...ACTIVE,
      status: 'succeeded' as const,
      resourceId: 'image-resource-1',
      resultUrl: 'https://cdn.example.com/image.png',
    }))
    const onSucceeded = vi.fn(async () => {})
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => [ACTIVE]),
      getGeneration,
      onSucceeded,
      pollIntervalMs: 1,
    }))

    await waitFor(() => expect(result.current.state.currentTask?.generationId).toBe('image-gen-1'))
    await waitFor(() => expect(result.current.state.phase).toBe('succeeded'))
    expect(getGeneration).toHaveBeenCalledWith('image-gen-1', 'demo')
    expect(onSucceeded).toHaveBeenCalledWith('image-resource-1', expect.objectContaining({
      generationId: 'image-gen-1',
      status: 'succeeded',
    }))
    expect(result.current.state.currentTask?.resultUrl).toContain('image.png')
  })

  it('surfaces a server task failure without a mock result', async () => {
    const createGeneration = vi.fn(async () => ({
      ...ACTIVE,
      status: 'failed' as const,
      errorMessage: '内容安全校验未通过',
    }))
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => []),
      createGeneration,
    }))
    await waitFor(() => expect(result.current.state.loadingHistory).toBe(false))

    act(() => result.current.submit({ prompt: '失败请求' }))

    await waitFor(() => expect(result.current.state.phase).toBe('failed'))
    expect(result.current.state.error).toBe('内容安全校验未通过')
    expect(result.current.state.currentTask?.resultUrl).toBeUndefined()
  })

  it('keeps manual generation empty while retaining completed history', async () => {
    const completed = {
      ...ACTIVE,
      status: 'succeeded' as const,
      resourceId: 'existing-resource',
      resultUrl: 'https://cdn.example.com/existing.png',
    }
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      selectLatestHistory: false,
      listGenerations: vi.fn(async () => [completed]),
    }))

    await waitFor(() => expect(result.current.state.loadingHistory).toBe(false))
    expect(result.current.state.history).toEqual([completed])
    expect(result.current.state.currentTask).toBeUndefined()
    expect(result.current.state.phase).toBe('idle')
  })

  it('polls an active task to the server-provided failed state', async () => {
    const getGeneration = vi.fn(async () => ({
      ...ACTIVE,
      status: 'failed' as const,
      errorCode: 'CONTENT_BLOCKED',
      errorMessage: '参考图片不符合内容规范',
    }))
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => [ACTIVE]),
      getGeneration,
      pollIntervalMs: 1,
    }))

    await waitFor(() => expect(result.current.state.phase).toBe('failed'))
    expect(result.current.state.error).toBe('参考图片不符合内容规范')
    expect(result.current.state.currentTask?.errorCode).toBe('CONTENT_BLOCKED')
  })

  it('stops local waiting for every observed task without changing server task status', async () => {
    const { result } = renderHook(() => useImageGeneration({
      gameSlug: 'demo',
      listGenerations: vi.fn(async () => [ACTIVE]),
      getGeneration: vi.fn(async () => ACTIVE),
    }))
    await waitFor(() => expect(result.current.state.tracking).toBe(true))

    act(() => result.current.stopWaiting())

    expect(result.current.state.tracking).toBe(false)
    expect(result.current.state.activeTasks).toEqual([])
    expect(result.current.state.currentTask?.status).toBe('polling')
    expect(result.current.state.phase).toBe('polling')
  })

  it('clears the previous scope immediately while the next scope history is pending', async () => {
    const scopeBList = deferred<KinoGenerationTask[]>()
    const listGenerations = vi.fn()
      .mockResolvedValueOnce([ACTIVE])
      .mockReturnValueOnce(scopeBList.promise)
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useImageGeneration({
        gameSlug: 'demo',
        scopeKey,
        listGenerations,
      }),
      { initialProps: { scopeKey: 'image|character|hero' } },
    )

    await waitFor(() => expect(result.current.state.currentTask?.generationId).toBe(ACTIVE.generationId))
    rerender({ scopeKey: 'image|scene|room' })

    expect(result.current.state).toMatchObject({ phase: 'idle', tracking: false })
    expect(result.current.state.currentTask).toBeUndefined()
    await act(async () => { scopeBList.resolve([]); await scopeBList.promise })
  })

  it('does not let a previous scope list response re-enter the new scope', async () => {
    const scopeAList = deferred<KinoGenerationTask[]>()
    const scopeBList = deferred<KinoGenerationTask[]>()
    const listGenerations = vi.fn()
      .mockReturnValueOnce(scopeAList.promise)
      .mockReturnValueOnce(scopeBList.promise)
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useImageGeneration({
        gameSlug: 'demo',
        scopeKey,
        listGenerations,
      }),
      { initialProps: { scopeKey: 'image|character|hero' } },
    )

    rerender({ scopeKey: 'image|scene|room' })
    expect(result.current.state.currentTask).toBeUndefined()
    await act(async () => { scopeAList.resolve([ACTIVE]); await scopeAList.promise })
    expect(result.current.state.currentTask).toBeUndefined()
    await act(async () => { scopeBList.resolve([]); await scopeBList.promise })
    expect(result.current.state.currentTask).toBeUndefined()
  })

  it('ignores an in-flight poll from the previous generation scope', async () => {
    vi.useFakeTimers()
    const oldPoll = deferred<KinoGenerationTask>()
    const onSucceeded = vi.fn(async () => {})
    const listGenerations = vi.fn()
      .mockResolvedValueOnce([ACTIVE])
      .mockResolvedValueOnce([])
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useImageGeneration({
        gameSlug: 'demo',
        scopeKey,
        listGenerations,
        getGeneration: vi.fn(() => oldPoll.promise),
        onSucceeded,
        pollIntervalMs: 1,
      }),
      { initialProps: { scopeKey: 'image|character|hero' } },
    )

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.state.currentTask?.generationId).toBe(ACTIVE.generationId)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    rerender({ scopeKey: 'image|scene|room' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    await act(async () => {
      oldPoll.resolve({
        ...ACTIVE,
        status: 'succeeded',
        resourceId: 'old-resource',
        resultUrl: 'https://cdn.example.com/old.png',
      })
      await oldPoll.promise
    })

    expect(result.current.state).toMatchObject({ phase: 'idle', tracking: false })
    expect(result.current.state.currentTask).toBeUndefined()
    expect(onSucceeded).not.toHaveBeenCalled()
  })

  it('persists a created task with the submitted scope callback after switching game', async () => {
    const pending = deferred<KinoGenerationTask>()
    const onStarted = vi.fn(async () => {})
    const createGeneration = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(
      ({ gameSlug }: { gameSlug: string }) => useImageGeneration({
        gameSlug,
        scopeKey: 'image|asset|cover-a',
        listGenerations: vi.fn(async () => []),
        createGeneration,
        onStarted,
      }),
      { initialProps: { gameSlug: 'game-a' } },
    )
    act(() => result.current.submit({ prompt: '旧游戏任务' }))
    rerender({ gameSlug: 'game-b' })
    await act(async () => {
      pending.resolve({ ...ACTIVE, generationId: 'old-game-task' })
      await pending.promise
    })

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'old-game-task' }), { prompt: '旧游戏任务' })
    expect(result.current.state.currentTask).toBeUndefined()
  })
})
