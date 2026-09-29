import { describe, expect, it } from 'vitest'
import { documentFromBlueprints, emptyBlueprintDoc, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import type { PillarInteractionContract } from '@/authoring/documents/pillar-interaction-contract'
import {
  configureBlueprintOutlineNode,
  createBlueprintOutlineSkeleton,
} from '../progressive-blueprint-outline'

function baseDocument() {
  return documentFromBlueprints({
    [MAIN_ID]: emptyBlueprintDoc({ id: MAIN_ID, title: '主蓝图' }),
  }, MAIN_ID, { entities: {}, variables: {} })
}

const pillar: PillarInteractionContract = {
  schemaVersion: 3,
  beats: [
    {
      id: 'B01',
      narrativeIntent: '议事厅上玩家表态',
      playerInformation: ['孙权在观察'],
      uiCapabilities: ['二元选择'],
      actions: [{
        id: 'hear',
        intent: '恳切陈词',
        stateMutationOwner: 'settlement',
        requiredRole: 'player-choice',
        stateChange: '信任 +15',
        immediateFeedback: '锁定选项',
        downstreamPayoff: '孙权动容',
        exitIntent: '进入应答结果',
      }],
      settlements: [{
        id: 'b01-hear-result',
        sourceActionId: 'hear',
        trigger: 'at',
        source: '恳切陈词',
        intent: '结算信任增益',
        feedback: '信任飘字 +15',
        exitIntent: '进入下一节拍',
      }],
    },
    {
      id: 'B02',
      narrativeIntent: '孙权回应',
      playerInformation: ['帐内议论'],
      uiCapabilities: [],
      actions: [],
      settlements: [],
    },
  ],
}

/**
 * 建一份合规骨架并配好 B01 源节点：`n01-hear-result` 是 B01 的结果节点，
 * `n03-next` 是剧情推进到的下一节拍，用来复现「把结算挂到下一章」这种写法。
 */
function graphWithConfiguredSource() {
  const created = createBlueprintOutlineSkeleton(baseDocument(), {
    entry: 'n01',
    chapters: [
      { id: 'n01', name: '议事厅', pillarBeatId: 'B01', beat: 'choice' },
      { id: 'n01-hear-result', name: '应答结果', pillarBeatId: 'B01', beat: 'narrative' },
      { id: 'n03-next', name: '孙权回应', pillarBeatId: 'B02', beat: 'narrative' },
    ],
  }, pillar)
  if (!created.ok) throw new Error(`skeleton failed: ${created.errors.join(' / ')}`)

  const source = configureBlueprintOutlineNode(created.document, {
    nodeId: 'n01',
    actions: [{
      pillarActionId: 'hear',
      component: 'InkYingMo',
      event: 'ying',
      effect: { target: 'entity.sunquan.attr.trust', op: 'add', value: 15 },
      feedbackSpec: { kind: 'hide-interface' },
    }],
    settlements: [],
    outgoingRoutes: [{ target: 'n01-hear-result', producer: { kind: 'action', ref: 'hear' } }],
  }, pillar)
  if (!source.ok) throw new Error(`source configure failed: ${source.errors.join(' / ')}`)
  return source.document
}

describe('结果节点必须与它结算的动作同节拍', () => {
  it('骨架期就拦下缺同节拍结果章节的方案', () => {
    const created = createBlueprintOutlineSkeleton(baseDocument(), {
      entry: 'n01',
      chapters: [
        { id: 'n01', name: '议事厅', pillarBeatId: 'B01', beat: 'choice' },
        { id: 'n02-ying', name: '应答结果', pillarBeatId: 'B02', beat: 'narrative' },
      ],
    }, pillar)

    expect(created).toMatchObject({ ok: false, failedPath: 'chapters' })
    if (created.ok) return
    expect(created.errors[0]).toContain('pillar beat B01 settles hear')
    expect(created.errors[0]).toContain('no narrative result chapter bound to B01')
  })

  it('跨节拍 resolvesActions 硬失败并指出该改成哪个 pillarBeatId，而不是静默丢弃结算', () => {
    const result = configureBlueprintOutlineNode(graphWithConfiguredSource(), {
      nodeId: 'n03-next',
      actions: [],
      settlements: [],
      resolvesActions: [{ sourceNodeId: 'n01', pillarActionId: 'hear', triggerSpec: { type: 'at', ms: 1200 } }],
      outgoingRoutes: [],
    }, pillar)

    expect(result).toMatchObject({ ok: false, failedPath: 'resolvesActions' })
    if (result.ok) return
    expect(result.errors[0]).toContain('bound to pillar beat B02')
    expect(result.errors[0]).toContain('pillarBeatId="B01"')
  })

  it('绑错节拍时直填 settlements 会说清该 ID 属于哪个节拍', () => {
    const result = configureBlueprintOutlineNode(graphWithConfiguredSource(), {
      nodeId: 'n03-next',
      actions: [],
      settlements: [{
        pillarSettlementId: 'b01-hear-result',
        triggerSpec: { type: 'at', ms: 1200 },
        feedbackSpec: { kind: 'transient-component', component: 'FloatingText' },
      }],
      outgoingRoutes: [],
    }, pillar)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toContain('belongs to beat B01')
    expect(result.errors[0]).toContain('is bound to beat B02')
  })

  it('用 pillarBeatId 就地改绑即可脱困，无需重建骨架', () => {
    const rebound = configureBlueprintOutlineNode(graphWithConfiguredSource(), {
      nodeId: 'n03-next',
      pillarBeatId: 'B01',
      actions: [],
      settlements: [],
      resolvesActions: [{ sourceNodeId: 'n01', pillarActionId: 'hear', triggerSpec: { type: 'at', ms: 1200 } }],
      outgoingRoutes: [],
    }, pillar)

    expect(rebound.ok).toBe(true)
    if (!rebound.ok) return
    const node = rebound.document.graph.nodes.find((candidate) => candidate.id === 'n03-next')
    expect(node?.data.interaction?.sourcePillarBeatId).toBe('B01')
    expect(node?.data.interaction?.settlements).toMatchObject([{
      sourcePillarSettlementId: 'b01-hear-result',
      sourcePillarActionId: 'hear',
      trigger: 'at',
    }])
    // 改绑保留节点身份与既有边，这正是不必重建骨架的原因。
    expect(rebound.document.graph.nodes.map((candidate) => candidate.id))
      .toEqual(['n01', 'n01-hear-result', 'n03-next'])
    expect(rebound.document.graph.edges.map((edge) => `${edge.source}->${edge.target}`))
      .toEqual(['n01->n01-hear-result'])
  })

  it('同节拍结果节点照常工作', () => {
    const result = configureBlueprintOutlineNode(graphWithConfiguredSource(), {
      nodeId: 'n01-hear-result',
      actions: [],
      settlements: [],
      resolvesActions: [{ sourceNodeId: 'n01', pillarActionId: 'hear', triggerSpec: { type: 'at', ms: 1200 } }],
      outgoingRoutes: [],
    }, pillar)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.graph.nodes
      .find((node) => node.id === 'n01-hear-result')?.data.interaction?.settlements).toHaveLength(1)
  })
})
