/**
 * 组件事件带出参（`eventPayload.<key>`）的演示用例 + 校验用例。
 *
 * 覆盖三层命名契约的运行时闭环：
 *   声明侧 `outputs`（挂 `ComponentEvent`）→ 组件侧 `emit(key, payload)`
 *   → 求值侧 `eventPayload.<key>`（number 走 `{expr}`，string/boolean 走 `{ref}`）→ 持久侧 `var/attr/item`。
 */
import { describe, expect, it } from 'vitest'
import { registerTestComponents } from './test-components'
import { validateGraph } from '../core/validate/validate'
import { GraphRuntime } from '../core/engine/engine'
import { scnOf, node, rid } from './test-fixtures'
import type { GameGraph, Overlay } from '../core/schema/graph-schema'
import type { Reaction } from '../core/schema/node-config-schema'

registerTestComponents()

/** 单挂载 + 单交互 child：eventId 用裸 `success` / `greatSuccess`（无 childId 前缀）。 */
const qteChild = { id: 'q', component: 'test.qte', trigger: { when: 'enter' as const }, inputs: {} }

function scenarioWith(reactions: Reaction[]) {
  const graph: GameGraph = {
    nodes: [node('a', { overlayNodes: [{ overlay: 'ov-a', reactions }] }), node('b')],
    edges: [],
  }
  return scnOf(graph, {
    variables: { qi: { id: 'qi', initial: 1 } },
    ui: { overlays: { 'ov-a': { id: 'ov-a', children: [qteChild] } } },
  })
}

describe('组件事件出参（eventPayload.<key>）运行时', () => {
  it('number 出参走 {expr} 参与数值运算（var add）', () => {
    const scn = scenarioWith([
      {
        when: { type: 'event', id: 'success' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.damage * 2' } }] }],
      },
    ])
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'success', { damage: 25 })
    expect(rt.state.vars.qi).toBe(51)
  })

  it('string 出参走 {ref} 透传到文本变量', () => {
    const scn = scenarioWith([
      {
        when: { type: 'event', id: 'greatSuccess' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'title', valueType: 'text', op: 'set', value: { ref: 'eventPayload.label' } }] }],
      },
    ])
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'greatSuccess', { damage: 99, label: '会心' })
    expect(rt.state.textVars?.title).toBe('会心')
  })

  it('boolean 出参走 {ref} 写入 flag', () => {
    const scn = scenarioWith([
      {
        when: { type: 'event', id: 'greatSuccess' },
        do: [{ kind: 'effect', effects: [{ kind: 'flag', varId: 'critical', value: { ref: 'eventPayload.critical' } }] }],
      },
    ])
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'greatSuccess', { critical: false })
    expect(rt.state.flags.critical).toBe(0)
  })

  it('number 出参驱动 item 数量（买 N 个苹果）', () => {
    const scn = scenarioWith([
      {
        when: { type: 'event', id: 'success' },
        do: [{ kind: 'effect', effects: [{ kind: 'item', itemId: 'apple', op: 'give', count: { expr: 'eventPayload.count' } }] }],
      },
    ])
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'success', { count: 3 })
    expect(rt.state.items?.apple).toBe(3)
  })

  it('非 number 出参误走 {expr} 数值通道：effect 被跳过、不崩不生效', () => {
    const scn = scenarioWith([
      {
        when: { type: 'event', id: 'greatSuccess' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.label' } }] }],
      },
    ])
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'greatSuccess', { label: '会心' })
    expect(rt.state.vars.qi).toBe(1)
  })

  it('未携带 payload 时 eventPayload.<key> 缺失，数值 effect 被跳过', () => {
    const scn = scenarioWith([
      {
        when: { type: 'event', id: 'success' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.damage' } }] }],
      },
    ])
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    rt.emitComponentEvent(rid('a', 'q'), 'success')
    expect(rt.state.vars.qi).toBe(1)
  })
})

describe('组件事件出参校验（validateGraph）', () => {
  const optsBase = { entities: ['ent-player', 'ent-boss'], vars: ['qi'] }

  function graphWith(reactions: Reaction[]) {
    const graph: GameGraph = {
      nodes: [node('a', { overlayNodes: [{ overlay: 'ov-a', reactions }] })],
      edges: [],
    }
    const overlays: Record<string, Overlay> = { 'ov-a': { id: 'ov-a', children: [qteChild] } }
    return { graph, overlays }
  }

  it('声明过的 key：无 eventPayload 相关报错', () => {
    const { graph, overlays } = graphWith([
      {
        when: { type: 'event', id: 'success' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.damage' } }] }],
      },
    ])
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.filter((i) => i.code.startsWith('ref.event'))).toEqual([])
  })

  it('未声明 key：报 ref.eventPayload.output.missing', () => {
    const { graph, overlays } = graphWith([
      {
        when: { type: 'event', id: 'success' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.unknownKey' } }] }],
      },
    ])
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.some((i) => i.code === 'ref.eventPayload.output.missing' && i.msg.includes('unknownKey'))).toBe(true)
  })

  it('运行时兼容的 childId:eventId 别名也校验 outputs', () => {
    const { graph, overlays } = graphWith([
      {
        when: { type: 'event', id: 'q:success' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.unknownKey' } }] }],
      },
    ])
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.some((i) => i.code === 'ref.eventPayload.output.missing' && i.msg.includes('unknownKey'))).toBe(true)
  })

  it('目录 reaction 使用对应 child 事件的 outputs 校验 payload', () => {
    const { graph, overlays } = graphWith([])
    overlays['ov-a']!.reactions = [{
      when: { type: 'event', id: 'q:success' },
      do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.unknownKey' } }] }],
    }]
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.some((i) => i.code === 'ref.eventPayload.output.missing' && i.msg.includes('unknownKey'))).toBe(true)
  })

  it('动态 inputs.events 声明的 outputs 可供挂载 reaction 使用', () => {
    const graph: GameGraph = {
      nodes: [node('a', {
        overlayNodes: [{
          overlay: 'dynamic',
          reactions: [{
            when: { type: 'event', id: 'buy' },
            do: [{ kind: 'effect', effects: [{ kind: 'item', itemId: 'apple', op: 'give', count: { expr: 'eventPayload.count' } }] }],
          }],
        }],
      })],
      edges: [],
    }
    const overlays: Record<string, Overlay> = {
      dynamic: {
        id: 'dynamic',
        children: [{
          id: 'q',
          component: 'test.qte',
          inputs: { events: [{ id: 'buy', outputs: [{ key: 'count', valueType: 'number' }] }] },
        }],
      },
    }
    const issues = validateGraph(graph, { ...optsBase, overlays, items: ['apple'] })
    expect(issues.filter((i) => i.code.startsWith('ref.eventPayload'))).toEqual([])
  })

  it('项目注入的 authored 组件事件契约参与 outputs 校验', () => {
    const graph: GameGraph = {
      nodes: [node('a', {
        overlayNodes: [{
          overlay: 'authored',
          reactions: [{
            when: { type: 'event', id: 'buy' },
            do: [{ kind: 'effect', effects: [{ kind: 'item', itemId: 'apple', op: 'give', count: { expr: 'eventPayload.missing' } }] }],
          }],
        }],
      })],
      edges: [],
    }
    const overlays: Record<string, Overlay> = {
      authored: {
        id: 'authored',
        children: [{ id: 'buy-button', component: 'authored.quantity', inputs: {} }],
      },
    }
    const componentEvents = new Map([[
      'authored.quantity',
      { events: [{ id: 'buy', outputs: [{ key: 'count', valueType: 'number' as const }] }] },
    ]])
    const issues = validateGraph(graph, {
      ...optsBase,
      overlays,
      items: ['apple'],
      componentEvents,
    })
    expect(issues.some((i) => i.code === 'component.unknown')).toBe(false)
    expect(issues.some((i) => i.code === 'ref.eventPayload.output.missing' && i.msg.includes('missing'))).toBe(true)
  })

  it('在非 event 反应里读 eventPayload.<key>：报 ref.eventPayload.unavailable', () => {
    const { graph, overlays } = graphWith([
      {
        when: { type: 'enter' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: { expr: 'eventPayload.damage' } }] }],
      },
    ])
    const issues = validateGraph(graph, { ...optsBase, overlays })
    expect(issues.some((i) => i.code === 'ref.eventPayload.unavailable')).toBe(true)
  })
})
