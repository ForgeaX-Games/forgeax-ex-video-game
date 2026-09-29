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
      narrativeIntent: '玩家决定进攻或撤退',
      playerInformation: ['敌人逼近'],
      uiCapabilities: ['二元选择'],
      actions: [
        {
          id: 'advance', intent: '进攻', stateMutationOwner: 'none', requiredRole: 'player-choice',
          stateChange: '无持久变化', immediateFeedback: '锁定进攻', downstreamPayoff: '进入进攻结果', exitIntent: '进入胜利节点',
        },
        {
          id: 'retreat', intent: '撤退', stateMutationOwner: 'none', requiredRole: 'player-choice',
          stateChange: '无持久变化', immediateFeedback: '锁定撤退', downstreamPayoff: '进入撤退结果', exitIntent: '进入撤退节点',
        },
      ],
      settlements: [],
    },
    {
      id: 'B02', narrativeIntent: '进攻结果', playerInformation: ['战斗结束'],
      uiCapabilities: [], actions: [], settlements: [],
    },
    {
      id: 'B03', narrativeIntent: '撤退结果', playerInformation: ['队伍脱离'],
      uiCapabilities: [], actions: [], settlements: [],
    },
  ],
}

describe('progressive blueprint outline', () => {
  it('rejects a skeleton when a pillar action has no interactive node to carry it', () => {
    const result = createBlueprintOutlineSkeleton(baseDocument(), {
      entry: 'result',
      chapters: [{ id: 'result', name: '结果', pillarBeatId: 'B01', beat: 'narrative' }],
    }, pillar)

    expect(result).toMatchObject({
      ok: false,
      failedPath: 'chapters',
      // 报错要指向真正的成因（这一拍不可达），而不是让策划去改一个没错的章节类型。
      errors: [expect.stringContaining('节拍 B01 写了 2 个动作')],
    })
  })

  it('creates every visible node before configuring one node at a time', () => {
    const skeleton = createBlueprintOutlineSkeleton(baseDocument(), {
      entry: 'choice',
      chapters: [
        { id: 'choice', name: '临阵抉择', pillarBeatId: 'B01', beat: 'choice' },
        { id: 'advance-result', name: '进攻结果', pillarBeatId: 'B02', beat: 'narrative' },
        { id: 'retreat-result', name: '撤退结果', pillarBeatId: 'B03', beat: 'narrative' },
      ],
    }, pillar)

    expect(skeleton).toMatchObject({ ok: true, nodeCount: 3, edgeCount: 0, commandCount: 3 })
    if (!skeleton.ok) return
    expect(skeleton.document.graph.nodes.map((node) => node.id)).toEqual([
      'choice', 'advance-result', 'retreat-result',
    ])

    const configured = configureBlueprintOutlineNode(skeleton.document, {
      nodeId: 'choice',
      actions: [
        { pillarActionId: 'advance', component: 'InkYingMo', event: 'ying', feedbackSpec: { kind: 'hide-interface' } },
        { pillarActionId: 'retreat', component: 'InkYingMo', event: 'mo', feedbackSpec: { kind: 'hide-interface' } },
      ],
      settlements: [],
      outgoingRoutes: [
        { target: 'advance-result', producer: { kind: 'action', ref: 'advance' } },
        { target: 'retreat-result', producer: { kind: 'action', ref: 'retreat' } },
      ],
    }, pillar)

    expect(configured).toMatchObject({ ok: true, nodeId: 'choice', nodeCount: 3, edgeCount: 2 })
    if (!configured.ok) return
    expect(configured.document.graph.edges.map((edge) => edge.id)).toEqual([
      'edge-choice-ying-advance-result',
      'edge-choice-mo-retreat-result',
    ])
    expect(configured.document.graph.nodes.find((node) => node.id === 'choice')?.data.interaction?.actions)
      .toHaveLength(2)
  })

  it('allows outline to correct a node beat type without rebuilding the skeleton', () => {
    const skeleton = createBlueprintOutlineSkeleton(baseDocument(), {
      entry: 'choice',
      chapters: [{ id: 'choice', name: '临阵抉择', pillarBeatId: 'B01', beat: 'choice' }],
    }, pillar)
    if (!skeleton.ok) throw new Error('fixture skeleton failed')

    const corrected = configureBlueprintOutlineNode(skeleton.document, {
      nodeId: 'choice',
      beat: 'timed',
      actions: [{
        pillarActionId: 'advance',
        component: 'InkYingMo',
        event: 'ying',
        feedbackSpec: { kind: 'hide-interface' },
      }],
      settlements: [],
      outgoingRoutes: [],
    }, pillar)

    expect(corrected).toMatchObject({ ok: true, nodeId: 'choice' })
    if (!corrected.ok) return
    expect(corrected.document.graph.nodes.find((node) => node.id === 'choice')?.data.interaction?.beat)
      .toBe('timed')
  })

  it('rejects only the invalid node transaction and leaves the input graph unchanged', () => {
    const skeleton = createBlueprintOutlineSkeleton(baseDocument(), {
      entry: 'choice',
      chapters: [
        { id: 'choice', name: '临阵抉择', pillarBeatId: 'B01', beat: 'choice' },
        { id: 'advance-result', name: '进攻结果', pillarBeatId: 'B02', beat: 'narrative' },
      ],
    }, pillar)
    if (!skeleton.ok) throw new Error('fixture skeleton failed')
    const before = JSON.stringify(skeleton.document)

    const invalid = configureBlueprintOutlineNode(skeleton.document, {
      nodeId: 'choice',
      actions: [{
        pillarActionId: 'invented', component: 'InkYingMo', event: 'ying', feedbackSpec: { kind: 'hide-interface' },
      }],
      settlements: [],
      outgoingRoutes: [],
    }, pillar)

    expect(invalid).toMatchObject({ ok: false, failedPath: 'chapters[0].actions[0].pillarActionId' })
    expect(JSON.stringify(skeleton.document)).toBe(before)
  })
})
