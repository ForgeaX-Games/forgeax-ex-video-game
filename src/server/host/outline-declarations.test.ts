import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import { validateProjectForActivity } from './project-inspection'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import { writeScopesFor } from './activity-groups'

const encoder = new TextEncoder()

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

/**
 * 总脉络的职责边界（真跑修正）。
 *
 * 原设计让总脉络同时产出蓝图树和三张声明清单，实测两个后果：
 * 一是它写 `cast` 会撞「引用了不存在的角色」而目录又不在它的写域里，直接死锁；
 * 二是「一次性想清全局」让模型连续三轮纯推理不落笔，主 agent 误判卡死把它杀了。
 *
 * 现在总脉络只出蓝图树与稳定 ID 级 cast/scenes 声明；完整角色/场景定义仍是资产支线产物。
 */

const seed = {
  revision: 0,
  manifest: {
    mainPackId: 'main',
    packs: {
      main: {
        id: 'main',
        title: '主蓝图',
        entry: 'entry',
        graph: {
          nodes: [{
            id: 'entry',
            type: 'scene',
            position: { x: 0, y: 0 },
            data: { name: '起点', chapterSummary: '武松上路', storyText: '三碗不过冈' },
          }],
          edges: [],
        },
      },
    },
  },
  graph: { nodes: [], edges: [] },
}

function createContext(activity: 'blueprint.outline' | 'characters.modeling'): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', json(seed)],
    ['assets/manifest.json', json({ version: 2, assets: [] })],
  ])
  const workflow = createInitialWorkflowState('g')
  workflow.productPhase = 'feature-development'
  workflow.activity = activity
  workflow.activityStatus = 'working'
  workflow.activities[activity] = { revision: 1, status: 'working', artifactRefs: [], evidence: [] }
  if (activity === 'characters.modeling') {
    // G2 是并发组：角色线与场景线同时活跃，这样两条线的写入都能通过守卫。
    workflow.activities['scenes.modeling'] = { revision: 1, status: 'working', artifactRefs: [], evidence: [] }
  }
  workflow.activeGroup = {
    id: activity === 'blueprint.outline' ? 'outline' : 'modeling',
    activities: activity === 'characters.modeling'
      ? ['characters.modeling', 'scenes.modeling']
      : [activity],
    status: 'working',
    revision: 1,
  }
  files.set(VIDEO_GAME_WORKFLOW_FILE, json(workflow))
  return {
    gameId: 'g',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
}

describe('总脉络只写蓝图树', () => {
  it('写域只有 graph', () => {
    expect(writeScopesFor('blueprint.outline')).toEqual(['graph'])
  })

  it('总脉络写角色目录被拒，规则同理归数值线', async () => {
    const service = createGameVideoService(createContext('blueprint.outline'))

    await expect(service.patchCharacters({
      ops: [{
        op: 'upsert-character',
        character: { id: 'wusong', name: '武松', appearance: { description: 'd', previewPrompt: 'p' } },
      }],
    })).rejects.toMatchObject({ code: 'workflow.capability.denied' })
    await expect(service.patchRules({
      ops: [{ op: 'upsert-variable', variableId: 'hp', name: '生命', initial: 10 }],
    })).rejects.toMatchObject({ code: 'workflow.capability.denied' })
  })

  it('不引用任何角色的蓝图树也能通过总脉络的完成门', async () => {
    const context = createContext('blueprint.outline')
    const result = await validateProjectForActivity(
      context,
      'blueprint.outline',
      1,
      ['outline.declarations-complete'],
    )

    // 节点没有 cast：这是合法的，角色是下游产物。
    expect(result.evidence[0]!.status).toBe('pass')
  })

  it('总脉络不能用 patch_graph 的公式 op 绕过工具面写规则', async () => {
    const service = createGameVideoService(createContext('blueprint.outline'))

    await expect(service.patchGraph({
      ops: [{
        op: 'set-formula',
        formulaId: 'clue_count',
        formula: { id: 'clue_count', ast: { t: 'num', id: 'n0', v: 0 } },
      }],
    })).rejects.toMatchObject({ code: 'workflow.write-scope.denied' })
  })

  it('总脉络能看元件契约，但不能挂元件', async () => {
    const service = createGameVideoService(createContext('blueprint.outline'))

    // 看得见：节点出口 handle 来自元件事件，不给它看就编不出可寻址的分支。
    const catalog = await service.listUiComponents() as {
      components: Array<{ id: string; events: Array<{ id: string }> }>
    }
    expect(catalog.components.length).toBeGreaterThan(0)

    // 挂不上：overlay 属于界面写域，挂载与绑数据是整装的活。
    await expect(service.patchGraph({
      ops: [{
        op: 'add-overlay-child',
        nodeId: 'entry',
        child: { id: 'knock', kind: 'component', component: 'ChoiceButton', inputs: {} },
      }],
    })).rejects.toMatchObject({ code: 'workflow.write-scope.denied' })
  })

  it('纯节点与边的批次不受影响', async () => {
    const service = createGameVideoService(createContext('blueprint.outline'))

    const result = await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId: 'entry', field: 'name', value: '景阳冈前' }],
    }) as { ok: boolean, errors?: string[] }

    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
  })
})

describe('总脉络稳定 ID 级资产声明', () => {
  it('允许写 cast/scenes，且目录尚无完整定义时声明检查通过', async () => {
    const context = createContext('blueprint.outline')
    const service = createGameVideoService(context)

    const result = await service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: {
          cast: [{ characterId: 'wusong', onScreen: true }],
          scenes: [{ sceneId: 'gang' }],
        },
      }],
    }) as { ok: boolean, errors?: string[], errorCode?: string }

    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
    const declaration = await validateProjectForActivity(
      context,
      'blueprint.outline',
      1,
      ['outline.declarations-complete'],
    )
    expect(declaration.evidence[0]).toMatchObject({ status: 'pass' })

    const blueprint = JSON.parse(new TextDecoder().decode(
      await context.files.read('blueprint.json') ?? new Uint8Array(),
    ))
    expect(blueprint.manifest.packs.main.graph.nodes[0].data).toMatchObject({
      cast: [{ characterId: 'wusong', onScreen: true }],
      scenes: [{ sceneId: 'gang' }],
    })
  })

  it('资产定义尚未补齐时 game.finalizing 仍可继续修改蓝图逻辑', async () => {
    const context = createContext('blueprint.outline')
    const service = createGameVideoService(context)
    const declaration = await service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: {
          cast: [{ characterId: 'wusong' }],
          scenes: [{ sceneId: 'gang' }],
        },
      }],
    }) as { ok: boolean }
    expect(declaration.ok).toBe(true)

    const workflow = JSON.parse(new TextDecoder().decode(
      await context.files.read(VIDEO_GAME_WORKFLOW_FILE) ?? new Uint8Array(),
    ))
    workflow.activity = 'game.finalizing'
    workflow.activityStatus = 'working'
    workflow.activityRevision = 1
    workflow.activities['game.finalizing'] = {
      revision: 1,
      status: 'working',
      artifactRefs: [],
      evidence: [],
    }
    workflow.activeGroup = {
      id: 'integration',
      activities: ['game.finalizing'],
      status: 'working',
      revision: 1,
    }
    await context.files.write(VIDEO_GAME_WORKFLOW_FILE, json(workflow))

    const result = await service.patchGraph({
      ops: [{ op: 'set-node-field', nodeId: 'entry', field: 'name', value: '逻辑整装继续' }],
    }) as { ok: boolean, errors?: string[] }
    expect(result.ok, JSON.stringify(result.errors)).toBe(true)
  })

  it('拒绝视觉定义、当前资产、参考资源和视频预设字段', async () => {
    const service = createGameVideoService(createContext('blueprint.outline'))
    const result = await service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: {
          appearance: { description: '不应写入' },
          visualDescription: '不应写入',
          previewPrompt: '不应写入',
          currentAssetId: 'asset-current',
          media: {
            kind: 'video',
            prompt: '基础镜头描述可以存在',
            ref: 'video-current',
            generation: {
              schemaVersion: 1,
              durationSeconds: 5,
              generateAudio: false,
              mode: 'firstref',
              references: { firstFrameAssetId: 'frame-current' },
            },
          },
        },
      }],
    }) as { ok: boolean, errors?: string[], errorCode?: string }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('workflow.outline.asset-detail-not-allowed')
    expect(result.errors?.join('\n')).toContain('appearance')
    expect(result.errors?.join('\n')).toContain('previewPrompt')
    expect(result.errors?.join('\n')).toContain('currentAssetId')
    expect(result.errors?.join('\n')).toContain('media.ref')
    expect(result.errors?.join('\n')).toContain('media.generation')
  })

  it('基础视频 Prompt 也必须通过专用节点媒体操作写入', async () => {
    const context = createContext('blueprint.outline')
    const service = createGameVideoService(context)
    const before = await context.files.read('blueprint.json')

    const result = await service.patchGraph({
      ops: [{
        op: 'set-node-data',
        nodeId: 'entry',
        patch: {
          chapterSummary: '武松上路，酒意上头',
          storyText: '三碗不过冈，直奔景阳冈',
          media: {
            kind: 'video',
            prompt: '武松提着哨棒，大步走向山冈，落日余晖',
          },
        },
      }],
    }) as { ok: boolean, errors?: string[], errorCode?: string }

    expect(result).toMatchObject({
      ok: false,
      errorCode: 'workflow.node-media.dedicated-operation-required',
    })
    expect(await context.files.read('blueprint.json')).toEqual(before)
  })
})
