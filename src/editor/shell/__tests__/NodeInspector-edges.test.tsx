import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { NodeInspector } from '../NodeInspector'

afterEach(cleanup)

function twoNodeGraph(): GameGraph {
  return {
    nodes: [
      { id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '慈悲狱门口' } },
      { id: 'battle', type: 'perf', position: { x: 240, y: 0 }, inputs: [], outputs: [], data: { name: '战斗节点' } },
    ],
    edges: [],
  }
}

/** 「添加连线」在「事件响应」的动作候选里同名，所以入口只能在出边分区内取。 */
function edgeSection(container: HTMLElement): HTMLElement {
  return [...container.querySelectorAll<HTMLElement>('section.ni-section')]
    .find((section) => section.querySelector('.ni-section-title')?.textContent === '节点连线')!
}

function draftTargetSelect(container: HTMLElement): HTMLSelectElement {
  return [...container.querySelectorAll<HTMLSelectElement>('select')]
    .find((select) => [...select.options].some((option) => option.text === '（选择目标节点）'))!
}

/**
 * 这里钉的是「先选目标才落边」。预填「第一个别的节点」当目标的失败样子是**静默多一条边**：
 * 作者还在想去哪，图里已经多了一条会被运行时走的路，试玩就从这里岔走了。
 */
describe('NodeInspector · 出边分区', () => {
  it('点「添加连线」只出一张空目标的卡片，不落边', () => {
    const onChange = vi.fn()
    const { container } = render(<NodeInspector graph={twoNodeGraph()} nodeId="gate" onChange={onChange} />)

    fireEvent.click(within(edgeSection(container)).getByRole('button', { name: '添加连线' }))

    expect(onChange).not.toHaveBeenCalled()
    const target = draftTargetSelect(container)
    expect(target.value).toBe('')
    // 自环连不上，本节点不该出现在候选里。
    expect([...target.options].map((option) => option.text)).toEqual(['（选择目标节点）', '战斗节点'])
  })

  it('选中目标节点才落成一条默认推进边', () => {
    const onChange = vi.fn()
    const { container } = render(<NodeInspector graph={twoNodeGraph()} nodeId="gate" onChange={onChange} />)

    fireEvent.click(within(edgeSection(container)).getByRole('button', { name: '添加连线' }))
    fireEvent.change(draftTargetSelect(container), { target: { value: 'battle' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.edges).toHaveLength(1)
    expect(next.edges[0]).toMatchObject({ source: 'gate', target: 'battle', sourceHandle: 'default' })
  })
})
