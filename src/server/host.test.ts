import type {
  MediaCapability,
  ModelCapability,
  ServiceCapability,
  VideoGenerationGateway,
} from '@forgeax/extension-host/contracts'
import type { SeedContext } from '@forgeax/extension-host/node'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_LIBRARY_DOCUMENT } from '@/authoring/blueprint/empty-library'
import { getAssetIdFromArgs, createGameVideoService } from './host/extension-service'
import { createInitialWorkflowState, WorkflowStateError } from './host/workflow-state'
import { host, tools } from './host'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

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

afterEach(() => vi.restoreAllMocks())

class MemoryFiles {
  readonly entries = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(EMPTY_LIBRARY_DOCUMENT))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])

  async list(path: string): Promise<string[]> {
    const prefix = `${path.replace(/\/+$/, '')}/`
    return [...new Set([...this.entries.keys()]
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!)
      .filter(Boolean))].sort()
  }

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.entries.get(path)
    return bytes ? new Uint8Array(bytes) : null
  }

  async write(path: string, contents: Uint8Array): Promise<void> {
    this.entries.set(path, new Uint8Array(contents))
  }

  async delete(path: string): Promise<void> {
    this.entries.delete(path)
  }

  async withLocks<T>(
    _keys: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation()
  }
}

class TraceMedia implements MediaCapability {
  readonly calls: unknown[] = []

  async list(...args: Parameters<MediaCapability['list']>) {
    this.calls.push(['list', structuredClone(args)])
    return []
  }

  async read(...args: Parameters<MediaCapability['read']>) {
    this.calls.push(['read', structuredClone(args)])
    return null
  }

  async put(
    ...args: Parameters<MediaCapability['put']>
  ): Promise<Awaited<ReturnType<MediaCapability['put']>>> {
    this.calls.push(['put', structuredClone(args)])
    throw new Error('No media writes expected from this parity fixture')
  }

  async delete(...args: Parameters<MediaCapability['delete']>): Promise<void> {
    this.calls.push(['delete', structuredClone(args)])
  }
}

class TraceModels implements ModelCapability {
  readonly calls: unknown[] = []

  async generateText(...args: Parameters<ModelCapability['generateText']>) {
    this.calls.push(['text', structuredClone(args)])
    return { text: '[]', model: 'trace' }
  }

  async generateImage(...args: Parameters<ModelCapability['generateImage']>) {
    this.calls.push(['image', structuredClone(args)])
    return { assets: [], model: 'trace' }
  }

  async generateVideo(...args: Parameters<ModelCapability['generateVideo']>) {
    this.calls.push(['video', structuredClone(args)])
    return { assets: [], model: 'trace' }
  }
}

function createContext() {
  const files = new MemoryFiles()
  const media = new TraceMedia()
  const models = new TraceModels()
  return {
    context: {
      gameId: 'parity-game',
      gameRoot: '/host/parity-game',
      files,
      media,
      models,
      videoGeneration: unavailableVideoGeneration,
      services: unavailableServices,
      capabilities: { async invoke(id: string) {
        if (id === 'media.video.visual-styles.list') return { items: [] }
        throw new Error('Capabilities are unavailable in this test context')
      } },
      options: {},
    } satisfies SeedContext,
    files,
    media,
    models,
  }
}

const manifestTools = [
  ['game-video:get-graph', 'getGraph', {}],
  ['game-video:save-graph', 'saveGraph', { project: EMPTY_LIBRARY_DOCUMENT }],
  ['game-video:patch-graph', 'patchGraph', {
    ops: [{
      op: 'set-node-field',
      nodeId: EMPTY_LIBRARY_DOCUMENT.graph.nodes[0]!.id,
      field: 'name',
      value: 'Patched opening',
    }],
  }],
  ['game-video:compile-blueprint-outline', 'compileBlueprintOutline', {
    entry: 'entry',
    idempotencyKey: 'outline:parity',
    chapters: [{ id: 'entry', name: '起点', pillarBeatId: 'B01', beat: 'narrative' }],
    routes: [],
  }],
  ['game-video:create-blueprint-outline-skeleton', 'createBlueprintOutlineSkeleton', {
    entry: 'entry',
    idempotencyKey: 'outline-skeleton:parity',
    chapters: [{ id: 'entry', name: '起点', pillarBeatId: 'B01', beat: 'narrative' }],
  }],
  ['game-video:configure-blueprint-outline-node', 'configureBlueprintOutlineNode', {
    nodeId: 'entry',
    idempotencyKey: 'outline-node:entry:parity',
    actions: [],
    settlements: [],
    outgoingRoutes: [],
  }],
  ['game-video:configure-blueprint-node', 'configureBlueprintNode', {
    nodeId: EMPTY_LIBRARY_DOCUMENT.graph.nodes[0]!.id,
    settlements: [{ trigger: { kind: 'at', seconds: 1 } }],
  }],
  ['game-video:patch-node-media', 'patchNodeMedia', {
    activityRevision: 1,
    expectedGraphRevision: 0,
    graphSnapshotToken: 'parity-game:0',
    expectedAssetRevision: 0,
    idempotencyKey: 'video-presets:parity',
    bindings: [{
      nodeRef: {
        blueprintId: EMPTY_LIBRARY_DOCUMENT.manifest.mainPackId,
        nodeId: EMPTY_LIBRARY_DOCUMENT.graph.nodes[0]!.id,
      },
      media: {
        kind: 'video',
        prompt: 'A bounded provider-neutral preset',
        generation: {
          schemaVersion: 1,
          durationSeconds: 8,
          generateAudio: false,
          mode: 't2v',
          references: {},
        },
      },
    }],
  }],
  ['game-video:patch-rules', 'patchRules', {
    ops: [{ op: 'upsert-variable', variableId: 'var_clues', name: '线索', initial: 0 }],
  }],
  ['game-video:patch-characters', 'patchCharacters', {
    ops: [{ op: 'upsert-character', character: { id: 'char-hero', name: 'Hero', appearance: { description: 'A determined hero', previewPrompt: 'cinematic portrait of a determined hero' } } }],
  }],
  ['game-video:generate-character-previews', 'generateCharacterPreviews', {
    activityRevision: 1,
    expectedRevision: 0,
    idempotencyKey: 'character-preview:test:1',
  }],
  ['game-video:patch-scenes', 'patchScenes', {
    ops: [{ op: 'upsert-scene', sceneId: 'scene_hill', name: '景阳冈', description: '暮色荒山', previewPrompt: '暮色荒山，电影质感，无人物' }],
  }],
  ['game-video:generate-scene-previews', 'generateScenePreviews', {
    activityRevision: 1,
    expectedRevision: 0,
    idempotencyKey: 'scene-preview:test:1',
  }],
  ['game-video:get-workflow-state', 'getWorkflowState', {}],
  ['game-video:begin-activity', 'beginActivity', { activity: 'document.core', expectedWorkflowRevision: 1 }],
  ['game-video:await-user', 'awaitUser', { activityRevision: 1, reason: 'requirement-questionnaire' }],
  ['game-video:complete-activity', 'completeActivity', { activityRevision: 1, artifactRefs: [], checkIds: [] }],
  ['game-video:report-blocker', 'reportBlocker', { activityRevision: 1, code: 'test.blocked', message: 'blocked', retryable: false }],
  ['game-video:focus-page', 'focusPage', { activityRevision: 1, location: { kind: 'document', documentType: 'core' } }],
  ['game-video:inspect-project', 'inspectProject', {}],
  ['game-video:preflight-activity', 'preflightActivity', { activity: 'document.core' }],
  ['game-video:list-ui-components', 'listUiComponents', {}],
  ['game-video:validate-project', 'validateProject', { activityRevision: 1 }],
  ['game-video:simulate-pass-a', 'simulatePassA', { activityRevision: 1 }],
  ['game-video:get-node-production-context', 'getNodeProductionContext', { blueprintId: 'bp-main', nodeId: 'node-a' }],
  ['game-video:list-videos', 'listVideos', {}],
  ['game-video:generate-shot-script', 'generateShotScript', {
    nodeName: 'Opening', storyText: 'Hero enters',
  }],
  ['game-video:generate-keyframe', 'generateKeyframe', {
    sceneNodeId: 'node-1', nodeName: 'Opening', beat: 'Hero enters',
  }],
  ['game-video:generate-video', 'generateVideo', {
    sceneNodeId: 'node-1', nodeName: 'Opening',
    characterRefIds: ['character-ref'], sceneRefIds: ['scene-ref'],
  }],
  ['game-video:generate-video-clip', 'generateVideoClip', {
    prompt: 'A rainy alley',
  }],
  ['game-video:list-video-visual-styles', 'listVideoVisualStyles', {}],
  ['game-video:generate-node-video', 'generateNodeVideo', {
    sceneNodeId: 'node-1', nodeName: 'Opening',
    characterRefIds: ['character-ref'], sceneRefIds: ['scene-ref'],
  }],
  ['game-video:list-assets', 'listAssets', {}],
  ['game-video:get-asset', 'getAsset', { id: 'missing' }],
  ['game-video:import-character-refs', 'importCharacterRefs', {}],
  ['game-video:import-scene-refs', 'importSceneRefs', {}],
  ['game-video:upsert-document', 'upsertDocument', {
    documentType: 'intake',
    slug: 'demo',
    content: '# Intake',
  }],
  ['game-video:upsert-component', 'upsertComponent', {
    id: 'OptionButton',
    label: '选项按钮',
    inputs: [{ key: 'label', label: '文字', valueType: 'string', default: '选项' }],
    events: [{ id: 'select', label: '选择' }],
    gameplaySemantics: {
      roles: ['player-choice'], purpose: '承载剧情选项', stateBindings: [],
      eventSemantics: [{ event: 'select', intent: '选择选项', requiredConsequences: ['feedback', 'advance'], stateMutationOwner: 'settlement', downstreamPayoff: '下游呈现选择结果' }],
      requiredCompanions: [], recommendedSettlements: ['choice-event-route'],
      requiredFeedback: ['选择后锁定'], antiPatterns: ['无差异合流'],
    },
    implementation: `function OptionButton(props) {
      return React.createElement('button', {
        onClick: function () { props.emit?.('select') },
      }, props.label)
    }`,
  }],
] as const

describe('game-video host module', () => {
  test.each([
    ['tavern', '酒馆'],
  ] as const)('creates the %s template seed from initialize options', async (template, nodeName) => {
    const seedRun = createContext()
    Object.assign(seedRun.context, { options: { template } })

    const seed = await host.gamePackage!.createSeed(seedRun.context)
    await expect(host.gamePackage!.validateSeed(seed)).resolves.toBeUndefined()

    expect(seed.blueprint).toMatchObject({
      graph: {
        nodes: expect.arrayContaining([
          expect.objectContaining({ type: 'perf', data: expect.objectContaining({ name: nodeName }) }),
        ]),
      },
    })
    expect(decoder.decode(seedRun.files.entries.get('extra/copied.txt'))).toBe(
      `${template}-extra\n`,
    )
  })

  test('rejects a template seed that lost its entry node', async () => {
    const seedRun = createContext()
    Object.assign(seedRun.context, { options: { template: 'tavern' } })
    const seed = await host.gamePackage!.createSeed(seedRun.context)
    const blueprint = seed.blueprint as typeof EMPTY_LIBRARY_DOCUMENT
    blueprint.manifest.packs[blueprint.manifest.mainPackId]!.graph.nodes.shift()

    await expect(host.gamePackage!.validateSeed(seed)).rejects.toThrow(
      'entry node id',
    )
  })

  test('exports the manifest-ordered tool map and host integrations', async () => {
    const seedRun = createContext()
    expect(Object.keys(tools)).toEqual(manifestTools.map(([id]) => id))
    expect(host.tools).toBe(tools)
    expect(host.gamePackage).toMatchObject({ platform: 'game-video' })
    expect(await host.gamePackage!.createSeed(seedRun.context))
      .toMatchObject({ project: { id: 'parity-game' } })
    expect(decoder.decode(seedRun.files.entries.get('components/index.js')))
      .toContain('export default [\n]')
    await expect(host.gamePackage!.validateSeed({})).rejects.toThrow()
    expect(host.createRouter).toBeTypeOf('function')
  })

  test.each(manifestTools)(
    '%s delegates to its host-context service operation without adapter drift',
    async (toolId, serviceMethod, args) => {
      vi.spyOn(Date, 'now').mockReturnValue(1)
      vi.spyOn(Math, 'random').mockReturnValue(0.25)
      const toolRun = createContext()
      const serviceRun = createContext()

      const service = createGameVideoService(serviceRun.context) as unknown as Record<
        string,
        (input: unknown) => Promise<unknown>
      >
      const [actual, expected] = await Promise.allSettled([
        tools[toolId]!(toolRun.context, structuredClone(args)),
        serviceMethod === 'getAsset'
          ? service.getAsset!(getAssetIdFromArgs(args))
          : service[serviceMethod]!(structuredClone(args)),
      ])
      expect(actual.status).toBe(expected.status)
      if (actual.status === 'fulfilled' && expected.status === 'fulfilled') {
        expect(actual.value).toEqual(expected.value)
      } else if (actual.status === 'rejected' && expected.status === 'rejected') {
        if (expected.reason instanceof WorkflowStateError) {
          // `retryable` 由三态语义推导：`stop` 类才是不可重试，
          // 其余（如未初始化，读一次状态就能继续）报成不可重试会让 Agent 直接放弃。
          expect(actual.reason).toMatchObject({
            ok: false,
            error: {
              code: expected.reason.code,
              target: 'workflow',
              message: expected.reason.message,
              retryable: expected.reason.retry !== 'stop',
              details: { retry: expected.reason.retry },
            },
          })
        } else if (expected.reason instanceof TypeError) {
          // 输入类错误同样结构化回传：退化成 `internal_error` 时模型拿不到
          // 任何可据以修正的信息，只会原样重试（设计 §9.7.5）。
          expect(actual.reason).toMatchObject({
            ok: false,
            error: {
              target: 'input',
              message: expected.reason.message,
              retryable: true,
              details: { retry: 'fix-then-retry' },
            },
          })
        } else {
          expect(String(actual.reason)).toBe(String(expected.reason))
        }
      }
      expect(toolRun.media.calls).toEqual(serviceRun.media.calls)
      expect(toolRun.models.calls).toEqual(serviceRun.models.calls)
    },
  )

  test('validates author gates from workflow evidence instead of returning a constant pass', async () => {
    const run = createContext()
    const pending = createInitialWorkflowState(run.context.gameId)
    await run.files.write(
      '.forgeax/extensions/game-video/workflow.json',
      encoder.encode(JSON.stringify(pending)),
    )
    const service = createGameVideoService(run.context)

    const pendingValidation = await service.validateProject({
      activityRevision: pending.activityRevision,
      checkIds: ['gate.pillar.approved'],
    }) as { evidence: Array<{ status: string; issues?: Array<{ code: string }> }> }
    expect(pendingValidation.evidence[0]).toMatchObject({
      status: 'fail',
      issues: [{ code: 'gate.pillar.pending' }],
    })

    const approved = {
      ...pending,
      gates: {
        ...pending.gates,
        pillar: {
          status: 'approved' as const,
          revision: 1,
          evidenceRef: 'author:pillar:test',
          approvedAt: new Date().toISOString(),
        },
      },
    }
    await run.files.write(
      '.forgeax/extensions/game-video/workflow.json',
      encoder.encode(JSON.stringify(approved)),
    )
    const approvedValidation = await service.validateProject({
      activityRevision: approved.activityRevision,
      checkIds: ['gate.pillar.approved'],
    }) as { evidence: Array<{ status: string }> }
    expect(approvedValidation.evidence[0]).toMatchObject({ status: 'pass' })
  })

  test('returns a stable workflow gate error to AI callers', async () => {
    const run = createContext()
    const state = createInitialWorkflowState(run.context.gameId)
    const pillarComplete = {
      ...state,
      revision: 2,
      productPhase: 'planning-design' as const,
      phaseStatus: 'complete' as const,
      activity: 'document.pillar' as const,
      activityStatus: 'complete' as const,
      activeGroup: {
        id: 'design',
        activities: [],
        status: 'complete' as const,
        revision: 1,
      },
      activities: {
        ...state.activities,
        'document.core': {
          revision: 1,
          status: 'complete' as const,
          artifactRefs: [],
          evidence: [],
        },
        'document.inquiry': {
          revision: 1,
          status: 'complete' as const,
          artifactRefs: [],
          evidence: [],
        },
        'document.pillar': {
          revision: 1,
          status: 'complete' as const,
          artifactRefs: [],
          evidence: [],
        },
      },
    }
    await run.files.write(
      '.forgeax/extensions/game-video/workflow.json',
      encoder.encode(JSON.stringify(pillarComplete)),
    )

    // 总脉络是支柱的编译产物：走 MCP 工具面进来的调用一律被拒，连支柱门都不必看。
    // 这道拒绝比原来的 `workflow.gate.required` 更靠前——那时它意味着「等门开了
    // 再来」，而现在没有任何时机能让 agent 开启它。
    await expect(tools['game-video:begin-activity']!(run.context, {
      activity: 'blueprint.outline',
      expectedWorkflowRevision: pillarComplete.revision,
    })).rejects.toMatchObject({
      ok: false,
      error: {
        code: 'workflow.activity.compiler-owned',
        target: 'workflow',
        retryable: false,
        details: { currentRevision: pillarComplete.revision },
      },
    })
  })
})
