// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ClipGenState } from '../useClipGeneration'
import type { VideoGenerationScope } from '../catalogGenerationRecovery'

const GENERATION_SCOPE: VideoGenerationScope = {
  mediaType: 'video',
  owner: 'entity',
  entityId: 'video-root',
}

function requestForTest(prompt: string): import('../generation-api').ClipGenerationRequest {
  return { gameSlug: 'demo', mode: 't2v', prompt, durationSeconds: 5, generateAudio: false }
}

const mocks = vi.hoisted(() => ({
  state: { phase: 'idle', transport: 'kino' } as ClipGenState,
  submit: vi.fn(),
  cancel: vi.fn(),
  surfaceInteraction: undefined as undefined | { disabled?: boolean, readOnly?: boolean },
  surfaceDisabledReason: undefined as string | undefined,
  surfaceInitialResultAssetId: undefined as string | undefined,
  onStarted: undefined as undefined | ((task: import('../generation-api').VideoGenerationTask, request: import('../generation-api').ClipGenerationRequest) => void | Promise<void>),
}))

vi.mock('../../useVideoAssets', () => ({
  useVideoAssets: () => ({ refresh: vi.fn(), items: [] }),
}))
vi.mock('../useVideoGenerationWorkspace', () => ({
  useVideoGenerationWorkspace: (
    _game: string,
    _controller: unknown,
    _scope: VideoGenerationScope,
    onStarted: typeof mocks.onStarted,
  ) => {
    mocks.onStarted = onStarted
    return {
    imageAssets: [],
    recentClips: [],
    clipGeneration: {
      state: mocks.state,
      submit: mocks.submit,
      cancel: mocks.cancel,
      reset: vi.fn(),
      track: vi.fn(),
    },
    }
  },
}))
vi.mock('../VideoGenerationSurface', () => ({
  VideoGenerationSurface: (props: {
    onSubmit: (request: Record<string, unknown>) => void
    interaction?: { disabled?: boolean, readOnly?: boolean }
    generationDisabledReason?: string
    initialResultAssetId?: string
    submissionError?: string | null
  }) => (
    (() => {
      mocks.surfaceInteraction = props.interaction
      mocks.surfaceDisabledReason = props.generationDisabledReason
      mocks.surfaceInitialResultAssetId = props.initialResultAssetId
      return <>
        <button type="button" onClick={() => props.onSubmit({
          gameSlug: 'demo',
          mode: 't2v',
          prompt: 'prompt',
          durationSeconds: 5,
          generateAudio: false,
        })}>
          submit
        </button>
        {props.submissionError ? <p role="alert">{props.submissionError}</p> : null}
      </>
    })()
  ),
}))

import { VideoGenerationWorkspace } from '../VideoGenerationWorkspace'

beforeEach(() => {
  mocks.state = { phase: 'idle', transport: 'kino' }
  mocks.submit.mockClear()
  mocks.cancel.mockClear()
  mocks.onStarted = undefined
  mocks.surfaceInteraction = undefined
  mocks.surfaceDisabledReason = undefined
  mocks.surfaceInitialResultAssetId = undefined
})

it('forwards a created Kino task to durable registration immediately', async () => {
  const onGenerationStarted = vi.fn(async () => {})
  render(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} onClose={vi.fn()} onGenerationStarted={onGenerationStarted} />)
  const request = { gameSlug: 'demo', mode: 't2v' as const, prompt: '雨夜追逐', durationSeconds: 5, generateAudio: false }
  await act(async () => {
    await mocks.onStarted?.({ generationId: 'video-generation-pending', status: 'polling' }, request)
  })
  expect(onGenerationStarted).toHaveBeenCalledWith(
    expect.objectContaining({ generationId: 'video-generation-pending' }),
    request,
  )
})

it('forwards a disabled node interaction to the generation surface', () => {
  render(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} onClose={vi.fn()} interaction={{ disabled: true }} />)

  expect(mocks.surfaceInteraction).toEqual({ disabled: true })
})

it('forwards the restored manifest video id to the generation surface', () => {
  render(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} initialResultAssetId="manifest-video-1" onClose={vi.fn()} />)

  expect(mocks.surfaceInitialResultAssetId).toBe('manifest-video-1')
})

it('forwards the disabled node reason to the generation surface', () => {
  render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      interaction={{ disabled: true }}
      generationDisabledReason="节点视频正在准备中"
    />,
  )

  expect(mocks.surfaceDisabledReason).toBe('节点视频正在准备中')
})

it('surfaces node submission validation errors without creating a Kino task', async () => {
  render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      validateSubmit={vi.fn(async () => {
        throw new Error('节点所需角色或场景参考图已被移除，请恢复预填参考图后再生成')
      })}
    />,
  )

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
  })

  expect(screen.getByRole('alert')).toHaveTextContent('节点所需角色或场景参考图已被移除')
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('does not submit a validation continuation after switching generation scope', async () => {
  let resolveValidation!: () => void
  const validateSubmit = vi.fn(() => new Promise<void>((resolve) => { resolveValidation = resolve }))
  const view = render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      validateSubmit={validateSubmit}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'submit' }))
  view.rerender(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={{ mediaType: 'video', owner: 'node', blueprintId: 'bp-other', nodeId: 'node-other' }}
      onClose={vi.fn()}
      validateSubmit={validateSubmit}
    />,
  )
  await act(async () => { resolveValidation(); await Promise.resolve() })

  expect(mocks.submit).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('does not bind a restored successful task to a newly opened node page', () => {
  mocks.state = {
    phase: 'succeeded',
    transport: 'kino',
    generationId: 'restored-task',
    resourceId: 'restored-resource',
  }
  const onGenerationSucceeded = vi.fn()

  render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )

  expect(onGenerationSucceeded).not.toHaveBeenCalled()
})

it('binds the task submitted from the current workspace after it succeeds', async () => {
  const onGenerationSucceeded = vi.fn()
  const view = render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )

  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'submit' }))
    await mocks.onStarted?.({ generationId: 'current-task', status: 'polling' }, requestForTest('prompt'))
  })
  expect(mocks.submit).toHaveBeenCalledTimes(1)

  mocks.state = {
    phase: 'succeeded',
    transport: 'kino',
    generationId: 'current-task',
    resourceId: 'current-resource',
  }
  view.rerender(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )

  expect(onGenerationSucceeded).toHaveBeenCalledWith('current-resource', expect.objectContaining({ generationId: 'current-task', status: 'succeeded', resourceId: 'current-resource' }))
})

it('binds only generation ids started by this scope, including multiple same-scope tasks', async () => {
  const onGenerationSucceeded = vi.fn()
  const view = render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )
  await act(async () => {
    await mocks.onStarted?.({ generationId: 'started-a', status: 'polling' }, { ...requestForTest('a') })
    await mocks.onStarted?.({ generationId: 'started-b', status: 'polling' }, { ...requestForTest('b') })
  })

  mocks.state = { phase: 'succeeded', transport: 'kino', generationId: 'unrelated', resourceId: 'unrelated-resource' }
  view.rerender(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} onClose={vi.fn()} onGenerationSucceeded={onGenerationSucceeded} />)
  expect(onGenerationSucceeded).not.toHaveBeenCalled()

  mocks.state = { phase: 'succeeded', transport: 'kino', generationId: 'started-a', resourceId: 'resource-a' }
  view.rerender(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} onClose={vi.fn()} onGenerationSucceeded={onGenerationSucceeded} />)
  mocks.state = { phase: 'succeeded', transport: 'kino', generationId: 'started-b', resourceId: 'resource-b' }
  view.rerender(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} onClose={vi.fn()} onGenerationSucceeded={onGenerationSucceeded} />)

  expect(onGenerationSucceeded).toHaveBeenCalledWith('resource-a', expect.objectContaining({ generationId: 'started-a' }))
  expect(onGenerationSucceeded).toHaveBeenCalledWith('resource-b', expect.objectContaining({ generationId: 'started-b' }))
})

it('offers an explicit catalog-registration retry without submitting Kino again', async () => {
  const onGenerationSucceeded = vi.fn()
    .mockRejectedValueOnce(new Error('catalog unavailable'))
    .mockResolvedValue(undefined)
  const view = render(
    <VideoGenerationWorkspace
      gameId="demo"
      generationScope={GENERATION_SCOPE}
      onClose={vi.fn()}
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'submit' }))
    await mocks.onStarted?.({ generationId: 'terminal-task', status: 'polling' }, requestForTest('prompt'))
    mocks.state = {
      phase: 'succeeded', transport: 'kino', generationId: 'terminal-task', resourceId: 'terminal-resource',
    }
    view.rerender(<VideoGenerationWorkspace gameId="demo" generationScope={GENERATION_SCOPE} onClose={vi.fn()} onGenerationSucceeded={onGenerationSucceeded} />)
  })
  expect(await screen.findByRole('button', { name: '重试素材登记' })).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试素材登记' })) })
  expect(onGenerationSucceeded).toHaveBeenCalledTimes(2)
  expect(mocks.submit).toHaveBeenCalledTimes(1)
})
