import type {
  BoundedGameFiles,
  ExtensionContext,
} from '@forgeax/extension-host/node'
import type {
  ImageGenerationInput,
  MediaAsset as HostMediaAsset,
  MediaBody,
  MediaCapability,
  MediaQuery,
  MediaWriteInput,
  ModelCapability,
  ServiceCapability,
  TextGenerationInput,
  VideoGenerationGateway,
  VideoGenerationInput,
} from '@forgeax/extension-host/contracts'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createHostAssetRegistry,
  sanitizePublicText,
} from '../asset-registry'
import {
  characterPreviewAssetId,
  characterPreviewSourceHash,
} from '../generation/character-previews'
import blueprint from './fixtures/nodia.blueprint.json'
import {
  createGameVideoService,
  getAssetIdFromArgs,
} from './extension-service'
import { createInitialWorkflowState } from './workflow-state'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const originalForgeaxServerPort = process.env.FORGEAX_SERVER_PORT

const unavailableVideoGeneration: VideoGenerationGateway = {
  async start() { throw new Error('Video generation is unavailable in this test context') },
  async get() { throw new Error('Video generation is unavailable in this test context') },
  async cancel() { throw new Error('Video generation is unavailable in this test context') },
  async generateVideo() { throw new Error('Video generation is unavailable in this test context') },
}

const unavailableServices: ServiceCapability = {
  async scope() { throw new Error('Services are unavailable in this test context') },
  async request() { throw new Error('Services are unavailable in this test context') },
  async stageMedia() { throw new Error('Services are unavailable in this test context') },
}

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for test condition')
}

class MemoryFiles implements BoundedGameFiles {
  private static readonly queues = new WeakMap<
    Map<string, Uint8Array>,
    Map<string, Promise<void>>
  >()
  readonly entries: Map<string, Uint8Array>
  readonly calls: string[] = []

  constructor(
    entries: Record<string, Uint8Array> = {},
    backing = new Map<string, Uint8Array>(),
  ) {
    this.entries = backing
    for (const [path, bytes] of Object.entries(entries)) {
      this.entries.set(path, new Uint8Array(bytes))
    }
  }

  async read(path: string): Promise<Uint8Array | null> {
    expect(path).not.toMatch(/^(?:\/|[A-Za-z]:[\\/])/)
    expect(path).not.toContain('..')
    this.calls.push(`read:${path}`)
    const bytes = this.entries.get(path)
    return bytes ? new Uint8Array(bytes) : null
  }

  async write(path: string, contents: Uint8Array): Promise<void> {
    expect(path).not.toMatch(/^(?:\/|[A-Za-z]:[\\/])/)
    expect(path).not.toContain('..')
    this.calls.push(`write:${path}`)
    this.entries.set(path, new Uint8Array(contents))
  }

  async delete(path: string): Promise<void> {
    expect(path).not.toMatch(/^(?:\/|[A-Za-z]:[\\/])/)
    expect(path).not.toContain('..')
    this.calls.push(`delete:${path}`)
    this.entries.delete(path)
  }

  async list(path: string): Promise<string[]> {
    expect(path).not.toMatch(/^(?:\/|[A-Za-z]:[\\/])/)
    expect(path).not.toContain('..')
    this.calls.push(`list:${path}`)
    const prefix = `${path.replace(/\/+$/, '')}/`
    return [...new Set(
      [...this.entries.keys()]
        .filter((entry) => entry.startsWith(prefix))
        .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!)
        .filter(Boolean),
    )].sort()
  }

  async withLocks<T>(
    keys: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    this.calls.push(`locks:${[...keys].sort().join(',')}`)
    const queues = MemoryFiles.queues.get(this.entries) ?? new Map<string, Promise<void>>()
    MemoryFiles.queues.set(this.entries, queues)
    const releases: Array<() => void> = []
    for (const key of [...new Set(keys)].sort()) {
      const previous = queues.get(key) ?? Promise.resolve()
      let release!: () => void
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const tail = previous.then(() => current)
      queues.set(key, tail)
      await previous
      releases.push(() => {
        release()
        if (queues.get(key) === tail) queues.delete(key)
      })
    }
    try {
      return await operation()
    } finally {
      for (const release of releases.reverse()) release()
      if (queues.size === 0) {
        MemoryFiles.queues.delete(this.entries)
      }
    }
  }
}

class MemoryMedia implements MediaCapability {
  readonly bodies = new Map<string, MediaBody>()
  readonly assets = new Map<string, HostMediaAsset>()
  readonly puts: MediaWriteInput[] = []
  readonly receipts = new Map<string, {
    readonly fingerprint: string
    readonly asset: HostMediaAsset
  }>()
  #sequence = 0

  async list(_gameId: string, query?: MediaQuery): Promise<HostMediaAsset[]> {
    let assets = [...this.assets.values()]
    if (query?.type) {
      assets = assets.filter((asset) => asset.type === query.type)
    }
    return assets.map((asset) => structuredClone(asset))
  }

  async read(_gameId: string, assetId: string): Promise<MediaBody | null> {
    const body = this.bodies.get(assetId)
    return body
      ? { contentType: body.contentType, bytes: new Uint8Array(body.bytes) }
      : null
  }

  async put(gameId: string, input: MediaWriteInput): Promise<HostMediaAsset> {
    this.puts.push({
      ...input,
      bytes: new Uint8Array(input.bytes),
      metadata: input.metadata ? structuredClone(input.metadata) : undefined,
    })
    const fingerprint = JSON.stringify({
      filename: input.filename,
      contentType: input.contentType,
      bytes: [...input.bytes],
      metadata: input.metadata ?? null,
    })
    const receiptKey = input.idempotencyKey
      ? `${gameId}\0${input.idempotencyKey}`
      : undefined
    const receipt = receiptKey ? this.receipts.get(receiptKey) : undefined
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) {
        throw new TypeError('Media idempotency key was reused with a different payload')
      }
      return structuredClone(receipt.asset)
    }
    const id = `${gameId}:media-${++this.#sequence}`
    this.bodies.set(id, {
      contentType: input.contentType,
      bytes: new Uint8Array(input.bytes),
    })
    const asset: HostMediaAsset = {
      id,
      type: input.contentType.startsWith('video/') ? 'video' : 'image',
      url: `https://media.invalid/${id}`,
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      ...(input.metadata ? {
        metadata: structuredClone(input.metadata),
      } : {}),
    }
    this.assets.set(id, structuredClone(asset))
    if (receiptKey) {
      this.receipts.set(receiptKey, {
        fingerprint,
        asset: structuredClone(asset),
      })
    }
    return asset
  }

  async delete(_gameId: string, assetId: string): Promise<void> {
    this.bodies.delete(assetId)
    this.assets.delete(assetId)
  }
}

class MemoryModels implements ModelCapability {
  readonly textInputs: TextGenerationInput[] = []
  readonly imageInputs: ImageGenerationInput[] = []
  readonly videoInputs: VideoGenerationInput[] = []

  constructor(private readonly media: MemoryMedia) {}

  async generateText(input: TextGenerationInput) {
    this.textInputs.push(structuredClone(input))
    return {
      text: JSON.stringify([
        { shotNumber: 1, durationSeconds: 8, seedancePrompt: 'A bounded shot' },
      ]),
      model: 'memory-text',
    }
  }

  async generateImage(input: ImageGenerationInput) {
    this.imageInputs.push(structuredClone(input))
    // 每次生成返回唯一 id，与真实 provider 一致。固定 id 在批内并发下会互相踩：
    // 先完成的那张持久化后会回收源媒体，另一张再读就已经不存在了。
    const id = `model:image-${this.imageInputs.length}`
    this.media.bodies.set(id, {
      contentType: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 4]),
    })
    return {
      assets: [{
        id,
        type: 'image' as const,
        url: 'https://model.invalid/private-keyframe.png',
        contentType: 'image/png',
        sizeBytes: 4,
      }],
      model: 'memory-image',
    }
  }

  async generateVideo(input: VideoGenerationInput) {
    this.videoInputs.push(structuredClone(input))
    const id = `model:video-${this.videoInputs.length}`
    this.media.bodies.set(id, {
      contentType: 'video/mp4',
      bytes: new Uint8Array([5, 6, 7, 8]),
    })
    return {
      assets: [{
        id,
        type: 'video' as const,
        url: 'https://model.invalid/private-video.mp4',
        contentType: 'video/mp4',
        sizeBytes: 4,
      }],
      model: 'memory-video',
    }
  }
}

interface MemoryVideoCapabilityResult {
  video: {
    bytes: Uint8Array
    mime: string
    sourceUrl: string
    provider: {
      kind: string
      ref: string
      upstreamResourceId: string
    }
  }
}

function memoryVideoCapabilityResult(
  id: string,
  bytes = new Uint8Array([5, 6, 7, 8]),
): MemoryVideoCapabilityResult {
  return {
    video: {
      bytes,
      mime: 'video/mp4',
      sourceUrl: `https://capability.invalid/${id}.mp4`,
      provider: {
        kind: 'memory-video',
        ref: `memory:${id}`,
        upstreamResourceId: id,
      },
    },
  }
}

class MemoryCapabilities {
  readonly videoInputs: unknown[] = []

  constructor(private readonly media: MemoryMedia) {}

  async invoke(id: string, version: number, input: unknown): Promise<unknown> {
    if (id !== 'media.video.generate' || version !== 1) {
      throw new Error(`Unsupported capability: ${id}@${version}`)
    }
    this.videoInputs.push(structuredClone(input))
    const generatedId = `capability:video-${this.videoInputs.length}`
    const result = memoryVideoCapabilityResult(generatedId)
    this.media.bodies.set(generatedId, {
      contentType: result.video.mime,
      bytes: new Uint8Array(result.video.bytes),
    })
    return result
  }
}

function createContext() {
  const files = new MemoryFiles({
    'blueprint.json': json(blueprint),
    'project.json': json({
      id: '游戏一',
      platform: 'game-video',
      entry: { blueprint: 'blueprint.json', components: 'dist/components' },
    }),
    'assets/manifest.json': json({ version: 2, assets: [] }),
    'characters/hero/manifest.json': json({
      charId: 'hero',
      name: 'Hero',
      portrait: { front: 'portrait/front.png' },
    }),
    'characters/hero/portrait/front.png': new Uint8Array([10, 11, 12]),
    'textures/index.json': json([{
      assetName: 'Courtyard',
      assetType: 'scene',
      sha256: 'abc123',
      file: 'blobs/abc123.png',
      mimeType: 'image/png',
    }]),
    'textures/blobs/abc123.png': new Uint8Array([20, 21, 22]),
  })
  const media = new MemoryMedia()
  const models = new MemoryModels(media)
  const capabilities = new MemoryCapabilities(media)
  const context: ExtensionContext = {
    gameId: '游戏一',
    gameRoot: '/host/injected/game-root',
    files,
    media,
    models,
    videoGeneration: unavailableVideoGeneration,
    services: unavailableServices,
    capabilities,
  }
  return { context, files, media, models, capabilities }
}

function prepareCharacterPreviewWorkflow(
  files: MemoryFiles,
): { activityRevision: number } {
  const stored = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
  const characterId = 'character-wukong'
  for (const pack of Object.values(stored.manifest.packs) as Array<{ graph: { nodes: Array<{ data: Record<string, unknown> }> } }>) {
    if (pack.graph.nodes[0]) {
      pack.graph.nodes[0].data.cast = [{ characterId, role: 'primary' }]
    }
  }
  stored.graph = stored.manifest.packs[stored.manifest.mainPackId].graph
  files.entries.set('blueprint.json', json(stored))
  const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
  manifest.assetCatalog = {
    version: 1,
    folders: [],
    placements: {
      [`character:${characterId}`]: {
        folderId: 'root:character', sortKey: '孙悟空', createdAt: 1, updatedAt: 1,
      },
    },
    entities: {
      character: {
        [characterId]: {
          id: characterId,
          name: '孙悟空',
          description: '金箍、虎皮裙、手持金箍棒',
          prompt: '东方神话电影质感，孙悟空全身角色设定',
          history: [],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {},
    },
  }
  files.entries.set('assets/manifest.json', json(manifest))

  const state = createInitialWorkflowState('游戏一')
  state.productPhase = 'feature-development'
  state.phaseRevision = 1
  state.activity = 'characters.previewing'
  state.activityRevision = 1
  state.activityStatus = 'working'
  // 出图是角色线的第二步：同 track 的前序（角色设定）必须已交付，
  // 否则 activeActivitiesIn 会把角色线停在 characters.modeling 上。
  state.activities['characters.modeling'] = {
    revision: 1,
    status: 'complete',
    artifactRefs: [],
    evidence: [],
  }
  state.activities['characters.previewing'] = {
    revision: 1,
    status: 'working',
    artifactRefs: [],
    evidence: [],
  }
  state.activeGroup = {
    id: 'modeling',
    activities: ['characters.previewing', 'scenes.modeling', 'rules.catalog'],
    status: 'working',
    revision: 1,
  }
  files.entries.set('.forgeax/extensions/game-video/workflow.json', json(state))
  return { activityRevision: 1 }
}

function prepareIntegrationWorkflow(
  files: MemoryFiles,
  activity: 'ui.authoring' | 'game.finalizing',
): { activityRevision: number } {
  const state = createInitialWorkflowState('游戏一')
  state.productPhase = 'feature-development'
  state.phaseRevision = 1
  state.activity = activity
  state.activityRevision = 1
  state.activityStatus = 'working'
  state.activities[activity] = {
    revision: 1,
    status: 'working',
    artifactRefs: [],
    evidence: [],
  }
  state.activeGroup = {
    id: 'integration',
    activities: [activity],
    status: 'working',
    revision: 1,
  }
  files.entries.set('.forgeax/extensions/game-video/workflow.json', json(state))
  return { activityRevision: 1 }
}

afterEach(() => {
  vi.restoreAllMocks()
  if (originalForgeaxServerPort === undefined) {
    delete process.env.FORGEAX_SERVER_PORT
  } else {
    process.env.FORGEAX_SERVER_PORT = originalForgeaxServerPort
  }
})

describe('createGameVideoService', () => {
  test('getGraph returns a bounded node-field shard with a revision snapshot', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)
    const blueprintRecord = blueprint as unknown as {
      manifest: {
        mainPackId: string
        packs: Record<string, { graph: { nodes: Array<{ id: string }> } }>
      }
    }
    const blueprintId = blueprintRecord.manifest.mainPackId
    const nodeId = blueprintRecord.manifest.packs[blueprintId]!.graph.nodes[0]!.id

    const result = await service.getGraph({
      blueprintId,
      nodeIds: [nodeId],
      fields: ['summary', 'interaction'],
    }) as {
      project: {
        blueprintId: string
        graph: { nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: unknown[] }
      }
      assetEntities: { characters: Record<string, unknown>; scenes: Record<string, unknown> }
      revision: number
      snapshot: { token: string; revision: number; blueprintId: string }
    }

    expect(result.project.blueprintId).toBe(blueprintId)
    expect(result.project.graph.nodes).toHaveLength(1)
    expect(result.project.graph.nodes[0]!.id).toBe(nodeId)
    expect(result.project.graph.edges).toEqual([])
    expect(result.project.graph.nodes[0]!.data.storyText).toBeUndefined()
    expect(result.assetEntities).toEqual({ characters: {}, scenes: {}, videos: {} })
    expect(result.snapshot).toMatchObject({
      blueprintId,
      revision: result.revision,
    })
  })

  test('patchGraph rejects a stale shard snapshot before applying ops', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const before = decoder.decode(files.entries.get('blueprint.json')!)

    const result = await service.patchGraph({
      snapshotToken: '游戏一:999',
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: { storyText: 'must not write from stale shard' },
      }],
    }) as { ok: boolean; errorCode?: string; errors?: string[] }

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'snapshot.stale',
    })
    expect(result.errors?.join('\n')).toContain('重新读取')
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(before)
  })

  test('completeActivity returns a retryable structured rejection instead of an ambiguous working state', async () => {
    const { context, files } = createContext()
    const workflow = prepareIntegrationWorkflow(files, 'game.finalizing')
    const service = createGameVideoService(context)

    const result = await service.completeActivity({
      activity: 'game.finalizing',
      activityRevision: workflow.activityRevision,
      artifactRefs: [],
      checkIds: [],
    }) as {
      accepted: boolean
      disposition?: string
      retry?: string
      failedChecks?: string[]
      guidance?: string
      state: { activityStatus: string }
    }

    expect(result).toMatchObject({
      accepted: false,
      disposition: 'retryable',
      retry: 'retry',
      state: { activityStatus: 'working' },
    })
    expect(result.failedChecks?.length).toBeGreaterThan(0)
    expect(result.guidance).toContain('failedChecks')
  })

  test('keeps awaiting-user in workflow state without publishing a Toast notice', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)
    const initial = await service.getWorkflowState({}) as { state: { revision: number } }
    const working = await service.beginActivity({
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.state.revision,
    }) as { state: { activityRevision: number } }

    const result = await service.awaitUser({
      activityRevision: working.state.activityRevision,
      reason: 'requirement-questionnaire',
    }) as {
      state: { activityStatus: string }
      projection: {
        notice?: { kind: string }
        modules: Record<string, { availability: string }>
      }
    }

    expect(result.state.activityStatus).toBe('awaiting-user')
    expect(result.projection.notice).toBeUndefined()
    expect(result.projection.modules.character?.availability).toBe('hidden')
  })

  test('polishes only a bounded prompt through the host text model', async () => {
    const { context, models } = createContext()
    const generateText = vi.spyOn(models, 'generateText').mockResolvedValue({
      text: '  雨夜中，@Hero 稳定地走入画面，无水印、无 Logo、无 UI。  ',
      model: 'memory-text',
    })
    const service = createGameVideoService(context)

    await expect(service.polishVideoPrompt({ prompt: '  雨夜中的 @Hero  ' })).resolves.toEqual({
      prompt: '雨夜中，@Hero 稳定地走入画面，无水印、无 Logo、无 UI。',
    })
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '雨夜中的 @Hero',
      temperature: 0.3,
      maxTokens: 1600,
      metadata: { usage: 'video-prompt-polish' },
    }))
  })

  test.each([
    [{ prompt: '   ' }, 'prompt must be a non-empty string'],
    [{ prompt: 'x'.repeat(4001) }, 'prompt must be at most 4000 characters'],
    [{ prompt: '镜头', gameId: 'other' }, 'unsupported path or selector fields'],
    [{ prompt: '镜头', modelUrl: 'https://model.invalid' }, 'unsupported path or selector fields'],
  ])('rejects invalid prompt-polish input %#', async (input, message) => {
    const { context, models } = createContext()
    const service = createGameVideoService(context)

    await expect(service.polishVideoPrompt(input)).rejects.toThrow(message)
    expect(models.textInputs).toHaveLength(0)
  })

  test('polishes an overlay placement hint through the host text model', async () => {
    const { context, models } = createContext()
    const generateText = vi.spyOn(models, 'generateText').mockResolvedValue({
      text: '  我方状态 HUD 一般放在右下角。  ',
      model: 'memory-text',
    })
    const service = createGameVideoService(context)

    await expect(service.polishOverlayPrompt({
      prompt: '  右下角  ',
      title: '  我方状态 HUD  ',
    })).resolves.toEqual({ prompt: '我方状态 HUD 一般放在右下角。' })
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'template: 我方状态 HUD\ndraft hint: 右下角',
      metadata: { usage: 'overlay-prompt-polish' },
    }))
  })

  test.each([
    [{ prompt: 'x'.repeat(1001), title: '标题' }, 'prompt must be at most 1000 characters'],
    [{ prompt: 42, title: '标题' }, 'prompt must be a string'],
    [{ prompt: '', title: '标题', gameId: 'other' }, 'unsupported path or selector fields'],
  ])('rejects invalid overlay prompt-polish input %#', async (input, message) => {
    const { context, models } = createContext()
    const service = createGameVideoService(context)

    await expect(service.polishOverlayPrompt(input)).rejects.toThrow(message)
    expect(models.textInputs).toHaveLength(0)
  })

  test('preserves logical namespaces while redacting locator-shaped public text', () => {
    const logicalIdentifiers = [
      'scene:opening',
      'entity:boss',
      'camera:close-up',
      'base:battleHpBar',
      'urn:forgeax:component:qte',
    ]
    const locators = [
      'https://host.invalid/secret',
      's3://bucket/private',
      'custom+provider://secret/item',
      'file:/private/secret',
      'javascript:alert(1)',
      'data:text/html,unsafe',
      '/private/secret',
      '\\\\server\\share\\secret',
      'C:\\secret\\file.png',
    ]

    expect(logicalIdentifiers.map(sanitizePublicText)).toEqual(logicalIdentifiers)
    expect(locators.map(sanitizePublicText)).toEqual([
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
      '[redacted]',
    ])
  })

  test('returns an actionable error and performs no write for invalid design-options', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const manifestBefore = new Uint8Array(files.entries.get('assets/manifest.json')!)

    const result = await service.upsertDocument({
      documentType: 'design-options',
      slug: 'wusong',
      content: '[{"id":"A","title":"broken "quote""}]',
    })

    expect(result).toEqual({
      document: null,
      error: expect.stringMatching(/design-options JSON is invalid/i),
    })
    expect(files.entries.has('docs/wusong_design_options.md')).toBe(false)
    expect(files.entries.get('assets/manifest.json')).toEqual(manifestBefore)
  })

  test('persists a pillar without a character-preview confirmation estimate', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const result = await service.upsertDocument({
      documentType: 'pillar',
      slug: 'wusong',
      content: '# 支柱\n\n本文缺少角色预览图数量声明。',
    }) as { document: { documentType?: string } | null; error?: string }

    expect(result.error).toBeUndefined()
    expect(result.document?.documentType).toBe('pillar')
    expect(files.entries.has('docs/wusong_pillar.md')).toBe(true)
  })

  test('persists a pillar that declares a valid character_preview_estimate.image_count', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.upsertDocument({
      documentType: 'pillar',
      slug: 'wusong',
      content: [
        '# 支柱',
        'character_preview_estimate:',
        '  image_count: 5',
      ].join('\n'),
    }) as { document: { documentType?: string } | null; error?: string }

    expect(result.error).toBeUndefined()
    expect(result.document?.documentType).toBe('pillar')
    expect(files.entries.has('docs/wusong_pillar.md')).toBe(true)
  })

  test('imports accepted stage artifacts and resumes after the latest artifact', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.importStageArtifacts({
      slug: 'wusong',
      artifacts: {
        core: '# 核心文档\n\n既有核心循环。',
        pillar: '# 支柱文档\n\n既有叙事、互动、规则与界面契约。',
      },
    }) as {
      accepted: boolean
      imported: string[]
      resumeActivity: string
      state: { activity: string; activityStatus: string; gates: Record<string, { status: string }> }
    }

    expect(result).toMatchObject({
      accepted: true,
      imported: ['core', 'pillar'],
      resumeActivity: 'blueprint.outline',
      state: {
        activity: 'blueprint.outline',
        activityStatus: 'working',
        gates: {
          core: { status: 'approved' },
          pillar: { status: 'approved' },
        },
      },
    })
    expect(files.entries.has('docs/wusong_core.md')).toBe(true)
    expect(files.entries.has('docs/wusong_pillar.md')).toBe(true)
  })

  test('requires the core artifact when importing a pillar checkpoint', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    await expect(service.importStageArtifacts({
      slug: 'wusong',
      artifacts: { pillar: '# 支柱文档' },
    })).rejects.toThrow(/core artifact is required/i)
  })

  test('graph reads and writes only host-bounded game files', async () => {
    const { context, files } = createContext()
    const cwd = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('process.cwd must not be called')
    })
    const service = createGameVideoService(context)

    // Tool calls pass {}, while internal read-only callers may omit the
    // argument; both are the same published empty object input.
    expect(await service.getGraph()).toMatchObject({
      project: { version: 'game-video.graph.v1' },
      gameSlug: '游戏一',
    })
    expect(await service.saveGraph({ project: blueprint, title: 'ignored' })).toMatchObject({
      schemaVersion: 1,
      ok: true,
      revision: 1,
      versions: [],
      gameSlug: '游戏一',
      artifactRef: { kind: 'blueprint', id: 'bp-main', revision: 1 },
      validation: { structural: 'pass', references: 'pass' },
    })
    expect(JSON.parse(decoder.decode(files.entries.get('blueprint.json')))).toMatchObject({
      version: 'game-video.graph.v1',
    })
    const manifestAfter = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    expect(manifestAfter).toMatchObject({ version: 2, assets: [] })
    expect(Object.keys(manifestAfter.assetCatalog.entities.video).length).toBeGreaterThan(0)
    expect(files.calls).toContain('locks:game-video-assets-manifest,game-video-graph-save')
    expect(cwd).not.toHaveBeenCalled()
  })

  test('saveGraph rejects asset entity ids that are absent from the manifest', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const snapshot = decoder.decode(files.entries.get('blueprint.json')!)
    const graph = await service.getGraph({}) as {
      project: { graph: { nodes: Array<{ data: Record<string, unknown> }> } }
    }
    graph.project.graph.nodes[0]!.data.cast = [{ characterId: 'character-missing' }]

    const result = await service.saveGraph({ project: graph.project }) as {
      ok: boolean
      errorCode?: string
      errors?: string[]
    }

    expect(result).toMatchObject({ ok: false, errorCode: 'validation.failed' })
    expect(result.errors?.join('\n')).toContain("不存在的角色 'character-missing'")
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snapshot)
  })

  test('patchGraph renames a node without rewriting the full project arg', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const before = await service.getGraph({}) as {
      project: { graph: { nodes: Array<{ id: string }> } }
    }
    const nodeId = before.project.graph.nodes[0]!.id
    const result = await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: '过桥' }],
    })

    expect(result).toMatchObject({
      schemaVersion: 1,
      ok: true,
      applied: 1,
      revision: 1,
      versions: [],
      gameSlug: '游戏一',
      artifactRef: { kind: 'blueprint', id: 'bp-main', revision: 1 },
      uiHint: {
        location: { kind: 'blueprint-node', blueprintId: 'bp-main', nodeId },
        reveal: 'select-and-expand',
      },
    })
    const after = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    expect(after.graph.nodes.find((n: { id: string }) => n.id === nodeId).data.name).toBe('过桥')
    expect(files.calls).toContain('locks:game-video-assets-manifest,game-video-graph-save')
  })

  test('patchGraph does not write when an op fails', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const snap = decoder.decode(files.entries.get('blueprint.json')!)
    const result = await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId: 'nope', field: 'name', value: 'x' }],
    }) as { ok: boolean }

    expect(result.ok).toBe(false)
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snap)
  })

  test('patchGraph reads inside the lock so concurrent batches both land', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const before = await service.getGraph({}) as {
      project: { graph: { nodes: Array<{ id: string }> } }
    }
    const [first, second] = before.project.graph.nodes

    const results = await Promise.all([
      service.patchGraph({ ops: [{ op: 'set-node-field', nodeId: first!.id, field: 'name', value: '甲' }] }),
      service.patchGraph({ ops: [{ op: 'set-node-field', nodeId: second!.id, field: 'name', value: '乙' }] }),
    ]) as Array<{ ok: boolean }>

    expect(results.every((result) => result.ok)).toBe(true)
    const after = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const nameOf = (id: string) => after.graph.nodes.find((n: { id: string }) => n.id === id).data.name
    expect(nameOf(first!.id)).toBe('甲')
    expect(nameOf(second!.id)).toBe('乙')
  })

  test('back-fills all package files when saving into an empty workspace', async () => {
    const files = new MemoryFiles({})
    const media = new MemoryMedia()
    const models = new MemoryModels(media)
    const context: ExtensionContext = {
      gameId: '游戏一',
      gameRoot: '/host/injected/game-root',
      files,
      media,
      models,
      videoGeneration: unavailableVideoGeneration,
      services: unavailableServices,
      capabilities: { async invoke() { throw new Error('Capabilities are unavailable in this test context') } },
    }
    const service = createGameVideoService(context)

    expect(await service.saveGraph({ project: blueprint })).toMatchObject({
      schemaVersion: 1,
      ok: true,
      revision: 1,
      versions: [],
      gameSlug: '游戏一',
    })
    expect(files.entries.has('blueprint.json')).toBe(true)
    expect(files.entries.has('project.json')).toBe(true)
    expect(files.entries.has('assets/manifest.json')).toBe(true)
    expect(JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))).toMatchObject({
      version: 2,
      assets: [],
    })

    // Never overwrite an existing manifest: mutate it directly, then save
    // again, and confirm the back-fill did not clobber the marker.
    files.entries.set(
      'assets/manifest.json',
      encoder.encode(JSON.stringify({ version: 2, assets: [], marker: true })),
    )
    expect(await service.saveGraph({ project: blueprint })).toMatchObject({
      schemaVersion: 1,
      ok: true,
      revision: 2,
      versions: [],
      gameSlug: '游戏一',
    })
    expect(JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))).toMatchObject({
      version: 2,
      assets: [],
      marker: true,
    })
  })

  test('keeps an authoritative blueprint readable when project metadata is corrupt', async () => {
    const { context, files } = createContext()
    files.entries.set('project.json', encoder.encode('{broken'))
    const service = createGameVideoService(context)

    expect(await service.getGraph({})).toMatchObject({
      project: { version: 'game-video.graph.v1' },
      gameSlug: '游戏一',
    })
  })

  test('imports character and scene references through bounded files and media ids', async () => {
    const { context, files, media } = createContext()
    const service = createGameVideoService(context)

    const characters = await service.importCharacterRefs({}) as {
      refs: Array<Record<string, unknown>>
    }
    const scenes = await service.importSceneRefs({}) as {
      refs: Array<Record<string, unknown>>
    }

    expect(characters).toMatchObject({
      refs: [{
        id: 'a-charref-hero',
        productionType: 'character_ref',
        url: 'https://media.invalid/游戏一:media-1',
        meta: {
          hostMedia: {
            provenance: 'extension-media-capability',
            assetId: '游戏一:media-1',
            locator: 'https://media.invalid/游戏一:media-1',
          },
        },
      }],
    })
    expect(scenes).toMatchObject({
      refs: [{
        id: 'a-sceneref-abc123',
        productionType: 'scene_ref',
        url: 'https://media.invalid/游戏一:media-2',
        meta: {
          hostMedia: {
            provenance: 'extension-media-capability',
            assetId: '游戏一:media-2',
            locator: 'https://media.invalid/游戏一:media-2',
          },
        },
      }],
    })
    expect(characters.refs[0]).not.toHaveProperty('provider')
    expect(scenes.refs[0]).not.toHaveProperty('provider')
    expect(JSON.stringify([characters, scenes])).not.toMatch(
      /(?:\/host\/|\/Users\/|file:\/\/|model\.invalid)/,
    )
    expect(media.puts.map((put) => put.filename)).toEqual([
      'character-hero.png',
      'scene-abc123.png',
    ])
    expect((context.files as MemoryFiles).calls).toContain('list:characters')
  })

  test('registers a manual Kino character image as a durable character_ref and binds it', async () => {
    const { context, files, media } = createContext()
    prepareCharacterPreviewWorkflow(files)
    media.assets.set('host-character-manual', {
      id: 'host-character-manual',
      type: 'image',
      url: 'https://media.invalid/host-character-manual',
      contentType: 'image/png',
      sizeBytes: 4,
      metadata: {
        source: 'game-video-generation',
        registryId: 'asset_kino_generation-manual-1',
        operationId: 'game-video:kino-reference:generation-manual-1',
        kinoResourceId: 'kino-resource-manual-1',
        kinoGenerationId: 'generation-manual-1',
      },
    })
    const service = createGameVideoService(context)

    const result = await service.registerKinoReference({
      registryId: 'asset_kino_generation-manual-1',
      hostMediaAssetId: 'host-character-manual',
      kinoResourceId: 'kino-resource-manual-1',
      kinoGenerationId: 'generation-manual-1',
      productionType: 'character_ref',
      characterId: 'character-wukong',
      prompt: '用户手动输入的角色立绘提示词',
      model: 'lite',
      size: '1664x2496',
    }) as { ok: boolean; asset: { id: string; productionType: string; meta?: Record<string, unknown> } }

    expect(result).toMatchObject({
      ok: true,
      asset: {
        id: 'asset_kino_generation-manual-1',
        productionType: 'character_ref',
        meta: {
          kinoResourceId: 'kino-resource-manual-1',
          kinoGenerationId: 'generation-manual-1',
          kinoModel: 'lite',
          characterPreview: {
            characterId: 'character-wukong',
            mode: 'manual',
          },
        },
      },
    })
    const storedManifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    expect(storedManifest.assetCatalog.entities.character['character-wukong'].current.assetId)
      .toBe('asset_kino_generation-manual-1')
  })

  test('continues character and scene batches after malformed records', async () => {
    const { context, files, media } = createContext()
    files.entries.set('characters/bad/manifest.json', json({
      charId: 'bad',
      name: 'Bad',
      portrait: { front: '../private.png' },
    }))
    files.entries.set('textures/index.json', json([
      {
        assetName: 'Bad scene',
        assetType: 'scene',
        sha256: 'bad',
        file: '../private.png',
        mimeType: 'image/png',
      },
      {
        assetName: 'Courtyard',
        assetType: 'scene',
        sha256: 'abc123',
        file: 'blobs/abc123.png',
        mimeType: 'image/png',
      },
    ]))
    const service = createGameVideoService(context)

    const characters = await service.importCharacterRefs({}) as {
      refs: Array<{ id: string }>
    }
    const scenes = await service.importSceneRefs({}) as {
      refs: Array<{ id: string }>
    }

    expect(characters.refs.map((asset) => asset.id)).toEqual([
      'a-charref-hero',
    ])
    expect(scenes.refs.map((asset) => asset.id)).toEqual([
      'a-sceneref-abc123',
    ])
    expect(media.puts).toHaveLength(2)
  })

  test('durably retries an imported-reference replacement after old media reclamation fails', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const input = {
      registryId: 'a-charref-hero',
      relativePath: 'characters/hero/portrait/front.png',
      filename: 'character-hero.png',
      contentType: 'image/png',
      productionType: 'character_ref' as const,
      label: 'Hero',
      sourceModule: 'character',
    }
    await registry.importGameFile(input)
    const [oldHosted] = await media.list(context.gameId)
    files.entries.set(
      input.relativePath,
      new Uint8Array([90, 91, 92]),
    )
    const deleteSpy = vi.spyOn(media, 'delete')
      .mockRejectedValueOnce(new Error('injected import replacement delete failure'))

    await expect(registry.importGameFile(input)).rejects.toThrow(
      'injected import replacement delete failure',
    )
    const failedManifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as {
      assets: Array<{ id: string; provider?: { ref: string } }>
      wbGameVideoReclaims?: {
        version: number
        entries: Array<{
          registryId: string
          assetId: string
          source: string
          operationId: string | null
        }>
      }
    }
    const replacementId = failedManifest.assets
      .find((asset) => asset.id === input.registryId)!
      .provider!.ref

    expect(replacementId).not.toBe(oldHosted!.id)
    expect(failedManifest.wbGameVideoReclaims).toEqual({
      version: 1,
      entries: [{
        registryId: input.registryId,
        assetId: oldHosted!.id,
        source: 'game-video-reference',
        operationId: expect.any(String),
      }],
    })

    await expect(registry.importGameFile(input)).resolves.toMatchObject({
      id: input.registryId,
      meta: {
        hostMedia: { assetId: replacementId },
      },
    })
    const recoveredManifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as Record<string, unknown>
    const replacementBody = await media.read(context.gameId, replacementId)

    expect(recoveredManifest).not.toHaveProperty('wbGameVideoReclaims')
    expect((await media.list(context.gameId)).map((asset) => asset.id)).toEqual([
      replacementId,
    ])
    expect(replacementBody?.bytes).toEqual(new Uint8Array([90, 91, 92]))
    expect(deleteSpy).toHaveBeenCalledTimes(2)
  })

  test('reclaims media created before an imported-reference crash when changed bytes are retried', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const input = {
      registryId: 'a-charref-crash',
      relativePath: 'characters/hero/portrait/front.png',
      filename: 'character-hero.png',
      contentType: 'image/png',
      productionType: 'character_ref' as const,
      label: 'Hero',
      sourceModule: 'character',
    }
    const originalPut = media.put.bind(media)
    vi.spyOn(media, 'put').mockImplementationOnce(async (gameId, value) => {
      await originalPut(gameId, value)
      throw new Error('simulated crash after host media put')
    })

    await expect(registry.importGameFile(input)).rejects.toThrow(
      'simulated crash after host media put',
    )
    const [orphaned] = await media.list(context.gameId)
    expect(orphaned).toBeDefined()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).toHaveProperty('wbGameVideoMediaIntents')

    files.entries.set(input.relativePath, new Uint8Array([90, 91, 92]))
    await expect(registry.importGameFile(input)).resolves.toMatchObject({
      id: input.registryId,
      status: 'ready',
    })

    const remaining = await media.list(context.gameId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).not.toBe(orphaned!.id)
    expect(await media.read(context.gameId, orphaned!.id)).toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).not.toHaveProperty('wbGameVideoMediaIntents')
  })

  test('durably retries generated-media replacement reclamation for the same registry id', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-replacement'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const persistInput = {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image' as const,
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    }
    const firstGenerated: HostMediaAsset = {
      id: 'model:first-generated',
      type: 'image',
      url: 'https://model.invalid/first-generated.png',
      contentType: 'image/png',
    }
    media.bodies.set(firstGenerated.id, {
      contentType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    await registry.persistGenerated(firstGenerated, persistInput)
    const [oldHosted] = await media.list(context.gameId)
    const secondGenerated: HostMediaAsset = {
      id: 'model:second-generated',
      type: 'image',
      url: 'https://model.invalid/second-generated.png',
      contentType: 'image/png',
    }
    media.bodies.set(secondGenerated.id, {
      contentType: 'image/png',
      bytes: new Uint8Array([7, 8, 9]),
    })
    const originalDelete = media.delete.bind(media)
    const deletedIds: string[] = []
    let failedOldHostedDelete = false
    const deleteSpy = vi.spyOn(media, 'delete')
      .mockImplementation(async (gameId, assetId) => {
        deletedIds.push(assetId)
        if (assetId === oldHosted!.id && !failedOldHostedDelete) {
          failedOldHostedDelete = true
          throw new Error('injected generated replacement delete failure')
        }
        await originalDelete(gameId, assetId)
      })

    await expect(
      registry.persistGenerated(secondGenerated, persistInput),
    ).rejects.toThrow('injected generated replacement delete failure')
    const failedManifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as {
      assets: Array<{ id: string; provider?: { ref: string } }>
      wbGameVideoReclaims?: {
        version: number
        entries: Array<{
          registryId: string
          assetId: string
          source: string
          operationId: string | null
        }>
      }
    }
    const replacementId = failedManifest.assets
      .find((asset) => asset.id === registryId)!
      .provider!.ref

    expect(replacementId).not.toBe(oldHosted!.id)
    expect(failedManifest.wbGameVideoReclaims).toEqual({
      version: 1,
      entries: [{
        registryId,
        assetId: oldHosted!.id,
        source: 'game-video-generation',
        operationId: expect.any(String),
      }],
    })

    await expect(
      registry.persistGenerated(secondGenerated, persistInput),
    ).resolves.toMatchObject({
      id: registryId,
      meta: {
        hostMedia: { assetId: replacementId },
      },
    })
    const recoveredManifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as Record<string, unknown>

    expect(recoveredManifest).not.toHaveProperty('wbGameVideoReclaims')
    expect((await media.list(context.gameId)).map((asset) => asset.id)).toEqual([
      replacementId,
    ])
    expect(deleteSpy).toHaveBeenCalledTimes(3)
    expect(deletedIds.filter((assetId) => assetId === oldHosted!.id)).toHaveLength(2)
    expect(deletedIds).toContain(secondGenerated.id)
  })

  test('reclaims media created before a generated-asset crash when changed output is retried', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-crash'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const input = {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image' as const,
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    }
    const firstGenerated: HostMediaAsset = {
      id: 'model:crashed-generation',
      type: 'image',
      url: 'https://model.invalid/crashed-generation.png',
      contentType: 'image/png',
    }
    media.bodies.set(firstGenerated.id, {
      contentType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    const originalPut = media.put.bind(media)
    vi.spyOn(media, 'put').mockImplementationOnce(async (gameId, value) => {
      await originalPut(gameId, value)
      throw new Error('simulated crash after generated media put')
    })

    await expect(
      registry.persistGenerated(firstGenerated, input),
    ).rejects.toThrow('simulated crash after generated media put')
    const [orphaned] = await media.list(context.gameId)
    expect(orphaned).toBeDefined()

    const changedGenerated: HostMediaAsset = {
      id: 'model:changed-generation',
      type: 'image',
      url: 'https://model.invalid/changed-generation.png',
      contentType: 'image/png',
    }
    media.bodies.set(changedGenerated.id, {
      contentType: 'image/png',
      bytes: new Uint8Array([7, 8, 9]),
    })
    await expect(
      registry.persistGenerated(changedGenerated, input),
    ).resolves.toMatchObject({
      id: registryId,
      status: 'ready',
    })

    const remaining = await media.list(context.gameId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).not.toBe(orphaned!.id)
    expect(await media.read(context.gameId, orphaned!.id)).toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).not.toHaveProperty('wbGameVideoMediaIntents')
  })

  test('reclaims the model output only after the persisted generated asset is committed', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-reclaim'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-reclaim',
      type: 'image',
      url: 'https://model.invalid/source-frame.png?signature=private',
      contentType: 'image/png',
      sizeBytes: 4,
      metadata: {
        filename: 'source-frame.png',
        provenance: { provider: 'memory-model', requestId: 'request-1' },
      },
    }
    media.assets.set(generated.id, structuredClone(generated))
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([1, 2, 3, 4]),
    })

    const persisted = await registry.persistGenerated(generated, {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image',
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    })
    const remaining = await media.list(context.gameId)
    const manifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as Record<string, unknown>

    expect(persisted).toMatchObject({
      id: registryId,
      meta: { hostMedia: { assetId: expect.any(String) } },
    })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.id).not.toBe(generated.id)
    expect(await media.read(context.gameId, generated.id)).toBeNull()
    expect(manifest).not.toHaveProperty('wbGameVideoReclaims')
  })

  test('registers a generated Kino reference without downloading or copying it', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-charref-kino'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'character_ref',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'resource-1',
      type: 'image',
      url: 'https://kino.invalid/resources/kino-character.jpg',
      contentType: 'image/jpeg',
      metadata: {
        provider: 'kino',
        kinoGenerationId: 'generation-1',
        kinoResourceId: 'resource-1',
        kinoStatus: 'succeeded',
      },
    }

    await expect(registry.registerGenerated(generated, {
      registryId,
      productionType: 'character_ref',
      label: '角色参考图',
      prompt: '角色设定',
    })).resolves.toMatchObject({
      id: registryId,
      meta: {
        kinoGenerationId: 'generation-1',
        kinoResourceId: 'resource-1',
        kinoStatus: 'succeeded',
      },
      url: 'https://kino.invalid/resources/kino-character.jpg',
    })

    expect(media.assets.size).toBe(0)
    expect(media.bodies.size).toBe(0)

    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    const persisted = manifest.assets.find((asset: { id: string }) => asset.id === registryId)
    expect(persisted).toMatchObject({
      id: registryId,
      url: 'https://kino.invalid/resources/kino-character.jpg',
      provider: {
        kind: 'kino',
        ref: 'https://kino.invalid/resources/kino-character.jpg',
        upstreamResourceId: 'resource-1',
      },
    })
  })

  test('coalesces reclaim when the generated source is the current persisted host asset', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-current-source'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const initialGenerated: HostMediaAsset = {
      id: 'model:initial-current-source',
      type: 'image',
      url: 'https://model.invalid/initial-current-source.png',
      contentType: 'image/png',
      sizeBytes: 4,
    }
    media.assets.set(initialGenerated.id, structuredClone(initialGenerated))
    media.bodies.set(initialGenerated.id, {
      contentType: initialGenerated.contentType,
      bytes: new Uint8Array([1, 2, 3, 4]),
    })
    const first = await registry.persistGenerated(initialGenerated, {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image',
      sceneNodeId: 'node-1',
      label: 'First keyframe',
      prompt: 'First frame',
    })
    const currentHostId = (
      first.meta!.hostMedia as { assetId: string }
    ).assetId
    const currentHostAsset = structuredClone(media.assets.get(currentHostId)!)

    const replaced = await registry.persistGenerated(currentHostAsset, {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image',
      sceneNodeId: 'node-1',
      label: 'Replacement keyframe',
      prompt: 'Replacement frame',
    })
    const manifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as Record<string, unknown>

    const replacementHostId = (
      replaced.meta!.hostMedia as { assetId: string }
    ).assetId
    expect(replacementHostId).not.toBe(currentHostId)
    expect(await media.read(context.gameId, currentHostId)).toBeNull()
    expect((await media.list(context.gameId)).map((asset) => asset.id)).toEqual([
      replacementHostId,
    ])
    expect(manifest).not.toHaveProperty('wbGameVideoMediaIntents')
    expect(manifest).not.toHaveProperty('wbGameVideoReclaims')
  })

  test('reclaims a generated source across legitimate media projection drift', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-projection'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-projection',
      type: 'image',
      url: 'https://model.invalid/result-view.png?signature=result',
      contentType: 'image/png',
      metadata: { projection: 'model-result' },
    }
    media.assets.set(generated.id, {
      ...generated,
      url: 'https://media.invalid/list-view.png?signature=list',
      sizeBytes: 4,
      metadata: { projection: 'media-list' },
    })
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([4, 3, 2, 1]),
    })

    await expect(registry.persistGenerated(generated, {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image',
      sceneNodeId: 'node-1',
      label: 'Projected keyframe',
      prompt: 'Projected frame',
    })).resolves.toMatchObject({ id: registryId, status: 'ready' })

    expect(await media.read(context.gameId, generated.id)).toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).not.toHaveProperty('wbGameVideoReclaims')
  })

  test('durably retries a failed generated-source reclaim without another media put', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-retry'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-retry',
      type: 'image',
      url: 'https://model.invalid/source-retry.png',
      contentType: 'image/png',
      sizeBytes: 3,
      metadata: {
        filename: 'source-retry.png',
        provenance: { provider: 'memory-model', requestId: 'request-2' },
      },
    }
    media.assets.set(generated.id, structuredClone(generated))
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([4, 5, 6]),
    })
    const input = {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image' as const,
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    }
    const deleteSpy = vi.spyOn(media, 'delete')
      .mockRejectedValueOnce(new Error('injected generated source delete failure'))

    await expect(
      registry.persistGenerated(generated, input),
    ).rejects.toThrow('injected generated source delete failure')
    const failedManifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as {
      assets: Array<{ id: string; provider?: { ref: string } }>
      wbGameVideoReclaims?: {
        version: number
        entries: Array<{
          registryId: string
          assetId: string
          source: string
          operationId: string | null
          fingerprint?: string
        }>
      }
    }
    const hostedId = failedManifest.assets
      .find((asset) => asset.id === registryId)!
      .provider!.ref

    expect(failedManifest.wbGameVideoReclaims).toEqual({
      version: 1,
      entries: [{
        registryId,
        assetId: generated.id,
        source: 'game-video-model-output',
        operationId: expect.any(String),
        fingerprint: expect.stringMatching(/^sha256:/),
      }],
    })
    await expect(
      registry.persistGenerated(generated, input),
    ).resolves.toMatchObject({
      id: registryId,
      meta: { hostMedia: { assetId: hostedId } },
    })
    expect(media.puts).toHaveLength(1)
    expect((await media.list(context.gameId)).map((asset) => asset.id)).toEqual([
      hostedId,
    ])
    expect(deleteSpy).toHaveBeenCalledTimes(2)
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).not.toHaveProperty('wbGameVideoReclaims')
  })

  test('keeps a generated-source journal and refuses deletion after source id reuse', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-reused'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-reused',
      type: 'image',
      url: 'https://model.invalid/original.png',
      contentType: 'image/png',
      sizeBytes: 3,
      metadata: {
        filename: 'original.png',
        provenance: { provider: 'memory-model', requestId: 'request-original' },
      },
    }
    media.assets.set(generated.id, structuredClone(generated))
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([1, 1, 1]),
    })
    const input = {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image' as const,
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    }
    const deleteSpy = vi.spyOn(media, 'delete')
      .mockRejectedValueOnce(new Error('injected generated source delete failure'))
    await expect(
      registry.persistGenerated(generated, input),
    ).rejects.toThrow('injected generated source delete failure')

    const reused: HostMediaAsset = {
      ...generated,
      url: 'https://model.invalid/reused.png',
      metadata: {
        filename: 'reused.png',
        provenance: { provider: 'foreign-model', requestId: 'request-reused' },
      },
    }
    media.assets.set(reused.id, reused)
    media.bodies.set(reused.id, {
      contentType: reused.contentType,
      bytes: new Uint8Array([9, 9, 9]),
    })

    await expect(
      registry.persistGenerated(generated, input),
    ).rejects.toThrow(/mismatched generated source provenance/i)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(await media.read(context.gameId, reused.id)).not.toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).toHaveProperty('wbGameVideoReclaims')
  })

  test('keeps a blocked reclaim isolated from unrelated registry and style mutations', async () => {
    const { context, files, media } = createContext()
    const blockedSource: HostMediaAsset = {
      id: 'model:blocked-reclaim',
      type: 'image',
      url: 'https://media.invalid/blocked-reclaim.png',
      contentType: 'image/png',
    }
    media.assets.set(blockedSource.id, blockedSource)
    media.bodies.set(blockedSource.id, {
      contentType: blockedSource.contentType,
      bytes: new Uint8Array([1, 2, 3]),
    })
    await files.write('assets/manifest.json', json({
      version: 2,
      assets: [{
        id: 'unrelated-registry',
        kind: 'image',
        productionType: 'shot_image',
        status: 'generating',
        sourceModule: 'game-video',
        createdAt: 1,
        updatedAt: 1,
      }],
      wbGameVideoReclaims: {
        version: 1,
        entries: [{
          registryId: 'blocked-registry',
          assetId: blockedSource.id,
          source: 'game-video-model-output',
          operationId: 'blocked-operation',
          fingerprint: `sha256:${'0'.repeat(64)}`,
        }],
      },
    }))
    const registry = createHostAssetRegistry(context)

    await expect(registry.upsert({
      id: 'unrelated-registry',
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      label: 'Unrelated update',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })).resolves.toMatchObject({
      id: 'unrelated-registry',
      label: 'Unrelated update',
    })
    await expect(registry.setStyleAxes({
      artMedia: 'watercolor',
    })).resolves.toMatchObject({
      artMedia: 'watercolor',
    })

    const manifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as {
      wbGameVideoReclaims?: { entries: Array<{ registryId: string }> }
    }
    expect(manifest.wbGameVideoReclaims?.entries).toEqual([
      expect.objectContaining({ registryId: 'blocked-registry' }),
    ])
    expect(await media.read(context.gameId, blockedSource.id)).not.toBeNull()
  })

  test('keeps a generated-source journal when host membership is ambiguous', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-ambiguous'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-ambiguous',
      type: 'image',
      url: 'https://model.invalid/source-ambiguous.png',
      contentType: 'image/png',
      sizeBytes: 3,
      metadata: {
        filename: 'source-ambiguous.png',
        provenance: { provider: 'memory-model', requestId: 'request-ambiguous' },
      },
    }
    media.assets.set(generated.id, structuredClone(generated))
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([2, 2, 2]),
    })
    const input = {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image' as const,
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    }
    const deleteSpy = vi.spyOn(media, 'delete')
      .mockRejectedValueOnce(new Error('injected generated source delete failure'))
    await expect(
      registry.persistGenerated(generated, input),
    ).rejects.toThrow('injected generated source delete failure')

    const originalList = media.list.bind(media)
    vi.spyOn(media, 'list').mockImplementation(async (gameId, query) => {
      const values = await originalList(gameId, query)
      const source = values.find((asset) => asset.id === generated.id)
      return source ? [...values, structuredClone(source)] : values
    })

    await expect(
      registry.persistGenerated(generated, input),
    ).rejects.toThrow(/ambiguous generated source media identity/i)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(await media.read(context.gameId, generated.id)).not.toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).toHaveProperty('wbGameVideoReclaims')
  })

  test('treats a missing generated source as reclaimed after journal-clear failure', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-missing'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-missing',
      type: 'image',
      url: 'https://model.invalid/source-missing.png',
      contentType: 'image/png',
      sizeBytes: 3,
      metadata: {
        filename: 'source-missing.png',
        provenance: { provider: 'memory-model', requestId: 'request-3' },
      },
    }
    media.assets.set(generated.id, structuredClone(generated))
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([7, 7, 7]),
    })
    const input = {
      registryId,
      filenamePrefix: 'keyframe',
      productionType: 'shot_image' as const,
      sceneNodeId: 'node-1',
      label: 'Keyframe',
      prompt: 'A frame',
    }
    const originalWrite = files.write.bind(files)
    let injected = false
    const writeSpy = vi.spyOn(files, 'write').mockImplementation(
      async (path, contents) => {
        if (path === 'assets/manifest.json') {
          const manifest = JSON.parse(decoder.decode(contents)) as {
            assets?: Array<{ id?: string; status?: string; provider?: unknown }>
            wbGameVideoReclaims?: unknown
          }
          const committed = manifest.assets?.some((asset) => (
            asset.id === registryId
            && asset.status === 'ready'
            && asset.provider !== undefined
          ))
          if (
            !injected
            && committed
            && manifest.wbGameVideoReclaims === undefined
          ) {
            injected = true
            throw new Error('injected source journal clear failure')
          }
        }
        await originalWrite(path, contents)
      },
    )

    await expect(
      registry.persistGenerated(generated, input),
    ).rejects.toThrow('injected source journal clear failure')
    writeSpy.mockRestore()
    expect(await media.read(context.gameId, generated.id)).toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).toHaveProperty('wbGameVideoReclaims')

    await expect(
      registry.persistGenerated(generated, input),
    ).resolves.toMatchObject({ id: registryId, status: 'ready' })
    expect(media.puts).toHaveLength(1)
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).not.toHaveProperty('wbGameVideoReclaims')
  })

  test('never reclaims a generated source when the final host asset reuses its id', async () => {
    const { context, files, media } = createContext()
    const registry = createHostAssetRegistry(context)
    const registryId = 'a-img-source-is-final'
    await registry.upsert({
      id: registryId,
      kind: 'image',
      productionType: 'shot_image',
      status: 'generating',
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })
    const generated: HostMediaAsset = {
      id: 'model:source-is-final',
      type: 'image',
      url: 'https://model.invalid/source-is-final.png',
      contentType: 'image/png',
      sizeBytes: 3,
      metadata: {
        filename: 'source-is-final.png',
        provenance: { provider: 'memory-model', requestId: 'request-4' },
      },
    }
    media.assets.set(generated.id, structuredClone(generated))
    media.bodies.set(generated.id, {
      contentType: generated.contentType,
      bytes: new Uint8Array([8, 8, 8]),
    })
    vi.spyOn(media, 'put').mockImplementation(async (_gameId, value) => {
      const hosted: HostMediaAsset = {
        ...generated,
        metadata: structuredClone(value.metadata),
      }
      media.assets.set(hosted.id, structuredClone(hosted))
      return hosted
    })
    const deleteSpy = vi.spyOn(media, 'delete')

    await expect(
      registry.persistGenerated(generated, {
        registryId,
        filenamePrefix: 'keyframe',
        productionType: 'shot_image',
        sceneNodeId: 'node-1',
        label: 'Keyframe',
        prompt: 'A frame',
      }),
    ).resolves.toMatchObject({
      id: registryId,
      meta: { hostMedia: { assetId: generated.id } },
    })
    expect(deleteSpy).not.toHaveBeenCalled()
    expect(await media.read(context.gameId, generated.id)).not.toBeNull()
    expect(JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    )).not.toHaveProperty('wbGameVideoReclaims')
  })

  test('refuses a reclaim journal entry that targets the current live host media reference', async () => {
    const { context, files, media } = createContext()
    const registryId = 'a-img-live'
    const operationId = 'game-video:test:live'
    const hosted = await media.put(context.gameId, {
      filename: 'live.png',
      contentType: 'image/png',
      bytes: new Uint8Array([3, 2, 1]),
      metadata: {
        source: 'game-video-generation',
        registryId,
        operationId,
      },
    })
    files.entries.set('assets/manifest.json', json({
      version: 2,
      assets: [{
        id: registryId,
        kind: 'image',
        productionType: 'shot_image',
        status: 'ready',
        sourceModule: 'game-video',
        provider: { kind: 'local', ref: hosted.id },
        meta: {
          hostMedia: {
            provenance: 'extension-media-capability',
            assetId: hosted.id,
          },
        },
        createdAt: 1,
        updatedAt: 1,
      }],
      wbGameVideoReclaims: {
        version: 1,
        entries: [{
          registryId,
          assetId: hosted.id,
          source: 'game-video-generation',
          operationId,
        }],
      },
    }))
    const deleteSpy = vi.spyOn(media, 'delete')

    await expect(
      createHostAssetRegistry(context).update(registryId, { label: 'Still live' }),
    ).rejects.toThrow('Refusing to reclaim current host media reference')
    const manifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as Record<string, unknown>

    expect(deleteSpy).not.toHaveBeenCalled()
    expect(manifest).toHaveProperty('wbGameVideoReclaims')
    expect(await media.read(context.gameId, hosted.id)).not.toBeNull()
  })

  test('preserves a reclaim journal without deleting mismatched host media provenance', async () => {
    const { context, files, media } = createContext()
    const registryId = 'a-img-stale-reclaim'
    const hosted = await media.put(context.gameId, {
      filename: 'foreign.png',
      contentType: 'image/png',
      bytes: new Uint8Array([4, 5, 6]),
      metadata: {
        source: 'another-domain',
        registryId,
        operationId: 'foreign-operation',
      },
    })
    files.entries.set('assets/manifest.json', json({
      version: 2,
      assets: [{
        id: registryId,
        kind: 'image',
        productionType: 'shot_image',
        status: 'generating',
        sourceModule: 'game-video',
        createdAt: 1,
        updatedAt: 1,
      }],
      wbGameVideoReclaims: {
        version: 1,
        entries: [{
          registryId,
          assetId: hosted.id,
          source: 'game-video-generation',
          operationId: 'game-video:test:stale',
        }],
      },
    }))
    const deleteSpy = vi.spyOn(media, 'delete')

    await expect(
      createHostAssetRegistry(context).update(registryId, { label: 'Retry' }),
    ).rejects.toThrow('Refusing to reclaim host media with mismatched provenance')
    const manifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as Record<string, unknown>

    expect(deleteSpy).not.toHaveBeenCalled()
    expect(manifest).toHaveProperty('wbGameVideoReclaims')
    expect(await media.read(context.gameId, hosted.id)).not.toBeNull()
  })

  test('serializes manifest mutations across separate host contexts for one game', async () => {
    const { context, files } = createContext()
    const secondFiles = new MemoryFiles({}, files.entries)
    const secondContext: ExtensionContext = {
      ...context,
      files: secondFiles,
    }
    const registry = createHostAssetRegistry(context)
    const secondRegistry = createHostAssetRegistry(secondContext)
    const asset = (id: string) => ({
      id,
      kind: 'image' as const,
      productionType: 'shot_image' as const,
      status: 'ready' as const,
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })

    await Promise.all([
      registry.upsert(asset('concurrent_a')),
      secondRegistry.upsert(asset('concurrent_b')),
    ])

    expect((await registry.list()).map((entry) => entry.id).sort()).toEqual([
      'concurrent_a',
      'concurrent_b',
    ])
    expect(files).not.toBe(secondFiles)
    expect([...files.calls, ...secondFiles.calls]).toContain(
      'locks:game-video-assets-manifest',
    )
  })

  test('continues the shared manifest mutation queue after a rejected operation', async () => {
    const { context, files } = createContext()
    files.entries.set('assets/manifest.json', json({
      version: 2,
      assets: [{
        id: 'foreign',
        kind: 'image',
        productionType: 'shot_image',
        provider: { kind: 'remote', ref: 'secret' },
        sourceModule: 'another-domain',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }],
    }))
    const secondContext: ExtensionContext = {
      ...context,
      files: new MemoryFiles({}, files.entries),
    }
    const first = createHostAssetRegistry(context)
    const second = createHostAssetRegistry(secondContext)
    const asset = (id: string) => ({
      id,
      kind: 'image' as const,
      productionType: 'shot_image' as const,
      status: 'ready' as const,
      sourceModule: 'game-video',
      createdAt: 1,
      updatedAt: 1,
    })

    await expect(first.upsert(asset('foreign'))).rejects.toThrow(
      'owned by another asset domain',
    )
    await expect(second.upsert(asset('after-rejection'))).resolves.toMatchObject({
      id: 'after-rejection',
    })
  })

  test('deeply sanitizes legacy manifest records while preserving trusted host media locators', async () => {
    const { context, files, media } = createContext()
    files.entries.set('assets/manifest.json', json({
      version: 2,
      assets: [{
        id: 'legacy',
        kind: 'image',
        productionType: 'shot_image',
        status: 'ready',
        file: 'media/legacy.png',
        externalPath: '/private/legacy.png',
        url: 'https://model.invalid/legacy.png',
        provider: { kind: 'remote', ref: 'https://provider.invalid/secret' },
        label: 'Legacy /home/you/label [/opt/secret] \\\\server\\share C:\\secret s3://bucket/key',
        prompt: 'use https://model.invalid/prompt and /Users/you/prompt.txt',
        error: 'failed at file:///private/error.log and /etc/passwd (/root/.ssh/key)',
        sourceUrl: 'https://source.invalid/top-level',
        legacyDetails: {
          providerUrl: 'https://provider.invalid/top-level-nested',
        },
        sourceModule: 'game-video',
        meta: {
          sourceUrl: 'https://source.invalid/private',
          nested: {
            path: '/Users/you/secret.png',
            safe: 'kept',
            deeper: { providerUrl: 'https://provider.invalid/deeper' },
          },
          values: [
            'safe-value',
            'scene:opening',
            'entity:boss',
            'camera:close-up',
            'file:///private/secret',
            '/Users/you/secret',
            'https://model.invalid/private',
            '/home/you/secret',
            '/var/lib/private',
            '\\\\server\\share\\secret',
            'C:\\secret\\file.png',
            's3://bucket/private',
            'custom+provider://secret/item',
            {
              sourceUrl: 'https://provider.invalid/array-item',
              nestedSafe: 'kept-in-array',
            },
          ],
        },
        createdAt: 1,
        updatedAt: 1,
      }],
    }))
    const manifest = JSON.parse(
      decoder.decode(files.entries.get('assets/manifest.json')),
    ) as { assets: unknown[]; version: 2 }
    manifest.assets.push({
      id: 'forged-host-media',
      kind: 'image',
      productionType: 'shot_image',
      status: 'ready',
      url: 'javascript:alert(1)',
      provider: { kind: 'local', ref: 'forged-provider-id' },
      sourceModule: 'game-video',
      meta: {
        hostMedia: {
          provenance: 'extension-media-capability',
          assetId: 'forged-provider-id',
          locator: 'javascript:alert(1)',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    })
    media.assets.set('unsafe-host-id', {
      id: 'unsafe-host-id',
      type: 'image',
      url: 'data:text/html,unsafe',
      contentType: 'image/png',
    })
    manifest.assets.push({
      id: 'unsafe-host-media',
      kind: 'image',
      productionType: 'shot_image',
      status: 'ready',
      url: 'data:text/html,unsafe',
      provider: { kind: 'local', ref: 'unsafe-host-id' },
      sourceModule: 'game-video',
      meta: {
        hostMedia: {
          provenance: 'extension-media-capability',
          assetId: 'unsafe-host-id',
          locator: 'data:text/html,unsafe',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    })
    media.assets.set('real-model-provider-id', {
      id: 'real-model-provider-id',
      type: 'image',
      url: 'https://media.invalid/real-provider-item.png',
      contentType: 'image/png',
    })
    manifest.assets.push({
      id: 'forged-model-provider',
      kind: 'image',
      productionType: 'shot_image',
      status: 'ready',
      url: 's3://forged-provider/real-provider-item.png',
      provider: { kind: 'local', ref: 'real-model-provider-id' },
      sourceModule: 'game-video',
      meta: {
        hostMedia: {
          provenance: 'extension-media-capability',
          assetId: 'real-model-provider-id',
          locator: 's3://forged-provider/real-provider-item.png',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    })
    files.entries.set('assets/manifest.json', json(manifest))
    const service = createGameVideoService(context)

    const listed = await service.listAssets({}) as {
      assets: Array<Record<string, unknown>>
    }
    const fetched = await service.getAsset('legacy')
    const serialized = JSON.stringify([listed, fetched])

    expect(serialized).not.toMatch(
      /(?:externalPath|sourceUrl|providerUrl|file:\/\/|\/private\/|\/Users\/|model\.invalid|provider\.invalid|source\.invalid)/,
    )
    expect(serialized).not.toMatch(
      /javascript:|data:text|forged-provider-id|unsafe-host-id|s3:\/\/|custom\+provider:|\/home\/|\/etc\/|\/opt\/|\/root\/|\/var\/|\\\\server\\|C:\\/,
    )
    expect(listed.assets.find((asset) => asset.id === 'legacy')).toMatchObject({
      id: 'legacy',
      meta: {
        nested: { safe: 'kept' },
        values: [
          'safe-value',
          'scene:opening',
          'entity:boss',
          'camera:close-up',
          { nestedSafe: 'kept-in-array' },
        ],
      },
    })
    expect(
      listed.assets.find((asset) => asset.id === 'forged-host-media'),
    ).not.toHaveProperty('url')
    expect(
      listed.assets.find((asset) => asset.id === 'forged-host-media'),
    ).not.toHaveProperty('meta.hostMedia')
    expect(fetched).toMatchObject({
      asset: { id: 'legacy', meta: { nested: { safe: 'kept' } } },
    })
  })

  test('attests every legacy provider kind by game-scoped media membership before model calls', async () => {
    const { context, files, media, models } = createContext()
    const providerRefs = (['local', 's3', 'cos', 'kino'] as const)
      .map((kind) => ({
        kind,
        registryId: `trusted-${kind}-ref`,
        mediaId: `metadata-free-${kind}-media`,
      }))
    for (const ref of providerRefs) {
      media.assets.set(ref.mediaId, {
        id: ref.mediaId,
        type: 'image',
        url: `memory://游戏一/${ref.mediaId}`,
        contentType: 'image/png',
      })
    }
    files.entries.set('assets/manifest.json', json({
      version: 2,
      assets: [
        ...providerRefs.map((ref) => ({
          id: ref.registryId,
          kind: 'image',
          productionType: 'character_ref',
          status: 'ready',
          url: `memory://游戏一/${ref.mediaId}`,
          provider: { kind: ref.kind, ref: ref.mediaId },
          sourceModule: 'character',
          ...(ref.kind === 'local'
            ? {
              meta: {
                hostMedia: {
                  provenance: 'extension-media-capability',
                  assetId: ref.mediaId,
                  locator: `memory://游戏一/${ref.mediaId}`,
                },
              },
            }
            : {}),
          createdAt: 1,
          updatedAt: 1,
        })),
        {
          id: 'forged-ref',
          kind: 'image',
          productionType: 'scene_ref',
          status: 'ready',
          provider: { kind: 'kino', ref: 'foreign-provider-id' },
          sourceModule: 'scene',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }))
    const service = createGameVideoService(context)

    expect(await service.getAsset('trusted-local-ref')).toMatchObject({
      asset: {
        id: 'trusted-local-ref',
        url: 'memory://游戏一/metadata-free-local-media',
      },
    })
    const trusted = await service.generateKeyframe({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      beat: 'Hero enters',
      refAssetIds: providerRefs.map((ref) => ref.registryId),
    })
    const callsAfterTrusted = models.imageInputs.length
    const forged = await service.generateKeyframe({
      sceneNodeId: 'node-2',
      nodeName: 'Forged',
      beat: 'Must not call model',
      refAssetIds: ['forged-ref'],
    })
    const forgedVideo = await service.generateVideo({
      sceneNodeId: 'node-3',
      nodeName: 'Forged video',
      characterRefIds: ['trusted-local-ref'],
      sceneRefIds: ['forged-ref'],
    })

    expect(trusted).toMatchObject({ asset: { status: 'ready' } })
    expect(models.imageInputs[0]?.references).toEqual(
      providerRefs.map((ref) => ({ assetId: ref.mediaId })),
    )
    expect(forged).toMatchObject({
      asset: null,
      error: expect.any(String),
    })
    expect(forgedVideo).toMatchObject({
      asset: null,
      error: expect.any(String),
    })
    expect(models.imageInputs).toHaveLength(callsAfterTrusted)
    expect(models.videoInputs).toHaveLength(0)
  })

  test('keyframe and video generation use model and media capabilities without environment URLs', async () => {
    const { context, media, models, capabilities } = createContext()
    const cwd = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('process.cwd must not be called')
    })
    process.env.FORGEAX_SERVER_PORT = 'poison-port-must-not-be-read'
    const service = createGameVideoService(context)
    const { refs: characterRefs } = await service.importCharacterRefs({}) as {
      refs: Array<{ id: string }>
    }
    const { refs: sceneRefs } = await service.importSceneRefs({}) as {
      refs: Array<{ id: string }>
    }

    const keyframe = await service.generateKeyframe({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      beat: 'Hero enters',
      refAssetIds: [characterRefs[0]!.id, sceneRefs[0]!.id],
    })
    const video = await service.generateVideo({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      seedancePrompt: 'Hero enters',
      durationSeconds: 8,
      characterRefIds: [characterRefs[0]!.id],
      sceneRefIds: [sceneRefs[0]!.id],
    })
    const shotScript = await service.generateShotScript({
      nodeName: 'Opening',
      storyText: 'Hero enters',
      durationSeconds: 8,
    })
    const nodeVideo = await service.generateNodeVideo({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      seedancePrompt: 'Hero enters',
      durationSeconds: 16,
      characterRefIds: [characterRefs[0]!.id],
      sceneRefIds: [sceneRefs[0]!.id],
    })
    const assets = await service.listAssets({ kind: 'video' }) as {
      assets: Array<{ id: string }>
    }
    const firstVideo = assets.assets[0]
    expect(firstVideo).toBeDefined()
    expect(await service.getAsset(firstVideo!.id)).toMatchObject({
      asset: { id: firstVideo!.id },
    })

    expect(models.imageInputs[0]?.references).toEqual([
      { assetId: '游戏一:media-1' },
      { assetId: '游戏一:media-2' },
    ])
    expect(capabilities.videoInputs[0]).toMatchObject({
      references: [
        { assetId: '游戏一:media-1' },
        { assetId: '游戏一:media-2' },
      ],
    })
    expect(capabilities.videoInputs).toHaveLength(3)
    expect(capabilities.videoInputs[2]).toMatchObject({
      references: [
        { role: 'reference_video', mediaKind: 'video' },
        { role: 'character_reference', mediaKind: 'image' },
        { role: 'scene_reference', mediaKind: 'image' },
      ],
    })
    expect(media.puts).toHaveLength(6)
    expect(keyframe).toMatchObject({
      asset: { kind: 'image', productionType: 'shot_image', status: 'ready' },
    })
    expect(video).toMatchObject({
      asset: {
        kind: 'video',
        productionType: 'video_clip',
        status: 'ready',
        url: expect.stringMatching(/^https:\/\/media\.invalid\//),
      },
    })
    expect(shotScript).toMatchObject({
      shots: [{ seedancePrompt: 'A bounded shot' }],
    })
    expect(nodeVideo).toMatchObject({
      assets: [
        { productionType: 'video_clip', status: 'ready' },
        { productionType: 'video_clip', status: 'ready' },
      ],
    })
    expect(cwd).not.toHaveBeenCalled()
    expect(JSON.stringify([
      keyframe,
      video,
      nodeVideo,
      models.textInputs,
      models.imageInputs,
      capabilities.videoInputs,
    ]))
      .not.toMatch(/18900|FORGEAX_SERVER_PORT|model\.invalid|\/host\/|\bkino\b/i)
  })

  test('publishes one stable keyframe id from generating through ready', async () => {
    const { context, media, models } = createContext()
    const generation = deferred<
      Awaited<ReturnType<MemoryModels['generateImage']>>
    >()
    models.generateImage = async (input) => {
      models.imageInputs.push(structuredClone(input))
      return generation.promise
    }
    const service = createGameVideoService(context)
    const pending = service.generateKeyframe({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      beat: 'Hero enters',
    })
    await waitUntil(() => models.imageInputs.length === 1)

    const during = await service.listAssets({ kind: 'image' }) as {
      assets: Array<{ id: string; status: string; createdAt: number }>
    }
    const generating = during.assets.find((asset) => asset.status === 'generating')
    expect(generating).toBeDefined()

    media.bodies.set('model:delayed-keyframe', {
      contentType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    })
    generation.resolve({
      assets: [{
        id: 'model:delayed-keyframe',
        type: 'image',
        url: 'https://model.invalid/secret-keyframe.png',
        contentType: 'image/png',
        sizeBytes: 3,
      }],
      model: 'delayed-image',
    })

    const completed = await pending as {
      asset: { id: string; status: string; url: string; createdAt: number }
    }
    expect(completed.asset).toMatchObject({
      id: generating!.id,
      status: 'ready',
      url: expect.stringMatching(/^https:\/\/media\.invalid\//),
    })
    expect(completed.asset.createdAt).toBe(generating!.createdAt)
  })

  test('publishes one stable video id from generating through ready', async () => {
    const { context, media, capabilities } = createContext()
    const service = createGameVideoService(context)
    const { refs: characterRefs } = await service.importCharacterRefs({}) as {
      refs: Array<{ id: string }>
    }
    const { refs: sceneRefs } = await service.importSceneRefs({}) as {
      refs: Array<{ id: string }>
    }
    const generation = deferred<MemoryVideoCapabilityResult>()
    capabilities.invoke = async (_id, _version, input) => {
      capabilities.videoInputs.push(structuredClone(input))
      return generation.promise
    }
    const pending = service.generateVideo({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      durationSeconds: 8,
      characterRefIds: [characterRefs[0]!.id],
      sceneRefIds: [sceneRefs[0]!.id],
    })
    await waitUntil(() => capabilities.videoInputs.length === 1)

    const during = await service.listAssets({ kind: 'video' }) as {
      assets: Array<{ id: string; status: string; createdAt: number }>
    }
    const generating = during.assets.find((asset) => asset.status === 'generating')
    expect(generating).toBeDefined()

    media.bodies.set('model:delayed-video', {
      contentType: 'video/mp4',
      bytes: new Uint8Array([5, 6, 7]),
    })
    generation.resolve(memoryVideoCapabilityResult(
      'model:delayed-video',
      new Uint8Array([5, 6, 7]),
    ))

    const completed = await pending as {
      asset: { id: string; status: string; createdAt: number }
    }
    expect(completed.asset).toMatchObject({
      id: generating!.id,
      status: 'ready',
    })
    expect(completed.asset.createdAt).toBe(generating!.createdAt)
  })

  test('keeps completed node segments and exposes a sanitized failed segment', async () => {
    const { context, media, capabilities } = createContext()
    const service = createGameVideoService(context)
    const { refs: characterRefs } = await service.importCharacterRefs({}) as {
      refs: Array<{ id: string }>
    }
    const { refs: sceneRefs } = await service.importSceneRefs({}) as {
      refs: Array<{ id: string }>
    }
    let call = 0
    capabilities.invoke = async (_id, _version, input) => {
      capabilities.videoInputs.push(structuredClone(input))
      call++
      if (call === 2) {
        throw new Error(
          'provider failed at https://model.invalid/task using /Users/you/secret',
        )
      }
      const id = 'model:first-segment'
      media.bodies.set(id, {
        contentType: 'video/mp4',
        bytes: new Uint8Array([5, 6, 7]),
      })
      return memoryVideoCapabilityResult(id, new Uint8Array([5, 6, 7]))
    }

    const result = await service.generateNodeVideo({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      durationSeconds: 16,
      characterRefIds: [characterRefs[0]!.id],
      sceneRefIds: [sceneRefs[0]!.id],
    }) as {
      assets: Array<{ id: string; status: string; error?: string }>
      error?: string
    }
    const listed = await service.listAssets({ kind: 'video' }) as {
      assets: Array<{ id: string; status: string; error?: string }>
    }

    expect(result.assets.map((asset) => asset.status)).toEqual([
      'ready',
      'failed',
    ])
    expect(result.assets.map((asset) => asset.id)).toEqual(
      listed.assets.map((asset) => asset.id),
    )
    expect(result.error).toBeUndefined()
    expect(listed.assets.map((asset) => asset.status).sort()).toEqual([
      'failed',
      'ready',
    ])
    expect(JSON.stringify([result, listed])).not.toMatch(
      /(?:model\.invalid|\/Users\/|file:\/\/)/,
    )
  })

  test('rejects invalid published-schema inputs before any model call', async () => {
    const { context, models } = createContext()
    const service = createGameVideoService(context)

    await expect(service.generateShotScript({
      nodeName: 'Opening',
      storyText: 'Hero enters',
      interactive: 'yes',
    })).rejects.toThrow()
    await expect(service.generateKeyframe({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      beat: 'Hero enters',
      styleAxes: { artMedia: 'ink', sourceUrl: 'https://secret.invalid' },
    })).rejects.toThrow()
    await expect(service.generateVideo({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      characterRefIds: ['character'],
      sceneRefIds: ['scene'],
      generateAudio: 'yes',
    })).rejects.toThrow()
    await expect(service.generateNodeVideo({
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      characterRefIds: ['character'],
      sceneRefIds: ['scene'],
      durationSeconds: 121,
    })).rejects.toThrow()

    expect(models.textInputs).toHaveLength(0)
    expect(models.imageInputs).toHaveLength(0)
    expect(models.videoInputs).toHaveLength(0)
  })

  test('applies published schemas to graph, asset, and intake operations', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    await expect(service.getGraph({
      cwd: '/private/secret',
    })).rejects.toThrow('additional properties')
    await expect(service.saveGraph({
      project: blueprint,
      extra: true,
    })).rejects.toThrow('additional properties')
    await expect(service.listAssets({ kind: 'audio' })).rejects.toThrow(
      'allowed values',
    )
    expect(getAssetIdFromArgs({
      id: 'asset-1',
    })).toBe('asset-1')
    expect(() => getAssetIdFromArgs({
      id: 'asset-1',
      gameSlug: context.gameId,
    })).toThrow('additional properties')
    expect(() => getAssetIdFromArgs({
      id: 'asset-1',
      extra: true,
    })).toThrow('additional properties')
    await expect(service.getAsset('asset-1')).resolves.toEqual({ asset: null })
    await expect(service.importCharacterRefs({
      characterIds: ['hero'],
    })).rejects.toThrow('additional properties')
    await expect(service.importSceneRefs({
      files: ['scene.png'],
    })).rejects.toThrow('additional properties')
  })

  test('rejects absolute or traversing reference selectors before file access', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const callsBefore = files.calls.length

    await expect(
      service.importCharacterRefs({ characterIds: ['/tmp/secret'] }),
    ).rejects.toThrow('additional properties')
    await expect(
      service.importSceneRefs({ files: ['../secret.png'] }),
    ).rejects.toThrow('additional properties')
    expect(files.calls).toHaveLength(callsBefore)
  })
})

describe('patchRules', () => {
  function metaOnDisk(files: MemoryFiles) {
    return JSON.parse(decoder.decode(files.entries.get('blueprint.json')!)) as {
      entities?: Record<string, unknown>
      variables?: Record<string, unknown>
      formulas?: Record<string, { ast?: unknown }>
      revision?: number
    }
  }

  test('creates a related rule set atomically and advances the revision', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.patchRules({
      ops: [
        { op: 'upsert-entity', entityId: 'ent_wukong', name: '孙悟空' },
        { op: 'upsert-entity-attr', entityId: 'ent_wukong', attrId: 'insight', value: 1, meta: { min: 0, max: 5 } },
        { op: 'upsert-variable', variableId: 'var_clue_count', name: '线索数', initial: 0 },
        {
          op: 'upsert-formula',
          formulaId: 'formula_truth_depth',
          name: '真相深度',
          expressionText: 'var.var_clue_count + entity.ent_wukong.attr.insight',
        },
      ],
    }) as {
      ok: boolean
      revision: number
      results: Array<{ id: string }>
      errors?: string[]
    }

    expect(result.errors).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.revision).toBe(1)
    expect(result.results.map((entry) => entry.id)).toEqual([
      'ent_wukong',
      'ent_wukong',
      'var_clue_count',
      'formula_truth_depth',
    ])
    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactRef: { kind: 'blueprint', id: 'bp-main', revision: 1 },
      validation: { structural: 'pass', references: 'pass' },
      uiHint: {
        location: { kind: 'rule', section: 'formulas', itemId: 'formula_truth_depth' },
        reveal: 'select-and-expand',
      },
    })
    const persisted = metaOnDisk(files)
    expect(persisted.entities).toHaveProperty('ent_wukong')
    expect(persisted.variables).toHaveProperty('var_clue_count')
    // expressionText became a normalized authoring AST, not a stored string.
    expect(persisted.formulas!['formula_truth_depth']!.ast).toMatchObject({ t: 'bin' })
    expect(persisted.revision).toBe(1)
  })

  test('writes nothing when one op in the batch fails', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const snapshot = decoder.decode(files.entries.get('blueprint.json')!)

    const result = await service.patchRules({
      ops: [
        { op: 'upsert-entity', entityId: 'ent_ok', name: '会被丢弃' },
        { op: 'upsert-entity-attr', entityId: 'ent_missing', attrId: 'hp', value: 1 },
      ],
    }) as { ok: boolean; errorCode?: string; failedOpIndex?: number }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('rules.entity.not-found')
    expect(result.failedOpIndex).toBe(1)
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snapshot)
  })

  test('refuses a formula that references an unknown object', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    const result = await service.patchRules({
      ops: [{
        op: 'upsert-formula',
        formulaId: 'formula_bad',
        name: '坏公式',
        expressionText: 'var.nope + 1',
      }],
    }) as { ok: boolean; errorCode?: string }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('rules.formula.unknown-reference')
  })

  test('honours the same optimistic lock as patch-graph', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)
    const before = await service.getGraph({}) as { revision: number }
    await service.patchRules({
      ops: [{ op: 'upsert-variable', variableId: 'var_a', name: 'A', initial: 0 }],
    })

    const stale = await service.patchRules({
      expectedRevision: before.revision,
      ops: [{ op: 'upsert-variable', variableId: 'var_b', name: 'B', initial: 0 }],
    }) as { ok: boolean; errorCode?: string }

    expect(stale.ok).toBe(false)
    expect(stale.errorCode).toBe('revision.conflict')
  })

  test('rejects unknown ops and stray arguments at the schema boundary', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    await expect(service.patchRules({ ops: [] })).rejects.toThrow()
    await expect(service.patchRules({
      ops: [{ op: 'delete-everything' }],
    })).rejects.toThrow()
    await expect(service.patchRules({
      ops: [{ op: 'upsert-variable', variableId: 'var_a', gameSlug: 'other-game' }],
    })).rejects.toThrow('additional properties')
  })

  test('leaves graph topology untouched', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const before = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))

    await service.patchRules({
      ops: [{ op: 'upsert-variable', variableId: 'var_a', name: 'A', initial: 0 }],
    })

    const after = metaOnDisk(files) as unknown as { graph: unknown; manifest: unknown }
    expect(after.graph).toEqual(before.graph)
    expect(after.manifest).toEqual(before.manifest)
  })

  test('recompiles existing formula usages only when a formula changes', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.patchRules({
      ops: [{
        op: 'upsert-formula',
        formulaId: 'fx-dmg',
        expressionText: 'score + 1',
      }],
    }) as { ok: boolean }

    expect(result.ok).toBe(true)
    const persisted = decoder.decode(files.entries.get('blueprint.json')!)
    expect(persisted).toContain('score + 1')
  })

  test('replays an accepted idempotent batch without advancing revision twice', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const request = {
      expectedRevision: 0,
      idempotencyKey: 'rules.catalog:4:var_a',
      ops: [{ op: 'upsert-variable', variableId: 'var_a', name: 'A', initial: 0 }],
    }

    const first = await service.patchRules(request) as { ok: boolean; revision: number; replayed: boolean }
    const replay = await service.patchRules(request) as { ok: boolean; revision: number; replayed: boolean }

    expect(first).toMatchObject({ ok: true, revision: 1, replayed: false })
    expect(replay).toMatchObject({ ok: true, revision: 1, replayed: true })
    expect(metaOnDisk(files).revision).toBe(1)

    const reused = await service.patchRules({
      ...request,
      ops: [{ op: 'upsert-variable', variableId: 'var_b', name: 'B', initial: 0 }],
    }) as { ok: boolean; errorCode?: string; revision?: number }
    expect(reused).toMatchObject({
      ok: false,
      errorCode: 'idempotency.conflict',
      revision: 1,
    })
  })

  test('refuses to remove variables or formulas still referenced by the graph', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    for (const [op, errorCode] of [
      [{ op: 'remove-variable', variableId: 'combo' }, 'rules.variable.in-use'],
      [{ op: 'remove-formula', formulaId: 'fx-dmg' }, 'rules.formula.in-use'],
    ] as const) {
      const snapshot = decoder.decode(files.entries.get('blueprint.json')!)
      const result = await service.patchRules({ ops: [op] }) as {
        ok: boolean
        errorCode?: string
      }
      expect(result).toMatchObject({ ok: false, errorCode })
      expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snapshot)
    }
  })
})

describe('node production authoring fields', () => {
  test('resolves canonical Kino provider ids into node reference submissions', async () => {
    const { context, files } = createContext()
    const stored = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const node = stored.manifest.packs[stored.manifest.mainPackId].graph.nodes[0]
    node.data = {
      name: '雨夜对决',
      chapterSummary: '雨夜石桥迎敌',
      storyText: '剑客在暴雨中拔剑。',
      cast: [{ characterId: 'hero', role: 'primary' }],
      media: {
        kind: 'video',
        prompt: '红发剑客在雨夜拔剑',
        generation: { schemaVersion: 1, durationSeconds: 5, generateAudio: true, mode: 't2v', resolution: '720p' },
      },
    }
    stored.graph = stored.manifest.packs[stored.manifest.mainPackId].graph
    files.entries.set('blueprint.json', json(stored))
    files.entries.set('assets/manifest.json', json({
      version: 2,
      assets: [{
        id: 'asset-hero', kind: 'image', productionType: 'character_ref', status: 'ready',
        label: '主角', prompt: '红发剑客角色设定图', createdAt: 1, updatedAt: 1,
        url: 'https://kino.invalid/hero.png',
        provider: { kind: 'kino', ref: 'kino-resource-hero', upstreamResourceId: 'kino-resource-hero' },
      }],
      assetCatalog: {
        version: 1,
        folders: [],
        placements: { 'character:hero': { folderId: 'root:character', sortKey: '主角', createdAt: 1, updatedAt: 1 } },
        entities: {
          character: {
            hero: {
              id: 'hero', name: '主角', description: '红发剑客', prompt: '红发剑客角色设定图',
              current: { assetId: 'asset-hero' }, history: [], createdAt: 1, updatedAt: 1,
            },
          },
          scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {},
        },
      },
    }))

    const result = await createGameVideoService(context).getNodeProductionContext({
      blueprintId: stored.manifest.mainPackId,
      nodeId: node.id,
    }) as {
      readiness: { readyToSubmit: boolean }
      video: { submission: { mode: string; referenceImageResourceIds: string[] } }
    }

    expect(result.readiness.readyToSubmit).toBe(true)
    expect(result.video.submission).toMatchObject({
      mode: 'ref',
      referenceImageResourceIds: ['kino-resource-hero'],
    })
  })

  test('accepts and persists a fully authored non-media beat', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    manifest.assetCatalog = {
      version: 1,
      folders: [],
      placements: {},
      entities: {
        character: {
          'character-wukong': {
            id: 'character-wukong', name: '孙悟空', description: '金箍、虎皮裙',
            prompt: '孙悟空角色设定图，金箍、虎皮裙',
            history: [], createdAt: 1, updatedAt: 1,
          },
        },
        scene: {}, video: {}, icon: {}, control: {}, audio: {}, font: {},
      },
    }
    files.entries.set('assets/manifest.json', json(manifest))
    const before = await service.getGraph({}) as {
      project: { graph: { nodes: Array<{ id: string }> } }
    }
    const nodeId = before.project.graph.nodes[0]!.id

    const result = await service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId,
        patch: {
          chapterSummary: '悟空闯入凌霄殿',
          storyText: '金光炸开，悟空提棒立于殿前。',
          cast: [{ characterId: 'character-wukong', role: 'primary' }],
        },
      }],
    }) as { ok: boolean; errors?: string[] }

    expect(result.errors).toBeUndefined()
    expect(result.ok).toBe(true)
    const persisted = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    expect(persisted.graph.nodes.find((n: { id: string }) => n.id === nodeId).data)
      .toMatchObject({
        chapterSummary: '悟空闯入凌霄殿',
        storyText: '金光炸开，悟空提棒立于殿前。',
        cast: [{ characterId: 'character-wukong', role: 'primary' }],
      })
  })

  test('rejects a generation preset carrying provider resource ids', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    // Kino resource ids belong to the provider and may not exist yet; letting
    // them into the blueprint makes the document non-portable.
    await expect(service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: {
          media: {
            kind: 'video',
            prompt: '悟空腾云',
            generation: {
              schemaVersion: 1,
              durationSeconds: 6,
              generateAudio: false,
              mode: 'firstref',
              references: { firstFrameResourceId: 'kino-res-1' },
            },
          },
        },
      }],
    })).rejects.toThrow('additional properties')
  })

  test('rejects a cast entry without a character reference', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    await expect(service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: { cast: [{ name: '孙悟空' }] },
      }],
    })).rejects.toThrow()
  })

  test('persists an ID-level character declaration before the asset catalog definition exists', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'n_open',
        patch: { cast: [{ characterId: 'character-missing' }] },
      }],
    }) as { ok: boolean; errors?: string[] }

    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
    const persisted = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    expect(persisted.graph.nodes.find((node: { id: string }) => node.id === 'n_open').data.cast)
      .toEqual([{ characterId: 'character-missing' }])
  })

  test('ui.authoring rejects per-node overlay creation before writing', async () => {
    const { context, files } = createContext()
    const workflow = prepareIntegrationWorkflow(files, 'ui.authoring')
    const service = createGameVideoService(context)
    const snapshot = decoder.decode(files.entries.get('blueprint.json')!)

    const result = await service.patchGraph({
      activityRevision: workflow.activityRevision,
      ops: [{ op: 'ensure-node-overlay', nodeId: 'n_open' }],
    }) as { ok: boolean; errorCode?: string; errors?: string[] }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('workflow.ui.catalog-overlays-only')
    expect(result.errors?.join('\n')).toContain('set-node-data')
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snapshot)
  })

  test('game.finalizing can rewrite overlay mounts', async () => {
    const { context, files } = createContext()
    const workflow = prepareIntegrationWorkflow(files, 'game.finalizing')
    const service = createGameVideoService(context)

    const result = await service.patchGraph({
      activityRevision: workflow.activityRevision,
      ops: [{ op: 'set-node-data', nodeId: 'n_open', patch: { overlayNodes: [] } }],
    }) as { ok: boolean; errorCode?: string; errors?: string[] }

    expect(result).toMatchObject({ ok: true })
    expect(result.errorCode).toBeUndefined()
    expect(result.errors).toBeUndefined()
    const persisted = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    expect(persisted.graph.nodes.find((node: { id: string }) => node.id === 'n_open').data.overlayNodes).toEqual([])
  })

  test('game.finalizing can patch the rules catalog', async () => {
    const { context, files } = createContext()
    const workflow = prepareIntegrationWorkflow(files, 'game.finalizing')
    const service = createGameVideoService(context)

    const result = await service.patchRules({
      activityRevision: workflow.activityRevision,
      ops: [{ op: 'upsert-variable', variableId: 'finalizing_score', name: '整装评分', initial: 0 }],
    }) as { ok: boolean; errorCode?: string; errors?: string[] }

    expect(result).toMatchObject({ ok: true })
    expect(result.errorCode).toBeUndefined()
    expect(result.errors).toBeUndefined()
    const persisted = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    expect(persisted.variables).toHaveProperty('finalizing_score')
  })

  test('upsertComponent assembles a multi-control template and also creates a new control', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.upsertComponent({
      id: 'ComboHpBar',
      label: '连击血条',
      events: [],
      implementation: "function ComboHpBar() { return React.createElement('span') }",
      compose: {
        id: 'scheme-combo-hud',
        title: '连击战斗 HUD',
        prompt: '整块模板一般放右下角',
        children: [
          { id: 'hp', component: 'ComboHpBar' },
          { id: 'skill', component: 'BattleSkill', inputs: { label: '斩' } },
        ],
      },
    }) as { ok: boolean; componentId?: string; overlayId?: string; overlayTitle?: string }

    expect(result.ok).toBe(true)
    expect(result.componentId).toBe('ComboHpBar')
    expect(result.overlayId).toBe('scheme-combo-hud')
    expect(result.overlayTitle).toBe('连击战斗 HUD')

    // 控件已落盘
    expect(files.entries.has('components/definitions/ComboHpBar.json')).toBe(true)
    expect(decoder.decode(files.entries.get('components/index.js')!)).toContain('ComboHpBar')

    // 模板已写入 blueprint.json
    const blueprint = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const overlay = blueprint.ui.overlays['scheme-combo-hud']
    expect(overlay).toBeDefined()
    expect(overlay.title).toBe('连击战斗 HUD')
    expect(overlay.prompt).toBe('整块模板一般放右下角')
    expect(overlay.children.map((child: { component: string }) => child.component))
      .toEqual(['ComboHpBar', 'BattleSkill'])
  })

  test('upsertComponent rejects a compose referencing an unknown control', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    await expect(service.upsertComponent({
      compose: {
        children: [{ id: 'hp', component: 'NotAControl' }],
      },
    })).rejects.toThrow('not a known control')
  })

  test('listUiComponents returns built-ins plus authored controls', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    // 先造一个控件
    await service.upsertComponent({
      id: 'ComboHpBar',
      label: '连击血条',
      events: [],
      implementation: "function ComboHpBar() { return React.createElement('span') }",
    })

    const result = await service.listUiComponents() as { components: Array<{ id: string; prompt?: string }> }
    const ids = result.components.map((c) => c.id)

    // 内置组件仍在
    expect(ids).toContain('BattlePlayerHpBar')
    expect(ids).toContain('BattleSkill')
    // 新造控件也在
    expect(ids).toContain('ComboHpBar')
  })
})

describe('automatic character preview generation', () => {
  test('registers the Kino CDN resource without requiring host media bytes', async () => {
    const { context, files, media, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    models.generateImage = async (input) => {
      models.imageInputs.push(structuredClone(input))
      return {
        assets: [{
          id: 'kino-resource-character-1',
          type: 'image',
          url: 'https://kino.invalid/resources/character-1.png',
          contentType: 'image/png',
          sizeBytes: 1,
          metadata: {
            provider: 'kino',
            kinoResourceId: 'kino-resource-character-1',
            kinoGenerationId: 'kino-generation-character-1',
            kinoStatus: 'succeeded',
          },
        }],
        model: 'lite',
      }
    }
    const service = createGameVideoService(context)

    await expect(service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:wukong:kino-register:v1',
      mode: 'portrait',
    })).resolves.toMatchObject({
      ok: true,
      totals: { generated: 1, failed: 0 },
    })

    expect(media.puts).toHaveLength(0)
    expect(media.bodies.has('kino-resource-character-1')).toBe(false)
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    expect(manifest.assets.find((asset: { productionType?: string }) => (
      asset.productionType === 'character_ref'
    ))).toMatchObject({
      status: 'ready',
      url: 'https://kino.invalid/resources/character-1.png',
      provider: {
        kind: 'kino',
        ref: 'https://kino.invalid/resources/character-1.png',
        upstreamResourceId: 'kino-resource-character-1',
      },
    })
  })

  test('uses the Kino-supported 2:3 portrait ratio', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const service = createGameVideoService(context)

    const result = await service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:wukong:portrait:v1',
      mode: 'portrait',
    }) as { ok: boolean }

    expect(result.ok).toBe(true)
    expect(models.imageInputs).toHaveLength(1)
    expect(models.imageInputs[0]).toMatchObject({ aspectRatio: '2:3' })
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    expect(manifest.assets.find((asset: { productionType?: string }) => asset.productionType === 'character_ref'))
      .toMatchObject({
        provenance: {
          recipe: {
            parameters: { aspectRatio: '2:3', size: '1664x2496' },
          },
        },
      })
  })

  test('defaults Agent character generation to turnaround, registers it, binds it, and replays without another model call', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const service = createGameVideoService(context)
    const request = {
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:wukong:v1',
    }

    const first = await service.generateCharacterPreviews(request) as {
      ok: boolean
      revision: number
      replayed: boolean
      totals: { generated: number; failed: number }
      results: Array<{ characterId: string; status: string; asset?: { id: string } }>
    }

    expect(first).toMatchObject({
      ok: true,
      revision: 1,
      replayed: false,
      totals: { generated: 1, failed: 0 },
      results: [{ characterId: 'character-wukong', status: 'generated' }],
    })
    expect(models.imageInputs).toHaveLength(1)
    expect(models.imageInputs[0]).toMatchObject({
      aspectRatio: '16:9',
      model: 'lite',
      metadata: {
        productionType: 'character_ref',
        characterId: 'character-wukong',
        generationTrigger: 'workflow-auto',
        activityRevision: workflow.activityRevision,
      },
    })
    expect(models.imageInputs[0]!.prompt).toContain('正面、侧面、背面')

    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    const assetId = manifest.assetCatalog.entities.character['character-wukong'].current.assetId
    expect(assetId).toMatch(/^a-charref-character-wukong-/)
    expect(manifest.assets.find((asset: { id: string }) => asset.id === assetId)).toMatchObject({
      productionType: 'character_ref',
      status: 'ready',
      sourceModule: 'game-video',
      meta: {
        characterPreview: {
          characterId: 'character-wukong',
          sourcePrompt: '东方神话电影质感，孙悟空全身角色设定',
          generationTrigger: 'workflow-auto',
          activityRevision: workflow.activityRevision,
          mode: 'turnaround',
        },
      },
      provenance: {
        origin: 'generation',
        recipe: {
          parameters: {
            model: 'lite',
            mode: 'turnaround',
            aspectRatio: '16:9',
            size: '2560x1440',
          },
        },
      },
    })

    const replay = await service.generateCharacterPreviews(request) as {
      ok: boolean
      revision: number
      replayed: boolean
    }
    expect(replay).toMatchObject({ ok: true, revision: 1, replayed: true })
    expect(models.imageInputs).toHaveLength(1)
  })

  test('does not accept obsolete user authorization input', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const service = createGameVideoService(context)

    await expect(service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      authorizationRef: 'gate:someone-else',
      idempotencyKey: 'character-preview:unauthorized',
    })).rejects.toThrow('input must NOT have additional properties')
    expect(models.imageInputs).toHaveLength(0)
  })

  test('derives the full cast and automatically generates every required preview', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const stored = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    manifest.assetCatalog.entities.character['character-bajie'] = {
      id: 'character-bajie', name: '猪八戒', description: '黑色僧衣，九齿钉耙',
      prompt: '东方神话电影质感，猪八戒全身角色设定',
      history: [], createdAt: 1, updatedAt: 1,
    }
    const main = stored.manifest.packs[stored.manifest.mainPackId]
    main.graph.nodes[0].data.cast.push({ characterId: 'character-bajie', role: 'secondary' })
    stored.graph = main.graph
    files.entries.set('blueprint.json', json(stored))
    files.entries.set('assets/manifest.json', json(manifest))
    const service = createGameVideoService(context)

    const result = await service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:full-cast',
    }) as { ok: boolean; errorCode?: string; errors?: string[] }

    expect(result).toMatchObject({
      ok: true,
      totals: { required: 2, generated: 2, skipped: 0, failed: 0 },
    })
    expect(models.imageInputs).toHaveLength(2)
  })

  test('rejects an abnormal cast above the fixed automatic-generation limit', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const stored = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    const main = stored.manifest.packs[stored.manifest.mainPackId]
    for (let index = 1; index <= 50; index++) {
      const characterId = `character-extra-${index}`
      manifest.assetCatalog.entities.character[characterId] = {
        id: characterId, name: `角色${index}`, description: `角色${index}设定`,
        prompt: `角色${index}全身参考图`, history: [], createdAt: 1, updatedAt: 1,
      }
      main.graph.nodes[0].data.cast.push({ characterId, role: 'secondary' })
    }
    stored.graph = main.graph
    files.entries.set('blueprint.json', json(stored))
    files.entries.set('assets/manifest.json', json(manifest))
    const service = createGameVideoService(context)

    const result = await service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:system-limit',
      characterIds: ['character-wukong'],
    }) as { ok: boolean; errorCode?: string; errors?: string[] }

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'characters.preview.system-limit-exceeded',
      totals: { required: 51, generated: 0, skipped: 0, failed: 0 },
    })
    expect(result.errors?.[0]).toContain('系统自动生成上限 50')
    expect(models.imageInputs).toHaveLength(0)
  })

  test('does not let a requested subset satisfy readiness for the full on-screen cast', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const stored = JSON.parse(decoder.decode(files.entries.get('blueprint.json')!))
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    manifest.assetCatalog.entities.character['character-bajie'] = {
      id: 'character-bajie', name: '猪八戒', description: '黑色僧衣，九齿钉耙',
      prompt: '东方神话电影质感，猪八戒全身角色设定',
      history: [], createdAt: 1, updatedAt: 1,
    }
    const main = stored.manifest.packs[stored.manifest.mainPackId]
    main.graph.nodes[0].data.cast.push({ characterId: 'character-bajie', role: 'secondary' })
    stored.graph = main.graph
    files.entries.set('blueprint.json', json(stored))
    files.entries.set('assets/manifest.json', json(manifest))
    const service = createGameVideoService(context)

    const generated = await service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:authorized-subset',
      characterIds: ['character-wukong'],
    }) as { ok: boolean }
    const validation = await service.validateProject({
      activityRevision: workflow.activityRevision,
      checkIds: ['characters.references.ready'],
    }) as { ok: boolean; evidence: Array<{ status: string; issues?: Array<{ code: string }> }> }

    expect(generated.ok).toBe(true)
    expect(models.imageInputs).toHaveLength(1)
    expect(validation.evidence[0]!.status).toBe('fail')
    expect(validation.evidence[0]!.issues?.map((issue) => issue.code)).toEqual(['character.preview.missing'])
  })

  test('does not resubmit a model call when the same idempotency key has an unresolved generation', async () => {
    const { context, files, models } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const manifest = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    const sourcePromptHash = characterPreviewSourceHash(
      '金箍、虎皮裙、手持金箍棒',
      '东方神话电影质感，孙悟空全身角色设定',
    )
    manifest.assets.push({
      id: characterPreviewAssetId({
        characterId: 'character-wukong',
        name: '孙悟空',
        description: '金箍、虎皮裙、手持金箍棒',
        sourcePrompt: '东方神话电影质感，孙悟空全身角色设定',
        sourcePromptHash,
      }),
      kind: 'image',
      productionType: 'character_ref',
      status: 'generating',
      label: '孙悟空 · 角色三视图',
      sourceModule: 'game-video',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta: {
        characterPreview: {
          characterId: 'character-wukong',
          sourcePromptHash,
          idempotencyKey: 'character-preview:unresolved',
        },
      },
    })
    files.entries.set('assets/manifest.json', json(manifest))
    const service = createGameVideoService(context)

    const result = await service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:unresolved',
    }) as { ok: boolean; results: Array<{ status: string; error?: string }> }

    expect(result.ok).toBe(false)
    expect(result.results).toEqual([
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('避免重复计费') }),
    ])
    expect(models.imageInputs).toHaveLength(0)
  })

  test('marks a bound preview stale after the source character prompt changes', async () => {
    const { context, files } = createContext()
    const workflow = prepareCharacterPreviewWorkflow(files)
    const service = createGameVideoService(context)
    await service.generateCharacterPreviews({
      activityRevision: workflow.activityRevision,
      expectedRevision: 0,
      idempotencyKey: 'character-preview:stale-check',
    })

    const generated = JSON.parse(decoder.decode(files.entries.get('assets/manifest.json')!))
    generated.assetCatalog.entities.character['character-wukong'].prompt = '全新赛博朋克角色设定'
    files.entries.set('assets/manifest.json', json(generated))
    const validation = await service.validateProject({
      activityRevision: workflow.activityRevision,
      checkIds: ['characters.references.ready'],
    }) as { ok: boolean; evidence: Array<{ status?: string; issues?: Array<{ code: string }> }> }

    expect(validation.evidence[0]!.status).toBe('fail')
    expect(validation.evidence[0]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'character.preview.stale' }),
    ]))
  })
})

describe('graph document revision', () => {
  function revisionOnDisk(files: MemoryFiles): unknown {
    return JSON.parse(decoder.decode(files.entries.get('blueprint.json')!)).revision
  }

  test('reports the initial revision for a legacy blueprint that was never stamped', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)

    expect(await service.getGraph({})).toMatchObject({ revision: 0 })
  })

  test('advances the revision on every accepted patch', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const before = await service.getGraph({}) as {
      project: { graph: { nodes: Array<{ id: string }> } }
    }
    const nodeId = before.project.graph.nodes[0]!.id

    const first = await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: '一' }],
    }) as { revision: number }
    const second = await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: '二' }],
    }) as { revision: number }

    expect([first.revision, second.revision]).toEqual([1, 2])
    expect(revisionOnDisk(files)).toBe(2)
    expect(await service.getGraph({})).toMatchObject({ revision: 2 })
  })

  test('accepts a patch that claims the current revision', async () => {
    const { context } = createContext()
    const service = createGameVideoService(context)
    const before = await service.getGraph({}) as {
      revision: number
      project: { graph: { nodes: Array<{ id: string }> } }
    }
    const nodeId = before.project.graph.nodes[0]!.id

    const result = await service.patchGraph({
      expectedRevision: before.revision,
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: '过桥' }],
    }) as { ok: boolean; revision: number }

    expect(result.ok).toBe(true)
    expect(result.revision).toBe(before.revision + 1)
  })

  test('rejects a patch built on a stale revision without touching the document', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    const before = await service.getGraph({}) as {
      revision: number
      project: { graph: { nodes: Array<{ id: string }> } }
    }
    const nodeId = before.project.graph.nodes[0]!.id

    // Someone else lands a write first, so the agent's snapshot goes stale.
    await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: '用户改的' }],
    })
    const snapshot = decoder.decode(files.entries.get('blueprint.json')!)

    const result = await service.patchGraph({
      expectedRevision: before.revision,
      ops: [{ op: 'set-node-field', nodeId, field: 'name', value: 'agent 覆盖' }],
    }) as { ok: boolean; errorCode?: string; revision?: number }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('revision.conflict')
    expect(result.revision).toBe(1)
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snapshot)
  })

  test('never lets a client choose the next revision', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)

    const result = await service.saveGraph({
      project: { ...blueprint, revision: 999 },
    }) as { ok: boolean; revision: number }

    expect(result.ok).toBe(true)
    expect(result.revision).toBe(1)
    expect(revisionOnDisk(files)).toBe(1)
  })

  test('rejects a whole-document save built on a stale revision', async () => {
    const { context, files } = createContext()
    const service = createGameVideoService(context)
    await service.saveGraph({ project: blueprint })
    const snapshot = decoder.decode(files.entries.get('blueprint.json')!)

    const result = await service.saveGraph({
      project: blueprint,
      expectedRevision: 0,
    }) as { ok: boolean; errorCode?: string; revision?: number }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('revision.conflict')
    expect(result.revision).toBe(1)
    expect(decoder.decode(files.entries.get('blueprint.json')!)).toBe(snapshot)
  })
})
