import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { validateProjectForActivity } from './project-inspection'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import type { GameNode, NodeInteractionPlan } from '@/runtime/core/schema/graph-schema'

const encoder = new TextEncoder()
const PILLAR_CONTENT = `
## 互动节拍
\`\`\`pillar-interaction-contract
{"schemaVersion":2,"beats":[{"id":"B01","narrativeIntent":"武松识破猛虎扑击并发动轻击","playerInformation":["猛虎正在扑击","敌方当前生命值"],"uiCapabilities":["战斗输入"],"actions":[{"id":"light","intent":"观众点轻击，趁老虎扑空时打它","stateMutationOwner":"settlement","stateChange":"降低敌方生命","immediateFeedback":"敌方血条下降并显示受击反馈","downstreamPayoff":"下游视频播放猛虎中拳后退","exitIntent":"进入轻击结果演出"}],"settlements":[{"id":"light-result","sourceActionId":"light","trigger":"at","source":"轻击结果视频 1000ms 命中帧","intent":"应用轻击伤害","feedback":"敌方血条下降并显示受击反馈","exitIntent":"结果演出结束"}]}]}
\`\`\`
`

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
              overlayNodes: [{
                id: 'm',
                overlay: 'node:clash',
                reactions: [{
                  when: { type: 'event', id: 'light' },
                  do: [{ kind: 'advance', edgeId: 'e-light' }],
                }],
              }],
            }
            : {}),
          ...(options.plan?.actions?.some((action) => (action.exit ?? action.event) === 'light')
            ? {
              outcomeEvidence: [{
                id: 'B01/light',
                sourceEdgeId: 'e-light',
                presentation: '下游视频播放猛虎中拳后退',
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
        data: {
          name: '轻击结果',
          chapterSummary: '猛虎中拳后退',
          storyText: '猛虎中拳后退',
          interaction: {
            beat: 'narrative',
            sourcePillarBeatId: 'B01',
            narrativeIntent: '武松识破猛虎扑击并发动轻击',
            playerInformation: ['猛虎正在扑击', '敌方当前生命值'],
            settlements: [{
              id: 'light-result',
              sourcePillarSettlementId: 'light-result',
              sourcePillarActionId: 'light',
              pattern: 'timeline-hit-sync',
              trigger: 'at',
              source: '轻击结果视频 1000ms 命中帧',
              triggerSpec: { type: 'at', ms: 1000 },
              intent: '应用轻击伤害',
              feedback: '敌方血条下降并显示受击反馈',
              feedbackSpec: {
                kind: 'state-binding',
                component: 'BattleEnemyHpBar',
                target: 'entity.tiger.attr.hp',
              },
              exitIntent: '结果演出结束',
            }],
          },
          ...(options.wired
            ? {
              overlayNodes: [{ id: 'result-hud', overlay: 'node:win' }],
              reactions: [{
                when: { type: 'at', ms: 1000 },
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
    ],
    edges: [
      {
        id: 'e-default',
        source: 'clash',
        target: 'win',
        sourceHandle: 'default',
        data: options.wired ? { condition: { all: [{ type: 'attr', entityId: 'tiger', attr: 'hp', op: 'lte', value: 0 }] } } : {},
      },
      ...(options.plan?.actions?.some((action) => (action.exit ?? action.event) === 'light')
        ? [{
          id: 'e-light',
          source: 'clash',
          target: 'win',
          sourceHandle: 'light',
          data: {
            design: {
              pillarBeatId: 'B01',
              producer: { kind: 'component-event', ref: 'BattleSkill.light' },
              narrativePayoff: '下游视频播放猛虎中拳后退',
              outcomeEvidenceId: 'B01/light',
            },
          },
        }]
        : []),
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
              children: [
                { id: 'skill', kind: 'component', component: 'BattleSkill', inputs: {} },
                {
                  id: 'enemy-hp',
                  kind: 'component',
                  component: 'BattleEnemyHpBar',
                  inputs: { current: { expr: 'entity.tiger.attr.hp' }, max: 30 },
                },
              ],
            },
            'node:win': {
              id: 'node:win',
              kind: 'group',
              children: [{
                id: 'enemy-hp',
                kind: 'component',
                component: 'BattleEnemyHpBar',
                inputs: { current: { expr: 'entity.tiger.attr.hp' }, max: 30 },
              }],
            },
          },
        },
      }
      : {}),
  }
}

/** v3 起动作必须声明承载角色，或显式承认目录承载不了。 */
function pillarV3(carrier: string): string {
  return PILLAR_CONTENT
    .replace('"schemaVersion":2', '"schemaVersion":3')
    .replace('"id":"light","intent"', `"id":"light",${carrier},"intent"`)
}

function context(doc: unknown, pillar: string = PILLAR_CONTENT): ExtensionContext {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(doc))],
    ['docs/test_pillar.md', encoder.encode(pillar)],
    ['assets/manifest.json', encoder.encode(JSON.stringify({
      version: 2,
      assets: [{
        id: 'pillar', kind: 'document', name: 'pillar', status: 'ready', mimeType: 'text/markdown',
        provider: { kind: 'local', ref: 'docs/test_pillar.md' }, createdAt: 1, updatedAt: 1,
        meta: { documentType: 'pillar' },
      }],
    }))],
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

async function statusOf(
  doc: unknown,
  activity: string,
  checkId: string,
  workflowState?: unknown,
  pillar?: string,
) {
  const result = await validateProjectForActivity(
    context(doc, pillar),
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
  sourcePillarBeatId: 'B01',
  narrativeIntent: '武松识破猛虎扑击并发动轻击',
  playerInformation: ['猛虎正在扑击', '敌方当前生命值'],
  actions: [{
    sourcePillarActionId: 'light',
    stateMutationOwner: 'settlement',
    component: 'BattleSkill',
    event: 'light',
    intent: '观众点轻击，趁老虎扑空时打它',
    stateChangeIntent: '降低敌方生命',
    feedback: '敌方血条下降并显示受击反馈',
    feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'entity.tiger.attr.hp' },
    downstreamPayoff: '下游视频播放猛虎中拳后退',
    exitIntent: '进入轻击结果演出',
    effect: { target: 'entity.tiger.attr.hp', op: 'sub', formulaId: 'dmg_light' },
    exit: 'light',
    targetNodeId: 'win',
  }],
  loop: { backTo: 'clash', note: '双方仍存活时进入下一回合' },
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

  it('纯叙事节拍本身不需要动作，但不能吞掉支柱已确认的互动节拍', async () => {
    const { status, codes } = await statusOf(
      project({ plan: { beat: 'narrative' } }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(codes).not.toContain('outline.interaction.no-action')
    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.pillar-beat-incomplete')
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

  it('动作反馈和结算触发必须有可机械编译的规格', async () => {
    const actionWithoutFeedbackSpec = structuredClone(combatPlan)
    delete actionWithoutFeedbackSpec.actions![0]!.feedbackSpec
    const actionResult = await statusOf(
      project({ plan: actionWithoutFeedbackSpec }),
      'blueprint.outline',
      'outline.interaction-plan',
    )
    expect(actionResult.codes).toContain('outline.interaction.feedback-spec-missing')

    const settlementResult = await statusOf(
      project({
        plan: {
          ...combatPlan,
          settlements: [{
            id: 'terminal', pattern: 'health-terminal', trigger: 'state',
            source: 'entity.tiger.attr.hp <= 0', intent: '判胜', feedback: '冻结输入',
            feedbackSpec: { kind: 'hide-interface' },
          }],
        },
      }),
      'blueprint.outline',
      'outline.interaction-plan',
    )
    expect(settlementResult.codes).toContain('outline.interaction.settlement-trigger-spec-missing')
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

  it('数值动作必须路由到独立结果节点并规划时间轴结算', async () => {
    const sameNode = await statusOf(
      project({
        plan: {
          ...combatPlan,
          actions: [{ ...combatPlan.actions![0]!, targetNodeId: 'clash' }],
        },
      }),
      'blueprint.outline',
      'outline.interaction-plan',
    )
    expect(sameNode.codes).toContain('outline.interaction.effect-payoff-self-target')

    const missingResolution = project({ plan: combatPlan })
    missingResolution.graph.nodes.find((node) => node.id === 'win')!.data.interaction!.settlements = []
    const result = await statusOf(missingResolution, 'blueprint.outline', 'outline.interaction-plan')
    expect(result.codes).toContain('outline.interaction.effect-settlement-missing')
  })

  it('互动边必须声明支柱 trace、producer 和下游视频 payoff', async () => {
    const doc = project({
      plan: {
        beat: 'choice',
        sourcePillarBeatId: 'B01',
        playerInformation: ['玩家看见两种态度的风险'],
        actions: [{
          component: 'TextOption', event: 'activate', intent: '选择迎战',
          feedback: '选项锁定', downstreamPayoff: '下游播放迎战镜头',
          exit: 'activate', targetNodeId: 'win',
        }],
      },
    })
    const edge = doc.graph.edges[0]! as unknown as { sourceHandle?: string; data: Record<string, unknown> }
    edge.sourceHandle = 'activate'
    edge.data = {
      design: {
        pillarBeatId: 'B01',
        producer: { kind: 'component-event', ref: 'TextOption.activate' },
        narrativePayoff: '下游播放迎战镜头',
        outcomeEvidenceId: 'B01/light',
      },
    }
    ;(doc.graph.nodes.find((node) => node.id === 'win')!.data as Record<string, unknown>).outcomeEvidence = [{
      id: 'B01/light',
      sourceEdgeId: 'e-default',
      presentation: '下游播放迎战镜头',
    }]

    expect(await statusOf(doc, 'blueprint.outline', 'outline.causal-chain'))
      .toMatchObject({ status: 'pass' })
    delete (doc.graph.nodes.find((node) => node.id === 'win')!.data as Record<string, unknown>).outcomeEvidence
    const missingEvidence = await statusOf(doc, 'blueprint.outline', 'outline.causal-chain')
    expect(missingEvidence.codes).toContain('outline.edge.outcome-evidence-missing')
    ;(doc.graph.nodes.find((node) => node.id === 'win')!.data as Record<string, unknown>).outcomeEvidence = [{
      id: 'B01/light', sourceEdgeId: 'e-default', presentation: '下游播放迎战镜头',
    }]
    delete edge.data.design
    const missing = await statusOf(doc, 'blueprint.outline', 'outline.causal-chain')
    expect(missing.codes).toContain('outline.edge.design-trace-missing')
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

  // 这条堵的是静默降级：结构、事件、逐字漂移全对，但控件根本不提供支柱要的能力。
  it('v3 支柱声明的承载角色必须被实际绑定的元件满足', async () => {
    const matched = await statusOf(
      project({ plan: combatPlan }),
      'blueprint.outline',
      'outline.interaction-plan',
      undefined,
      pillarV3('"requiredRole":"combat-command"'),
    )
    expect(matched.status, matched.codes.join(',')).toBe('pass')

    const mismatched = await statusOf(
      project({ plan: combatPlan }),
      'blueprint.outline',
      'outline.interaction-plan',
      undefined,
      pillarV3('"requiredRole":"timed-input"'),
    )
    expect(mismatched.status).toBe('fail')
    expect(mismatched.codes).toContain('outline.interaction.role-mismatch')
  })

  it('支柱未解决的能力缺口不能被总脉络悄悄编译掉', async () => {
    const { status, codes } = await statusOf(
      project({ plan: combatPlan }),
      'blueprint.outline',
      'outline.interaction-plan',
      undefined,
      pillarV3('"capabilityGap":{"need":"拖动排序输入","why":"目录里没有任何拖拽类控件"}'),
    )

    expect(status).toBe('fail')
    expect(codes).toContain('outline.interaction.capability-gap-unresolved')
  })

  it('v1/v2 支柱不触发 v3 的承载校验', async () => {
    const { codes } = await statusOf(
      project({ plan: combatPlan }),
      'blueprint.outline',
      'outline.interaction-plan',
    )

    expect(codes).not.toContain('outline.interaction.role-mismatch')
    expect(codes).not.toContain('outline.interaction.capability-gap-unresolved')
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

  it('界面事件直接修改数值会在 ui.authoring 完成门被拦住', async () => {
    const doc = project({
      plan: combatPlan,
      formulas: { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } },
      wired: true,
    })
    const source = doc.graph.nodes.find((node) => node.id === 'clash')!
    const sourceData = source.data as GameNode['data']
    sourceData.overlayNodes![0]!.reactions![0]!.do.unshift({
      kind: 'effect',
      effects: [{
        kind: 'attr', entityId: 'tiger', attr: 'hp', op: 'add', value: { expr: '-formula.dmg_light' },
      }],
    })

    const { status, codes } = await statusOf(doc, 'ui.authoring', 'ui.event-routing-only')

    expect(status).toBe('fail')
    expect(codes).toContain('finalization.plan.effect-owned-by-event')
  })

  it('目标结果节点缺少动作结算会在 rules.binding 完成门被拦住', async () => {
    const doc = project({
      plan: combatPlan,
      formulas: { dmg_light: { id: 'dmg_light', ast: { t: 'num', id: 'n0', v: 3 } } },
      wired: true,
    })
    const resultData = doc.graph.nodes.find((node) => node.id === 'win')!.data as GameNode['data']
    resultData.reactions = []

    const { status, codes } = await statusOf(doc, 'rules.binding', 'rules.settlement-ownership')

    expect(status).toBe('fail')
    expect(codes).toContain('finalization.plan.effect-unwired')
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
