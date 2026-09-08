import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import type { VideoGameWorkflowState } from '../../workflow/contracts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * 玩法契约的**通链**测试：写得进去、读得出来、三段闸门依次消费。
 *
 * 各校验器的单元测试只证明「给定一份契约，判据算得对」。真正会让整套设计变成纸面的
 * 是链条断在工具边界——例如 `patch_graph` 的 schema 不接受 `interaction`，
 * 或者节点上下文不透出它。这条测试从总脉络的真实工具调用开始，一路走到整装的闸门。
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
          nodes: [
            {
              id: 'entry',
              type: 'scene',
              position: { x: 0, y: 0 },
              data: { name: '景阳冈前', chapterSummary: '武松上冈', storyText: '三碗不过冈' },
            },
            {
              id: 'clash',
              type: 'scene',
              position: { x: 200, y: 0 },
              data: { name: '虎扑', chapterSummary: '猛虎扑来', storyText: '一声吼' },
            },
          ],
          edges: [{ id: 'e1', source: 'entry', target: 'clash', sourceHandle: 'default', data: {} }],
        },
      },
    },
  },
  graph: { nodes: [], edges: [] },
  entities: {},
  variables: {},
  formulas: {},
}

const GROUP_OF: Record<string, string> = {
  'blueprint.outline': 'outline',
  'rules.catalog': 'modeling',
  'game.finalizing': 'finalizing',
}

function contextFor(activity: string): { context: ExtensionContext, files: Map<string, Uint8Array> } {
  const state = createInitialWorkflowState('g')
  state.productPhase = 'feature-development'
  state.activity = activity as VideoGameWorkflowState['activity']
  state.activityStatus = 'working'
  state.activities[activity as VideoGameWorkflowState['activity']] = {
    revision: 1, status: 'working', artifactRefs: [], evidence: [],
  }
  state.activeGroup = {
    id: GROUP_OF[activity] ?? activity,
    activities: [activity as VideoGameWorkflowState['activity']],
    status: 'working',
    revision: 1,
  }
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(seed))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
    [VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(state))],
  ])
  const context = {
    gameId: 'g',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] } },
  } as unknown as ExtensionContext
  return { context, files }
}

const plan = {
  beat: 'combat',
  actions: [{
    component: 'BattleSkill',
    event: 'light',
    intent: '观众点轻击，趁老虎扑空时打它',
    effect: { target: 'entity.tiger.attr.hp', op: 'sub', formulaId: 'dmg_light' },
    exit: 'none',
  }],
  terminals: [{ when: 'entity.tiger.attr.hp <= 0', note: '武松取胜' }],
}

describe('玩法契约通链', () => {
  it('patch_graph rejects generic non-default branches that immediately merge without consequences', async () => {
    const { context } = contextFor('blueprint.outline')
    const service = createGameVideoService(context)

    const result = await service.patchGraph({
      ops: [
        { op: 'connect', id: 'branch-left', source: 'clash', target: 'entry', sourceHandle: 'option_left', targetHandle: 'in' },
        { op: 'connect', id: 'branch-right', source: 'clash', target: 'entry', sourceHandle: 'option_right', targetHandle: 'in' },
      ],
    }) as { ok: boolean, errorCode?: string, errors?: string[] }

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('validation.failed')
    expect(result.errors?.join('\n')).toContain('分支立即合流且没有状态后果')
  })

  it('总脉络能用 patch_graph 把契约写进节点，并在读回时保留', async () => {
    const { context } = contextFor('blueprint.outline')
    const service = createGameVideoService(context)

    const result = await service.patchGraph({
      ops: [
        { op: 'set-node-data', nodeId: 'clash', patch: { interaction: plan } },
        { op: 'set-node-data', nodeId: 'entry', patch: { interaction: { beat: 'narrative' } } },
      ],
    }) as { ok: boolean, errors?: string[] }

    expect(result.ok, JSON.stringify(result.errors)).toBe(true)

    const graph = await service.getGraph() as {
      project: { manifest: { packs: Record<string, { graph: { nodes: Array<{ id: string, data: Record<string, unknown> }> } }> } }
    }
    const clash = graph.project.manifest.packs.main!.graph.nodes.find((node) => node.id === 'clash')!
    // 归一化不能把契约洗掉——scenes 字段当年就是这样丢的。
    expect(clash.data.interaction).toEqual(plan)
  })

  it('契约写完后总脉络的完成门通过，缺表态的节点会被拦住', async () => {
    const { context } = contextFor('blueprint.outline')
    const service = createGameVideoService(context)

    await service.patchGraph({ ops: [{ op: 'set-node-data', nodeId: 'clash', patch: { interaction: plan } }] })
    await service.getWorkflowState()
    const partial = await service.validateProject({ checkIds: ['outline.interaction-plan'] }) as {
      evidence: Array<{ status: string, issues?: Array<{ code: string }> }>
    }
    // entry 还没表态。
    expect(partial.evidence[0]!.status).toBe('fail')
    expect((partial.evidence[0]!.issues ?? []).map((entry) => entry.code)).toContain('outline.interaction.missing')

    await service.patchGraph({ ops: [{ op: 'set-node-data', nodeId: 'entry', patch: { interaction: { beat: 'narrative' } } }] })
    const full = await service.validateProject({ checkIds: ['outline.interaction-plan'] }) as {
      evidence: Array<{ status: string, issues?: Array<{ code: string }> }>
    }
    expect(full.evidence[0]!.status, JSON.stringify(full.evidence[0]!.issues)).toBe('pass')
  })

  it('数值线读到契约后按订单造公式，闸门随之转绿', async () => {
    const outline = contextFor('blueprint.outline')
    const outlineService = createGameVideoService(outline.context)
    await outlineService.patchGraph({
      ops: [
        { op: 'set-node-data', nodeId: 'clash', patch: { interaction: plan } },
        { op: 'set-node-data', nodeId: 'entry', patch: { interaction: { beat: 'narrative' } } },
      ],
    })

    // 换成数值线的活动，沿用上一步写好的蓝图。
    const rules = contextFor('rules.catalog')
    rules.files.set('blueprint.json', outline.files.get('blueprint.json')!)
    const rulesService = createGameVideoService(rules.context)

    await rulesService.getWorkflowState()
    const before = await rulesService.validateProject({ checkIds: ['rules.plan-formulas'] }) as {
      evidence: Array<{ status: string, issues?: Array<{ code: string, message: string }> }>
    }
    expect(before.evidence[0]!.status).toBe('fail')
    // 报错要说清是哪个节点、哪个动作要这条公式，否则数值线只能猜。
    const message = (before.evidence[0]!.issues ?? []).map((entry) => entry.message).join('\n')
    expect(message).toContain('dmg_light')
    expect(message).toContain('clash')

    const patched = await rulesService.patchRules({
      ops: [
        { op: 'upsert-entity', entityId: 'tiger', name: '猛虎' },
        { op: 'upsert-entity-attr', entityId: 'tiger', attrId: 'hp', value: 30, meta: { max: 30 } },
        { op: 'upsert-formula', formulaId: 'dmg_light', name: '轻击伤害', expressionText: '3' },
      ],
    }) as { ok: boolean, errors?: string[] }
    expect(patched.ok, JSON.stringify(patched.errors)).toBe(true)

    const after = await rulesService.validateProject({ checkIds: ['rules.plan-formulas'] }) as {
      evidence: Array<{ status: string, issues?: Array<{ code: string }> }>
    }
    expect(after.evidence[0]!.status, JSON.stringify(after.evidence[0]!.issues)).toBe('pass')
  })

  it('节点生产上下文把契约透给整装', async () => {
    const { context, files } = contextFor('blueprint.outline')
    const service = createGameVideoService(context)
    await service.patchGraph({ ops: [{ op: 'set-node-data', nodeId: 'clash', patch: { interaction: plan } }] })

    const finalizing = contextFor('game.finalizing')
    finalizing.files.set('blueprint.json', files.get('blueprint.json')!)
    const finalizingService = createGameVideoService(finalizing.context)

    const nodeContext = await finalizingService.getNodeProductionContext({
      blueprintId: 'main',
      nodeId: 'clash',
    }) as { node: { interaction: unknown } }

    expect(nodeContext.node.interaction).toEqual(plan)
  })
})
