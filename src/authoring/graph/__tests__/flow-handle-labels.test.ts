/**
 * 画布出口展示契约：
 * - 引脚/边 label = 组件事件的中文 label（不再回退成机器 id 字符串）；
 * - handle.data.flowId 保留完整稳定 id（多挂载时带 `mountId:` 前缀），
 *   GraphCanvas 以 `title={flowId}` 渲染 hover 提示，用于区分同名 label 的不同挂载。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deriveOutputs, registerComponent, unregisterComponent } from '@/runtime/core/registry/component-registry'
import { toFXView } from '@/editor/graph/canvas/fx-view'
import type { GameGraph, GameNode } from '@/runtime/core/schema/graph-schema'
import type { Overlay } from '@/runtime/core/schema/node-config-schema'

const INK = 'InkYingMo'

function nodeOf(id: string, extra: Record<string, unknown> = {}): GameNode {
  return {
    id,
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: id, ...extra },
  }
}

const overlays: Record<string, Overlay> = {
  M: {
    id: 'M',
    children: [{ id: 'ink', component: INK, trigger: { when: 'enter' }, inputs: {} }],
  },
}

/** 同一界面 M 在同一节点挂载两次（A = 'M'，B = 'M__2'）。 */
function twoMounts(): GameNode {
  return nodeOf('n1', { overlayNodes: [{ overlay: 'M' }, { id: 'M__2', overlay: 'M' }] })
}

afterEach(() => unregisterComponent(INK))

describe('flow handle labels', () => {
  it('多挂载：deriveOutputs 输出稳定 id + 中文 label', () => {
    registerComponent(INK, { events: [{ id: 'ying', label: '應' }] })
    const outs = deriveOutputs(twoMounts(), overlays)
    expect(outs.map((h) => h.id)).toEqual(['default', 'M:ying', 'M__2:ying'])
    expect(outs.find((h) => h.id === 'M:ying')?.label).toBe('應')
    expect(outs.find((h) => h.id === 'M__2:ying')?.label).toBe('應')
  })

  it('单挂载：handle id 保持裸 key（与既有工程逐字节一致）', () => {
    registerComponent(INK, { events: [{ id: 'ying', label: '應' }] })
    const node = nodeOf('n1', { overlayNodes: [{ overlay: 'M' }] })
    const outs = deriveOutputs(node, overlays)
    expect(outs.map((h) => h.id)).toEqual(['default', 'ying'])
    expect(outs.find((h) => h.id === 'ying')?.label).toBe('應')
  })

  it('toFXView：引脚显示中文 label，flowId 保留完整稳定 id 供 hover 区分', () => {
    registerComponent(INK, { events: [{ id: 'ying', label: '應' }] })
    const graph: GameGraph = {
      nodes: [twoMounts(), nodeOf('n2')],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'M:ying', targetHandle: 'in' }],
    }
    const fx = toFXView(graph, overlays)
    const n1 = fx.nodes.find((n) => n.id === 'n1')!
    const a = n1.outputs.find((h) => h.data?.flowId === 'M:ying')!
    const b = n1.outputs.find((h) => h.data?.flowId === 'M__2:ying')!
    // 两个挂载的中文 label 相同（作者未自定义时），这是允许的
    expect(a.data?.displayLabel).toBe('應')
    expect(b.data?.displayLabel).toBe('應')
    // hover title 给出完整稳定 id，肉眼才能区分 A / B
    expect(a.data?.flowId).toBe('M:ying')
    expect(b.data?.flowId).toBe('M__2:ying')
    // 边 label 同样用中文，不再显示裸 id
    expect(fx.edges[0]?.label).toBe('應')
  })

  it('稳定 id 落在 validate 的派生出口集合内（不误报 edge.handle.missing）', () => {
    registerComponent(INK, { events: [{ id: 'ying', label: '應' }] })
    const outs = deriveOutputs(twoMounts(), overlays).map((h) => h.id)
    expect(outs).toContain('M:ying')
    expect(outs).toContain('M__2:ying')
  })
})
