import { describe, expect, test } from 'vitest'
import type { GameNode, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { calculateBlueprintQualityMetrics, inspectCompiledPlayability } from './project-inspection'

function document(
  nodes: GraphLibraryDocument['graph']['nodes'],
  edges: GraphLibraryDocument['graph']['edges'],
  ui?: GraphLibraryDocument['ui'],
): GraphLibraryDocument {
  const graph = { nodes, edges }
  return {
    version: 'game-video.graph.v1',
    graph,
    manifest: {
      version: 'game-video.blueprint-manifest.v1',
      mainPackId: 'main',
      packs: { main: { id: 'main', title: '主蓝图', entry: nodes[0]!.id, graph } },
    },
    variables: {}, entities: {}, formulas: {}, ...(ui ? { ui } : {}),
  }
}

const node = (
  id: string,
  interaction: NonNullable<GameNode['data']['interaction']>,
  outcomeEvidence?: GameNode['data']['outcomeEvidence'],
): GameNode => ({
  id,
  type: 'perf',
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id, interaction, ...(outcomeEvidence ? { outcomeEvidence } : {}) },
})

describe('覆盖率失败必须指名道姓', () => {
  // 一个光秃秃的百分比没法照着改：策划看到「战斗循环闭合率 0%」既不知道是哪个
  // 节点，也不知道缺的是回边还是退出条件。把它当支柱门就等于让人盲猜。
  test('战斗循环未闭合时点名具体节点', () => {
    const project = document([
      node('round', {
        beat: 'combat', sourcePillarBeatId: 'B02', playerInformation: ['双方生命'],
        actions: [{
          sourcePillarActionId: 'light', component: 'BattleSkill', event: 'light', intent: '轻击',
          feedback: '血条下降', downstreamPayoff: '播放敌方受击',
          effect: { target: 'entity.enemy.attr.hp', op: 'sub', value: 3 },
          exit: 'light', targetNodeId: 'after',
        }],
      }),
      node('after', { beat: 'narrative' }),
    ], [
      { id: 'e', source: 'round', sourceHandle: 'light', target: 'after', targetHandle: 'in', data: {} },
    ])

    const issues = inspectCompiledPlayability(project, undefined, { includeQualityStamps: true })
    const closure = issues.find((item) => item.code === 'quality.combat-loop-closure')
    expect(closure?.message).toContain('round')
  })

  // 质量检查必须在支柱门就生效：那是唯一改得动的地方。放到审查阶段才查，
  // 等于把一份改不动的缺口留到蓝图已经冻结之后。
  test('支柱门默认就跑质量检查，不需要额外开关', () => {
    const project = document([
      node('round', {
        beat: 'combat', sourcePillarBeatId: 'B02', playerInformation: ['双方生命'],
        actions: [{
          sourcePillarActionId: 'light', component: 'BattleSkill', event: 'light', intent: '轻击',
          feedback: '血条下降', downstreamPayoff: '播放敌方受击',
          effect: { target: 'entity.enemy.attr.hp', op: 'sub', value: 3 },
          exit: 'light', targetNodeId: 'after',
        }],
      }),
      node('after', { beat: 'narrative' }),
    ], [
      { id: 'e', source: 'round', sourceHandle: 'light', target: 'after', targetHandle: 'in', data: {} },
    ])

    const codes = inspectCompiledPlayability(project).map((item) => item.code)
    expect(codes).toContain('quality.combat-loop-closure')
  })
})

describe('代表性互动模式语义回放指标', () => {
  test('选择分支的 producer、支柱 trace、下游 payoff 和差异化后果全覆盖', () => {
    const project = document([
      node('choice', {
        beat: 'choice', sourcePillarBeatId: 'B01', playerInformation: ['两项风险'],
        actions: [
          { sourcePillarActionId: 'answer', component: 'InkYingMo', event: 'ying', intent: '回应', feedback: '锁定回应', downstreamPayoff: '人物接受回应', exit: 'ying', targetNodeId: 'yes' },
          { sourcePillarActionId: 'silence', component: 'InkYingMo', event: 'mo', intent: '沉默', feedback: '锁定沉默', downstreamPayoff: '人物因沉默离开', exit: 'mo', targetNodeId: 'no' },
        ],
      }),
      node('yes', { beat: 'narrative' }, [{ id: 'B01/answer', sourceEdgeId: 'e-yes', presentation: '人物接受回应' }]),
      node('no', { beat: 'narrative' }, [{ id: 'B01/silence', sourceEdgeId: 'e-no', presentation: '人物因沉默离开' }]),
    ], [
      { id: 'e-yes', source: 'choice', sourceHandle: 'ying', target: 'yes', targetHandle: 'in', data: { design: { pillarBeatId: 'B01', producer: { kind: 'component-event', ref: 'InkYingMo.ying' }, narrativePayoff: '人物接受回应', outcomeEvidenceId: 'B01/answer' } } },
      { id: 'e-no', source: 'choice', sourceHandle: 'mo', target: 'no', targetHandle: 'in', data: { design: { pillarBeatId: 'B01', producer: { kind: 'component-event', ref: 'InkYingMo.mo' }, narrativePayoff: '人物因沉默离开', outcomeEvidenceId: 'B01/silence' } } },
    ])

    expect(calculateBlueprintQualityMetrics(project)).toMatchObject({
      edgeProducerCoverageRate: 1,
      pillarTraceCoverageRate: 1,
      downstreamPayoffCoverageRate: 1,
      decisionConsequenceRate: 1,
    })
  })

  test('战斗回合只有同时具备信息、进展、反馈和退出才算闭合', () => {
    const project = document([
      node('round', {
        beat: 'combat', sourcePillarBeatId: 'B02', playerInformation: ['敌方意图', '双方生命'],
        actions: [{
          sourcePillarActionId: 'light', component: 'BattleSkill', event: 'light', intent: '轻击', feedback: '血条下降',
          downstreamPayoff: '播放敌方受击', effect: { target: 'entity.enemy.attr.hp', op: 'sub', value: 3 },
          exit: 'light', targetNodeId: 'result',
        }],
        loop: { backTo: 'round' },
        terminals: [{ when: 'entity.enemy.attr.hp <= 0' }],
      }),
      node('result', { beat: 'narrative' }, [{ id: 'B02/light', sourceEdgeId: 'e-result', presentation: '播放敌方受击' }]),
    ], [{
      id: 'e-result', source: 'round', sourceHandle: 'light', target: 'result',
      targetHandle: 'in',
      data: { design: { pillarBeatId: 'B02', producer: { kind: 'component-event', ref: 'BattleSkill.light' }, narrativePayoff: '播放敌方受击', outcomeEvidenceId: 'B02/light' } },
    }])

    expect(calculateBlueprintQualityMetrics(project).combatLoopClosureRate).toBe(1)
  })

  /**
   * 飘字与状态提示只能由 reaction.spawn 产生，永远不会出现在 `overlayNodes` 里。
   * 只认静态挂载的话，「结算已经把数值弹给玩家看」会被算成没有可见反馈，而这个
   * 缺口策划改支柱也补不上——支柱里反馈写得清清楚楚。
   */
  test('结算 spawn 的状态提示算作该状态的可见反馈', () => {
    const choice = node('choice', {
      beat: 'choice', sourcePillarBeatId: 'B01', playerInformation: ['鲁肃的态度'],
      actions: [{
        sourcePillarActionId: 'ying', component: 'InkYingMo', event: 'ying', intent: '坦陈',
        feedback: '信任提示', feedbackSpec: { kind: 'transient-component', component: 'StatusNotice' },
        downstreamPayoff: '鲁肃允诺借船', effect: { target: 'var.trust', op: 'add', value: 2 },
        exit: 'ying', targetNodeId: 'result',
      }],
    })
    const result = node('result', { beat: 'narrative', sourcePillarBeatId: 'B01' })
    result.data.reactions = [{
      when: { type: 'at', ms: 900 },
      do: [
        { kind: 'effect', effects: [{ kind: 'var', varId: 'trust', op: 'add', value: 2 }] },
        { kind: 'spawn', from: 'base:StatusNotice/StatusNotice-0', inputs: { parameter: { ref: 'var.trust' } } },
      ],
    }]
    const project = document([choice, result, node('ending', { beat: 'narrative' })], [
      { id: 'e-result', source: 'choice', sourceHandle: 'ying', target: 'result', targetHandle: 'in' },
      {
        id: 'e-ending',
        source: 'result',
        sourceHandle: 'default',
        target: 'ending',
        targetHandle: 'in',
        // Pillar authoring uses `field`, which must remain a valid state
        // consumer even when this condition has not been normalized yet.
        data: {
          condition: { all: [{ field: 'var.trust', op: 'gte', value: 6 }] },
        } as unknown as NonNullable<GraphLibraryDocument['graph']['edges']>[number]['data'],
      },
    ], {
      overlays: {
        'base:StatusNotice': { id: 'base:StatusNotice', children: [{ id: 'StatusNotice-0', component: 'StatusNotice' }] },
      },
    })
    project.variables = { trust: { id: 'trust', initial: 5, min: 0, max: 10 } }

    expect(calculateBlueprintQualityMetrics(project).stateLifecycleCoverageRate).toBe(1)
  })

  /**
   * 一个只有「继续」的过场不是决策：它永远只有一种后果，差异化在结构上就不可能
   * 成立。把它算进分母会让一份正常的短篇永远停在半数覆盖率，而策划无从下手——
   * 唯一的「修法」是删掉所有过场。
   */
  test('只有一个动作的过场不计入差异化选择后果', () => {
    const project = document([
      node('choice', {
        beat: 'choice', sourcePillarBeatId: 'B01', playerInformation: ['两条航路'],
        actions: [
          {
            sourcePillarActionId: 'ying', component: 'InkYingMo', event: 'ying', intent: '北岸',
            feedback: '收起界面', downstreamPayoff: '更快抵达', exit: 'ying', targetNodeId: 'pass',
          },
          {
            sourcePillarActionId: 'mo', component: 'InkYingMo', event: 'mo', intent: '南岸',
            feedback: '收起界面', downstreamPayoff: '更稳妥', exit: 'mo', targetNodeId: 'next',
          },
        ],
      }),
      node('pass', {
        beat: 'choice', sourcePillarBeatId: 'B02', playerInformation: ['继续'],
        actions: [{
          sourcePillarActionId: 'continue', component: 'TextOption', event: 'activate', intent: '继续',
          feedback: '收起界面', downstreamPayoff: '进入下一拍', exit: 'activate', targetNodeId: 'next',
        }],
      }),
      node('next', { beat: 'narrative' }),
    ], [
      { id: 'e-ying', source: 'choice', sourceHandle: 'ying', target: 'pass', targetHandle: 'in' },
      { id: 'e-mo', source: 'choice', sourceHandle: 'mo', target: 'next', targetHandle: 'in' },
      { id: 'e-next', source: 'pass', sourceHandle: 'activate', target: 'next', targetHandle: 'in' },
    ])

    expect(calculateBlueprintQualityMetrics(project).decisionConsequenceRate).toBe(1)
  })

  test('全是单动作过场的蓝图不会被要求差异化选择后果', () => {
    const project = document([
      node('pass', {
        beat: 'choice', sourcePillarBeatId: 'B01', playerInformation: ['继续'],
        actions: [{
          sourcePillarActionId: 'continue', component: 'TextOption', event: 'activate', intent: '继续',
          feedback: '收起界面', downstreamPayoff: '进入下一拍', exit: 'activate', targetNodeId: 'next',
        }],
      }),
      node('next', { beat: 'narrative' }),
    ], [
      { id: 'e-next', source: 'pass', sourceHandle: 'activate', target: 'next', targetHandle: 'in' },
    ])

    const codes = inspectCompiledPlayability(project, undefined, { includeQualityStamps: true })
      .map((item) => item.code)
    expect(codes).not.toContain('quality.decision-consequence')
  })

  test('界面事件只路由，结果节点结算数值并由血条提供可见反馈', () => {
    const hit = node('hit', {
      beat: 'combat', sourcePillarBeatId: 'B03', playerInformation: ['敌方生命'],
      actions: [{
        sourcePillarActionId: 'light', component: 'BattleSkill', event: 'light', intent: '轻击', feedback: '敌方血条下降',
        feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'entity.enemy.attr.hp' },
        downstreamPayoff: '播放受击', effect: { target: 'entity.enemy.attr.hp', op: 'sub', value: 3 },
        exit: 'light', targetNodeId: 'result',
      }],
      loop: { backTo: 'hit' }, terminals: [{ when: 'entity.enemy.attr.hp <= 0' }],
    })
    hit.data.overlayNodes = [{
      id: 'combat-ui', overlay: 'combat-ui', reactions: [{
        when: { type: 'event', id: 'light' },
        do: [{ kind: 'advance', edgeId: 'e-result' }],
      }],
    }]
    const result = node('result', {
      beat: 'narrative', sourcePillarBeatId: 'B03',
      settlements: [{
        id: 'light-result', sourcePillarSettlementId: 'light-result', sourcePillarActionId: 'light',
        pattern: 'timeline-hit-sync', trigger: 'at', triggerSpec: { type: 'at', ms: 1000 },
        intent: '应用轻击伤害', source: '受击视频命中帧', feedback: '敌方血条下降',
        feedbackSpec: { kind: 'state-binding', component: 'BattleEnemyHpBar', target: 'entity.enemy.attr.hp' },
      }],
    }, [{ id: 'B03/light', sourceEdgeId: 'e-result', presentation: '播放受击' }])
    result.data.overlayNodes = [{ id: 'result-ui', overlay: 'result-ui' }]
    result.data.reactions = [
      {
        when: { type: 'at', ms: 1000 },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'enemy', attr: 'hp', op: 'add', value: -3 }] }],
      },
      {
        when: { type: 'state', condition: { all: [{ type: 'attr', entityId: 'enemy', attr: 'hp', op: 'lte', value: 0 }] } },
        do: [],
      },
    ]
    const project = document([hit, result], [{
      id: 'e-result', source: 'hit', sourceHandle: 'light', target: 'result',
      targetHandle: 'in',
      data: { design: { pillarBeatId: 'B03', producer: { kind: 'component-event', ref: 'BattleSkill.light' }, narrativePayoff: '播放受击', outcomeEvidenceId: 'B03/light' } },
    }], {
      overlays: {
        'combat-ui': {
          id: 'combat-ui',
          children: [{ id: 'skill', component: 'BattleSkill' }],
        },
        'result-ui': {
          id: 'result-ui',
          children: [{ id: 'enemy-hp', component: 'BattleEnemyHpBar', inputs: { current: { expr: 'entity.enemy.attr.hp' }, max: 30 } }],
        },
      },
    })
    project.entities = { enemy: { id: 'enemy', attrs: { hp: 30 }, attrMeta: { hp: { max: 30 } } } }

    expect(calculateBlueprintQualityMetrics(project)).toMatchObject({
      settlementEffectCoverageRate: 1,
      eventRoutePurityRate: 1,
      feedbackCoverageRate: 1,
      stateLifecycleCoverageRate: 1,
    })
  })
})
