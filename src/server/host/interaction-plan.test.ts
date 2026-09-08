import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { validateProjectForActivity } from './project-inspection'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import type { NodeInteractionPlan } from '@/runtime/core/schema/graph-schema'

const encoder = new TextEncoder()

/**
 * 玩法契约把三条线串起来（第二局问题 23–26 的共同根因）。
 *
 * 三条线并行工作、写域互斥，此前没有任何共享的玩法设计：总脉络编出没有元件提供的出口，
 * 数值线写了 43 个公式只有 3 个被引用，整装拿到零件却不知道哪个配哪个。
 * 现在总脉络在节点上声明契约，数值线只读它决定造哪些公式，整装照它接线，三段各有闸门。
 */

function project(options: {
  plan?: NodeInteractionPlan
  formulas?: Record<string, unknown>
  entities?: Record<string, unknown>
  wired?: boolean
  combatPack?: boolean
  extraCombatNodes?: number
}) {
  const graph = {
    nodes: [
      {
        id: 'clash',
        type: 'scene',
        position: { x: 0, y: 0 },
        data: {
          name: '首次交手',
          chapterSummary: '武松与虎首次交手',
          storyText: '虎扑而来',
          ...(options.plan ? { interaction: options.plan } : {}),
          ...(options.plan?.beat === 'combat' && options.combatPack
            ? { subFlowPack: { id: 'battlepack:test', version: '1', entry: 'ready' } }
            : {}),
          ...(options.wired
            ? {
              overlayNodes: [{ id: 'm', overlay: 'node:clash' }],
              reactions: [{
                when: { type: 'event', id: 'light' },
                do: [{
                  kind: 'effect',
                  effects: [{
                    kind: 'attr',
                    entityId: 'tiger',
                    attr: 'hp',
                    op: 'add',
                    value: { expr: '-formula.dmg_light' },
                  }],
                }],
              }],
            }
            : {}),
        },
      },
      ...Array.from({ length: options.extraCombatNodes ?? 0 }, (_, index) => ({
        id: `clash-extra-${index}`,
        type: 'scene',
        position: { x: 0, y: 100 + index * 100 },
        data: {
          name: `追加战斗 ${index + 1}`,
          chapterSummary: '追加战斗',
          storyText: '追加战斗',
          ...(options.plan ? { interaction: options.plan } : {}),
        },
      })),
      {
        id: 'win',
        type: 'scene',
        position: { x: 200, y: 0 },
        // 终局节点是有意的纯叙事段，也必须显式表态。
        data: { name: '胜', chapterSummary: '胜', storyText: '胜', interaction: { beat: 'narrative' } },
      },
    ],
    edges: [
      {
        id: 'e-default',
        source: 'clash',
        target: 'win',
        sourceHandle: 'default',
        data: options.wired ? { condition: { kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'lte', value: 0 } } : {},
      },
    ],
  }
  return {
    revision: 1,
    version: 'game-video.graph.v1',
    graph,
    manifest: { mainPackId: 'bp-main', packs: { 'bp-main': { id: 'bp-main', title: '主蓝图', entry: 'clash', graph } } },
    variables: {},
    entities: options.entities ?? { tiger: { id: 'tiger', attrs: { hp: 30 }, attrMeta: { hp: { max: 30 } } } },
    formulas: options.formulas ?? {},
    ...(options.wired
      ? {
        ui: {
          overlays: {
            'node:clash': {
              id: 'node:clash',
              kind: 'group',
              children: [{ id: 'skill', kind: 'component', component: 'BattleSkill', inputs: {} }],
            },
          },
        },
      }
      : {}),
  }
}

function context(doc: unknown): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(doc))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
    [VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(createInitialWorkflowState('g')))],
  ])
  return {
    gameId: 'g',
    files: {
      async read(path: string) { return files.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { files.set(path, bytes) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] } },
  } as unknown as ExtensionContext
}

async function statusOf(doc: unknown, activity: string, checkId: string, workflowState?: unknown) {
  const result = await validateProjectForActivity(
    context(doc),
    activity as never,
    1,
    [checkId],
    workflowState as never,
  )
  const evidence = result.evidence[0]!
  return { status: evidence.status, codes: (evidence.issues ?? []).map((entry) => entry.code) }
}

const combatPlan: NodeInteractionPlan = {
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

describe('总脉络的玩法契约闸门', () => {
  it('每个节点都要声明节拍类型', async () => {
    const { status, codes } = await statusOf(project({}), 'blueprint.outline', 'outline.interaction-plan')

    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.missing')
  })

  it('打斗节拍不给动作就是漏配', async () => {
    const { codes } = await statusOf(
      project({ plan: { beat: 'combat' } }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(codes).toContain('outline.interaction.no-action')
  })

  it('标成纯叙事却挂了动作会被拦住：有交互就不是纯叙事', async () => {
    // 实测一局 12 个节点全填 narrative，连挂着 BattleParry 的打斗节点也是。
    const { status, codes } = await statusOf(
      project({ plan: { ...combatPlan, beat: 'narrative' } }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.beat-mismatch')
  })

  it('纯叙事节拍不需要动作（有意留白，不是漏配）', async () => {
    const { status } = await statusOf(
      project({ plan: { beat: 'narrative' } }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(status).toBe('pass')
  })

  it('写了清单里不存在的元件或事件会被拦住，并列出可用事件', async () => {
    const { codes } = await statusOf(
      project({
        plan: {
          beat: 'choice',
          actions: [{ component: 'BattleSkill', event: 'choice-A', intent: '编出来的事件' }],
        },
      }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(codes).toContain('outline.interaction.unknown-event')
  })

  it('每个交互动作必须在规划阶段声明 effect 或 exit 后果', async () => {
    const { status, codes } = await statusOf(
      project({
        plan: {
          beat: 'choice',
          actions: [{ component: 'TextOption', event: 'activate', intent: '查看血迹' }],
        },
      }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.no-consequence')
  })

  it('短篇篇幅下缺少战斗节拍时报错', async () => {
    const choicePlan: NodeInteractionPlan = {
      beat: 'choice',
      actions: [{ component: 'TextOption', event: 'activate', intent: '调查痕迹', exit: 'default' }],
    }
    const shortWorkflow = {
      requirementContract: {
        schemaVersion: 1,
        rawIntent: '短篇',
        dimensions: { work_scale: { value: '短篇（10个章节）', source: 'author' } },
        locale: 'zh-CN',
      },
    }
    const { status, codes } = await statusOf(
      project({ plan: choicePlan }),
      'blueprint.outline',
      'outline.interaction-plan',
      shortWorkflow,
    )

    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.combat-required')

    const passed = await statusOf(
      project({ plan: combatPlan }),
      'blueprint.outline',
      'outline.interaction-plan',
      shortWorkflow,
    )
    expect(passed.status).toBe('pass')
    expect(passed.codes).not.toContain('outline.interaction.combat-required')
  })

  it('短篇一个战斗回合可以由多个主图节点组成', async () => {
    const shortWorkflow = {
      requirementContract: {
        schemaVersion: 1,
        rawIntent: '短篇',
        dimensions: { work_scale: { value: '短篇（10个章节）', source: 'author' } },
        locale: 'zh-CN',
      },
    }
    const result = await statusOf(
      project({ plan: combatPlan, extraCombatNodes: 4 }),
      'blueprint.outline',
      'outline.interaction-plan',
      shortWorkflow,
    )

    expect(result.status).toBe('pass')
    expect(result.codes).not.toContain('outline.interaction.combat-over-budget')
  })

  it('契约齐全时通过', async () => {
    const { status, codes } = await statusOf(
      project({ plan: combatPlan }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(status, codes.join(',')).toBe('pass')
  })

  it('回合契约必须指向当前蓝图中的真实节点', async () => {
    const { status, codes } = await statusOf(
      project({
        plan: { ...combatPlan, loop: { backTo: 'missing-ready' } },
      }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.loop-target-missing')
  })

  it('战斗节拍必须声明 subFlowPack 战斗包', async () => {
    const missing = await statusOf(project({ plan: combatPlan }), 'blueprint.outline', 'combat.pack-required')
    expect(missing.status).toBe('fail')
    expect(missing.codes).toContain('combat.pack-required')

    const configured = await statusOf(
      project({ plan: combatPlan, combatPack: true }),
      'blueprint.outline',
      'combat.pack-required',
    )
    expect(configured.status).toBe('pass')
  })
})

describe('数值线按契约造公式', () => {
  it('契约点名的公式没造出来就拦住，并说清是哪个节点要的', async () => {
    const { status, codes } = await statusOf(
      project({ plan: combatPlan }),
      'rules.catalog',
      'rules.plan-formulas',
    )

    expect(status).toBe('fail')
    expect(codes).toContain('rules.plan.formula-missing')
  })

  it('契约引用的实体属性不存在也拦住', async () => {
    const { codes } = await statusOf(
      project({
        plan: combatPlan,
        formulas: { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } },
        entities: { tiger: { id: 'tiger', attrs: { stamina: 10 } } },
      }),
      'rules.catalog',
      'rules.plan-formulas',
    )

    expect(codes).toContain('rules.plan.target-missing')
  })

  it('公式与目标都到位时通过', async () => {
    const { status, codes } = await statusOf(
      project({
        plan: combatPlan,
        formulas: { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } },
      }),
      'rules.catalog',
      'rules.plan-formulas',
    )

    expect(status, codes.join(',')).toBe('pass')
  })
})

describe('整装照契约接线', () => {
  it('契约里的元件没挂上就拦住', async () => {
    const { status, codes } = await statusOf(
      project({
        plan: combatPlan,
        formulas: { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } },
      }),
      'game.finalizing',
      'finalization.plan-wired',
    )

    expect(status).toBe('fail')
    expect(codes).toContain('finalization.plan.component-unmounted')
  })

  it('挂上元件、事件接了结算、公式被引用后通过', async () => {
    const { status, codes } = await statusOf(
      project({
        plan: combatPlan,
        formulas: { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } },
        wired: true,
      }),
      'game.finalizing',
      'finalization.plan-wired',
    )

    expect(status, codes.join(',')).toBe('pass')
  })

  it('元件挂了但契约点名的公式没人引用 = 玩法没接上', async () => {
    const { codes } = await statusOf(
      project({
        plan: {
          ...combatPlan,
          actions: [{ ...combatPlan.actions![0]!, effect: { target: 'entity.tiger.attr.hp', op: 'sub', formulaId: 'dmg_heavy' } }],
        },
        formulas: { dmg_heavy: { id: 'dmg_heavy', ast: { t: 'num', id: 'n0', v: 9 } } },
        wired: true,
      }),
      'game.finalizing',
      'finalization.plan-wired',
    )

    expect(codes).toContain('finalization.plan.effect-unwired')
  })
})
