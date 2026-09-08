import { beforeAll, describe, expect, it } from 'vitest'
import type { GameNode, GameScenario, NumOrExpr } from '@/runtime/core/schema/graph-schema'
import type { OverlayChild } from '@/runtime/core/schema/node-config-schema'
import type { QteCue } from '../overlayMaterialTypes'
import {
  registerTestComponents,
  TEST_CHOICE,
  TEST_QTE,
} from '../../../runtime/__tests__/test-components'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { nodeOverlayId, patchOverlayChild } from '@/authoring/graph/overlay-edit'
import {
  activePreviewOverlaysFromNode,
  addMaterialGraph,
  addQteCueGraph,
  choiceElement,
  collectMaterialsFromNode,
  collectMountItemsFromNode,
  createDamageHpEffect,
  deleteMaterialGraph,
  findElement,
  findNode,
  listAvailableQteOutcomes,
  listSchemeMountTabs,
  listQteOutcomeViews,
  overlayEffects,
  addOptionBranchGraph,
  choiceSkinPreviewInteractions,
  listOptionBranches,
  mountOverlayGraph,
  patchMaterialGraph,
  patchOverlayMountLayoutGraph,
  patchOverlayGraph,
  patchOverlayPositionGraph,
  patchOverlayZIndexGraph,
  patchSelectedGraph,
  previewSkinChildrenInWindow,
  qteSkinPreviewInteraction,
  clampSettlementSpawnTtlMs,
  removeMountGraph,
  removeOptionBranchGraph,
  setOptionBranchEffectsGraph,
  setOptionBranchSpawnGraph,
  setOptionTargetGraph,
  setQteOutcomeEffectsGraph,
  setQteOutcomeSpawnGraph,
  setQteOutcomeTargetGraph,
  shiftMountWindowGraph,
  resizeMountWindowGraph,
} from '../graphMaterialOps'
import type { MaterialItem } from '../materialTimelineShared'
import { FLOAT_TEXT_TIMELINE_WIDTH_PX } from '../materialTimelineShared'
import { expandNodeOverlays } from '@/runtime/core/schema/expand-overlay'

// `hasCuePointsInput`/`hasOptionEventsInput`（editors）按组件 inputs 结构判定，任何用到
// qteElement/choiceElement 的用例都需要先注册核心组件——放在文件级 beforeAll。
beforeAll(() => {
    registerTestComponents()
})

function qteEl(scenario: GameScenario, nodeId: string): OverlayChild | undefined {
  return scenario.ui?.overlays?.[nodeOverlayId(nodeId)]?.children?.find(
    (child) => child.component === 'qte'
      || child.component === TEST_QTE
      || Array.isArray((child.inputs as { cues?: unknown[] } | undefined)?.cues),
  )
}
function qteItem(cueId: string): MaterialItem {
  return { key: `qte:x:${cueId}`, id: cueId, kind: 'qte', label: '', startMs: 0, endMs: 1000, zIndex: 2 }
}

function seedQte(): { scenario: GameScenario; node: GameNode; cueId: string } {
  const n = node('a', { durationMs: 8000 })
  let scenario = scnOf({ nodes: [n], edges: [] })
  const nodeRef = scenario.graph.nodes[0]!
  const res = addQteCueGraph(scenario, nodeRef, 8000, 1000)
  const created = qteEl(res.scenario, 'a')!
  scenario = patchOverlayChild(res.scenario, 'a', created.id, { component: TEST_QTE })
  const cueId = res.selectKey!.split(':').pop()!
  return { scenario, node: scenario.graph.nodes[0]!, cueId }
}

function addTestOptionGraph(
  scenario: GameScenario,
  nodeRef: GameNode,
  durationMs: number,
  startMs = 0,
): ReturnType<typeof addMaterialGraph> {
  const result = addMaterialGraph(scenario, nodeRef, durationMs, 'option', undefined, startMs)
  const after = findNode(result.scenario.graph, nodeRef.id)!
  const created = choiceElement(result.scenario, after)!
  return {
    ...result,
    scenario: patchOverlayChild(result.scenario, nodeRef.id, created.id, {
      component: TEST_CHOICE,
    }),
  }
}

/**
 * `addQteCueGraph` 新建时固定 inkKou 皮肤（不再吃 styleScheme/皮肤下拉切换）——
 * 测其它皮肤（battleParry / 泛用 qte）时直接就地改写已建元素的顶层 `component`，
 * 绕开创建流程，只测样式锁定/结算这些仍然真实存在的读逻辑。
 */
function seedQteSkin(component: string, extraInputs: Record<string, unknown> = {}): { scenario: GameScenario; node: GameNode; cueId: string } {
  const base = seedQte()
  const el = qteEl(base.scenario, 'a')!
  const overlayId = nodeOverlayId('a')
  const overlay = base.scenario.ui!.overlays![overlayId]!
  const scenario: GameScenario = {
    ...base.scenario,
    ui: {
      ...base.scenario.ui,
      overlays: {
        ...base.scenario.ui!.overlays,
        [overlayId]: {
          ...overlay,
          children: overlay.children.map((c) =>
            c.id === el.id ? { ...c, component, inputs: { ...c.inputs, ...extraInputs } } : c,
          ),
        },
      },
    },
  }
  return { scenario, node: findNode(scenario.graph, 'a')!, cueId: base.cueId }
}

describe.skip('已退役旧同 ID 皮肤契约 · QTE 元素级参数', () => {
  it('完美判定 perfectMs 落到元素级 inputs，不写进 cue（成功=命中显示窗内，无独立半窗）', () => {
    const { scenario, node: n, cueId } = seedQte()
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), { perfectMs: 100 })
    const el = qteEl(next, 'a')!
    expect((el.inputs as { perfectMs?: number }).perfectMs).toBe(100)
    const cue = ((el.inputs as { cues?: QteCue[] }).cues ?? []).find((c) => c.id === cueId)!
    expect((cue as { perfectMs?: number }).perfectMs).toBeUndefined()
  })

  it('cue 级参数（label/appearAt）仍写进对应拍点，不污染元素级', () => {
    const { scenario, node: n, cueId } = seedQte()
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), { label: '叩', appearAt: 1200 })
    const el = qteEl(next, 'a')!
    const cue = ((el.inputs as { cues?: QteCue[] }).cues ?? []).find((c) => c.id === cueId)!
    expect(cue.label).toBe('叩')
    expect(cue.appearAt).toBe(1200)
    expect((el.inputs as { label?: unknown }).label).toBeUndefined()
  })
})

describe('graphMaterialOps · QTE 结算候选（新规格组件事件驱动）', () => {
  beforeAll(() => registerTestComponents())

  it('uses TEST_QTE manifest events for settlement outcomes', () => {
    const { scenario, node: n } = seedQte()
    const views = listQteOutcomeViews(scenario, n)
    expect(views).toHaveLength(1)
    expect(views[0]!.key).toBe('greatSuccess')
    expect(views[0]!.label).toBe('大成功')
    const available = listAvailableQteOutcomes(scenario, n)
    expect(available).toEqual([
      { handle: 'success', label: '成功' },
      { handle: 'fail', label: '失败' },
    ])
  })

  it.skip('旧 battleParry：出口由样式锁定为皮肤 defaults', () => {
    const { scenario, node: n, cueId } = seedQteSkin('test.qte')
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), {
      events: [{ id: 'ok', label: '自定义' }, { id: 'ng', label: '普通' }],
      defaultEvent: 'fail',
    })
    const n2 = findNode(next.graph, 'a')!
    const el = qteEl(next, 'a')!
    // 落盘也被锁回 battleParryDefaults.events
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.id)).toEqual([
      'pass',
      'good',
      'fail',
    ])
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.label)).toEqual([
      '防反',
      '闪避',
      '受击',
    ])
    const available = listAvailableQteOutcomes(next, n2)
    expect(available.map((c) => c.handle)).toEqual(['good', 'fail'])
    const shown = listQteOutcomeViews(next, n2)
    expect(shown.map((v) => v.key)).toEqual(['pass'])
    expect(shown[0]!.label).toBe('防反')
  })

  it.skip('旧 inkKou：出口由样式锁定为 pass/fail', () => {
    const { scenario, node: n, cueId } = seedQte()
    const next = patchSelectedGraph(scenario, n, qteItem(cueId), {
      component: 'test.qte',
      events: [{ id: 'a', label: '自定义' }, { id: 'b', label: '普通' }, { id: 'c', label: '多余' }],
      defaultEvent: 'fail',
    })
    const el = qteEl(next, 'a')!
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.id)).toEqual([
      'pass',
      'fail',
    ])
    expect((el.inputs as { events?: Array<{ id: string; label?: string }> }).events?.map((e) => e.label)).toEqual([
      '完美',
      '失败',
    ])
  })

  it.skip('旧 battleParry 样式出口可配跳转与数值', () => {
    const { scenario: s0, node: n0 } = seedQteSkin('test.qte')
    const s1 = setQteOutcomeTargetGraph(s0, n0, 'pass', 'b')
    const n1 = findNode(s1.graph, 'a')!
    const s2 = setQteOutcomeEffectsGraph(s1, n1, 'good', [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 }])
    const n2 = findNode(s2.graph, 'a')!
    const views = listQteOutcomeViews(s2, n2)
    const pass = views.find((v) => v.key === 'pass')!
    const good = views.find((v) => v.key === 'good')!
    expect(pass.targetId).toBe('b')
    expect(pass.effects).toHaveLength(0)
    expect(good.targetId).toBeUndefined()
    expect(good.effects).toHaveLength(1)
  })

  it.skip('旧 QTE 结算 spawn 契约', () => {
    expect(clampSettlementSpawnTtlMs(99999, 8000)).toBe(8000)
    expect(clampSettlementSpawnTtlMs(0, 8000)).toBe(8000)
    const { scenario: s0, node: n0 } = seedQteSkin('test.qte')
    const withScheme = {
      ...s0,
      ui: {
        ...s0.ui,
        overlays: {
          ...(s0.ui?.overlays ?? {}),
          'scheme-dynamic': {
            id: 'scheme-dynamic',
            children: [{ id: 'float', component: 'floatText', trigger: { when: 'enter' as const }, inputs: { text: '+1' } }],
          },
        },
      },
    }
    const s1 = setQteOutcomeSpawnGraph(withScheme, n0, 'pass', {
      from: 'scheme-dynamic/float',
      ttlMs: 99_000,
      inputs: { text: '爆' },
    })
    const n1 = findNode(s1.graph, 'a')!
    const view1 = listQteOutcomeViews(s1, n1).find((v) => v.key === 'pass')!
    expect(view1.spawn?.from).toBe('scheme-dynamic/float')
    expect(view1.spawn?.ttlMs).toBe(8000)
    expect(view1.spawn?.inputs).toEqual({ text: '爆' })
    const s2 = setQteOutcomeEffectsGraph(s1, n1, 'pass', [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -1 },
    ])
    const n2 = findNode(s2.graph, 'a')!
    const view2 = listQteOutcomeViews(s2, n2).find((v) => v.key === 'pass')!
    expect(view2.effects).toHaveLength(1)
    expect(view2.spawn?.from).toBe('scheme-dynamic/float')
  })
})

describe('graphMaterialOps · QTE fixture', () => {
  it('refixtures a newly-created QTE without catalog rendering', () => {
    const { scenario } = seedQte()
    const el = qteEl(scenario, 'a')
    expect(el).toBeDefined()
    expect(el!.component).toBe(TEST_QTE)
    expect(el!.layout).toMatchObject({ left: 0, top: 0, width: 1, height: 1 })
    expect(((el!.inputs as { cues?: unknown[] }).cues ?? []).length).toBe(1)
  })

  it.skip('旧 inkKou cues 时间轴槽契约', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const nodeRef = scenario.graph.nodes[0]!
    const res = addMaterialGraph(scenario, nodeRef, 8000, 'qte', undefined, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const mats = collectMaterialsFromNode(res.scenario, n1, 8000)
    const el = qteEl(res.scenario, 'a')!
    const item = mats.find((m) => m.key.startsWith(`qte:${el.id}:`))
    expect(item?.kind).toBe('qte')
    expect(item?.componentId).toBe('test.qte')
  })
})

describe.skip('已退役旧同 ID 皮肤契约 · battleParry 时间轴', () => {
  /**
   * 直接构造一个已挂载的 battleParry qte 元素（不再走 addQteCueGraph 的创建路径——
   * 新建固定 inkKou，battleParry 只能是已有元素），带一个 windowMs 时长的 cue。
   */
  function seedTestQte(appearAt: number, windowMs: number): { scenario: GameScenario; node: GameNode; cueId: string } {
    const n = node('a', { durationMs: 8000 })
    const cueId = 'q-parry'
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': {
              id: 'node:a',
              children: [
                {
                  id: 'qte-parry',
                  component: 'test.qte',
                  trigger: { when: 'enter' },
                  inputs: {
                    windowMs,
                    events: [{ id: 'pass' }, { id: 'good' }, { id: 'fail' }],
                    defaultEvent: 'fail',
                    cues: [{ id: cueId, shape: 'tap', appearAt, targetAt: appearAt + Math.round(windowMs / 2), endAt: appearAt + windowMs, zIndex: 2 }],
                  },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'node:a' }] } } : nd,
        ),
      },
    }
    return { scenario: withMount, node: findNode(withMount.graph, 'a')!, cueId }
  }

  it('battleParry 元素已存在时，追加按键点保留皮肤与既有 windowMs（新建按钮固定走 inkKou，不再回到这里选皮肤）', () => {
    const { scenario, node: n } = seedTestQte(1000, 2600)
    const res = addQteCueGraph(scenario, n, 8000, 5000)
    const el = qteEl(res.scenario, 'a')!
    expect(el.component).toBe('test.qte')
    expect((el.inputs as { windowMs?: number }).windowMs).toBe(2600)
    expect((el.inputs as { cues?: QteCue[] }).cues).toHaveLength(2)
  })

  it('拖时间轴边缘：只改 cue 窗（appearAt/endAt 即时长 SSOT），不再另外维护 windowMs 影子字段', () => {
    const { scenario, node: n, cueId } = seedTestQte(1000, 2600)
    const item: MaterialItem = {
      key: `qte:x:${cueId}`,
      id: cueId,
      kind: 'qte',
      label: '',
      startMs: 1000,
      endMs: 3600,
      zIndex: 2,
    }
    const next = patchMaterialGraph(scenario, n, 8000, item, { startMs: 1500, endMs: 3000 })
    const el = qteEl(next, 'a')!
    const cue = ((el.inputs as { cues?: QteCue[] }).cues ?? []).find((c) => c.id === cueId)!
    expect(cue.appearAt).toBe(1500)
    expect(cue.endAt).toBe(3000)
    // 旧的 windowMs 影子字段维持原值（不再被拖拽同步）——运行时已改成直接读 cue.appearAt/endAt，
    // 不会再看这个字段，留着不影响正确性。
    expect((el.inputs as { windowMs?: number }).windowMs).toBe(2600)
  })

  it('qteSkinPreviewInteraction：播放头在 cue 窗外返回 null，窗内返回 snap', () => {
    const { scenario, node: n } = seedTestQte(2000, 2600)
    expect(qteSkinPreviewInteraction(scenario, n, 500)).toBeNull()
    expect(qteSkinPreviewInteraction(scenario, n, 2500)).not.toBeNull()
    expect(qteSkinPreviewInteraction(scenario, n, 5000)).toBeNull()
  })

  it('预览画布层级调整写回 cue.zIndex', () => {
    const { scenario, node: currentNode, cueId } = seedQte()
    const element = qteEl(scenario, currentNode.id)!
    const next = patchOverlayZIndexGraph(
      scenario,
      currentNode,
      { kind: 'qteCue', elementId: element.id, cueId },
      7,
    )
    const cue = ((qteEl(next, currentNode.id)?.inputs?.cues ?? []) as QteCue[])
      .find((item) => item.id === cueId)
    expect(cue?.zIndex).toBe(7)
  })
})

describe('graphMaterialOps · choice 皮肤时间轴预览', () => {
  it('新规格画布可移动并缩放整份 mount', () => {
    const n = node('a', {
      overlayNodes: [{ overlay: 'hud', layout: { left: 0.1, top: 0.2, width: 0.6, height: 0.5 } }],
    })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      { ui: { overlays: { hud: { id: 'hud', children: [{ id: 'x', component: 'test.dialogue', inputs: {} }] } } } },
    )
    const next = patchOverlayMountLayoutGraph(scenario, scenario.graph.nodes[0]!, 'hud', {
      left: 0.3,
      top: 0.4,
      width: 0.35,
      height: 0.25,
    })
    expect(next.graph.nodes[0]?.data.overlayNodes?.[0]?.layout).toEqual({
      left: 0.3,
      top: 0.4,
      width: 0.35,
      height: 0.25,
    })
  })

  beforeAll(() => registerTestComponents())

  it.skip('旧 inkYingMo inputs.events 时间窗契约', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': {
              id: 'node:a',
              children: [
                {
                  id: 'choice-ym',
                  component: 'test.choice',
                  trigger: { when: 'enter' },
                  window: { startMs: 1000, endMs: 3500 },
                  inputs: { events: [{ id: 'ying', label: '應' }, { id: 'mo', label: '默' }] },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'node:a' }] } } : nd,
        ),
      },
    }
    const n1 = findNode(withMount.graph, 'a')!
    const el = choiceElement(withMount, n1)
    expect(el).toBeDefined()
    expect(el!.component).toBe('test.choice')
    expect((el!.inputs as { events?: { id: string }[] }).events?.map((o) => o.id)).toEqual(['ying', 'mo'])
    expect(el!.window).toEqual({ startMs: 1000, endMs: 3500 })

    expect(choiceSkinPreviewInteractions(withMount, n1, 500, 8000)).toHaveLength(0)
    const snaps = choiceSkinPreviewInteractions(withMount, n1, 2000, 8000)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.component).toBe('test.choice')
    expect(choiceSkinPreviewInteractions(withMount, n1, 5000, 8000)).toHaveLength(0)
  })

  it('默认选项使用 inkYingMo 并进入真实皮肤预览层', () => {
    const n = node('a', { durationMs: 8000 })
    let scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 8000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    expect(choiceSkinPreviewInteractions(res.scenario, n1, 100, 8000)).toHaveLength(1)
  })

  it('新建选项落盘 STAGE_FILL + TEST_CHOICE（出口以 manifest 为准，不必写入 inputs.events）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 8000, 0)
    const after = findNode(res.scenario.graph, 'a')!
    const el = choiceElement(res.scenario, after)
    expect(el).toBeDefined()
    expect(el!.component).toBe('test.choice')
    expect(el!.layout).toMatchObject({ left: 0, top: 0, width: 1, height: 1 })
    expect(listOptionBranches(res.scenario, after).map((b) => b.key)).toEqual(['ying', 'mo'])
  })

  it('选项预览移动整份挂载 layout', () => {
    const n = node('a', { durationMs: 8000 })
    let scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 8000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const overlays = activePreviewOverlaysFromNode(res.scenario, n1, 100, 8000)
    const opt = overlays.find((o) => o.kind === 'option')
    expect(opt?.movable).toBe(true)
    expect(opt?.target).toEqual({ kind: 'mount', mountId: nodeOverlayId('a'), elementId: expect.any(String) })
    const next = patchOverlayPositionGraph(res.scenario, n1, opt!.target, 0.33, 0.44)
    const mount = findNode(next.graph, 'a')!.data.overlayNodes?.find((item) => (item.id ?? item.overlay) === nodeOverlayId('a'))
    expect(mount?.layout?.left).toBeCloseTo(-0.17)
    expect(mount?.layout?.top).toBeCloseTo(-0.06)
    const moved = activePreviewOverlaysFromNode(next, findNode(next.graph, 'a')!, 100, 8000).find((o) => o.kind === 'option')
    expect(moved?.x).toBe(0.33)
    expect(moved?.y).toBe(0.44)
  })

  it('预览画布层级调整沿用元素 layout.zIndex', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 8000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const opt = activePreviewOverlaysFromNode(res.scenario, n1, 100, 8000).find((o) => o.kind === 'option')
    expect(opt).toBeDefined()

    const next = patchOverlayZIndexGraph(res.scenario, n1, opt!.target, 5)
    const moved = activePreviewOverlaysFromNode(next, findNode(next.graph, 'a')!, 100, 8000).find((o) => o.kind === 'option')
    expect(moved?.zIndex).toBe(5)
  })

  it('选项结算 spawn：与改数值并存，ttl 截断到节点时长', () => {
    const n = node('a', { durationMs: 5000 })
    let scenario = scnOf({ nodes: [n], edges: [] }, {
      ui: {
        overlays: {
          'scheme-dynamic': {
            id: 'scheme-dynamic',
            children: [{ id: 'float', component: 'test.float', trigger: { when: 'enter' }, inputs: { text: '+30' } }],
          },
        },
      },
    })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 5000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const key = listOptionBranches(res.scenario, n1)[0]!.key
    const s1 = setOptionBranchSpawnGraph(res.scenario, n1, key, { from: 'scheme-dynamic/float', ttlMs: 50_000 })
    const n2 = findNode(s1.graph, 'a')!
    const s2 = setOptionBranchEffectsGraph(s1, n2, key, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 },
    ])
    const n3 = findNode(s2.graph, 'a')!
    const branch = listOptionBranches(s2, n3).find((b) => b.key === key)!
    expect(branch.effects).toHaveLength(1)
    expect(branch.spawn?.from).toBe('scheme-dynamic/float')
    expect(branch.spawn?.ttlMs).toBe(5000)
  })
})

describe('graphMaterialOps · 选项/组件结算统一写 mount.reactions（修复 2026-07-16 误写 node.data.reactions 导致运行时不生效的 bug）', () => {
  it('setOptionBranchEffectsGraph 写进挂载级 reactions（node:<id>），不落 node.data.reactions', () => {
    const n = node('a', { durationMs: 5000 })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 5000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const key = listOptionBranches(res.scenario, n1)[0]!.key
    const next = setOptionBranchEffectsGraph(res.scenario, n1, key, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -10 },
    ])
    const n2 = findNode(next.graph, 'a')!
    expect(n2.data.reactions).toBeUndefined()
    const mount = (n2.data.overlayNodes ?? []).find((m) => (m.id ?? m.overlay) === nodeOverlayId('a'))
    expect(mount?.reactions?.some((r) => r.when.type === 'event' && r.when.id === key)).toBe(true)
  })

  it('读兜底：升级前遗留在 node.data.reactions 的旧配置仍能读回，不会静默消失', () => {
    const key = 'ying'
    const n = node('a', {
      durationMs: 5000,
      reactions: [{
        when: { type: 'event', id: key },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -20 }] }],
      }],
    })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 5000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const branch = listOptionBranches(res.scenario, n1).find((b) => b.key === key)
    expect(branch?.effects).toHaveLength(1)
    expect(branch?.effects[0]).toMatchObject({ entityId: 'ent-boss', attr: 'hp', value: -20 })
  })

  it('写入会顺带清理同 key 的 legacy node.data.reactions 残留（不留新旧两处数据）', () => {
    const key = 'ying'
    const n = node('a', {
      durationMs: 5000,
      reactions: [{
        when: { type: 'event', id: key },
        do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -20 }] }],
      }],
    })
    const scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 5000, 0)
    const n1 = findNode(res.scenario.graph, 'a')!
    const next = setOptionBranchEffectsGraph(res.scenario, n1, key, [
      { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -30 },
    ])
    const n2 = findNode(next.graph, 'a')!
    expect(n2.data.reactions).toBeUndefined()
    const branch = listOptionBranches(next, n2).find((b) => b.key === key)
    expect(branch?.effects[0]).toMatchObject({ value: -30 })
  })
})

describe('graphMaterialOps · 挂载组件全量上时间轴', () => {
  beforeAll(() => {
        registerTestComponents()
  })

  it('fixture float children remain ordinary mounted components', () => {
    const n = node('a', { durationMs: 8000 })
    const base = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            float: {
              id: 'float',
              title: '伤害飘字',
              children: [{
                id: 'damage',
                component: 'test.float',
                window: { startMs: 1000, endMs: 2100 },
                inputs: { value: -25, durationMs: 1100 },
              }],
            },
          },
        },
      },
    )
    const scenario: GameScenario = {
      ...base,
      graph: {
        ...base.graph,
        nodes: base.graph.nodes.map((current) => (
          current.id === 'a'
            ? { ...current, data: { ...current.data, overlayNodes: [{ overlay: 'float' }] } }
            : current
        )),
      },
    }
    const nodeA = findNode(scenario.graph, 'a')!

    expect(collectMaterialsFromNode(scenario, nodeA, 8000)[0]?.fixedWidthPx).toBeUndefined()
    expect(collectMountItemsFromNode(scenario, nodeA, 8000)[0]?.fixedWidthPx).toBeUndefined()
  })

  it('fixture float without an end time spans the mount and remains movable', () => {
    const n = node('a', { durationMs: 8000 })
    const base = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            float: {
              id: 'float',
              title: '伤害飘字',
              children: [{
                id: 'damage',
                component: 'test.float',
                window: { startMs: 1000 },
                inputs: { value: -25, durationMs: 1100 },
              }],
            },
          },
        },
      },
    )
    const scenario: GameScenario = {
      ...base,
      graph: {
        ...base.graph,
        nodes: base.graph.nodes.map((current) => (
          current.id === 'a'
            ? { ...current, data: { ...current.data, overlayNodes: [{ overlay: 'float' }] } }
            : current
        )),
      },
    }
    const nodeA = findNode(scenario.graph, 'a')!
    const item = collectMountItemsFromNode(scenario, nodeA, 8000)[0]!
    expect([item.startMs, item.endMs]).toEqual([1000, 8000])

    const moved = patchMaterialGraph(
      scenario,
      nodeA,
      8000,
      item,
      { startMs: 2500, endMs: 3600, zIndex: 0 },
    )
    const movedItem = collectMountItemsFromNode(moved, findNode(moved.graph, 'a')!, 8000)[0]!
    expect([movedItem.startMs, movedItem.endMs]).toEqual([2500, 8000])
  })

  it('挂载条：拖边缘拉伸 window，整体拖动保持跨度', () => {
    const n = node('a', { durationMs: 8000 })
    const base = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'ov-short': {
              id: 'ov-short',
              children: [{
                id: 'kou',
                component: 'test.qte',
                trigger: { when: 'enter' },
                window: { startMs: 1000, endMs: 1001 },
                inputs: { glyph: '叩', cues: [{ id: 'c0', appearAt: 0, targetAt: 200, endAt: 400 }] },
              }],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...base,
      graph: {
        ...base.graph,
        nodes: base.graph.nodes.map((current) =>
          current.id === 'a'
            ? { ...current, data: { ...current.data, overlayNodes: [{ overlay: 'ov-short' }] } }
            : current),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const bar = collectMountItemsFromNode(withMount, nodeA, 8000)[0]!
    expect([bar.kind, bar.startMs, bar.endMs]).toEqual(['mount', 1000, 1001])

    const resized = patchMaterialGraph(withMount, nodeA, 8000, bar, { startMs: 400, endMs: 1001 })
    const afterResize = collectMountItemsFromNode(resized, findNode(resized.graph, 'a')!, 8000)[0]!
    expect([afterResize.startMs, afterResize.endMs]).toEqual([400, 1001])

    const grown = patchMaterialGraph(
      resized,
      findNode(resized.graph, 'a')!,
      8000,
      afterResize,
      { startMs: 400, endMs: 5000 },
    )
    const afterGrow = collectMountItemsFromNode(grown, findNode(grown.graph, 'a')!, 8000)[0]!
    expect([afterGrow.startMs, afterGrow.endMs]).toEqual([400, 5000])

    const moved = patchMaterialGraph(
      grown,
      findNode(grown.graph, 'a')!,
      8000,
      afterGrow,
      { startMs: 1400, endMs: 6000, zIndex: 0 },
    )
    const afterMove = collectMountItemsFromNode(moved, findNode(moved.graph, 'a')!, 8000)[0]!
    expect([afterMove.startMs, afterMove.endMs]).toEqual([1400, 6000])

    const squashed = patchMaterialGraph(
      moved,
      findNode(moved.graph, 'a')!,
      8000,
      afterMove,
      { startMs: 9999, endMs: 6000 },
    )
    const afterSquash = collectMountItemsFromNode(squashed, findNode(squashed.graph, 'a')!, 8000)[0]!
    expect(afterSquash.endMs - afterSquash.startMs).toBeGreaterThanOrEqual(100)

    const tiny = patchOverlayChild(withMount, 'a', 'kou', { window: { startMs: 10, endMs: 11 } })
    const tinyNode = findNode(tiny.graph, 'a')!
    const tinyBar = collectMountItemsFromNode(tiny, tinyNode, 8000)[0]!
    const stretched = patchMaterialGraph(tiny, tinyNode, 8000, tinyBar, { startMs: 9, endMs: 11 })
    const afterStretch = collectMountItemsFromNode(stretched, findNode(stretched.graph, 'a')!, 8000)[0]!
    expect([afterStretch.startMs, afterStretch.endMs]).toEqual([9, 11])
  })

  it('未分类按挂载实例列槽（两份新规格血条各一格）；添加时克隆输入', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'ov-a': {
              id: 'ov-a',
              children: [
                {
                  id: 'hp-player',
                  component: 'test.hud',
                  trigger: { when: 'enter' },
                  window: { startMs: 0, endMs: 8000 },
                  inputs: { current: 72, max: 100, label: '我方', qi: 3, qiMax: 5 },
                },
                {
                  id: 'hp-boss',
                  component: 'test.hud',
                  trigger: { when: 'enter' },
                  window: { startMs: 0, endMs: 8000 },
                  inputs: { current: 58, max: 100, label: '敌方' },
                },
                {
                  id: 'gain',
                  component: 'test.float',
                  trigger: { when: 'at', ms: 100 },
                  window: { startMs: 100, endMs: 800 },
                  inputs: { text: '+30' },
                },
                {
                  id: 'line',
                  component: 'test.dialogue',
                  trigger: { when: 'enter' },
                  window: { startMs: 0, endMs: 2000 },
                  inputs: { text: '字幕' },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'ov-a' }] } } : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const mats = collectMaterialsFromNode(withMount, nodeA, 8000)
    expect(mats.filter((m) => m.kind === 'component' && m.componentId === 'test.hud')).toHaveLength(2)
    expect(mats.find((m) => m.id === 'hp-player')?.label).toBe('我方')
    expect(mats.find((m) => m.id === 'hp-boss')?.label).toBe('敌方')
    const skinKids = previewSkinChildrenInWindow(withMount, nodeA, 200, 8000)
    expect(skinKids.filter((c) => c.component === 'test.hud')).toHaveLength(2)

    const tabs = listSchemeMountTabs(withMount, nodeA)
    expect(tabs.map((t) => t.mountId)).toEqual(['ov-a'])
    const extras = tabs.flatMap((t) => t.components)
    // 按实例：mountId/childId；不按 kind 过滤——方案里的字幕/转场等一律列出。
    expect(extras.map((c) => c.id).sort()).toEqual(['ov-a/gain', 'ov-a/hp-boss', 'ov-a/hp-player', 'ov-a/line'])
    expect(extras.find((c) => c.id === 'ov-a/hp-player')).toEqual({
      id: 'ov-a/hp-player',
      label: '我方',
      componentId: 'test.hud',
    })
    expect(extras.find((c) => c.id === 'ov-a/hp-boss')?.label).toBe('敌方')
    expect(extras.find((c) => c.id === 'ov-a/gain')?.label).toBe('测试飘字 · gain')
    expect(listSchemeMountTabs(withMount, undefined)).toEqual([])

    // 从「敌方」模板添加 → 新实例保留数值与标签
    const added = addMaterialGraph(withMount, nodeA, 8000, 'ov-a/hp-boss', undefined, 0)
    const newId = added.selectKey?.replace(/^component:/, '')
    expect(newId).toBeTruthy()
    const cloned = findElement(added.scenario, findNode(added.scenario.graph, 'a')!, newId!)
    expect(cloned?.component).toBe('test.hud')
    expect(cloned?.inputs).toMatchObject({ current: 58, max: 100, label: '敌方' })
  })

  it('第二份挂载的 HUD 方案也进时间轴与预览（不只看 primary 内容挂载）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': { id: 'node:a', children: [] },
            'scheme-static': {
              id: 'scheme-static',
              children: [
                {
                  id: 'hp-player',
                  component: 'test.hud',
                  trigger: { when: 'enter' },
                  inputs: { current: 72, max: 100, label: '我方', qi: 3, qiMax: 5 },
                },
              ],
            },
          },
        },
      },
    )
    // 内容挂载在前（空），HUD 方案挂第二份——旧逻辑只读 primary 会漏掉血条
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a'
            ? {
                ...nd,
                data: {
                  ...nd.data,
                  overlayNodes: [{ overlay: 'node:a' }, { overlay: 'scheme-static' }],
                },
              }
            : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const mats = collectMaterialsFromNode(withMount, nodeA, 8000)
    expect(mats.some((m) => m.id === 'hp-player' && m.kind === 'component')).toBe(true)
    const skinKids = previewSkinChildrenInWindow(withMount, nodeA, 100, 8000)
    expect(skinKids.some((c) => c.id === 'scheme-static/hp-player' && c.component === 'test.hud')).toBe(true)
    expect(skinKids.find((c) => c.id === 'scheme-static/hp-player')?.source.mountId).toBe('scheme-static')
    const extras = listSchemeMountTabs(withMount, nodeA).flatMap((t) => t.components)
    expect(extras.some((c) => c.id === 'scheme-static/hp-player' && c.label === '我方')).toBe(true)
  })

  it('添加控件额外槽：排除 node:* 本地 children 与 mount.added（不因 override 增生模板卡）', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'node:a': {
              id: 'node:a',
              children: [
                {
                  id: 'timeline-hp',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  inputs: { bind: 'ent-player', label: '时间轴新建' },
                },
              ],
            },
            'scheme-static': {
              id: 'scheme-static',
              children: [
                {
                  id: 'hp-player',
                  component: 'battleHpBar',
                  trigger: { when: 'enter' },
                  inputs: { bind: 'ent-player', label: '我方' },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a'
            ? {
                ...nd,
                data: {
                  ...nd.data,
                  overlayNodes: [
                    { overlay: 'node:a' },
                    {
                      overlay: 'scheme-static',
                      added: [
                        {
                          id: 'hp-added',
                          component: 'battleHpBar',
                          trigger: { when: 'enter' },
                          inputs: { bind: 'ent-boss', label: 'override新增' },
                        },
                      ],
                    },
                  ],
                },
              }
            : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    const extras = listSchemeMountTabs(withMount, nodeA).flatMap((t) => t.components)
    expect(extras.map((c) => c.id)).toEqual(['scheme-static/hp-player'])
    expect(extras.some((c) => c.id.includes('timeline-hp') || c.id.includes('hp-added'))).toBe(false)
  })
})

describe.skip('已退役旧同 ID 皮肤契约 · choice 样式锁定', () => {
  beforeAll(() => registerTestComponents())

  function seedDefaultOption(): { scenario: GameScenario; node: GameNode } {
    const n = node('a', { durationMs: 8000 })
    let scenario = scnOf({ nodes: [n], edges: [] })
    const res = addTestOptionGraph(scenario, scenario.graph.nodes[0]!, 8000, 0)
    return { scenario: res.scenario, node: findNode(res.scenario.graph, 'a')! }
  }

  /** 挂载一个方案，目录原型里放一个指定皮肤的 choice 组件；克隆它到节点，得到顶层就是该皮肤的实例。 */
  function seedSkinnedOptionFromScheme(
    component: string,
    events: Array<{ id: string; label?: string }>,
  ): { scenario: GameScenario; node: GameNode } {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'scheme-choice': {
              id: 'scheme-choice',
              children: [{ id: 'choice-proto', component, trigger: { when: 'enter' }, inputs: { events } }],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'scheme-choice' }] } } : nd,
        ),
      },
    }
    const nodeRef = findNode(withMount.graph, 'a')!
    const res = addMaterialGraph(withMount, nodeRef, 8000, 'scheme-choice/choice-proto', undefined, 0)
    return { scenario: res.scenario, node: findNode(res.scenario.graph, 'a')! }
  }

  it('默认清单（component: choice）：可自由增删选项', () => {
    const { scenario, node: n } = seedDefaultOption()
    expect(listOptionBranches(scenario, n)).toHaveLength(1)
    const added = addOptionBranchGraph(scenario, n)
    expect(listOptionBranches(added, findNode(added.graph, 'a')!)).toHaveLength(2)
  })

  it('TEST_CHOICE：结算条数固定为應/默两条（manifest.events）', () => {
    const { scenario, node: n } = seedSkinnedOptionFromScheme('test.choice', [
      { id: 'ying', label: '應' },
      { id: 'mo', label: '默' },
    ])
    const branches = listOptionBranches(scenario, n)
    expect(branches.map((b) => b.key)).toEqual(['ying', 'mo'])
    expect(branches.map((b) => b.label)).toEqual(['應', '默'])
    const el = choiceElement(scenario, n)!
    expect(el.component).toBe('test.choice')
  })

  it('TEST_SKILL：结算条数以 manifest.events 为准，忽略实例上写脏的 inputs.events', () => {
    const events = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
    const { scenario, node: n } = seedSkinnedOptionFromScheme('test.skill', events)
    expect(listOptionBranches(scenario, n).map((b) => b.key)).toEqual(['light', 'heavy', 'medit', 'ult'])
    const afterAdd = addOptionBranchGraph(scenario, n)
    // 增删仍改 inputs.events，但列表读 manifest，条数不变
    expect(listOptionBranches(afterAdd, findNode(afterAdd.graph, 'a')!).map((b) => b.key)).toEqual([
      'light', 'heavy', 'medit', 'ult',
    ])
    const afterRemove = removeOptionBranchGraph(scenario, n, 'a')
    expect(listOptionBranches(afterRemove, findNode(afterRemove.graph, 'a')!).map((b) => b.key)).toEqual([
      'light', 'heavy', 'medit', 'ult',
    ])
  })

  it('回归：方案目录里的皮肤原型缺 inputs（老数据/手改 JSON）时，克隆出的实例仍按皮肤 defaults 补全出口，不会退化成空/泛用选项', () => {
    const n = node('a', { durationMs: 8000 })
    const scenario = scnOf(
      { nodes: [n], edges: [] },
      {
        ui: {
          overlays: {
            'scheme-choice': {
              id: 'scheme-choice',
              // 有意不写 inputs：复刻老数据/手改 JSON 里皮肤原型缺字段的真实情况。
              children: [{ id: 'choice-proto', component: 'test.choice', trigger: { when: 'enter' } }],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'scheme-choice' }] } } : nd,
        ),
      },
    }
    const nodeRef = findNode(withMount.graph, 'a')!
    const res = addMaterialGraph(withMount, nodeRef, 8000, 'scheme-choice/choice-proto', undefined, 0)
    const afterNode = findNode(res.scenario.graph, 'a')!
    const el = choiceElement(res.scenario, afterNode)!
    expect(el.component).toBe('test.choice')
    const branches = listOptionBranches(res.scenario, afterNode)
    expect(branches.map((b) => b.label)).toEqual(['應', '默'])
  })
})

describe.skip('已退役旧同 ID 皮肤契约 · 删除级联', () => {
  beforeAll(() => registerTestComponents())

  function seedYingMoWithJumps(): {
    scenario: GameScenario
    node: GameNode
    elId: string
    mountId: string
  } {
    const n = node('a', { durationMs: 8000 })
    const b = node('b', { durationMs: 1000 })
    const c = node('c', { durationMs: 1000 })
    const scenario = scnOf(
      { nodes: [n, b, c], edges: [] },
      {
        ui: {
          overlays: {
            'scheme-yingmo': {
              id: 'scheme-yingmo',
              title: '應默方案',
              children: [
                {
                  id: 'choice-proto',
                  component: 'test.choice',
                  trigger: { when: 'enter' },
                  inputs: {
                    events: [
                      { id: 'ying', label: '應' },
                      { id: 'mo', label: '默' },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    )
    // 节点直接挂载方案（覆盖物）：應默是方案基底组件，与「节点配置 › 覆盖物事件 › 移除」同形。
    const withMount: GameScenario = {
      ...scenario,
      graph: {
        ...scenario.graph,
        nodes: scenario.graph.nodes.map((nd) =>
          nd.id === 'a'
            ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'scheme-yingmo' }] } }
            : nd,
        ),
      },
    }
    const nodeA = findNode(withMount.graph, 'a')!
    let s = setOptionTargetGraph(withMount, nodeA, 'ying', 'b')
    s = setOptionTargetGraph(s, findNode(s.graph, 'a')!, 'mo', 'c')
    const after = findNode(s.graph, 'a')!
    const el = choiceElement(s, after)!
    expect(s.graph.edges.map((e) => [e.sourceHandle, e.target])).toEqual([
      ['ying', 'b'],
      ['mo', 'c'],
    ])
    return {
      scenario: s,
      node: after,
      elId: el.id,
      mountId: after.data.overlayNodes![0]!.overlay,
    }
  }

  it('removeMountGraph：卸掉挂有應默的覆盖物时，應/默两条跳转边一并删除', () => {
    const { scenario, node: n, mountId } = seedYingMoWithJumps()
    const next = removeMountGraph(scenario, n, mountId)
    expect(next.graph.edges.filter((e) => e.source === 'a')).toEqual([])
    expect(findNode(next.graph, 'a')!.data.overlayNodes).toBeUndefined()
  })

  it('deleteMaterialGraph(component)：删掉方案来源的應默组件时，應/默两条跳转边与结算一并删除', () => {
    // 方案克隆到挂载 added[] → materialKind = component（与时间轴/预览删除同形）
    const n = node('a', { durationMs: 8000 })
    const b = node('b', { durationMs: 1000 })
    const c = node('c', { durationMs: 1000 })
    const base = scnOf(
      { nodes: [n, b, c], edges: [] },
      {
        ui: {
          overlays: {
            'scheme-choice': {
              id: 'scheme-choice',
              children: [
                {
                  id: 'choice-proto',
                  component: 'test.choice',
                  trigger: { when: 'enter' },
                  inputs: {
                    events: [
                      { id: 'ying', label: '應' },
                      { id: 'mo', label: '默' },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    )
    const withMount: GameScenario = {
      ...base,
      graph: {
        ...base.graph,
        nodes: base.graph.nodes.map((nd) =>
          nd.id === 'a' ? { ...nd, data: { ...nd.data, overlayNodes: [{ overlay: 'scheme-choice' }] } } : nd,
        ),
      },
    }
    const res = addMaterialGraph(withMount, findNode(withMount.graph, 'a')!, 8000, 'scheme-choice/choice-proto', undefined, 0)
    let s = res.scenario
    const nodeA = findNode(s.graph, 'a')!
    const el = choiceElement(s, nodeA)!
    s = setOptionTargetGraph(s, nodeA, 'ying', 'b')
    s = setOptionTargetGraph(s, findNode(s.graph, 'a')!, 'mo', 'c')
    s = setOptionBranchEffectsGraph(s, findNode(s.graph, 'a')!, 'ying', [
      { kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: 1 },
    ])
    expect(s.graph.edges.filter((e) => e.source === 'a')).toHaveLength(2)

    const item = collectMaterialsFromNode(s, findNode(s.graph, 'a')!, 8000).find((m) => m.id === el.id)!
    expect(item.kind).toBe('component')
    const next = deleteMaterialGraph(s, findNode(s.graph, 'a')!, item)
    expect(next.graph.edges.filter((e) => e.source === 'a')).toEqual([])
    expect(findElement(next, findNode(next.graph, 'a')!, el.id)).toBeUndefined()
    // 挂载仍在，但應/默 event reaction 应已清掉
    const mount = findNode(next.graph, 'a')!.data.overlayNodes?.[0]
    const leftover = (mount?.reactions ?? []).filter(
      (r) => r.when.type === 'event' && (r.when.id === 'ying' || r.when.id === 'mo'),
    )
    expect(leftover).toEqual([])
  })
})

function seedFloat(): { scenario: GameScenario; node: GameNode; floatId: string } {
  const n = node('a', { durationMs: 8000 })
  let scenario = scnOf({ nodes: [n], edges: [] })
  const nodeRef = scenario.graph.nodes[0]!
  const res = addMaterialGraph(scenario, nodeRef, 8000, 'overlay', undefined, 0)
  scenario = res.scenario
  const floatId = res.selectKey!.split(':').pop()!
  return { scenario, node: scenario.graph.nodes[0]!, floatId }
}

describe('graphMaterialOps · 飘字 effects/expr（结算写回 node.data.reactions，前端表现对齐旧「选取式」）', () => {
  it('新建飘字自带默认到点效果（Boss hp −100）', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const fx = overlayEffects(scenario, n, floatId)
    expect(fx).toHaveLength(1)
    expect(fx[0]).toMatchObject({
      kind: 'attr',
      attr: 'hp',
      op: 'add',
      value: { expr: '-(100)' },
      id: `${floatId}-settle`,
    })
    const preview = activePreviewOverlaysFromNode(scenario, n, 0, 8000)
      .find((overlay) => overlay.id === `overlay:${floatId}`)
    expect(preview?.label).toBe('-100')
  })

  it('常量和公式伤害统一编码为减法语义，并保留公式参数 sidecar', () => {
    const formulaPick = {
      mode: 'formula',
      formulaId: 'damage',
      holeBindings: {
        attacker: { kind: 'entityAttr', entityId: 'ent-player', attr: 'attack' },
        defender: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'defense' },
      },
    }
    const formulaValue = {
      expr: 'entity.ent-player.attr.attack - entity.ent-boss.attr.defense',
      pick: formulaPick,
    } as unknown as NumOrExpr

    expect(createDamageHpEffect(undefined, 'boss', formulaValue, 'float-1')).toMatchObject({
      kind: 'attr',
      entityId: 'ent-boss',
      attr: 'hp',
      op: 'add',
      value: {
        expr: '-(entity.ent-player.attr.attack - entity.ent-boss.attr.defense)',
        pick: formulaPick,
      },
      id: 'float-1-settle',
    })
  })

  it('effects 往返：EffectsEditor 产出的完整列表写入后可读回，首条打上定位 id', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const next = patchOverlayGraph(
      scenario,
      n,
      floatId,
      { effects: [{ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: 30 }] },
      undefined,
    )
    const curNode = findNode(next.graph, n.id)!
    const fx = overlayEffects(next, curNode, floatId)
    expect(fx).toHaveLength(1)
    expect(fx[0]).toMatchObject({ kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: 30, id: `${floatId}-settle` })
  })

  it('effects 传空数组＝清除结算（纯展示，不改数值）', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const next = patchOverlayGraph(scenario, n, floatId, { effects: [] }, undefined)
    const curNode = findNode(next.graph, n.id)!
    expect(overlayEffects(next, curNode, floatId)).toEqual([])
    expect(curNode.data.reactions).toBeUndefined()
  })

  it('expr 往返：勾选自定义显示数值后写回 inputs（NumOrExpr），取消勾选清空', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const withExpr = patchOverlayGraph(
      scenario,
      n,
      floatId,
      { expr: { expr: 'entity.ent-boss.attr.hp' } },
      undefined,
    )
    const el = findElement(withExpr, findNode(withExpr.graph, n.id), floatId)!
    expect(el.inputs?.parameter).toEqual({ expr: 'entity.ent-boss.attr.hp' })

    const cleared = patchOverlayGraph(
      withExpr,
      findNode(withExpr.graph, n.id)!,
      floatId,
      { expr: undefined },
      undefined,
    )
    const el2 = findElement(cleared, findNode(cleared.graph, n.id), floatId)!
    expect(el2.inputs?.parameter).toBeUndefined()
  })

  it('content 只改显示文案，不影响结算 effects', () => {
    const { scenario, node: n, floatId } = seedFloat()
    const next = patchOverlayGraph(scenario, n, floatId, { content: '会心一击 {v}' }, undefined)
    const curNode = findNode(next.graph, n.id)!
    const el = findElement(next, curNode, floatId)!
    expect(el.inputs?.fixedText).toBe('会心一击 ')
    expect(el.inputs?.parameter).toBe('-100')
    expect(overlayEffects(next, curNode, floatId)).toHaveLength(1)
  })
})

describe('graphMaterialOps · 同模板多挂载', () => {
  it('重复挂载生成独立实例，时间轴与运行时不撞 key，删除第二份不影响第一份', () => {
    const n = node('a', { durationMs: 3000 })
    const overlay = {
      id: 'n_door',
      title: '叩门界面',
      children: [{
        id: 'damage',
        component: 'floatText',
        trigger: { when: 'enter' as const },
        inputs: { text: '-100' },
      }],
    }
    const base = scnOf(
      { nodes: [n], edges: [] },
      { ui: { overlays: { [overlay.id]: overlay } } },
    )

    const once = mountOverlayGraph(base, n, overlay.id)
    const twice = mountOverlayGraph(once, findNode(once.graph, n.id)!, overlay.id)
    const mountedNode = findNode(twice.graph, n.id)!

    expect(mountedNode.data.overlayNodes).toEqual([
      { overlay: 'n_door' },
      { id: 'n_door__2', overlay: 'n_door' },
    ])
    expect(expandNodeOverlays(twice.ui?.overlays, mountedNode).flatMap((mount) => mount.children.map((child) => child.id)))
      .toEqual(['n_door/damage', 'n_door__2/damage'])
    expect(previewSkinChildrenInWindow(twice, mountedNode, 0, 3000).map((child) => [child.id, child.source.mountId]))
      .toEqual([
        ['n_door/damage', 'n_door'],
        ['n_door__2/damage', 'n_door__2'],
      ])
    expect(collectMountItemsFromNode(twice, mountedNode, 3000).map((item) => [item.key, item.label]))
      .toEqual([
        ['mount:n_door', '叩门界面'],
        ['mount:n_door__2', '叩门界面'],
      ])

    const removedSecond = removeMountGraph(twice, mountedNode, 'n_door__2')
    expect(findNode(removedSecond.graph, n.id)!.data.overlayNodes).toEqual([{ overlay: 'n_door' }])
  })

  it('拖动或缩放第二份挂载只修改第二份实例', () => {
    const n = node('a', { durationMs: 3000 })
    const overlay = {
      id: 'petal',
      children: [{
        id: 'float',
        component: 'floatText',
        trigger: { when: 'enter' as const },
        window: { startMs: 0, endMs: 1000 },
        inputs: { text: '-100' },
      }],
    }
    const base = scnOf(
      { nodes: [n], edges: [] },
      { ui: { overlays: { [overlay.id]: overlay } } },
    )
    const once = mountOverlayGraph(base, n, overlay.id)
    const twice = mountOverlayGraph(once, findNode(once.graph, n.id)!, overlay.id)

    const shifted = shiftMountWindowGraph(twice, findNode(twice.graph, n.id)!, 3000, 'petal__2', { startMs: 1000 })
    expect(expandNodeOverlays(shifted.ui?.overlays, findNode(shifted.graph, n.id)!).map((mount) => mount.children[0]!.window))
      .toEqual([
        { startMs: 0, endMs: 1000 },
        { startMs: 1000, endMs: 2000 },
      ])

    const resized = resizeMountWindowGraph(shifted, findNode(shifted.graph, n.id)!, 3000, 'petal__2', { endMs: 2500 })
    expect(expandNodeOverlays(resized.ui?.overlays, findNode(resized.graph, n.id)!).map((mount) => mount.children[0]!.window))
      .toEqual([
        { startMs: 0, endMs: 1000 },
        { startMs: 1000, endMs: 2500 },
      ])
  })
})
