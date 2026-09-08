import type { ExtensionContext } from '@forgeax/extension-host/node'
import type { ServiceCapability, VideoGenerationGateway } from '@forgeax/extension-host/contracts'
import { describe, expect, test } from 'vitest'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'
import tools from './tool-handlers'
import { createInitialWorkflowState } from './host/workflow-state'

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

function createContext(gameId = 'contract-game') {
  const entries = new Map<string, Uint8Array>([
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  const context: ExtensionContext = {
    gameId,
    gameRoot: '/host/injected-game-root',
    files: {
      async list(path) {
        const prefix = `${path.replace(/\/+$/, '')}/`
        return [...new Set([...entries.keys()]
          .filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!)
          .filter(Boolean))].sort()
      },
      async read(path) {
        const bytes = entries.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path, bytes) {
        entries.set(path, new Uint8Array(bytes))
      },
      async delete(path) {
        entries.delete(path)
      },
      async withLocks(_keys, operation) {
        return operation()
      },
    },
    media: {
      async list() { return [] },
      async read() { return null },
      async put() { throw new Error('not needed by graph contract') },
      async delete() {},
    },
    models: {
      async generateText() { throw new Error('not needed by graph contract') },
      async generateImage() { throw new Error('not needed by graph contract') },
      async generateVideo() { throw new Error('not needed by graph contract') },
    },
    videoGeneration: unavailableVideoGeneration,
    services: unavailableServices,
    capabilities: { async invoke() { throw new Error('Capabilities are unavailable in this test context') } },
  }
  return { context, entries }
}

describe('host tool context contract', () => {
  test('persists graph data only through its injected bounded host context', async () => {
    const { context, entries } = createContext()
    const project = structuredClone(NODIA_DEMO_PROJECT)

    await expect(tools['game-video:save-graph']!(
      context,
      { project, title: 'must not create a snapshot' },
    )).resolves.toMatchObject({
      schemaVersion: 1,
      ok: true,
      revision: 1,
      versions: [],
      gameSlug: 'contract-game',
      artifactRef: { kind: 'blueprint', id: 'bp-main', revision: 1 },
      validation: { structural: 'pass', references: 'pass' },
    })
    // The server stamps the revision at the write boundary; the rest of the
    // document must round-trip byte-for-byte.
    expect(JSON.parse(decoder.decode(entries.get('blueprint.json')))).toEqual({
      ...project,
      revision: 1,
    })
  })

  test('lists extension-owned bundled media without a filesystem host field', async () => {
    const { context } = createContext()

    await expect(tools['game-video:list-videos']!(context, {})).resolves.toMatchObject({
      videos: expect.arrayContaining(['idle01']),
    })
  })

  test('uses the injected game binding, including Unicode and single-character ids', async () => {
    for (const gameId of ['中', 'a']) {
      const { context } = createContext(gameId)
      await expect(tools['game-video:get-graph']!(
        context,
        {},
      )).resolves.toMatchObject({ gameSlug: gameId })
    }
  })

  test('rejects host-specific path and caller-selected game fields', async () => {
    const { context } = createContext('bound')

    // schema 拒绝也走结构化 envelope：`additional properties` 必须留在 message 里，
    // 否则模型只会看到一句「Unexpected extension host error」然后原样重试。
    const additionalProperties = {
      ok: false,
      error: {
        code: 'invalid_input',
        target: 'input',
        message: expect.stringContaining('additional properties'),
        retryable: true,
        details: { retry: 'fix-then-retry' },
      },
    }
    await expect(tools['game-video:get-graph']!(
      context,
      { cwd: '/private/secret' },
    )).rejects.toMatchObject(additionalProperties)
    await expect(tools['game-video:get-graph']!(
      context,
      { gameSlug: 'other' },
    )).rejects.toMatchObject(additionalProperties)
    await expect(tools['game-video:generate-video-clip']!(
      context,
      { gameSlug: 'other', prompt: 'A rainy alley', mode: 't2v' },
    )).rejects.toMatchObject(additionalProperties)
  })

  test('blocks paid media fallbacks until the workflow reaches user video handoff', async () => {
    const { context, entries } = createContext('bound')
    const workflow = createInitialWorkflowState('bound')
    workflow.productPhase = 'feature-development'
    workflow.activity = 'characters.previewing'
    workflow.activityStatus = 'working'
    entries.set('.forgeax/extensions/game-video/workflow.json', encoder.encode(JSON.stringify(workflow)))

    const calls = [
      ['game-video:generate-keyframe', { sceneNodeId: 'node-1', nodeName: 'Hero', beat: 'character turnaround' }],
      ['game-video:generate-video', { sceneNodeId: 'node-1', nodeName: 'Hero', characterRefIds: ['character'], sceneRefIds: ['scene'] }],
      ['game-video:generate-video-clip', { prompt: 'character turnaround' }],
      ['game-video:generate-node-video', { sceneNodeId: 'node-1', nodeName: 'Hero', characterRefIds: ['character'], sceneRefIds: ['scene'] }],
    ] as const
    for (const [toolId, args] of calls) {
      await expect(tools[toolId]!(context, args)).rejects.toMatchObject({
        code: 'workflow.media-generation-not-ready',
        retryable: false,
        details: {
          activity: 'characters.previewing',
          characterAssetTool: 'game-video:generate-character-previews',
        },
      })
    }

    workflow.productPhase = 'asset-generation'
    workflow.phaseStatus = 'complete'
    workflow.activity = 'playtest.validating'
    workflow.activityStatus = 'complete'
    workflow.activities['playtest.validating'] = {
      revision: 1, status: 'complete', artifactRefs: [], evidence: [],
    }
    workflow.activeGroup = {
      id: 'delivery', activities: [], status: 'complete', revision: 2,
    }
    entries.set('.forgeax/extensions/game-video/workflow.json', encoder.encode(JSON.stringify(workflow)))
    await expect(tools['game-video:generate-keyframe']!(context, {
      sceneNodeId: 'node-1',
      nodeName: 'Hero',
      beat: 'user-submitted keyframe',
      cwd: '/must-still-reach-normal-schema-validation',
    })).rejects.toMatchObject({
      error: { target: 'input', message: expect.stringContaining('additional properties') },
    })
  })

  test('carries three-state retry semantics and guidance out through the MCP envelope', async () => {
    const { context, entries } = createContext('bound')
    const workflow = createInitialWorkflowState('bound')
    entries.set('.forgeax/extensions/game-video/workflow.json', encoder.encode(JSON.stringify(workflow)))

    // 需求收集阶段写规则目录：当前活动根本不允许这个写入，
    // 属于 `stop` 类——重试一万次也不会变，envelope 不能报成可重试。
    await expect(tools['game-video:patch-rules']!(context, {
      activityRevision: workflow.activityRevision,
      ops: [{ op: 'upsert-entity', entityId: 'hero', name: '主角', kind: 'character' }],
    })).rejects.toMatchObject({
      ok: false,
      error: {
        target: 'workflow',
        retryable: false,
        details: {
          retry: 'stop',
          guidance: { currentActivity: 'brief.collecting' },
        },
      },
    })
  })

  test('authors a project component only through the injected game file capability', async () => {
    const { context, entries } = createContext('bound-game')

    await expect(tools['game-video:upsert-component']!(context, {
      id: 'OptionButton',
      label: '选项按钮',
      inputs: [{ key: 'label', label: '文字', valueType: 'string', default: '选项' }],
      events: [{ id: 'select', label: '选择' }],
      implementation: "function OptionButton(props) { return React.createElement('button', { onClick: function () { props.emit?.('select') } }, props.label) }",
    })).resolves.toMatchObject({
      ok: true,
      componentId: 'OptionButton',
      modulePath: 'components/index.js',
    })
    expect(entries.has('components/definitions/OptionButton.json')).toBe(true)
    expect(entries.has('components/index.js')).toBe(true)
  })

  test('returns generated implementation defects to the agent without publishing source', async () => {
    const { context, entries } = createContext('bound-game')

    await expect(tools['game-video:upsert-component']!(context, {
      id: 'OptionButton',
      events: [],
      implementation: "function OptionButton() { var React = React; return React.createElement('button') }",
    })).rejects.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_component_input',
        target: 'implementation',
        retryable: false,
        message: expect.stringContaining('declares or shadows the injected React runtime'),
      },
    })

    expect(entries.has('components/definitions/OptionButton.json')).toBe(false)
    expect(entries.has('components/index.js')).toBe(false)
  })
})
