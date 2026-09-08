import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  inspectAssetReadiness,
  inspectBlueprintLogic,
  validateProjectForActivity,
} from './project-inspection'
import { scenePreviewSourceHash } from '../generation/scene-previews'
import { characterPreviewSourceHash } from '../generation/character-previews'
import type { VideoGameActivity } from '../../workflow/contracts'
import { activityContract } from '../../workflow/activity-contracts'
import type { NodeInteractionPlan, Reaction } from '@/runtime/core/schema/graph-schema'

const encoder = new TextEncoder()

interface SceneSpec { id: string, preview?: string }

function buildProject(input: {
  nodes?: Array<{
    id: string
    summary?: string
    story?: string
    cast?: string[]
    scenes?: string[]
    effect?: boolean
    prompt?: string
    interaction?: NodeInteractionPlan
    reactions?: Reaction[]
  }>
  edges?: Array<{ source: string, target: string, handle?: string, effect?: boolean }>
  /** 节点挂载的交互元件；出口 handle 由元件事件提供，不挂就没有非 default 出口。 */
  mounts?: Record<string, string>
  characters?: Array<{ id: string, preview?: string }>
  scenes?: SceneSpec[]
  variables?: string[]
  formulas?: Record<string, unknown>
  overlays?: string[]
  entry?: string
}) {
  const nodes = (input.nodes ?? []).map((node) => ({
    id: node.id,
    type: 'scene',
    position: { x: 0, y: 0 },
    data: {
      name: node.id,
      chapterSummary: node.summary ?? `${node.id} 的章节梗概`,
      storyText: node.story ?? `${node.id} 的剧情正文`,
      cast: (node.cast ?? []).map((characterId) => ({ characterId })),
      scenes: (node.scenes ?? []).map((sceneId) => ({ sceneId })),
      ...(node.effect ? { effect: 'var.hp - 1' } : {}),
      ...(node.interaction ? { interaction: node.interaction } : {}),
      ...(node.reactions ? { reactions: node.reactions } : {}),
      ...(input.mounts?.[node.id]
        ? { overlayNodes: [{ id: `mount-${node.id}`, overlay: `base:${input.mounts[node.id]}` }] }
        : {}),
      media: {
        kind: 'video',
        prompt: node.prompt ?? `${node.id} 的画面`,
        generation: {
          schemaVersion: 1,
          durationSeconds: 5,
          generateAudio: false,
          mode: 'strict',
        },
      },
    },
  }))
  const edges = (input.edges ?? []).map((edge, index) => ({
    id: `e-${index}`,
    source: edge.source,
    target: edge.target,
    ...(edge.handle ? { sourceHandle: edge.handle } : {}),
    ...(edge.effect ? { data: { effect: 'var.hp - 1' } } : {}),
  }))
  const graph = { nodes, edges }
  return {
    manifest: { mainPackId: 'main', packs: { main: { entry: input.entry ?? nodes[0]?.id, graph } } },
    graph,
    ...(input.characters ? {
      characters: Object.fromEntries(input.characters.map((character) => [character.id, {
        id: character.id,
        name: character.id,
        appearance: { description: `${character.id} 的外观`, previewPrompt: `${character.id} 的参考图` },
        ...(character.preview ? { primaryPreviewAssetId: character.preview } : {}),
      }])),
    } : {}),
    ...(input.scenes ? {
      scenes: Object.fromEntries(input.scenes.map((scene) => [scene.id, {
        id: scene.id,
        name: scene.id,
        visual: { description: `${scene.id} 的画面`, previewPrompt: `${scene.id} 的参考图` },
        ...(scene.preview ? { primaryPreviewAssetId: scene.preview } : {}),
      }])),
    } : {}),
    ...(input.variables ? {
      variables: Object.fromEntries(input.variables.map((id) => [id, { id, initial: 0 }])),
    } : {}),
    ...(input.formulas ? { formulas: input.formulas } : {}),
    ...(input.overlays || input.mounts ? {
      ui: {
        overlays: {
          ...Object.fromEntries((input.overlays ?? []).map((id) => [id, { id, kind: 'group', children: [] }])),
          ...Object.fromEntries(Object.entries(input.mounts ?? {}).map(([nodeId, component]) => [
            `base:${component}`,
            {
              id: `base:${component}`,
              kind: 'group',
              children: [{ id: `${nodeId}-ui`, kind: 'component', component, inputs: {} }],
            },
          ])),
        },
      },
    } : {}),
  }
}

function context(project: unknown, assets: unknown[] = []): ExtensionContext {
  const source = structuredClone(project) as {
    characters?: Record<string, { id: string, name: string, appearance: { description: string, previewPrompt: string }, primaryPreviewAssetId?: string }>
    scenes?: Record<string, { id: string, name: string, visual: { description: string, previewPrompt: string }, primaryPreviewAssetId?: string }>
    [key: string]: unknown
  }
  const now = 1
  const characterEntities = Object.fromEntries(Object.entries(source.characters ?? {}).map(([id, character]) => [id, {
    id, name: character.name, description: character.appearance.description, prompt: character.appearance.previewPrompt,
    ...(character.primaryPreviewAssetId ? { current: { assetId: character.primaryPreviewAssetId } } : {}),
    history: [], createdAt: now, updatedAt: now,
  }]))
  const sceneEntities = Object.fromEntries(Object.entries(source.scenes ?? {}).map(([id, scene]) => [id, {
    id, name: scene.name, description: scene.visual.description, prompt: scene.visual.previewPrompt,
    ...(scene.primaryPreviewAssetId ? { current: { assetId: scene.primaryPreviewAssetId } } : {}),
    history: [], createdAt: now, updatedAt: now,
  }]))
  delete source.characters
  delete source.scenes
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(source))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({
      version: 2,
      assets,
      assetCatalog: {
        version: 1,
        folders: [],
        placements: {},
        entities: {
          character: characterEntities,
          scene: sceneEntities,
          video: {}, icon: {}, control: {}, audio: {}, font: {},
        },
      },
    }))],
  ])
  return {
    gameId: 'g',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    // 资产读取会查宿主媒体来决定哪些 locator 可信。缺这个桩会让 registry.list()
    // 抛错并被兜成空数组，参考图就全被判成缺失——排查时极易误以为是哈希不匹配。
    media: {
      async list() { return [] },
      async read() { return null },
    },
  } as unknown as ExtensionContext
}

async function checkStatus(
  project: unknown,
  activity: VideoGameActivity,
  checkId: string,
  assets: unknown[] = [],
): Promise<{ status: string, codes: string[] }> {
  const result = await validateProjectForActivity(context(project, assets), activity, 1, [checkId])
  const evidence = result.evidence[0]!
  return { status: evidence.status, codes: (evidence.issues ?? []).map((entry) => entry.code) }
}

/** 就绪且未过期的场景参考图；哈希必须与 buildProject 写入的描述/Prompt 一致。 */
function sceneAsset(id: string) {
  return {
    id: `a-sceneref-${id}`,
    kind: 'image',
    productionType: 'scene_ref',
    status: 'ready',
    prompt: `${id} 的参考图`,
    meta: { scenePreview: { sceneId: id, sourcePromptHash: scenePreviewSourceHash(`${id} 的画面`, `${id} 的参考图`) } },
  }
}

function characterAsset(id: string) {
  return {
    id: `a-charref-${id}`,
    kind: 'image',
    productionType: 'character_ref',
    status: 'ready',
    prompt: `${id} 的参考图`,
    meta: { characterPreview: { characterId: id, sourcePromptHash: characterPreviewSourceHash(`${id} 的外观`, `${id} 的参考图`) } },
  }
}

/** 完整可玩的最小项目：两条不同去处的选项边 + 状态后果。 */
function playableProject(overrides: Parameters<typeof buildProject>[0] = {}) {
  return buildProject({
    nodes: [
      { id: 'n1', cast: ['c1'], scenes: ['s1'] },
      { id: 'n2', cast: ['c1'] },
      { id: 'n3', cast: ['c1'] },
    ],
    edges: [
      { source: 'n1', target: 'n2', handle: 'ying', effect: true },
      { source: 'n1', target: 'n3', handle: 'mo' },
    ],
    // n1 的两个分支出口来自 InkYingMo（发 ying / mo），否则这两条边玩家走不到。
    mounts: { n1: 'InkYingMo' },
    characters: [{ id: 'c1', preview: 'a-charref-c1' }],
    scenes: [{ id: 's1', preview: 'a-sceneref-s1' }],
    variables: ['hp'],
    entry: 'n1',
    ...overrides,
  })
}

describe('总脉络闸门', () => {
  it('骨架与声明齐全时通过', async () => {
    const project = playableProject()
    for (const checkId of [
      'outline.graph-connected',
      'outline.choice-consequence',
      'outline.node-summary-complete',
      'outline.declarations-complete',
      'outline.declaration-budget',
    ]) {
      const { status, codes } = await checkStatus(project, 'blueprint.outline', checkId)
      expect(status, `${checkId} → ${codes.join(',')}`).toBe('pass')
    }
  })

  it('非 default 分支立即合流且没有后果时拦住', async () => {
    const project = playableProject({
      edges: [
        { source: 'n1', target: 'n2', handle: 'route_left' },
        { source: 'n1', target: 'n2', handle: 'route_right' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.choice-consequence')
    expect(status).toBe('fail')
    expect(codes).toContain('graph.choice-consequence')
  })

  it('分支合流且每条出口都声明状态后果时通过', async () => {
    const project = playableProject({
      nodes: [
        {
          id: 'n1',
          cast: ['c1'],
          scenes: ['s1'],
          interaction: {
            beat: 'choice',
            actions: [
              { component: 'InkYingMo', event: 'route_left', intent: '选择左路', effect: { target: 'var.hp', op: 'add', value: 1 } },
              { component: 'InkYingMo', event: 'route_right', intent: '选择右路', effect: { target: 'var.hp', op: 'sub', value: 1 } },
            ],
          },
        },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'route_left' },
        { source: 'n1', target: 'n2', handle: 'route_right' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.choice-consequence')
    expect(status, codes.join(',')).toBe('pass')
  })

  it('分支合流时只有一条出口声明后果仍会被拦住', async () => {
    const project = playableProject({
      nodes: [
        {
          id: 'n1',
          cast: ['c1'],
          scenes: ['s1'],
          interaction: {
            beat: 'choice',
            actions: [
              { component: 'InkYingMo', event: 'route_left', intent: '选择左路', effect: { target: 'var.hp', op: 'add', value: 1 } },
              { component: 'InkYingMo', event: 'route_right', intent: '选择右路' },
            ],
          },
        },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'route_left' },
        { source: 'n1', target: 'n2', handle: 'route_right' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.choice-consequence')
    expect(status).toBe('fail')
    expect(codes).toContain('graph.choice-consequence')
  })

  it('空 effect action 不算分支状态后果', async () => {
    const project = playableProject({
      nodes: [
        {
          id: 'n1',
          cast: ['c1'],
          scenes: ['s1'],
          reactions: [
            { when: { type: 'event', id: 'route_left' }, do: [{ kind: 'effect', effects: [] }] },
            { when: { type: 'event', id: 'route_right' }, do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'hp', op: 'add', value: 1 }] }] },
          ],
        },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'route_left' },
        { source: 'n1', target: 'n2', handle: 'route_right' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.choice-consequence')
    expect(status).toBe('fail')
    expect(codes).toContain('graph.choice-consequence')
  })

  it('缺章节梗概时拦住', async () => {
    const project = playableProject({
      nodes: [
        { id: 'n1', summary: '', cast: ['c1'] },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.node-summary-complete')
    expect(status).toBe('fail')
    expect(codes).toContain('outline.node-summary.missing')
  })

  it('节点只声明稳定角色/场景 ID 时不要求资产目录已有完整定义', async () => {
    const project = playableProject({
      nodes: [
        { id: 'n1', cast: ['c1'], scenes: ['s_ghost'] },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.declarations-complete')
    expect(status, codes.join(',')).toBe('pass')
  })

  it('角色/场景数量不在总脉络阶段作为主线阻塞项', async () => {
    const many = Array.from({ length: 60 }, (_unused, index) => `c${index}`)
    const project = playableProject({
      nodes: [
        { id: 'n1', cast: many },
        { id: 'n2', cast: ['c0'] },
        { id: 'n3', cast: ['c0'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
      characters: many.map((id) => ({ id })),
    })
    const { status, codes } = await checkStatus(project, 'blueprint.outline', 'outline.declaration-budget')
    expect(status, codes.join(',')).toBe('pass')
  })
})

describe('场景完成门与角色对称', () => {
  const readyAssets = [sceneAsset('s1')]

  it('场景定义完整时目录校验通过', async () => {
    const { status, codes } = await checkStatus(playableProject(), 'scenes.modeling', 'scenes.catalog.valid')
    expect(status, codes.join(',')).toBe('pass')
  })

  it('场景缺 Prompt 时拦住', async () => {
    const project = playableProject()
    ;(project as { scenes: Record<string, { visual: { previewPrompt: string } }> }).scenes.s1!.visual.previewPrompt = ''
    const { status, codes } = await checkStatus(project, 'scenes.modeling', 'scenes.catalog.valid')
    expect(status).toBe('fail')
    expect(codes).toContain('scenes.catalog.prompt-missing')
  })

  it('场景缺主预览图时资产活动返回 fail 证据', async () => {
    const project = playableProject({ scenes: [{ id: 's1' }] })
    const { status, codes } = await checkStatus(project, 'scenes.previewing', 'scenes.references.ready')
    expect(status).toBe('fail')
    expect(codes).toContain('scene.preview.missing')
  })

  it('主预览图就绪且未过期时通过', async () => {
    const { status, codes } = await checkStatus(
      playableProject(),
      'scenes.previewing',
      'scenes.references.ready',
      readyAssets,
    )
    expect(status, codes.join(',')).toBe('pass')
  })
})

describe('汇总整装十一项闸门', () => {
  const readyAssets = [characterAsset('c1'), sceneAsset('s1')]

  it('项目巡检把蓝图逻辑与资产就绪证据分开', () => {
    const project = playableProject({ characters: [], scenes: [] })
    const logicIssues = inspectBlueprintLogic(project as never)
    expect(logicIssues.map((entry) => entry.code)).not.toEqual(expect.arrayContaining([
      'characters.catalog.undeclared',
      'scenes.catalog.undeclared',
      'character.preview.missing',
      'scene.preview.missing',
      'node.video-preset.missing',
    ]))

    const assetIssues = inspectAssetReadiness(project as never, {}, {}, new Map())
    expect(assetIssues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'characters.catalog.undeclared',
      'scenes.catalog.undeclared',
    ]))
  })

  it('默认完成门只保留蓝图逻辑，不要求角色、场景、参考图或节点视频预设', async () => {
    const contract = activityContract('game.finalizing')
    expect(contract.requiredInputs).not.toContainEqual({ kind: 'characters' })
    expect(contract.requiredInputs).not.toContainEqual({ kind: 'scenes' })
    expect(contract.hardChecks).not.toEqual(expect.arrayContaining([
      'finalization.declarations-resolved',
      'finalization.character-references-valid',
      'finalization.scene-references-valid',
      'finalization.node-presets-complete',
    ]))

    const project = playableProject({ characters: [], scenes: [] }) as {
      graph: { nodes: Array<{ data: { media?: { generation?: unknown } } }> }
      manifest: { packs: Record<string, { graph: { nodes: Array<{ data: { media?: { generation?: unknown } } }> } }> }
    }
    for (const node of project.graph.nodes) {
      if (node.data.media) delete node.data.media.generation
    }
    for (const pack of Object.values(project.manifest.packs)) {
      for (const node of pack.graph.nodes) {
        if (node.data.media) delete node.data.media.generation
      }
    }

    const result = await validateProjectForActivity(
      context(project),
      'game.finalizing',
      1,
      contract.hardChecks,
    )
    expect(
      result.ok,
      result.evidence
        .filter((entry) => entry.status === 'fail')
        .map((entry) => `${entry.checkId}: ${(entry.issues ?? []).map((item) => item.code).join(',')}`)
        .join('\n'),
    ).toBe(true)
  })

  it('声明了状态却一处都没写回时，结算校验拦住', async () => {
    const project = playableProject({
      edges: [
        { source: 'n1', target: 'n2', handle: 'a' },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'game.finalizing', 'finalization.settlements-complete')
    expect(status).toBe('fail')
    expect(codes).toContain('finalization.settlements.missing')
  })

  it('纯叙事项目（无变量无实体）不被强制要求结算', async () => {
    const project = buildProject({
      nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a' },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
      entry: 'n1',
    })
    const { status } = await checkStatus(project, 'game.finalizing', 'finalization.settlements-complete')
    expect(status).toBe('pass')
  })

  it('只挂载已有 base:* 原型时界面复用校验通过', async () => {
    const { status, codes } = await checkStatus(
      playableProject(),
      'ui.authoring',
      'ui.reuses-existing-overlays',
    )
    expect(status, codes.join(',')).toBe('pass')
  })

  it('挂载 node:* 节点模板时界面复用校验拦住', async () => {
    const project = playableProject() as unknown as {
      manifest: { packs: { main: { graph: { nodes: Array<{ data: { overlayNodes?: Array<{ overlay: string }> } }> } } } }
      ui: { overlays: Record<string, unknown> }
    }
    project.manifest.packs.main.graph.nodes[0]!.data.overlayNodes![0]!.overlay = 'node:n1'
    project.ui.overlays['node:n1'] = { id: 'node:n1', children: [] }

    const { status, codes } = await checkStatus(project, 'ui.authoring', 'ui.reuses-existing-overlays')
    expect(status).toBe('fail')
    expect(codes).toContain('ui.overlay.non-base')
  })

  it('在 base:* 挂载里新增本地 child 时界面复用校验拦住', async () => {
    const project = playableProject() as unknown as {
      manifest: { packs: { main: { graph: { nodes: Array<{ data: { overlayNodes?: Array<Record<string, unknown>> } }> } } } }
    }
    project.manifest.packs.main.graph.nodes[0]!.data.overlayNodes![0]!.added = []

    const { status, codes } = await checkStatus(project, 'ui.authoring', 'ui.reuses-existing-overlays')
    expect(status).toBe('fail')
    expect(codes).toContain('ui.overlay.local-structure')
  })

  it('悬空边被终局校验拦住', async () => {
    const project = playableProject({
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n3', handle: 'b' },
        { source: 'n2', target: 'n_ghost' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'game.finalizing', 'finalization.terminal-outcomes-valid')
    expect(status).toBe('fail')
    expect(codes).toContain('finalization.edge.dangling')
  })

  it('引用不存在变量的绑定被拦住', async () => {
    const project = playableProject({
      nodes: [
        { id: 'n1', cast: ['c1'], scenes: ['s1'] },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
      variables: ['mp'],
    })
    const { status, codes } = await checkStatus(project, 'game.finalizing', 'finalization.rule-bindings-valid')
    expect(status).toBe('fail')
    expect(codes).toContain('finalization.binding.unknown-variable')
  })

  it('未知公式函数被表达式校验拦住', async () => {
    const project = playableProject({
      formulas: {
        dmg: { id: 'dmg', ast: { t: 'call', id: 'c0', name: 'sqrt', args: [{ t: 'num', id: 'n0', v: 4 }] } },
      },
    })
    const { status, codes } = await checkStatus(project, 'game.finalizing', 'finalization.expressions-compile')
    expect(status).toBe('fail')
    expect(codes).toContain('rules.formula.unknown-function')
  })

  it('未解决占位被拦住', async () => {
    const project = playableProject({
      nodes: [
        { id: 'n1', story: 'TODO 待补充', cast: ['c1'], scenes: ['s1'] },
        { id: 'n2', cast: ['c1'] },
        { id: 'n3', cast: ['c1'] },
      ],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n3', handle: 'b' },
      ],
    })
    const { status, codes } = await checkStatus(project, 'game.finalizing', 'finalization.no-unresolved-placeholder')
    expect(status).toBe('fail')
    expect(codes).toContain('finalization.placeholder.unresolved')
  })

  it('引用不存在 overlay 的交互被拦住', async () => {
    const project = playableProject()
    ;(project as { graph: { nodes: Array<{ data: Record<string, unknown> }> } }).graph.nodes[0]!.data.overlayId = 'custom:Ghost'
    ;(project as { manifest: { packs: Record<string, { graph: { nodes: Array<{ data: Record<string, unknown> }> } }> } })
      .manifest.packs.main!.graph.nodes[0]!.data.overlayId = 'custom:Ghost'
    const { status, codes } = await checkStatus(project, 'game.finalizing', 'finalization.interactions-reachable')
    expect(status).toBe('fail')
    expect(codes).toContain('finalization.interaction.unreachable')
  })

  it('未在目录声明场景时整装拦截；已声明但缺参考图则通过逻辑声明检查', async () => {
    const projectWithUndeclared = playableProject({ scenes: [{ id: 's_ghost' }] })
    delete (projectWithUndeclared as { scenes: Record<string, unknown> }).scenes.s_ghost
    const undeclared = await checkStatus(projectWithUndeclared, 'game.finalizing', 'finalization.declarations-resolved')
    expect(undeclared.status).toBe('fail')
    expect(undeclared.codes).toContain('outline.scene.undeclared')

    const projectWithDeclared = playableProject({ scenes: [{ id: 's1' }] })
    const declared = await checkStatus(projectWithDeclared, 'game.finalizing', 'finalization.declarations-resolved')
    expect(declared.status).toBe('pass')
  })

  it('全部就绪时十一项一起通过', async () => {
    const project = playableProject({ overlays: ['custom:MainHud'] })
    for (const checkId of [
      'finalization.declarations-resolved',
      'finalization.settlements-complete',
      'finalization.terminal-outcomes-valid',
      'finalization.rule-bindings-valid',
      'finalization.expressions-compile',
      'finalization.required-ui-complete',
      'finalization.interactions-reachable',
      'finalization.character-references-valid',
      'finalization.scene-references-valid',
      'finalization.node-presets-complete',
      'finalization.no-unresolved-placeholder',
    ]) {
      const { status, codes } = await checkStatus(project, 'game.finalizing', checkId, readyAssets)
      expect(status, `${checkId} → ${codes.join(',')}`).toBe('pass')
    }
  })
})

describe('运行时试玩前置', () => {
  it('空角色/场景目录且没有媒体引用时仍通过默认试玩完成门', async () => {
    const project = playableProject({ characters: [], scenes: [] }) as {
      graph: { nodes: Array<{ data: { media?: unknown } }> }
      manifest: { packs: Record<string, { graph: { nodes: Array<{ data: { media?: unknown } }> } }> }
    }
    for (const node of project.graph.nodes) delete node.data.media
    for (const pack of Object.values(project.manifest.packs)) {
      for (const node of pack.graph.nodes) delete node.data.media
    }
    const result = await validateProjectForActivity(
      context(project),
      'playtest.validating',
      1,
      activityContract('playtest.validating').hardChecks,
    )
    expect(result.ok, JSON.stringify(result.summary.issues)).toBe(true)
  })

  it('图不连通时先拦住，不必等仿真', async () => {
    const project = playableProject({
      nodes: [{ id: 'n1', cast: ['c1'] }, { id: 'n2', cast: ['c1'] }, { id: 'orphan', cast: ['c1'] }],
      edges: [
        { source: 'n1', target: 'n2', handle: 'a', effect: true },
        { source: 'n1', target: 'n1', handle: 'b' },
      ],
    })
    const { status } = await checkStatus(project, 'playtest.validating', 'playtest.all-required-paths-reach-terminal')
    expect(status).toBe('fail')
  })

  it('结构就绪时前置通过，等仿真给最终证据', async () => {
    const { status, codes } = await checkStatus(
      playableProject(),
      'playtest.validating',
      'playtest.all-required-paths-reach-terminal',
    )
    expect(status, codes.join(',')).toBe('pass')
  })
})

describe('基础需求维度校验', () => {
  it('缺少篇幅规模时 brief.required-dimensions 给出 warn 提醒', async () => {
    const result = await validateProjectForActivity(
      context(playableProject()),
      'brief.collecting',
      1,
      ['brief.required-dimensions'],
      {
        requirementContract: {
          rawIntent: '武松打虎',
          dimensions: {},
        },
      } as never,
    )
    const evidence = result.evidence[0]!
    expect(evidence.status).toBe('warn')
    expect(evidence.issues?.[0]?.code).toBe('brief.work-scale.missing')
    expect(result.ok).toBe(true)
  })

  it('篇幅规模已确定时 brief.required-dimensions 通过', async () => {
    const result = await validateProjectForActivity(
      context(playableProject()),
      'brief.collecting',
      1,
      ['brief.required-dimensions'],
      {
        requirementContract: {
          rawIntent: '武松打虎',
          dimensions: {
            work_scale: { value: '短篇' },
          },
        },
      } as never,
    )
    const evidence = result.evidence[0]!
    expect(evidence.status).toBe('pass')
  })
})

describe('语言一致性只报警不拦路', () => {
  it('英文出图提示词产生 warn 而不是 fail，附带字段路径', async () => {
    const project = playableProject() as {
      characters: Record<string, { appearance: { previewPrompt: string } }>
    }
    // 只把出图 Prompt 改成英文：这是实测里最常漂的字段。
    project.characters.c1!.appearance.previewPrompt = 'A tall wandering monk under the moonlight, ink painting'

    const result = await validateProjectForActivity(
      context(project, [sceneAsset('s1'), characterAsset('c1')]),
      'game.finalizing',
      1,
      ['content.language-consistency'],
    )
    const evidence = result.evidence[0]!

    expect(evidence.status).toBe('warn')
    expect(evidence.issues?.[0]?.message).toContain('assetCatalog.entities.character.c1.prompt')
    // warn 不能把整体判成失败，否则一次润色就变成一次撞墙。
    expect(result.ok).toBe(true)
  })

  it('全中文项目该检查通过', async () => {
    const result = await validateProjectForActivity(
      context(playableProject(), [sceneAsset('s1'), characterAsset('c1')]),
      'game.finalizing',
      1,
      ['content.language-consistency'],
    )

    expect(result.evidence[0]!.status).toBe('pass')
  })
})
