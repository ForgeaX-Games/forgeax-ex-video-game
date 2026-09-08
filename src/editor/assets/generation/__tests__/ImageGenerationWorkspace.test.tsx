// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../../../persist/graphScenarioStore'
import { useCatalogNav } from '../../../persist/catalogNavStore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  registerGenerated: vi.fn<(input: unknown) => Promise<void>>(async () => {}),
  listVisualStyles: vi.fn(async () => []),
  surfaceTargetRoot: undefined as string | undefined,
  surfaceMentionAssets: undefined as undefined | readonly import('../PromptMentionEditor').PromptMentionAsset[],
  catalog: {
    version: 1,
    folders: [],
    placements: {},
    entities: { character: {}, scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {} },
    assets: {},
  } as import('../../asset-catalog').AssetCatalog,
  requestVisualStyles: undefined as undefined | (() => void),
  generationTrack: vi.fn(),
  generationState: {
    phase: 'idle',
    history: [],
    loadingHistory: false,
    tracking: false,
    currentTask: undefined,
  } as import('../useImageGeneration').ImageGenerationState,
  generationOptions: undefined as undefined | {
    onStarted?: (task: import('../generation-api').KinoGenerationTask, input: import('../useImageGeneration').ImageGenerationSubmitInput) => void | Promise<void>
    onSucceeded?: (resourceId: string, task: import('../generation-api').KinoGenerationTask) => void | Promise<void>
  },
}))

vi.mock('../../asset-catalog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../asset-catalog')>(),
  useAssetCatalog: () => ({
    catalog: mocks.catalog,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))
vi.mock('../../asset-catalog-client', () => ({ assetCatalogClient: { registerGenerated: mocks.registerGenerated } }))
vi.mock('../image-generation-lifecycle-client', () => ({
  reportImageGenerationLifecycle: (input: {
    task: import('../generation-api').KinoGenerationTask
    status: 'generating' | 'ready' | 'failed'
    scope: import('../catalogGenerationRecovery').ImageGenerationScope
    characterId?: string
    displayName: string
    placementTarget: string
    parameters: Record<string, unknown>
  }) => {
    const assetId = `asset_kino_${encodeURIComponent(input.task.generationId)}`
    const entityId = input.scope.targetRoot === 'image' ? undefined : input.scope.entityId ?? input.task.generationId
    const business = input.scope.targetRoot !== 'image' && entityId
    return mocks.registerGenerated({
      operationId: `${input.task.generationId}:register-${input.status}`,
      asset: {
        id: assetId,
        status: input.status,
        label: input.displayName,
        sourceModule: 'game-video',
        productionType: input.scope.targetRoot === 'character' ? 'character_ref' : input.scope.targetRoot === 'scene' ? 'scene_ref' : 'shot_image',
        provider: input.task.resourceId ? { upstreamResourceId: input.task.resourceId } : undefined,
        meta: { kinoGenerationId: input.task.generationId, catalogGeneration: { mediaType: 'image', scope: input.scope } },
      },
      ...(!business || input.status === 'ready' ? { placement: {
        placementKey: business ? `${input.scope.targetRoot}:${entityId}` : `image:${assetId}`,
        folderId: input.placementTarget,
      } } : {}),
      ...(input.status === 'ready' && business ? { apply: {
        mode: 'catalog', tabKind: input.scope.targetRoot, entityId,
        createEntity: { name: input.displayName }, source: 'generate',
      } } : {}),
      ...(input.status === 'ready' && input.characterId ? { blueprintApply: {
        mode: 'blueprint', tabKind: 'character', target: { kind: 'character-preview', characterId: input.characterId },
      } } : {}),
    }).then(() => assetId)
  },
}))
vi.mock('../visual-style-api', () => ({
  listVideoVisualStyles: mocks.listVisualStyles,
}))
vi.mock('../useImageGeneration', () => ({
  useImageGeneration: (options: typeof mocks.generationOptions) => {
    mocks.generationOptions = options
    return {
      state: mocks.generationState,
      submit: vi.fn(),
      stopWaiting: vi.fn(),
      track: mocks.generationTrack,
      refresh: vi.fn(),
    }
  },
}))
vi.mock('../ImageGenerationSurface', () => ({
  ImageGenerationSurface: ({ targetRoot, mentionAssets, onRequestVisualStyles }: { targetRoot: string, mentionAssets?: readonly import('../PromptMentionEditor').PromptMentionAsset[], onRequestVisualStyles?: () => void }) => {
    mocks.surfaceTargetRoot = targetRoot
    mocks.surfaceMentionAssets = mentionAssets
    mocks.requestVisualStyles = onRequestVisualStyles
    return null
  },
}))

import { ImageGenerationWorkspace } from '../ImageGenerationWorkspace'

beforeEach(() => {
  mocks.registerGenerated.mockClear()
  mocks.listVisualStyles.mockClear()
  mocks.surfaceTargetRoot = undefined
  mocks.surfaceMentionAssets = undefined
  mocks.catalog.assets = {}
  mocks.requestVisualStyles = undefined
  mocks.generationOptions = undefined
  mocks.generationTrack.mockClear()
  mocks.generationState.phase = 'idle'
  mocks.generationState.history = []
  mocks.generationState.tracking = false
  mocks.generationState.currentTask = undefined
  useGraphScenario.setState({ isDraft: false, syncTipIfClean: vi.fn(async () => 'applied' as const) })
  useCatalogNav.setState({ location: { kind: 'catalog-root', target: 'root:catalog' } })
})
it.each(['control', 'character', 'scene'] as const)(
  'refreshes image assets and preselects the returned Kino resource in the %s root after success',
  async (root) => {
  const onGenerationSucceeded = vi.fn()
  render(<ImageGenerationWorkspace gameId="demo" targetRoot={root} characterId={root === 'character' ? 'hero' : undefined} entityName={root === 'character' ? '主角' : undefined} onGenerationSucceeded={onGenerationSucceeded} />)

  await act(async () => {
    await mocks.generationOptions?.onSucceeded?.('kino-image-resource-1', {
      generationId: 'image-generation-1',
      status: 'succeeded',
      resourceId: 'kino-image-resource-1',
      resultUrl: 'https://example.test/image.png',
      prompt: 'test',
    })
  })

  expect(mocks.registerGenerated).toHaveBeenCalledTimes(1)
  const expectedEntityId = root === 'character' ? 'hero' : 'image-generation-1'
  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    asset: expect.objectContaining({
      id: 'asset_kino_image-generation-1',
      label: root === 'character' ? '主角' : root === 'scene' ? '新场景 1' : 'test',
      provider: expect.objectContaining({ upstreamResourceId: 'kino-image-resource-1' }),
      productionType: root === 'character' ? 'character_ref' : root === 'scene' ? 'scene_ref' : 'shot_image',
      sourceModule: 'game-video',
      meta: expect.objectContaining({
        catalogGeneration: expect.objectContaining({
          scope: {
            mediaType: 'image',
            targetRoot: root,
            entityId: expectedEntityId,
          },
        }),
      }),
    }),
    placement: expect.objectContaining({ placementKey: `${root}:${expectedEntityId}`, folderId: `root:${root}` }),
    apply: expect.objectContaining({ mode: 'catalog', source: 'generate' }),
  }))
  expect(mocks.surfaceTargetRoot).toBe(root)
  expect(onGenerationSucceeded).toHaveBeenCalledWith(
    'asset_kino_image-generation-1',
    expect.objectContaining({ generationId: 'image-generation-1' }),
  )
  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    apply: expect.objectContaining({
      tabKind: root,
      mode: 'catalog',
      entityId: expectedEntityId,
      createEntity: { name: root === 'character' ? '主角' : root === 'scene' ? '新场景 1' : 'test' },
    }),
  }))
  if (root === 'character') {
    expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
      blueprintApply: {
        mode: 'blueprint',
        tabKind: 'character',
        target: { kind: 'character-preview', characterId: 'hero' },
      },
    }))
  } else {
    expect(mocks.registerGenerated.mock.calls[0]?.[0]).not.toEqual(expect.objectContaining({
      blueprintApply: expect.anything(),
    }))
  }
  },
)

it('registers a generating placeholder as soon as Kino returns the generation id', async () => {
  render(<ImageGenerationWorkspace gameId="demo" targetRoot="scene" />)
  await act(async () => {
    await mocks.generationOptions?.onStarted?.({
      generationId: 'image-generation-pending',
      mediaType: 'image',
      status: 'polling',
      createdAt: 10,
    }, { prompt: '雾中森林' })
  })

  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    operationId: 'image-generation-pending:register-generating',
    asset: expect.objectContaining({
      id: 'asset_kino_image-generation-pending',
      status: 'generating',
      meta: expect.objectContaining({
        kinoGenerationId: 'image-generation-pending',
        catalogGeneration: expect.objectContaining({ mediaType: 'image' }),
      }),
    }),
  }))
  expect(mocks.registerGenerated.mock.calls[0]?.[0]).not.toHaveProperty('placement')
})

it('uses an explicit target root instead of stale asset navigation state', async () => {
  render(<ImageGenerationWorkspace gameId="demo" targetRoot="character" />)

  await act(async () => {
    await mocks.generationOptions?.onSucceeded?.('kino-character-resource', {
      generationId: 'image-generation-2',
      status: 'succeeded',
      resourceId: 'kino-character-resource',
      resultUrl: 'https://example.test/character.png',
      prompt: 'character',
    })
  })

  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({ asset: expect.objectContaining({ id: 'asset_kino_image-generation-2' }) }))
})

it('maps the image asset root to the icon generation target', async () => {
  render(<ImageGenerationWorkspace gameId="demo" />)
  await act(async () => {})

  expect(mocks.surfaceTargetRoot).toBe('image')
})

it('passes every catalog asset category to the shared mention picker', () => {
  mocks.catalog.assets = {
    portrait: { id: 'portrait', kind: 'image', name: 'Portrait', resourceId: 'kino-image', status: 'ready' },
    clip: { id: 'clip', kind: 'video', name: 'Clip', resourceId: 'kino-video', status: 'ready' },
    music: { id: 'music', kind: 'audio', name: 'Music', resourceId: 'kino-audio', status: 'ready' },
  }

  render(<ImageGenerationWorkspace gameId="demo" targetRoot="character" />)

  expect(mocks.surfaceMentionAssets).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'portrait', category: 'image', resourceId: 'kino-image' }),
    expect.objectContaining({ id: 'clip', category: 'video', resourceId: 'kino-video' }),
    expect.objectContaining({ id: 'music', category: 'audio', resourceId: 'kino-audio' }),
  ]))
})

it('restores an entry image once without selecting it again after a new generation starts', async () => {
  const entryTask = {
    generationId: 'entry-generation',
    mediaType: 'image' as const,
    status: 'succeeded' as const,
    resourceId: 'entry-resource',
  }
  mocks.generationState.history = [entryTask]
  mocks.generationState.currentTask = entryTask
  const view = render(
    <ImageGenerationWorkspace
      gameId="demo"
      initialAssetId="entry-asset"
      initialResourceId="entry-resource"
      initialTask={entryTask}
      resetKey="entry-asset:1"
    />,
  )
  await act(async () => {})
  expect(mocks.generationTrack).not.toHaveBeenCalled()

  const newTask = {
    generationId: 'new-generation',
    mediaType: 'image' as const,
    status: 'polling' as const,
  }
  mocks.generationState.history = [newTask, entryTask]
  mocks.generationState.currentTask = newTask
  mocks.generationState.phase = 'polling'
  mocks.generationState.tracking = true
  view.rerender(
    <ImageGenerationWorkspace
      gameId="demo"
      initialAssetId="entry-asset"
      initialResourceId="entry-resource"
      initialTask={entryTask}
      resetKey="entry-asset:1"
    />,
  )
  await act(async () => {})

  expect(mocks.generationTrack).not.toHaveBeenCalled()
})

it('keeps generic generated images in the image aggregate without creating an entity', async () => {
  render(<ImageGenerationWorkspace gameId="demo" />)
  await act(async () => {
    await mocks.generationOptions?.onSucceeded?.('kino-image-resource-aggregate', {
      generationId: 'image-generation-aggregate',
      status: 'succeeded',
      resourceId: 'kino-image-resource-aggregate',
      resultUrl: 'https://example.test/aggregate.png',
      prompt: 'generic image',
    })
  })

  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    placement: expect.objectContaining({ placementKey: 'image:asset_kino_image-generation-aggregate', folderId: 'root:image' }),
    asset: expect.objectContaining({ productionType: 'shot_image' }),
  }))
  expect(mocks.registerGenerated.mock.calls[0]?.[0]).not.toHaveProperty('apply')
})

it('keeps distinct Kino generation ids distinct in manifest asset ids', async () => {
  render(<ImageGenerationWorkspace gameId="demo" />)
  await act(async () => {
    await mocks.generationOptions?.onSucceeded?.('resource-space', {
      generationId: 'gen 2', status: 'succeeded', resourceId: 'resource-space', resultUrl: 'https://example.test/a.png',
    })
    await mocks.generationOptions?.onSucceeded?.('resource-dash', {
      generationId: 'gen-2', status: 'succeeded', resourceId: 'resource-dash', resultUrl: 'https://example.test/b.png',
    })
  })
  const ids = mocks.registerGenerated.mock.calls.map(([input]) => (input as { asset: { id: string } }).asset.id)
  expect(ids).toEqual(['asset_kino_gen%202', 'asset_kino_gen-2'])
})

it('finishes durable registration for the old scope without navigating or tracking it in the new scope', async () => {
  const pendingRegistration = deferred<void>()
  mocks.registerGenerated.mockImplementationOnce(() => pendingRegistration.promise)
  const onGenerationSucceeded = vi.fn()
  const view = render(
    <ImageGenerationWorkspace
      gameId="demo"
      targetRoot="scene"
      entityId="scene-a"
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )
  const oldOnSucceeded = mocks.generationOptions?.onSucceeded
  let completion!: Promise<void>
  act(() => {
    completion = Promise.resolve(oldOnSucceeded?.('resource-a', {
      generationId: 'generation-a',
      status: 'succeeded',
      resourceId: 'resource-a',
      resultUrl: 'https://example.test/a.png',
    }))
  })

  view.rerender(
    <ImageGenerationWorkspace
      gameId="demo"
      targetRoot="scene"
      entityId="scene-b"
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )
  await act(async () => {
    pendingRegistration.resolve()
    await completion
  })

  expect(mocks.registerGenerated).toHaveBeenCalledTimes(1)
  expect(onGenerationSucceeded).not.toHaveBeenCalled()
  expect(mocks.generationTrack).not.toHaveBeenCalled()
  expect(useCatalogNav.getState().location).toEqual({ kind: 'catalog-root', target: 'root:catalog' })
})

it('does not write blueprint state from the client after character lifecycle registration', async () => {
  const syncTipIfClean = vi.fn(async () => 'applied' as const)
  useGraphScenario.setState({ isDraft: true, syncTipIfClean })
  const onGenerationSucceeded = vi.fn()
  render(
    <ImageGenerationWorkspace
      gameId="demo"
      targetRoot="character"
      characterId="hero-a"
      entityId="hero-a"
      onGenerationSucceeded={onGenerationSucceeded}
    />,
  )
  await act(async () => {
    await mocks.generationOptions?.onSucceeded?.('resource-a', {
      generationId: 'generation-a',
      status: 'succeeded',
      resourceId: 'resource-a',
      resultUrl: 'https://example.test/a.png',
    })
  })

  expect(syncTipIfClean).not.toHaveBeenCalled()
  expect(onGenerationSucceeded).toHaveBeenCalledWith('asset_kino_generation-a', expect.any(Object))
  expect(mocks.generationTrack).toHaveBeenCalled()
})

it('loads visual styles only when the surface requests them', async () => {
  render(<ImageGenerationWorkspace gameId="demo" />)

  expect(mocks.listVisualStyles).not.toHaveBeenCalled()
  await act(async () => {
    mocks.requestVisualStyles?.()
    mocks.requestVisualStyles?.()
  })
  expect(mocks.listVisualStyles).toHaveBeenCalledTimes(1)
})

it('does not report generation success when atomic catalog registration fails', async () => {
  mocks.registerGenerated.mockRejectedValueOnce(new Error('catalog rejected'))
  const onGenerationSucceeded = vi.fn()
  render(<ImageGenerationWorkspace gameId="demo" onGenerationSucceeded={onGenerationSucceeded} />)

  await act(async () => {
    await expect(mocks.generationOptions?.onSucceeded?.('kino-image-resource-3', {
      generationId: 'image-generation-3', status: 'succeeded', resourceId: 'kino-image-resource-3', resultUrl: 'https://example.test/image.png', prompt: 'test',
    })).rejects.toThrow('catalog rejected')
  })
  expect(onGenerationSucceeded).not.toHaveBeenCalled()
})

it('offers registration retry for a terminal task without invoking generation again', async () => {
  mocks.registerGenerated
    .mockRejectedValueOnce(new Error('catalog unavailable'))
    .mockResolvedValue(undefined)
  render(<ImageGenerationWorkspace gameId="demo" />)

  await act(async () => {
    await expect(mocks.generationOptions?.onSucceeded?.('kino-image-resource-retry', {
      generationId: 'image-generation-retry', status: 'succeeded', resourceId: 'kino-image-resource-retry', resultUrl: 'https://example.test/image.png', prompt: 'test',
    })).rejects.toThrow('catalog unavailable')
  })
  const retry = await screen.findByRole('button', { name: '重试素材登记' })
  await act(async () => { fireEvent.click(retry) })
  expect(mocks.registerGenerated).toHaveBeenCalledTimes(2)
})

it('keeps a generic catalog generation successful when the blueprint rebase is unchanged', async () => {
  useGraphScenario.setState({ isDraft: false, syncTipIfClean: vi.fn(async () => 'unchanged' as const) })
  const onGenerationSucceeded = vi.fn()
  render(<ImageGenerationWorkspace gameId="demo" targetRoot="icon" onGenerationSucceeded={onGenerationSucceeded} />)

  await mocks.generationOptions?.onSucceeded?.('kino-image-resource-4', {
    generationId: 'image-generation-4', status: 'succeeded', resourceId: 'kino-image-resource-4', resultUrl: 'https://example.test/image.png', prompt: 'test',
  })
  expect(onGenerationSucceeded).toHaveBeenCalledWith('asset_kino_image-generation-4', expect.any(Object))
})

it('creates a catalog-only character entity from the character tab root without rebasing the blueprint', async () => {
  useGraphScenario.setState({ isDraft: false, syncTipIfClean: vi.fn(async () => 'unchanged' as const) })
  const onGenerationSucceeded = vi.fn()
  render(<ImageGenerationWorkspace gameId="demo" targetRoot="character" onGenerationSucceeded={onGenerationSucceeded} />)

  await mocks.generationOptions?.onSucceeded?.('kino-image-resource-5', {
    generationId: 'image-generation-5', status: 'succeeded', resourceId: 'kino-image-resource-5', resultUrl: 'https://example.test/image.png', prompt: 'test',
  })
  expect(onGenerationSucceeded).toHaveBeenCalledWith('asset_kino_image-generation-5', expect.any(Object))
  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    apply: expect.objectContaining({
      tabKind: 'character',
      entityId: 'image-generation-5',
      createEntity: { name: '新角色 1' },
    }),
  }))
})

it('preserves an existing scene name instead of replacing it with the prompt', async () => {
  mocks.catalog.entities.scene['scene-1'] = {
    id: 'scene-1', name: '忘川渡口', history: [], createdAt: 1, updatedAt: 1,
  }
  render(<ImageGenerationWorkspace gameId="demo" targetRoot="scene" entityId="scene-1" />)

  await mocks.generationOptions?.onSucceeded?.('kino-scene-resource', {
    generationId: 'image-generation-scene', status: 'succeeded', resourceId: 'kino-scene-resource',
    resultUrl: 'https://example.test/scene.png', prompt: '夜色中的河岸',
  })

  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    asset: expect.objectContaining({ label: '忘川渡口' }),
    apply: expect.objectContaining({ createEntity: { name: '忘川渡口' } }),
  }))
  delete mocks.catalog.entities.scene['scene-1']
})

it('numbers a new standalone image from the first unused image name', async () => {
  mocks.catalog.assets['existing-image'] = {
    id: 'existing-image', kind: 'image', name: '新图片 1', createdAt: 1, updatedAt: 1,
  }
  render(<ImageGenerationWorkspace gameId="demo" />)

  await mocks.generationOptions?.onSucceeded?.('kino-image-resource', {
    generationId: 'image-generation-numbered', status: 'succeeded', resourceId: 'kino-image-resource',
    resultUrl: 'https://example.test/image.png', prompt: '不会作为名称的提示词',
  })

  expect(mocks.registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
    asset: expect.objectContaining({ label: '新图片 2' }),
  }))
})
