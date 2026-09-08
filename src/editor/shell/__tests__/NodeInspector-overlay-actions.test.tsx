import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { GameGraph, GameNodeData, Overlay } from '@/runtime/core/schema/graph-schema'
import { STAGE_FILL_LAYOUT } from '@/runtime/core/schema/layout'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import { NodeInspector } from '../NodeInspector'

afterEach(cleanup)
beforeAll(registerTestComponents)

/** 测试用界面方案（对齐旧 n_door：双事件 QTE + 铺满舞台）。 */
const TEST_SCHEME_OVERLAY: Overlay = {
  id: 'n_door',
  title: '慈悲狱门叩',
  children: [{
    id: 'kou',
    component: 'test.qte',
    trigger: { when: 'enter' },
    layout: { ...STAGE_FILL_LAYOUT },
    inputs: {
      events: [
        { id: 'pass', label: '叩中' },
        { id: 'fail', label: '错过' },
      ],
    },
  }],
}

describe('NodeInspector · 界面事件动作入口', () => {
  it('aligns component parameter labels and sizes event-effect labels to their own text', () => {
    const overlay = structuredClone(TEST_SCHEME_OVERLAY)
    overlay.children = overlay.children.map((child) => ({ ...child, component: 'test.qte' }))
    overlay.children.unshift({
      id: 'damage',
      component: 'test.float',
      inputs: { fixedText: '-', parameter: 70 },
    })
    const data: GameNodeData = {
      name: '慈悲狱门口',
      overlayNodes: [{
        overlay: overlay.id,
        reactions: [{
          when: { type: 'event', id: 'pass' },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'attr', entityId: 'hero', attr: 'hp', op: 'add', value: 70 }],
          }],
        }],
      }],
    }
    const graph: GameGraph = {
      nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
      edges: [],
    }

    const { container } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    const mountSection = container.querySelector<HTMLElement>('[data-focus-anchor="mount:n_door"]')!
    const componentLabel = within(mountSection).getByText('触发按键', { selector: 'span' })
    const fixedTextLabel = within(mountSection).getByText('固定文本', { selector: 'span' })
    const parameterLabel = within(mountSection).getByText('参数', { selector: 'span' })
    // 紧凑字段行容器：普通标量是 `.cff-field-layout`；动态数值（参数）是同款 grid 的匿名 div。
    const gridColumns = (fixedTextLabel.closest<HTMLElement>('.cff-field-layout') ?? fixedTextLabel.parentElement)?.style.gridTemplateColumns ?? ''
    const labelWidth = gridColumns.split(' ')[0]!
    expect(Number.parseFloat(labelWidth)).toBeLessThan(77)
    expect((componentLabel.closest<HTMLElement>('.cff-field-layout') ?? componentLabel.parentElement)?.style.gridTemplateColumns).toBe(gridColumns)
    expect(parameterLabel.parentElement?.style.gridTemplateColumns).toBe(gridColumns)
    expect(gridColumns).toContain('minmax(0, 320px)')

    // 动作卡片按新稿排（Figma 15635:81481）：标签不再对齐成一列，各自按文字宽排，
    // 控件占满行内剩余宽度。六个字段本身都还在。
    // 排除 .ni-select-value：那是 NiSelect 壳里显示当前选项的装饰 span（如「类型」选中「属性」），
    // 与同名字段标签撞文本；这里量的是标签本身。
    for (const label of ['类型', '实体', '属性', '操作', '数值来源', '数值']) {
      expect(within(mountSection).getByText(label, { selector: 'span:not(.ni-select-value)' })).toHaveStyle({ width: 'auto' })
    }
  })

  it('事件响应保留添加连线入口，并把走边选择收进目标节点路由', () => {
    const overlay = structuredClone(TEST_SCHEME_OVERLAY)
    const data: GameNodeData = {
      name: '慈悲狱门口',
      overlayNodes: [{ overlay: overlay.id }],
    }
    const graph: GameGraph = {
      nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
      edges: [],
    }

    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    // 两个事件各在自己的「事件响应」行上有一颗新增触发器；挂载事件不开放绑定界面，所以候选里没有它。
    const actionAdds = screen.getAllByRole('button', { name: '添加动作' })
    expect(actionAdds).toHaveLength(2)
    for (const trigger of actionAdds) {
      fireEvent.click(trigger)
      const menu = within(screen.getByRole('listbox', { name: '添加动作' }))
      expect(menu.getAllByRole('button').map((option) => option.textContent)).toEqual([
        '添加效果',
        '添加连线',
      ])
      fireEvent.keyDown(document, { key: 'Escape' })
    }
    expect(screen.queryByText('走边')).toBeNull()
    expect(screen.getByText('界面')).toBeTruthy()
    expect(screen.queryByText('覆盖物事件')).toBeNull()
    // 「添加界面」用的是通用下拉（按钮 + 浮层候选），候选要展开后才在 DOM 里。
    const overlayAdd = screen.getByTitle(/从目录追加一张 overlay 挂载/)
    expect(overlayAdd).toHaveTextContent('添加界面')
    fireEvent.click(overlayAdd)
    const overlayOption = screen.getByRole('button', { name: overlay.title })
    expect(overlayOption.textContent).toBe(overlay.title)
    expect(overlayOption.textContent).not.toContain(`(${overlay.id})`)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(/尚未挂载/)).toBeNull()
  })

  it('允许同一界面方案重复添加，并为第二份生成独立挂载 id', () => {
    const overlay = structuredClone(TEST_SCHEME_OVERLAY)
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '慈悲狱门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByTitle(/从目录追加一张 overlay 挂载/))
    fireEvent.click(screen.getByRole('button', { name: overlay.title! }))

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.overlayNodes).toEqual([
      { overlay: 'n_door' },
      { id: 'n_door__2', overlay: 'n_door', layout: { left: 0, top: 0, width: 1, height: 1 } },
    ])
  })

  it('界面配置标题只展示名称，不拼接 overlay id', () => {
    const overlay = { id: 'base:TEST_QTE', title: '叩击', children: [] }
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '慈悲狱门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }

    const { container } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={vi.fn()}
      />,
    )

    const mountCard = container.querySelector('[data-focus-anchor="mount:base:TEST_QTE"]')
    expect(mountCard).toBeTruthy()
    expect(mountCard).toHaveTextContent('叩击')
    expect(mountCard).not.toHaveTextContent('叩击 (base:TEST_QTE)')
  })

  it('only stores the field changed in a shared scheme component override', () => {
    const overlay = {
      id: 'scheme-shared',
      title: '共享提示',
      children: [{
        id: 'notice',
        component: 'test.notice',
        inputs: { text: '原始提示', color: '#ffffff', durationMs: 1600 },
      }],
    }
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: { name: '门口', overlayNodes: [{ overlay: overlay.id }] },
      }],
      edges: [],
    }
    const onChange = vi.fn()
    render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={{ [overlay.id]: overlay }}
        onChange={onChange}
      />,
    )

    const durationField = screen.getByText('总时长ms').parentElement!
    fireEvent.change(within(durationField).getByRole('spinbutton'), { target: { value: '2000' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.overlayNodes?.[0]?.overrides).toEqual({
      notice: { inputs: { durationMs: 2000 } },
    })
  })

})
