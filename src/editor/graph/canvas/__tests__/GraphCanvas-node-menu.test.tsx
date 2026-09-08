/** 选中节点后的工具条保持横向、无三点中转入口。 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { GraphCanvas } from '../GraphCanvas'

const graph: GameGraph = {
  nodes: [
    { id: 'a', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '起点' } },
    { id: 'b', type: 'perf', position: { x: 320, y: 0 }, inputs: [], outputs: [], data: { name: '终点' } },
  ],
  edges: [],
}

describe('GraphCanvas node action menu', () => {
  it('shows a horizontal toolbar only after the node is selected', () => {
    const { container } = render(<GraphCanvas graph={graph} onChange={() => { }} />)

    expect(container.querySelector('.gv-bp-menu')).toBeNull()

    fireEvent.click(screen.getByText('起点'))

    const menu = container.querySelector<HTMLElement>('.gv-bp-menu')
    expect(menu).toBeInTheDocument()
    expect(menu!.querySelectorAll('[role="menuitem"]')).toHaveLength(5)
    expect(getComputedStyle(menu!).flexDirection).toBe('row')
    const toolbar = menu!.closest<HTMLElement>('.react-flow__node-toolbar')
    expect(toolbar).toBeInTheDocument()
    expect(toolbar!.style.transform).toMatch(/translate\([^,]+, -4px\) translate\(-50%, -100%\)$/)
  })

  it('removes the three-dot menu trigger from editable nodes', () => {
    const { container } = render(<GraphCanvas graph={graph} onChange={() => { }} />)

    expect(container.querySelector('.gv-bp-more-btn')).toBeNull()
  })

  it('hides node action toolbars while multiple nodes are selected', () => {
    const { container } = render(<GraphCanvas graph={graph} onChange={() => { }} />)

    fireEvent.click(screen.getByText('起点'))
    fireEvent.click(screen.getByText('终点'), { shiftKey: true })

    expect(container.querySelector('.gv-bp-menu')).toBeNull()
  })
})
