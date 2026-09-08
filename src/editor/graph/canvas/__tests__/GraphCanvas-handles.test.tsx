import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { canvasNodeDetails, canvasSettlementLabel, GraphCanvas } from '../GraphCanvas'

const graph: GameGraph = {
  nodes: [
    { id: 'a', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '起点' } },
    { id: 'b', type: 'perf', position: { x: 220, y: 0 }, inputs: [], outputs: [], data: { name: '终点' } },
  ],
  edges: [{ id: 'a-b', source: 'a', target: 'b', sourceHandle: 'default', targetHandle: 'in' }],
}

describe('GraphCanvas output handles', () => {
  it('marks source handles interactive only on the editable canvas', () => {
    const { container, rerender } = render(
      <GraphCanvas graph={graph} onChange={() => { }} />,
    )

    expect(container.querySelector('.gv-flow-handle.is-interactive')).toBeTruthy()

    rerender(<GraphCanvas graph={graph} onChange={() => { }} readOnly />)

    const staticHandle = container.querySelector<HTMLElement>('.gv-flow-handle.is-static')
    expect(staticHandle).toBeTruthy()
    expect(staticHandle?.style.pointerEvents).toBe('none')
    expect(container.querySelector('.gv-flow-handle.is-interactive')).toBeNull()
    expect(container.querySelector('.react-flow.gv-readonly-flow')).toBeTruthy()
    expect(container.querySelector('.react-flow__node.selectable')).toBeNull()
    expect(container.querySelector('.react-flow__edge.selectable')).toBeNull()
  })

  it('drops the viewport chrome when the host asks for a bare canvas', () => {
    // 试玩的蓝图浮层就这么用：只看流程走到哪，缩放工具条 / 小地图 / 「定位当前节点」都是噪点。
    const { container, queryByLabelText, rerender } = render(
      <GraphCanvas graph={graph} onChange={() => { }} readOnly />,
    )

    expect(container.querySelector('.gv-canvas-toolbar')).toBeTruthy()
    expect(container.querySelector('[data-testid="gv-graph-minimap"]')).toBeTruthy()
    expect(queryByLabelText('定位当前节点')).toBeTruthy()

    rerender(<GraphCanvas graph={graph} onChange={() => { }} readOnly hideViewportChrome />)

    expect(container.querySelector('.gv-canvas-toolbar')).toBeNull()
    expect(container.querySelector('[data-testid="gv-graph-minimap"]')).toBeNull()
    expect(queryByLabelText('定位当前节点')).toBeNull()
  })

  it('keeps minimap nodes as color blocks without video frames', () => {
    const videoGraph: GameGraph = {
      nodes: [{
        ...graph.nodes[0]!,
        data: {
          name: '起点',
          media: { kind: 'video', ref: 'video-1' },
        },
      }],
      edges: [],
    }
    const { container } = render(
      <GraphCanvas
        graph={videoGraph}
        onChange={() => { }}
        activeNodeId="a"
        videoOptions={[{
          id: 'video-1',
          label: '开场',
          previewUrl: 'https://cdn.test/opening.mp4',
        }]}
      />,
    )

    expect(container.querySelector('[data-testid="gv-graph-minimap"] image')).toBeNull()
    expect(container.querySelector('.gv-graph-minimap-node-image')).toBeNull()
    expect(container.querySelector('.gv-graph-minimap-node.is-active')).toBeTruthy()
  })

  it('adds a node behind the output whose arrow was hovered', () => {
    // a 的 fail 出口已连到 b：点该出口的「+」应把新节点插在 a→b 之间，default 出口不受影响。
    // 「+」UI 当前 display:none，DOM/逻辑仍保留。
    const forked: GameGraph = {
      nodes: graph.nodes,
      edges: [{ id: 'a-fail-b', source: 'a', target: 'b', sourceHandle: 'fail', targetHandle: 'in' }],
    }
    const onChange = vi.fn()
    const { container, rerender } = render(<GraphCanvas graph={forked} onChange={onChange} />)

    // a/b 各 1 个入口 + a 出口 default/fail + b 出口 default = 5。
    expect(container.querySelectorAll('.gv-handle-add-btn')).toHaveLength(5)

    const failHandle = container.querySelector('[data-handleid="source:fail"]')
    fireEvent.click(failHandle!.closest('.gv-handle-more')!.querySelector('.gv-handle-add-btn')!)

    const next = onChange.mock.calls[0]![0] as GameGraph
    const created = next.nodes.find((n) => !['a', 'b'].includes(n.id))!
    expect(created.data.name).toBe('新演出节点')
    expect(next.edges.some((e) => e.source === 'a' && e.target === created.id && e.sourceHandle === 'fail')).toBe(true)
    expect(next.edges.some((e) => e.source === created.id && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'a-fail-b')).toBe(false)

    rerender(<GraphCanvas graph={forked} onChange={onChange} readOnly />)
    expect(container.querySelector('.gv-handle-add-btn')).toBeNull()
  })

  it('adds a node in front of the input whose arrow was hovered', () => {
    // a→b：点 b 入口的「+」应把新节点插在 a→b 之间，保留原 sourceHandle。
    const onChange = vi.fn()
    const { container } = render(<GraphCanvas graph={graph} onChange={onChange} />)

    // 两个节点各有一个入口 +；按渲染顺序第二个是 b。
    const inletAdds = container.querySelectorAll('.gv-handle-add-btn.is-before')
    expect(inletAdds).toHaveLength(2)
    fireEvent.click(inletAdds[1]!)

    const next = onChange.mock.calls[0]![0] as GameGraph
    const created = next.nodes.find((n) => !['a', 'b'].includes(n.id))!
    expect(created.data.name).toBe('新演出节点')
    expect(next.edges.some((e) => e.source === 'a' && e.target === created.id && (e.sourceHandle ?? 'default') === 'default')).toBe(true)
    expect(next.edges.some((e) => e.source === created.id && e.target === 'b')).toBe(true)
    expect(next.edges.some((e) => e.id === 'a-b')).toBe(false)
  })

  it('marks the current graph entry node', () => {
    const { getByLabelText, queryAllByLabelText } = render(
      <GraphCanvas graph={graph} entryNodeId="a" onChange={() => { }} />,
    )

    expect(getByLabelText('入口节点')).toHaveAttribute('title', '入口节点')
    expect(getByLabelText('入口节点')).toHaveStyle({ background: '#55b98a' })
    expect(queryAllByLabelText('入口节点')).toHaveLength(1)
  })

  it('shows performance, interface and settlement details on a node', () => {
    const detailedGraph: GameGraph = {
      nodes: [{
        ...graph.nodes[0]!,
        data: {
          name: '起点',
          media: { kind: 'video', ref: 'video-1' },
          overlayNodes: [{ overlay: 'main-ui' }, { overlay: 'dialogue-ui' }],
          reactions: [
            {
              when: { type: 'at', ms: 1200 },
              do: [
                { kind: 'effect', effects: [{ kind: 'attr', entityId: 'player', attr: 'hp', op: 'add', value: -40 }] },
                { kind: 'advance', edgeId: 'next' },
              ],
            },
          ],
        },
      }],
      edges: [],
    }
    const { getByText, getByTestId } = render(
      <GraphCanvas
        graph={detailedGraph}
        onChange={() => { }}
        videoOptions={[{ id: 'video-1', label: '叙事·第1章·上岸' }]}
        overlays={{
          'main-ui': { id: 'main-ui', title: '主界面', children: [] },
          'dialogue-ui': { id: 'dialogue-ui', title: '对话', children: [] },
        }}
        entities={{
          player: {
            id: 'player',
            name: '空藏',
            attrs: { hp: 200 },
            attrMeta: { hp: { label: '生命' } },
          },
        }}
      />,
    )

    expect(getByText('演出')).toBeTruthy()
    expect(getByText('叙事·第1章·上岸')).toBeTruthy()
    expect(getByText('界面')).toBeTruthy()
    expect(getByText('主界面')).toBeTruthy()
    expect(getByText('对话')).toBeTruthy()
    expect(getByText('结算')).toBeTruthy()
    expect(getByText('1200 ms · 空藏.生命 -40；推进')).toBeTruthy()
    expect(
      getByTestId('node-edge-info').compareDocumentPosition(getByTestId('node-content-info'))
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('falls back to persisted ids when referenced catalogs are unavailable', () => {
    const node: GameGraph['nodes'][number] = {
      ...graph.nodes[0]!,
      data: { name: '起点', media: { kind: 'video', ref: 'missing-video' }, overlayNodes: [{ overlay: 'missing-ui' }] },
    }

    expect(canvasNodeDetails(node)).toEqual({
      performance: 'missing-video',
      interfaces: ['missing-ui'],
      settlements: [],
    })
  })

  it('summarizes every settlement trigger and excludes component events', () => {
    const node: GameGraph['nodes'][number] = {
      ...graph.nodes[0]!,
      data: {
        name: '起点',
        reactions: [
          {
            when: { type: 'watch', of: 'score', on: 'inc' },
            do: [{
              kind: 'effect',
              effects: [
                { kind: 'var', varId: 'rage', op: 'add', value: 1 },
                { kind: 'flag', varId: 'ready', value: true },
              ],
            }],
          },
          { when: { type: 'shown', of: 'hud/hp' }, do: [{ kind: 'spawn', from: 'toast/gain' }] },
          { when: { type: 'event', id: 'confirm' }, do: [{ kind: 'advance', edgeId: 'next' }] },
        ],
      },
    }

    expect(canvasNodeDetails(node, undefined, [], undefined, {
      rage: { id: 'rage', name: '怒气' },
      ready: { id: 'ready', name: '可释放' },
    }).settlements).toEqual([
      '条件 · 怒气 +1；可释放=是',
      '界面出现 · 绑定 toast',
    ])
    expect(canvasSettlementLabel({
      when: { type: 'complete' },
      do: [{ kind: 'hideOverlay', mountId: 'hud' }],
    })).toBe('演出结束 · 隐藏 hud')
  })
})
