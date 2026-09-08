import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listRecoverableKinoGenerations,
  recoverCatalogGenerations,
} from '../catalogGenerationRecovery'
import { useGraphScenario } from '../../../persist/graphScenarioStore'

const read = vi.fn()
const readHistory = vi.fn()
const registerGenerated = vi.fn(async (_input: unknown) => {})
const reportImageGenerationLifecycle = vi.fn(async (_input: unknown) => 'asset_kino_generation-1')
const getKinoGeneration = vi.fn()

vi.mock('../../asset-catalog-client', () => ({
  assetCatalogClient: {
    read: () => read(),
    readHistory: (input: unknown) => readHistory(input),
    registerGenerated: (input: unknown) => registerGenerated(input),
  },
}))

vi.mock('../kino-generation-client', async () => {
  const actual = await import('../kino-generation-client')
  return {
    isActiveGenerationStatus: actual.isActiveGenerationStatus,
    getKinoGeneration: (generationId: string, gameSlug: string, options: unknown) => getKinoGeneration(generationId, gameSlug, options),
  }
})

vi.mock('../image-generation-lifecycle-client', () => ({
  reportImageGenerationLifecycle: (input: unknown) => reportImageGenerationLifecycle(input),
}))

function catalogAsset(mediaType: 'image' | 'video' = 'video') {
  const id = `asset_kino_generation-1`
  const entityId = mediaType === 'video' ? 'node-1' : id
  const tabKind = mediaType === 'video' ? 'video' : 'image'
  return {
    id,
    kind: mediaType,
    name: '雨夜镜头',
    status: 'generating',
    productionType: mediaType === 'video' ? 'video_clip' : 'shot_image',
    prompt: '雨夜镜头',
    meta: {
      kinoGenerationId: 'generation-1',
      catalogGeneration: {
        version: 3,
        generationId: 'generation-1',
        mediaType,
        scope: mediaType === 'video'
          ? { mediaType: 'video', owner: 'node', blueprintId: 'main', nodeId: 'node-1' }
          : { mediaType: 'image', targetRoot: 'image', assetId: id },
        parameters: { prompt: '雨夜镜头' },
        placement: { placementKey: `${tabKind}:${entityId}`, folderId: `root:${tabKind}`, sortKey: '1' },
        ...(mediaType === 'video' ? { apply: {
          mode: 'catalog',
          tabKind: 'video',
          entityId,
          createEntity: { name: '雨夜镜头' },
          source: 'generate',
        }, blueprintApply: {
          mode: 'blueprint',
          tabKind: 'video',
          target: { kind: 'node-video', blueprintId: 'main', nodeId: 'node-1' },
        } } : {}),
      },
    },
  }
}

function catalogWith(asset: { id: string } & Record<string, unknown>) {
  return { catalog: { assets: { [asset.id]: asset } } }
}

function catalogWithAssets(...assets: Array<{ id: string } & Record<string, unknown>>) {
  return { catalog: { assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])) } }
}

describe('Catalog generation recovery', () => {
  beforeEach(() => {
    read.mockReset()
    readHistory.mockReset()
    readHistory.mockImplementation(() => read())
    registerGenerated.mockClear()
    reportImageGenerationLifecycle.mockClear()
    getKinoGeneration.mockReset()
    useGraphScenario.setState({ isDraft: false })
  })

  it('recovers an active task by durable id when Kino list does not include it', async () => {
    read.mockResolvedValue(catalogWith(catalogAsset()))
    getKinoGeneration.mockResolvedValue({ generationId: 'generation-1', mediaType: 'video', status: 'polling', prompt: '雨夜镜头' })

    await expect(listRecoverableKinoGenerations('game-a', 'video', { mediaType: 'video', owner: 'node', blueprintId: 'main', nodeId: 'node-1' })).resolves.toEqual([
      expect.objectContaining({ generationId: 'generation-1', status: 'polling' }),
    ])
    expect(getKinoGeneration).toHaveBeenCalledWith('generation-1', 'game-a', {})
    expect(registerGenerated).not.toHaveBeenCalled()
  })

  it('returns only the explicitly requested generation scope', async () => {
    const first = catalogAsset()
    const second = {
      ...catalogAsset(),
      id: 'asset_kino_generation-2',
      meta: {
        ...catalogAsset().meta,
        kinoGenerationId: 'generation-2',
        catalogGeneration: {
          ...catalogAsset().meta.catalogGeneration,
          generationId: 'generation-2',
          scope: { mediaType: 'video', owner: 'node', blueprintId: 'main', nodeId: 'node-2' },
          placement: { placementKey: 'video:node-2', folderId: 'root:video', sortKey: '2' },
        },
      },
    }
    read.mockResolvedValue(catalogWithAssets(first, second))
    getKinoGeneration.mockImplementation(async (generationId: string) => ({
      generationId,
      mediaType: 'video',
      status: 'polling',
    }))

    await expect(listRecoverableKinoGenerations('game-a', 'video', {
      mediaType: 'video', owner: 'node', blueprintId: 'main', nodeId: 'node-1',
    })).resolves.toEqual([expect.objectContaining({ generationId: 'generation-1' })])
    expect(getKinoGeneration).toHaveBeenCalledTimes(1)
    expect(getKinoGeneration).toHaveBeenCalledWith('generation-1', 'game-a', {})
  })

  it('upgrades a completed video in place with the original placement and entity', async () => {
    read.mockResolvedValue(catalogWith({ ...catalogAsset(), name: '鹰道·天隙' }))
    getKinoGeneration.mockResolvedValue({
      generationId: 'generation-1',
      mediaType: 'video',
      status: 'succeeded',
      prompt: '雨夜镜头',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/video.mp4',
    })

    await listRecoverableKinoGenerations('game-a', 'video', { mediaType: 'video', owner: 'node', blueprintId: 'main', nodeId: 'node-1' })

    expect(registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generation-1:recover-succeeded',
      asset: expect.objectContaining({
        id: 'asset_kino_generation-1',
        label: '鹰道·天隙',
        status: 'ready',
        url: 'https://cdn.example.com/video.mp4',
      }),
      placement: { placementKey: 'video:node-1', folderId: 'root:video', sortKey: '1' },
      apply: expect.objectContaining({ mode: 'catalog', tabKind: 'video', entityId: 'node-1' }),
      blueprintApply: {
        mode: 'blueprint',
        tabKind: 'video',
        target: { kind: 'node-video', blueprintId: 'main', nodeId: 'node-1' },
      },
    }))
  })

  it('recovers a completed character image with catalog and blueprint ownership in one registration', async () => {
    const base = catalogAsset('image')
    const asset = {
      ...base,
      productionType: 'character_ref',
      meta: {
        ...base.meta,
        catalogGeneration: {
          ...base.meta.catalogGeneration,
          placement: {
            placementKey: 'character:hero',
            folderId: 'root:character',
            sortKey: '1',
          },
          apply: {
            mode: 'catalog',
            tabKind: 'character',
            entityId: 'hero',
            createEntity: { name: '主角' },
            source: 'generate',
          },
          blueprintApply: {
            mode: 'blueprint',
            tabKind: 'character',
            target: { kind: 'character-preview', characterId: 'hero' },
          },
        },
      },
    }
    read.mockResolvedValue(catalogWith(asset))
    getKinoGeneration.mockResolvedValue({
      generationId: 'generation-1',
      mediaType: 'image',
      status: 'succeeded',
      prompt: '主角',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/hero.png',
    })

    await recoverCatalogGenerations('game-a', 'image')

    expect(reportImageGenerationLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'ready',
      scope: expect.objectContaining({ mediaType: 'image', targetRoot: 'character' }),
      characterId: 'hero',
      placementTarget: 'root:character',
      task: expect.objectContaining({ resourceId: 'resource-1' }),
    }))
  })

  it('defers the whole successful recovery transaction while the blueprint has an unsaved draft', async () => {
    read.mockResolvedValue(catalogWith(catalogAsset()))
    getKinoGeneration.mockResolvedValue({
      generationId: 'generation-1',
      mediaType: 'video',
      status: 'succeeded',
      prompt: '雨夜镜头',
      resourceId: 'resource-1',
      resultUrl: 'https://cdn.example.com/video.mp4',
    })
    useGraphScenario.setState({ isDraft: true })

    await recoverCatalogGenerations('game-a', 'video')

    expect(registerGenerated).not.toHaveBeenCalled()

    useGraphScenario.setState({ isDraft: false })
    await recoverCatalogGenerations('game-a', 'video')

    expect(registerGenerated).toHaveBeenCalledTimes(1)
    expect(registerGenerated).toHaveBeenCalledWith(expect.objectContaining({
      apply: expect.objectContaining({ mode: 'catalog' }),
      blueprintApply: expect.objectContaining({ mode: 'blueprint' }),
    }))
  })

  it('does not interpret v2 tracking as a v3 recovery contract', async () => {
    const asset = catalogAsset()
    asset.meta.catalogGeneration.version = 2
    read.mockResolvedValue(catalogWith(asset))

    await recoverCatalogGenerations('game-a', 'video')

    expect(getKinoGeneration).not.toHaveBeenCalled()
    expect(registerGenerated).not.toHaveBeenCalled()
  })

  it('rejects malformed scope data instead of normalizing it into another owner', async () => {
    const asset = catalogAsset()
    asset.meta.catalogGeneration.scope = {
      mediaType: 'video',
      owner: 'node',
      blueprintId: 'main',
      nodeId: 'node-1',
      graphPath: ['pack-a', 7],
    } as never
    read.mockResolvedValue(catalogWith(asset))

    await recoverCatalogGenerations('game-a', 'video')

    expect(getKinoGeneration).not.toHaveBeenCalled()
    expect(registerGenerated).not.toHaveBeenCalled()
  })

  it('writes a failed image state so the Catalog no longer shows it as generating', async () => {
    read.mockResolvedValue(catalogWith(catalogAsset('image')))
    getKinoGeneration.mockResolvedValue({
      generationId: 'generation-1',
      mediaType: 'image',
      status: 'failed',
      errorMessage: '内容安全校验未通过',
    })

    await recoverCatalogGenerations('game-a', 'image')

    expect(reportImageGenerationLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      placementTarget: 'root:image',
      task: expect.objectContaining({ errorMessage: '内容安全校验未通过' }),
    }))
  })
})
