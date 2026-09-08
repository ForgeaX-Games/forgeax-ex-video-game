// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipGenerationRequest, VideoGenerationTask } from '../generation-api'
import type { CreateKinoGenerationInput } from '../kino-generation-client'
import { useClipGeneration, type UseClipGenerationOptions } from '../useClipGeneration'
import { adaptVideoKinoTask } from '../components'

const GAME_SLUG = 'bridge-game'

const request: ClipGenerationRequest = {
  gameSlug: GAME_SLUG,
  prompt: 'A knight crossing a rain-soaked bridge',
  durationSeconds: 30,
  generateAudio: true,
  mode: 'strict',
  firstFrameResourceId: 'kino-first',
  lastFrameResourceId: 'kino-last',
  size: '1440x2560',
  resolution: '1080p',
  model: 'seedance2',
  visualStyleKey: 'bwcinema',
  label: 'Bridge shot',
}

function task(overrides: Partial<VideoGenerationTask> = {}): VideoGenerationTask {
  return { generationId: 'generation-1', status: 'polling', createdAt: 1, ...overrides }
}

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

function mount(options: UseClipGenerationOptions) {
  return renderHook(() => useClipGeneration({ gameSlug: GAME_SLUG, ...options }))
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('useClipGeneration same-origin Kino flow', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends the full Kino payload including game and provider parameters', async () => {
    const createGeneration = vi.fn().mockResolvedValue(
      task({ status: 'succeeded', resultUrl: 'https://cdn.example/clip.mp4' }),
    )
    const { result } = mount({ createGeneration, getGeneration: vi.fn() })

    expect(result.current.state).toEqual({ phase: 'idle', transport: 'kino' })
    act(() => result.current.submit(request))
    await flush()

    expect(createGeneration).toHaveBeenCalledWith({
      gameSlug: GAME_SLUG,
      prompt: request.prompt,
      durationSeconds: 15,
      generateAudio: true,
      size: '1440x2560',
      resolution: '1080p',
      model: 'seedance2',
      visualStyleKey: 'bwcinema',
      firstFrameResourceId: 'kino-first',
      lastFrameResourceId: 'kino-last',
    })
    expect(result.current.state).toMatchObject({
      phase: 'succeeded',
      generationId: 'generation-1',
      resultUrl: 'https://cdn.example/clip.mp4',
    })
  })

  it('announces the created task before polling so callers can persist its id', async () => {
    const created = task()
    const onStarted = vi.fn(async () => {})
    const { result } = mount({
      createGeneration: vi.fn().mockResolvedValue(created),
      getGeneration: vi.fn(),
      onStarted,
    })

    act(() => result.current.submit(request))
    await flush()

    expect(onStarted).toHaveBeenCalledWith(created, request)
    expect(result.current.state).toMatchObject({ phase: 'generating', generationId: created.generationId })
  })

  it('starts another durable task after the previous create request returns', async () => {
    const createGeneration = vi.fn()
      .mockResolvedValueOnce(task({ generationId: 'generation-1' }))
      .mockResolvedValueOnce(task({ generationId: 'generation-2' }))
    const onStarted = vi.fn(async () => {})
    const { result } = mount({ createGeneration, getGeneration: vi.fn(), onStarted })

    act(() => result.current.submit({ ...request, prompt: 'first task' }))
    await flush()
    expect(result.current.state).toMatchObject({ phase: 'generating', generationId: 'generation-1' })

    act(() => result.current.submit({ ...request, prompt: 'second task' }))
    await flush()

    expect(createGeneration).toHaveBeenCalledTimes(2)
    expect(onStarted).toHaveBeenCalledTimes(2)
    expect(onStarted).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ generationId: 'generation-1' }),
      expect.objectContaining({ prompt: 'first task' }),
    )
    expect(onStarted).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ generationId: 'generation-2' }),
      expect.objectContaining({ prompt: 'second task' }),
    )
    expect(result.current.state).toMatchObject({ phase: 'generating', generationId: 'generation-2' })
  })

  it('keeps the real submit request through task completion and history restore adaptation', async () => {
    const response = task({
      status: 'succeeded',
      prompt: undefined,
      resultUrl: 'https://cdn.example/clip.mp4',
      params: undefined,
    })
    const createGeneration = vi.fn().mockResolvedValue(response)
    const { result } = mount({ createGeneration, getGeneration: vi.fn() })

    act(() => result.current.submit(request))
    await flush()

    expect(result.current.state.params).toMatchObject({
      gameSlug: GAME_SLUG,
      prompt: request.prompt,
      durationSeconds: request.durationSeconds,
      mode: request.mode,
      firstFrameResourceId: request.firstFrameResourceId,
      lastFrameResourceId: request.lastFrameResourceId,
    })
    const history = adaptVideoKinoTask({
      ...response,
      params: result.current.state.params,
    })
    expect(history.restorePayload).toMatchObject({
      prompt: request.prompt,
      durationSeconds: request.durationSeconds,
      mode: request.mode,
      firstFrameResourceId: request.firstFrameResourceId,
      lastFrameResourceId: request.lastFrameResourceId,
    })
  })

  it('polls until the task reaches a terminal status and notifies once', async () => {
    const createGeneration = vi.fn().mockResolvedValue(task())
    const getGeneration = vi.fn()
      .mockResolvedValueOnce(task({ status: 'polling' }))
      .mockResolvedValue(task({ status: 'succeeded', resultUrl: 'https://cdn.example/a.mp4' }))
    const onTerminal = vi.fn()
    const { result } = mount({ createGeneration, getGeneration, onTerminal })

    act(() => result.current.submit({ ...request, mode: 't2v' }))
    await flush()
    expect(result.current.state.phase).toBe('generating')

    await advance(3_000)
    expect(result.current.state.phase).toBe('generating')

    await advance(3_000)
    expect(result.current.state).toMatchObject({
      phase: 'succeeded',
      resultUrl: 'https://cdn.example/a.mp4',
    })
    expect(onTerminal).toHaveBeenCalledOnce()

    await advance(9_000)
    expect(getGeneration).toHaveBeenCalledTimes(2)
    expect(onTerminal).toHaveBeenCalledOnce()
  })

  it('tolerates transient polling errors before giving up', async () => {
    const createGeneration = vi.fn().mockResolvedValue(task())
    const getGeneration = vi.fn().mockRejectedValue(new Error('gateway hiccup'))
    const { result } = mount({ createGeneration, getGeneration })

    act(() => result.current.submit({ ...request, mode: 't2v' }))
    await flush()

    await advance(12_000)
    expect(result.current.state.phase).toBe('generating')

    await advance(3_000)
    expect(result.current.state).toMatchObject({
      phase: 'failed',
      error: 'gateway hiccup',
    })
    expect(getGeneration).toHaveBeenCalledTimes(5)
  })

  it('surfaces a failed Kino task with its upstream message', async () => {
    const createGeneration = vi.fn().mockResolvedValue(
      task({ status: 'failed', errorMessage: '上游拒绝请求' }),
    )
    const { result } = mount({ createGeneration, getGeneration: vi.fn() })

    act(() => result.current.submit({ ...request, mode: 't2v' }))
    await flush()

    expect(result.current.state).toMatchObject({ phase: 'failed', error: '上游拒绝请求' })
  })

  it('restores a globally selected task and its prompt without resubmitting', () => {
    const createGeneration = vi.fn()
    const restoredTask = task({ prompt: '刷新前的提示词' })
    const { result } = mount({
      createGeneration,
      getGeneration: vi.fn().mockResolvedValue(restoredTask),
      restoredTask,
      activeTasks: [restoredTask],
    })

    expect(result.current.state).toMatchObject({
      phase: 'generating',
      generationId: 'generation-1',
      prompt: '刷新前的提示词',
      activeTasks: [restoredTask],
    })
    expect(createGeneration).not.toHaveBeenCalled()
  })

  it('rejects references that carry no Kino resource id', () => {
    const createGeneration = vi.fn()
    const { result } = mount({ createGeneration, getGeneration: vi.fn() })

    act(() => result.current.submit({
      ...request,
      firstFrameResourceId: undefined,
      lastFrameResourceId: undefined,
    }))

    expect(result.current.state.phase).toBe('failed')
    expect(result.current.state.error).toBeTruthy()
    expect(createGeneration).not.toHaveBeenCalled()
  })

  it('refuses to generate before the host supplies a game slug', () => {
    const createGeneration = vi.fn()
    const { result } = renderHook(() => useClipGeneration({
      gameSlug: '',
      createGeneration,
      getGeneration: vi.fn(),
    }))

    act(() => result.current.submit({ ...request, mode: 't2v' }))

    expect(result.current.state.phase).toBe('failed')
    expect(createGeneration).not.toHaveBeenCalled()
  })

  it('cancel ignores a stale creation response and stops polling', async () => {
    const pending = deferred<VideoGenerationTask>()
    const getGeneration = vi.fn()
    const { result } = mount({
      createGeneration: (_input: CreateKinoGenerationInput) => pending.promise,
      getGeneration,
    })

    act(() => result.current.submit({ ...request, mode: 't2v' }))
    act(() => result.current.cancel())
    await act(async () => { pending.resolve(task()) })

    expect(result.current.state).toEqual({ phase: 'idle', transport: 'kino' })
    await advance(9_000)
    expect(getGeneration).not.toHaveBeenCalled()
  })

  it('track resumes polling for a known generation id', async () => {
    const getGeneration = vi.fn().mockResolvedValue(
      task({ generationId: 'generation-9', status: 'succeeded', resultUrl: 'https://cdn/x.mp4' }),
    )
    const { result } = mount({ createGeneration: vi.fn(), getGeneration })

    act(() => result.current.track('generation-9'))
    expect(result.current.state.phase).toBe('generating')

    await advance(3_000)
    expect(getGeneration).toHaveBeenCalledWith('generation-9', GAME_SLUG)
    expect(result.current.state).toMatchObject({
      phase: 'succeeded',
      resultUrl: 'https://cdn/x.mp4',
    })
  })

  it('clears a restored task immediately when the generation scope changes', () => {
    const active = task({ status: 'polling' })
    const { result, rerender } = renderHook(
      ({ scopeKey, restoredTask }: { scopeKey: string; restoredTask?: VideoGenerationTask }) => useClipGeneration({
        gameSlug: GAME_SLUG,
        scopeKey,
        restoredTask,
        activeTasks: restoredTask ? [restoredTask] : [],
        getGeneration: vi.fn(),
      }),
      { initialProps: { scopeKey: 'video|node|bp-a|node-a', restoredTask: active } as { scopeKey: string; restoredTask?: VideoGenerationTask } },
    )

    expect(result.current.state.generationId).toBe(active.generationId)
    rerender({ scopeKey: 'video|node|bp-b|node-b', restoredTask: undefined })

    expect(result.current.state).toEqual({ phase: 'idle', transport: 'kino' })
  })

  it('ignores a previous scope submit response after switching scope', async () => {
    const pending = deferred<VideoGenerationTask>()
    const createGeneration = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(
      ({ scopeKey }: { scopeKey: string }) => useClipGeneration({
        gameSlug: GAME_SLUG,
        scopeKey,
        createGeneration,
        getGeneration: vi.fn(),
      }),
      { initialProps: { scopeKey: 'video|entity|a' } },
    )

    act(() => result.current.submit({ ...request, mode: 't2v' }))
    rerender({ scopeKey: 'video|entity|b' })
    await act(async () => { pending.resolve(task()); await pending.promise })

    expect(result.current.state).toEqual({ phase: 'idle', transport: 'kino' })
  })

  it('ignores an in-flight poll from the previous generation scope', async () => {
    const oldPoll = deferred<VideoGenerationTask>()
    const onTerminal = vi.fn()
    const active = task({ status: 'polling' })
    const { result, rerender } = renderHook(
      ({ scopeKey, restoredTask }: { scopeKey: string; restoredTask?: VideoGenerationTask }) => useClipGeneration({
        gameSlug: GAME_SLUG,
        scopeKey,
        restoredTask,
        activeTasks: restoredTask ? [restoredTask] : [],
        getGeneration: vi.fn(() => oldPoll.promise),
        onTerminal,
      }),
      { initialProps: { scopeKey: 'video|node|bp-a|node-a', restoredTask: active } as { scopeKey: string; restoredTask?: VideoGenerationTask } },
    )

    await advance(3_000)
    rerender({ scopeKey: 'video|node|bp-b|node-b', restoredTask: undefined })
    oldPoll.resolve(task({ status: 'succeeded', resultUrl: 'https://cdn.example.com/old.mp4' }))
    await flush()

    expect(result.current.state).toEqual({ phase: 'idle', transport: 'kino' })
    expect(onTerminal).not.toHaveBeenCalled()
  })

  it('persists a created task with the submitted callback after switching game', async () => {
    const pending = deferred<VideoGenerationTask>()
    const onStarted = vi.fn(async () => {})
    const createGeneration = vi.fn(() => pending.promise)
    const { result, rerender } = renderHook(
      ({ gameSlug }: { gameSlug: string }) => useClipGeneration({
        gameSlug,
        scopeKey: 'video|entity|clip-a',
        createGeneration,
        onStarted,
        getGeneration: vi.fn(),
      }),
      { initialProps: { gameSlug: GAME_SLUG } },
    )
    act(() => result.current.submit({ ...request, mode: 't2v' }))
    rerender({ gameSlug: 'other-game' })
    await act(async () => {
      pending.resolve(task({ generationId: 'old-game-video' }))
      await pending.promise
    })

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'old-game-video' }), expect.objectContaining({ prompt: request.prompt }))
    expect(result.current.state).toEqual({ phase: 'idle', transport: 'kino' })
  })
})
