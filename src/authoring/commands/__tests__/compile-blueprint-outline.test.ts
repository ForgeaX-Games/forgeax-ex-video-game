import { describe, expect, it } from 'vitest'
import { documentFromBlueprints, emptyBlueprintDoc, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import { compileBlueprintOutline } from '../compile-blueprint-outline'

function baseDocument() {
  return documentFromBlueprints({ [MAIN_ID]: emptyBlueprintDoc({ id: MAIN_ID, title: '主蓝图' }) }, MAIN_ID, {
    entities: {},
    variables: {},
  })
}

describe('compileBlueprintOutline', () => {
  it('collects independent chapter, settlement, resolution, and route errors in one pass', () => {
    const result = compileBlueprintOutline(baseDocument(), {
      entry: 'missing-entry',
      chapters: [
        { id: 'bad-beat', name: '错误节拍', pillarBeatId: 'NOPE', beat: 'narrative' },
        {
          id: 'choice', name: '选择', pillarBeatId: 'B01', beat: 'choice',
          actions: [
            { pillarActionId: 'unknown-action', component: 'TextOption', event: 'activate', feedbackSpec: { kind: 'hide-interface' } },
            { pillarActionId: 'hit', component: 'TextOption', event: 'hit', feedbackSpec: { kind: 'hide-interface' } },
          ],
          settlements: [
            { pillarSettlementId: 'unknown-settlement', triggerSpec: { type: 'at', ms: 1 }, feedbackSpec: { kind: 'hide-interface' } },
            { pillarSettlementId: 'hit-resolution', triggerSpec: { type: 'watch', of: 'var.hp', on: 'change' }, feedbackSpec: { kind: 'hide-interface' } },
          ],
          resolvesActions: [{ sourceNodeId: 'missing-source', pillarActionId: 'hit', triggerSpec: { type: 'at', ms: 1 } }],
        },
        { id: 'result', name: '结果', pillarBeatId: 'B01', beat: 'narrative' },
      ],
      routes: [
        { source: 'missing-source', target: 'result', producer: { kind: 'lifecycle', ref: 'missing' }, narrativePayoff: '不可达' },
        { source: 'choice', target: 'result', producer: { kind: 'action', ref: 'unknown-route-action' }, narrativePayoff: '不可达' },
      ],
    }, {
      schemaVersion: 2,
      beats: [{
        id: 'B01', narrativeIntent: '选择', playerInformation: ['信息'], uiCapabilities: ['选择'],
        actions: [{
          id: 'hit', intent: '攻击', stateMutationOwner: 'settlement', stateChange: 'hp-1',
          immediateFeedback: '受击', downstreamPayoff: '进入结果', exitIntent: '进入结果',
        }],
        settlements: [{
          id: 'hit-resolution', sourceActionId: 'hit', trigger: 'at', source: '结果帧', intent: '扣血',
          feedback: '血量下降', exitIntent: '继续',
        }],
      }],
    })

    expect(result).toMatchObject({ ok: false, failedPath: 'chapters[0].pillarBeatId' })
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(6)
    expect(result.errors).toEqual(expect.arrayContaining([
      'chapter bad-beat references unknown pillar beat NOPE; available pillar beats: B01',
      'unknown pillar action unknown-action; beat B01 defines: hit',
      'pillar action hit requires a settlement-owned effect',
      'unknown pillar settlement unknown-settlement; beat B01 defines: hit-resolution',
      'pillar settlement hit-resolution requires at, received watch',
      'resolution source action not found: missing-source/hit',
      'route references missing node: missing-source -> result',
      'action not found: unknown-route-action',
    ]))
  })

  it('rejects full graph fields even when an internal caller bypasses the public schema', () => {
    const result = compileBlueprintOutline(baseDocument(), {
      entry: 'entry',
      chapters: [],
      routes: [],
      nodes: [],
    } as never)

    expect(result).toEqual({
      ok: false,
      errors: ['nodes is not accepted; submit compact chapters/routes intents'],
      failedPath: 'nodes',
    })
  })

  it('materializes compact chapter and route intents into shared graph primitives', () => {
    const input = {
      entry: 'choice',
      chapters: [
        {
          id: 'choice', name: '临阵抉择', pillarBeatId: 'B01', beat: 'choice' as const,
          actions: [
            {
              pillarActionId: 'ying', component: 'InkYingMo', event: 'ying',
              effect: { target: 'var.trust', op: 'add' as const, value: 1 },
              feedbackSpec: { kind: 'state-binding' as const, component: 'StatusNotice', target: 'var.trust' },
            },
            {
              pillarActionId: 'mo', component: 'InkYingMo', event: 'mo',
              effect: { target: 'var.trust', op: 'sub' as const, value: 1 },
              feedbackSpec: { kind: 'state-binding' as const, component: 'StatusNotice', target: 'var.trust' },
            },
          ],
        },
        {
          id: 'ying-result', name: '应答结果', pillarBeatId: 'B01', beat: 'narrative' as const,
          resolvesActions: [{ sourceNodeId: 'choice', pillarActionId: 'ying', triggerSpec: { type: 'at' as const, ms: 1200 } }],
        },
        {
          id: 'mo-result', name: '沉默结果', pillarBeatId: 'B01', beat: 'narrative' as const, lane: 1,
          resolvesActions: [{ sourceNodeId: 'choice', pillarActionId: 'mo', triggerSpec: { type: 'at' as const, ms: 1200 } }],
        },
      ],
      routes: [
        { source: 'choice', target: 'ying-result', producer: { kind: 'action' as const, ref: 'ying' } },
        { source: 'choice', target: 'mo-result', producer: { kind: 'action' as const, ref: 'mo' } },
      ],
    }
    const pillar = {
      schemaVersion: 2 as const,
      beats: [{
        id: 'B01', narrativeIntent: '决定如何回应', playerInformation: ['对方态度'], uiCapabilities: ['应默选择'],
        actions: [
          {
            id: 'ying', intent: '正面回应', stateMutationOwner: 'settlement' as const, stateChange: '信任+1',
            immediateFeedback: '信任上升', downstreamPayoff: '对方接受回应', exitIntent: '进入应答结果',
          },
          {
            id: 'mo', intent: '保持沉默', stateMutationOwner: 'settlement' as const, stateChange: '信任-1',
            immediateFeedback: '信任下降', downstreamPayoff: '对方因沉默离开', exitIntent: '进入沉默结果',
          },
        ],
        settlements: [
          { id: 'ying-resolution', sourceActionId: 'ying', trigger: 'at' as const, source: '应答命中帧', intent: '应用信任+1', feedback: '信任上升', exitIntent: '继续' },
          { id: 'mo-resolution', sourceActionId: 'mo', trigger: 'at' as const, source: '沉默结果帧', intent: '应用信任-1', feedback: '信任下降', exitIntent: '继续' },
        ],
      }],
    }

    expect(JSON.stringify(input).length).toBeLessThan(4_000)
    const result = compileBlueprintOutline(baseDocument(), input, pillar)

    expect(result).toMatchObject({ ok: true, nodeCount: 3, edgeCount: 2, commandCount: 5 })
    if (!result.ok) return
    const choice = result.document.graph.nodes.find((node) => node.id === 'choice')!
    const yingResult = result.document.graph.nodes.find((node) => node.id === 'ying-result')!
    expect(choice.data.interaction?.actions?.[0]).toMatchObject({
      sourcePillarActionId: 'ying', exit: 'ying', targetNodeId: 'ying-result', intent: '正面回应',
    })
    expect(yingResult.data.interaction?.settlements?.[0]).toMatchObject({
      sourcePillarSettlementId: 'ying-resolution', sourcePillarActionId: 'ying', triggerSpec: { type: 'at', ms: 1200 },
    })
    expect(yingResult.data.outcomeEvidence?.[0]).toMatchObject({
      sourceEdgeId: 'edge-choice-ying-ying-result', presentation: '对方接受回应',
    })
    expect(result.document.graph.edges[0]?.data?.design?.producer).toEqual({
      kind: 'component-event', ref: 'InkYingMo.ying',
    })
  })

  it('repairs a cross-beat action result onto a same-beat result node instead of failing', () => {
    const result = compileBlueprintOutline(baseDocument(), {
      entry: 'n01',
      chapters: [
        {
          id: 'n01', name: '开场抉择', pillarBeatId: 'B01', beat: 'choice',
          actions: [{
            pillarActionId: 'cooperate', component: 'InkYingMo', event: 'ying',
            effect: { target: 'var.trust', op: 'add', value: 1 },
            feedbackSpec: { kind: 'state-binding', component: 'StatusNotice', target: 'var.trust' },
          }],
        },
        {
          id: 'n02', name: '下一幕', pillarBeatId: 'B02', beat: 'narrative',
          resolvesActions: [{ sourceNodeId: 'n01', pillarActionId: 'cooperate', triggerSpec: { type: 'at', ms: 1200 } }],
        },
      ],
      routes: [
        { source: 'n01', target: 'n02', producer: { kind: 'action', ref: 'cooperate' } },
      ],
    }, {
      schemaVersion: 2,
      beats: [
        {
          id: 'B01', narrativeIntent: '决定是否配合', playerInformation: ['对方态度'], uiCapabilities: ['应默选择'],
          actions: [{
            id: 'cooperate', intent: '配合', stateMutationOwner: 'settlement', stateChange: '信任+1',
            immediateFeedback: '信任上升', downstreamPayoff: '鲁肃后续更愿配合', exitIntent: '进入配合结果',
          }],
          settlements: [{
            id: 'cooperate-resolution', sourceActionId: 'cooperate', trigger: 'at', source: '配合命中帧',
            intent: '应用信任+1', feedback: '信任上升', exitIntent: '继续下一幕',
          }],
        },
        {
          id: 'B02', narrativeIntent: '下一幕', playerInformation: ['局势'], uiCapabilities: [],
          actions: [], settlements: [],
        },
      ],
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const action = result.document.graph.nodes.find((node) => node.id === 'n01')?.data.interaction?.actions?.[0]
    const resultNode = result.document.graph.nodes.find((node) => node.id === action?.targetNodeId)
    expect(resultNode?.data.interaction?.sourcePillarBeatId).toBe('B01')
    expect(resultNode?.data.interaction?.settlements?.[0]).toMatchObject({
      sourcePillarSettlementId: 'cooperate-resolution',
      sourcePillarActionId: 'cooperate',
    })
    expect(result.document.graph.edges.some((edge) => (
      edge.source === resultNode?.id && edge.target === 'n02'
    ))).toBe(true)
  })

  it('preserves a template entry seed for routes into the compiled outline', () => {
    const document = documentFromBlueprints({
      [MAIN_ID]: {
        ...emptyBlueprintDoc({ id: MAIN_ID, title: '主蓝图' }),
        graph: {
          nodes: [{ id: 'entry', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '起点' } }],
          edges: [],
        },
      },
    }, MAIN_ID, { entities: {}, variables: {} })
    const result = compileBlueprintOutline(document, {
      entry: 'choice',
      chapters: [{ id: 'choice', name: '第一幕', pillarBeatId: 'B01', beat: 'narrative' }],
      routes: [{ source: 'entry', target: 'choice', producer: { kind: 'lifecycle', ref: 'start' }, narrativePayoff: '进入第一幕' }],
    }, {
      schemaVersion: 2,
      beats: [{ id: 'B01', narrativeIntent: '第一幕', playerInformation: ['信息'], uiCapabilities: [], actions: [], settlements: [] }],
    })

    expect(result).toMatchObject({ ok: true, nodeCount: 2, edgeCount: 1 })
    if (!result.ok) return
    expect(result.document.manifest.packs[MAIN_ID]!.graph.nodes.map((node) => node.id)).toEqual(['entry', 'choice'])
  })

  it.each([
    ['action', { kind: 'action' as const, ref: 'choose' }, 'wrong', 'component-event route handle'],
    ['settlement', { kind: 'settlement' as const, ref: 'timeout' }, 'default', 'settlement route handle'],
    ['lifecycle', { kind: 'lifecycle' as const, ref: 'complete' }, 'complete', 'lifecycle route handle'],
  ])('rejects a %s producer whose explicit handle violates the downstream contract', (
    _label,
    producer,
    sourceHandle,
    expected,
  ) => {
    const result = compileBlueprintOutline(baseDocument(), {
      entry: 'choice',
      chapters: [
        {
          id: 'choice', name: '抉择', pillarBeatId: 'B01', beat: 'choice',
          actions: [{
            pillarActionId: 'choose', component: 'InkYingMo', event: 'ying',
            feedbackSpec: { kind: 'hide-interface' },
          }],
          settlements: [{
            pillarSettlementId: 'timeout', triggerSpec: { type: 'at', ms: 2_000 },
            feedbackSpec: { kind: 'hide-interface' },
          }],
        },
        { id: 'result', name: '结果', pillarBeatId: 'B02', beat: 'narrative' },
      ],
      routes: [{
        source: 'choice', target: 'result', producer, sourceHandle, narrativePayoff: '进入结果',
      }],
    }, {
      schemaVersion: 2,
      beats: [
        {
          id: 'B01', narrativeIntent: '做出抉择', playerInformation: ['倒计时'], uiCapabilities: ['选择'],
          actions: [{
            id: 'choose', intent: '选择', stateMutationOwner: 'none', stateChange: '无',
            immediateFeedback: '隐藏选择', downstreamPayoff: '进入结果', exitIntent: '进入结果',
          }],
          settlements: [{
            id: 'timeout', trigger: 'at', source: '倒计时结束', intent: '超时',
            feedback: '隐藏选择', exitIntent: '进入结果',
          }],
        },
        { id: 'B02', narrativeIntent: '结果', playerInformation: ['结果'], uiCapabilities: [], actions: [], settlements: [] },
      ],
    })

    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining(expected)]))
  })

})
