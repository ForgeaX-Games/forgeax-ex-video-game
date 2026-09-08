import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GameGraph, GameNodeData, Overlay } from '@/runtime/core/schema/graph-schema'
import type { Reaction } from '@/runtime/core/schema/node-config-schema'
import { registerComponent, unregisterComponent } from '@/runtime/core/registry/component-registry'
import { NodeInspector } from '../NodeInspector'

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
const originalScrollTo = Element.prototype.scrollTo

/**
 * 面板宿主的滚动结构：外层裁切（GraphStudio 主体，`overflow: hidden`）套内层配置列
 * （`overflow: auto`）。聚焦滚动只准动内层——外层被滚起来就是画布与工具条整体上移。
 */
function ScrollHost({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div data-testid="outer-clip" style={{ overflow: 'hidden' }}>
      <div data-testid="inspector-scroll" style={{ overflow: 'auto' }}>{children}</div>
    </div>
  )
}

/** 记录每一次 `scrollTo`（滚的是谁、滚到哪），替代不可用的 jsdom 布局。 */
function captureScrolls(): { el: Element; top?: number }[] {
  const scrolls: { el: Element; top?: number }[] = []
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: function scrollTo(this: Element, options?: ScrollToOptions) {
      scrolls.push({ el: this, top: options?.top })
    },
  })
  return scrolls
}

function lifecycle(ms: number, entityId: string): Reaction {
  return {
    when: { type: 'at', ms },
    do: [{
      kind: 'effect',
      effects: [{ kind: 'attr', entityId, attr: 'attack', op: 'add', value: 0 }],
    }],
  }
}

function graphWith(reactions: Reaction[]): GameGraph {
  const data: GameNodeData = { name: '慈悲狱门口', durationMs: 3_000, reactions }
  return {
    nodes: [{ id: 'gate', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data }],
    edges: [],
  }
}

/**
 * 新增动作的入口是「事件响应」行右侧那颗 ＋：候选浮层展开后才在 DOM 里，
 * 且被 portal 挂到 body 上，所以触发器在 `scope` 里找、候选在全局找。
 */
function openAddAction(scope?: HTMLElement): void {
  fireEvent.click(within(scope ?? document.body).getByRole('button', { name: '添加动作' }))
}

/**
 * 沿候选层级依次点过去；「绑定界面」带子层，第二级是具体的界面模板。
 * 候选一律在浮层里找：「添加连线」这类文案在节点配置里不止一处（出边分区底部也有同名入口）。
 */
function addAction(path: string | (string | RegExp)[], scope?: HTMLElement): void {
  openAddAction(scope)
  for (const label of Array.isArray(path) ? path : [path]) {
    fireEvent.click(
      within(screen.getByRole('listbox', { name: '添加动作' })).getByRole('button', { name: label }),
    )
  }
}

/** 新增结算：入口是类型选择下拉（Figma 15635:82029），先点「添加结算」再选一种触发。 */
function addSettlement(label = '时间轴结算'): void {
  fireEvent.click(screen.getByRole('button', { name: '添加结算' }))
  fireEvent.click(
    within(screen.getByRole('listbox', { name: '添加结算' })).getByRole('button', { name: label }),
  )
}

/** 读出一条事件响应行当前提供的候选（含置灰项），读完收起以免影响后续查询。 */
function addActionOptions(scope?: HTMLElement): { label: string; disabled: boolean }[] {
  openAddAction(scope)
  const options = within(screen.getByRole('listbox', { name: '添加动作' }))
    .getAllByRole('button')
    .map((option) => ({
      label: option.textContent ?? '',
      disabled: (option as HTMLButtonElement).disabled,
    }))
  fireEvent.keyDown(document, { key: 'Escape' })
  return options
}

afterEach(() => {
  cleanup()
  unregisterComponent('test-rage-float')
  unregisterComponent('test-dialogue')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: originalScrollIntoView,
  })
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: originalScrollTo,
  })
})

describe('NodeInspector · 结算选中联动', () => {
  it('选中节点被删除后显示空态且保持 hook 顺序稳定', () => {
    const graph = graphWith([])
    const { rerender } = render(<NodeInspector graph={graph} nodeId="gate" onChange={vi.fn()} />)

    expect(screen.getByTitle('节点 gate')).toBeTruthy()
    expect(() => {
      rerender(<NodeInspector graph={{ nodes: [], edges: [] }} nodeId="gate" onChange={vi.fn()} />)
    }).not.toThrow()
    expect(screen.getByText('点画布上的节点以编辑')).toBeTruthy()

    expect(() => {
      rerender(<NodeInspector graph={graph} nodeId="gate" onChange={vi.fn()} />)
    }).not.toThrow()
    expect(screen.getByTitle('节点 gate')).toBeTruthy()
  })

  it('新增结算使用宿主计算的时间轴插入时刻，没有时回落到 0ms', () => {
    const onChange = vi.fn()
    const onFocusLifecycle = vi.fn()
    const emptyGraph = graphWith([])
    const { rerender } = render(
      <NodeInspector
        graph={emptyGraph}
        nodeId="gate"
        settlementInsertMs={1_350}
        onFocusLifecycle={onFocusLifecycle}
        onChange={onChange}
      />,
    )

    addSettlement()
    let next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 1_350 })
    expect(next.nodes[0]?.data.reactions?.[0]?.do).toEqual([])
    expect(onFocusLifecycle).toHaveBeenLastCalledWith(0)

    onChange.mockClear()
    rerender(<NodeInspector graph={emptyGraph} nodeId="gate" onChange={onChange} />)
    addSettlement()
    next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 0 })
  })

  it('可配置播放到 300ms 时让实体属性减少手动设置的 50', () => {
    const entities = {
      bull: {
        id: 'bull',
        name: '牛魔王',
        attrs: { rage: 100 },
        attrMeta: { rage: { label: '怒气' } },
      },
    }
    let latest = graphWith([])
    function Harness(): JSX.Element {
      const [graph, setGraph] = useState(latest)
      latest = graph
      return (
        <NodeInspector
          graph={graph}
          nodeId="gate"
          entities={entities}
          settlementInsertMs={300}
          onChange={setGraph}
        />
      )
    }

    render(<Harness />)
    addSettlement()
    addAction('添加效果')

    expect(screen.getByTitle('本节点演出 3000ms')).toHaveValue('300')
    expect(screen.getByRole('combobox', { name: '数值来源' })).toHaveValue('const')
    fireEvent.click(screen.getByRole('button', { name: '−' }))
    fireEvent.change(screen.getByRole('textbox', { name: '数值' }), { target: { value: '50' } })

    expect(screen.getByText('属性 · 牛魔王 的 怒气')).toBeTruthy()
    expect(latest.nodes[0]?.data.reactions?.[0]).toEqual({
      when: { type: 'at', ms: 300 },
      do: [{
        kind: 'effect',
        effects: [{
          kind: 'attr',
          entityId: 'bull',
          attr: 'rage',
          op: 'add',
          value: { expr: '-(50)' },
        }],
      }],
    })
  })

  it('节点结算把目录创建能力传给效果级联选择器', () => {
    render(
      <NodeInspector
        graph={graphWith([lifecycle(300, 'hero')])}
        nodeId="gate"
        entities={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { attack: 10 },
            attrMeta: { attack: { label: '攻击力' } },
          },
        }}
        variables={{
          rage: { id: 'rage', name: '怒气', initial: 0 },
        }}
        formulas={{}}
        onCreateEntityAttribute={vi.fn()}
        onCreateEntity={vi.fn()}
        onCreateVariable={vi.fn()}
        onCreateFormula={vi.fn()}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '实体' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '效果目标的新实体 ID' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('combobox', { name: '数值来源' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '变量' }))
    expect(screen.getByRole('menuitem', { name: '怒气' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增变量' }))
    expect(screen.getByRole('textbox', { name: '新变量初始值' })).toHaveValue('')
  })

  it('结算效果类型只提供属性和变量', () => {
    render(
      <NodeInspector
        graph={graphWith([lifecycle(300, 'ent-boss')])}
        nodeId="gate"
        onChange={vi.fn()}
      />,
    )

    const typeSelect = screen.getByTitle('效果类型：属性 / 变量') as HTMLSelectElement
    expect(Array.from(typeSelect.options).map((option) => option.text)).toEqual(['属性', '变量'])
    expect(screen.queryByRole('option', { name: '道具' })).toBeNull()
  })

  it('添加连线统一选择目标节点，并在没有连线时同步建边', () => {
    const onChange = vi.fn()
    const graph = graphWith([lifecycle(1000, 'ent-boss')])
    graph.nodes.push({
      id: 'battle',
      type: 'perf',
      position: { x: 240, y: 0 },
      inputs: [],
      outputs: [],
      data: { name: '战斗节点' },
    })
    const { rerender } = render(<NodeInspector graph={graph} nodeId="gate" onChange={onChange} />)

    addAction('添加连线')
    const withAdvance = onChange.mock.calls.at(-1)?.[0] as GameGraph
    rerender(<NodeInspector graph={withAdvance} nodeId="gate" onChange={onChange} />)

    expect(screen.queryByText('走边')).toBeNull()
    expect(screen.getByText('慈悲狱门口')).toBeTruthy()
    expect(screen.queryByText('慈悲狱门口 (gate)')).toBeNull()
    const targetSelect = screen.getByRole('combobox', { name: '目标节点' }) as HTMLSelectElement
    expect([...targetSelect.options].find((option) => option.value === 'battle')?.text).toBe('战斗节点')
    expect(targetSelect.textContent).not.toContain('battle)')
    fireEvent.change(targetSelect, { target: { value: 'battle' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    const edge = next.edges.find((candidate) => candidate.source === 'gate' && candidate.target === 'battle')
    expect(edge).toBeTruthy()
    expect(edge?.sourceHandle).toMatch(/^settlement-advance:/)
    expect(next.nodes[0]?.data.reactions?.[0]?.do.at(-1)).toEqual({ kind: 'advance', edgeId: edge?.id })

    rerender(<NodeInspector graph={next} nodeId="gate" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox', { name: '跳转时机' }), { target: { value: 'complete' } })
    const deferred = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(deferred.edges.find((candidate) => candidate.id === edge?.id)?.data?.transition).toBe('onSettlement')
    expect(deferred.nodes[0]?.data.routingSettlement).toEqual({ type: 'complete' })
  })

  it('多个效果时只高亮时间轴指定的配置块，块内编辑不会取消选中', () => {
    const onFocusLifecycle = vi.fn()
    const { container } = render(
      <NodeInspector
        graph={graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])}
        nodeId="gate"
        focusedLifecycleIndex={1}
        onFocusLifecycle={onFocusLifecycle}
        onChange={vi.fn()}
      />,
    )

    const first = container.querySelector<HTMLElement>('[data-lifecycle-effect-index="0"]')
    const second = container.querySelector<HTMLElement>('[data-lifecycle-effect-index="1"]')
    expect(first).toHaveAttribute('data-selected', 'false')
    expect(second).toHaveAttribute('data-selected', 'true')
    expect(second?.style.border).toContain('#b9d79c')
    expect(second?.style.background).toBe('')
    expect(second?.style.boxShadow).toBe('')
    expect(screen.getByText('结算')).toBeTruthy()
    expect(screen.getByRole('button', { name: '添加结算' })).toBeTruthy()
    expect(screen.queryByText('生命周期效果')).toBeNull()
    expect(screen.queryByText(/演出播到指定 ms/)).toBeNull()

    fireEvent.pointerDown(second!.querySelector('input')!)
    expect(onFocusLifecycle).not.toHaveBeenCalled()
    expect(onFocusLifecycle).not.toHaveBeenCalledWith(null)

    fireEvent.click(first!)
    expect(onFocusLifecycle).toHaveBeenLastCalledWith(0)
  })

  it('右侧表单切换高亮不触发滚动定位', () => {
    const scrolls = captureScrolls()
    const graph = graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])
    const { container, rerender } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        focusedLifecycleIndex={null}
        focusAnchorRevision={1}
        onChange={vi.fn()}
      />,
    )
    scrolls.length = 0

    rerender(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        focusedLifecycleIndex={0}
        focusAnchorRevision={1}
        onChange={vi.fn()}
      />,
    )

    expect(container.querySelector('[data-settlement-index="0"]')).toHaveAttribute('data-selected', 'true')
    expect(scrolls).toEqual([])
  })

  it('组件属性折叠标题不被结算卡片的选中手势抢占', () => {
    registerComponent('test-rage-float', {
      inputs: [{ key: 'value', label: '飘字数值', valueType: 'number' }],
    })
    const onFocusLifecycle = vi.fn()
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        children: [{ id: 'value', component: 'test-rage-float', inputs: { value: 10 } }],
      },
    }
    const graph = graphWith([{
      when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'inc' },
      do: [{ kind: 'spawn', from: 'rageHud/value', ttlMs: 1200 }],
    }])
    const { container } = render(
      <NodeInspector
        graph={graph}
        nodeId="gate"
        overlays={overlays}
        onFocusLifecycle={onFocusLifecycle}
        onChange={vi.fn()}
      />,
    )
    const details = container.querySelector<HTMLDetailsElement>('[data-component-inputs-disclosure]')!
    const summary = details.querySelector('summary')!

    fireEvent.pointerDown(summary)
    fireEvent.click(summary)

    expect(onFocusLifecycle).not.toHaveBeenCalled()
    expect(details.open).toBe(true)
  })

  it('重复选择同一个结算时仍把配置块滚到配置列中央，且不动外层裁切层', () => {
    const scrolls = captureScrolls()
    const graph = graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])
    const { rerender } = render(
      <ScrollHost>
        <NodeInspector
          graph={graph}
          nodeId="gate"
          focusedLifecycleIndex={1}
          focusAnchorRevision={1}
          onChange={vi.fn()}
        />
      </ScrollHost>,
    )

    expect(scrolls.map((s) => s.el)).toEqual([screen.getByTestId('inspector-scroll')])
    scrolls.length = 0
    rerender(
      <ScrollHost>
        <NodeInspector
          graph={graph}
          nodeId="gate"
          focusedLifecycleIndex={1}
          focusAnchorRevision={2}
          onChange={vi.fn()}
        />
      </ScrollHost>,
    )
    expect(scrolls).toHaveLength(1)
    expect(scrolls.some((s) => s.el === screen.getByTestId('outer-clip'))).toBe(false)
  })

  it('选择时间轴覆盖物时滚动到对应挂载卡片，重复选择仍可重新定位', () => {
    const scrolls = captureScrolls()
    const graph: GameGraph = {
      nodes: [{
        id: 'gate',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '慈悲狱门口',
          overlayNodes: [
            { id: 'mount-a', overlay: 'hud' },
            { id: 'mount-b', overlay: 'hud' },
          ],
        },
      }],
      edges: [],
    }
    const overlays = {
      hud: { id: 'hud', children: [{ id: 'hp', component: 'test.hud' }] },
    }
    const { container, rerender } = render(
      <ScrollHost>
        <NodeInspector
          graph={graph}
          nodeId="gate"
          overlays={overlays}
          focusedMountId="mount-b"
          focusAnchorRevision={1}
          onChange={vi.fn()}
        />
      </ScrollHost>,
    )

    const focusedMount = container.querySelector<HTMLElement>('[data-focus-anchor="mount:mount-b"]')
    expect(focusedMount).toBeTruthy()
    expect(focusedMount?.style.outline).toContain('#f08840')
    expect(focusedMount?.style.background).toBe('')
    expect(scrolls.map((s) => s.el)).toEqual([screen.getByTestId('inspector-scroll')])
    scrolls.length = 0
    rerender(
      <ScrollHost>
        <NodeInspector
          graph={graph}
          nodeId="gate"
          overlays={overlays}
          focusedMountId="mount-b"
          focusAnchorRevision={2}
          onChange={vi.fn()}
        />
      </ScrollHost>,
    )
    expect(scrolls).toHaveLength(1)
    expect(scrolls.some((s) => s.el === screen.getByTestId('outer-clip'))).toBe(false)
  })

  it('删除选中项前面的效果后同步修正高亮序号', () => {
    const onFocusLifecycle = vi.fn()
    const onChange = vi.fn()
    const { container } = render(
      <NodeInspector
        graph={graphWith([lifecycle(0, 'ent-player'), lifecycle(800, 'ent-boss')])}
        nodeId="gate"
        focusedLifecycleIndex={1}
        onFocusLifecycle={onFocusLifecycle}
        onChange={onChange}
      />,
    )

    const first = container.querySelector<HTMLElement>('[data-lifecycle-effect-index="0"]')!
    const deleteButton = Array.from(first.querySelectorAll('button')).find((button) => button.textContent === '删除结算')!
    fireEvent.pointerDown(deleteButton)
    expect(onFocusLifecycle).not.toHaveBeenCalled()
    fireEvent.click(deleteButton)

    expect(onFocusLifecycle).toHaveBeenLastCalledWith(0)
    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions).toHaveLength(1)
  })

  it('统一呈现定时与数值变化结算，两者都能绑定界面', () => {
    const onChange = vi.fn()
    const { container } = render(
      <NodeInspector
        graph={graphWith([
          lifecycle(500, 'ent-player'),
          { when: { type: 'watch', of: 'entity.ent-player.attr.hp', on: 'dec' }, do: [] },
        ])}
        nodeId="gate"
        onChange={onChange}
      />,
    )

    // 类型在新增时选定，卡片标题是纯文字、不再可切换（Figma 15635:82040）。
    const triggerTitles = container.querySelectorAll<HTMLElement>('[data-settlement-trigger]')
    expect([...triggerTitles].map((title) => title.dataset.settlementTrigger)).toEqual(['at', 'condition'])
    expect([...triggerTitles].map((title) => title.textContent)).toEqual(['时间轴结算', '条件结算'])
    expect(screen.queryByTitle('触发条件')).toBeNull()
    expect(screen.getByRole('combobox', { name: '条件类型' })).toHaveValue('dec')
    expect(screen.getByRole('option', { name: '数值增加' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '数值减少' })).toBeTruthy()
    expect(screen.queryByText('响应规则')).toBeNull()
    expect(screen.getAllByRole('button', { name: '添加动作' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '+ 效果' })).toBeNull()
    const [timedSettlement, conditionSettlement] = container.querySelectorAll<HTMLElement>('[data-settlement-index]')
    // 事件响应行用胶囊概览这条结算已加的响应：定时那条有一个效果，条件那条还什么都没加。
    // 只看那一行——动作卡片的标题现在也是「添加效果」（与胶囊同一份措辞）。
    const responseRow = (settlement: HTMLElement) =>
      settlement.querySelector<HTMLElement>('.ni-st-actions-head')!
    expect(within(responseRow(timedSettlement!)).getByText('添加效果')).toBeTruthy()
    expect(within(responseRow(conditionSettlement!)).queryByText('添加效果')).toBeNull()
    // 定时结算能绑界面，但不开放「隐藏界面」——hideOverlay 命中不了 spawn 出来的界面。
    // 本用例没有任何界面模板/挂载，所以能绑的两项置灰留在列表里（原因走 tooltip），而不是消失。
    expect(addActionOptions(timedSettlement!)).toEqual([
      { label: '添加效果', disabled: false },
      { label: '添加连线', disabled: false },
      { label: '绑定界面', disabled: true },
    ])
    expect(addActionOptions(conditionSettlement!)).toEqual([
      { label: '添加效果', disabled: false },
      { label: '添加连线', disabled: false },
      { label: '绑定界面', disabled: true },
      { label: '隐藏界面', disabled: true },
    ])

    // 「添加结算」只开放时间轴 / 条件；界面出现/消失改走绑定界面动作。
    fireEvent.click(screen.getByRole('button', { name: '添加结算' }))
    expect(
      within(screen.getByRole('listbox', { name: '添加结算' }))
        .getAllByRole('button')
        .map((option) => option.textContent),
    ).toEqual(['时间轴结算', '条件结算'])
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('绑定界面的初始显示时长取自模板 window 声明的可见长度', () => {
    const onChange = vi.fn()
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气值界面',
        children: [{
          id: 'value',
          component: 'test.float',
          trigger: { when: 'enter' },
          window: { startMs: 200, endMs: 1_000 },
          inputs: { value: 0 },
        }],
      },
    }
    render(
      <NodeInspector
        graph={graphWith([lifecycle(3000, 'ent-player')])}
        nodeId="gate"
        overlays={overlays}
        onChange={onChange}
      />,
    )

    addAction(['绑定界面', /怒气值界面/])

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.do[1]).toEqual({
      kind: 'spawn',
      from: 'rageHud/value',
      ttlMs: 800,
    })
  })

  it('模板 window 不写结束时刻时仍给一个确定时长，好让它随结算点整体平移', () => {
    const onChange = vi.fn()
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气值界面',
        children: [{
          id: 'value',
          component: 'test.float',
          trigger: { when: 'enter' },
          window: { startMs: 0 },
          inputs: {},
        }],
      },
    }
    render(
      <NodeInspector
        graph={graphWith([lifecycle(3000, 'ent-player')])}
        nodeId="gate"
        overlays={overlays}
        onChange={onChange}
      />,
    )

    addAction(['绑定界面', /怒气值界面/])

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.do[1]).toEqual({
      kind: 'spawn',
      from: 'rageHud/value',
      ttlMs: 2500,
    })
  })

  it('定时结算可绑定界面，并把效果排在界面之前让飘字能读到 delta', () => {
    const onChange = vi.fn()
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气值界面',
        children: [{
          id: 'value',
          component: 'test.float',
          trigger: { when: 'enter' },
          window: { startMs: 0, endMs: 1_200 },
          inputs: { value: 0 },
        }],
      },
    }
    render(
      <NodeInspector
        graph={graphWith([lifecycle(3000, 'ent-player')])}
        nodeId="gate"
        overlays={overlays}
        onChange={onChange}
      />,
    )

    expect(addActionOptions()).toContainEqual({ label: '绑定界面', disabled: false })
    addAction(['绑定界面', /怒气值界面/])

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    const reaction = next.nodes[0]?.data.reactions?.[0]
    expect(reaction?.when).toEqual({ type: 'at', ms: 3000 })
    expect(reaction?.do.map((action) => action.kind)).toEqual(['effect', 'spawn'])
    expect(reaction?.do[1]).toEqual({ kind: 'spawn', from: 'rageHud/value', ttlMs: 1200 })
  })

  it('条件结算可从界面模板绑定界面，并带上确定的显示时长', () => {
    const onChange = vi.fn()
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气值界面',
        children: [{
          id: 'value',
          component: 'test.float',
          trigger: { when: 'enter' },
          inputs: { value: 0 },
          layout: { left: 0.5, top: 0.2 },
        }],
      },
    }
    render(
      <NodeInspector
        graph={graphWith([{ when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'change' }, do: [] }])}
        nodeId="gate"
        overlays={overlays}
        onChange={onChange}
      />,
    )

    expect(addActionOptions()).toContainEqual({ label: '绑定界面', disabled: false })
    addAction(['绑定界面', /怒气值界面/])

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.do).toEqual([{
      kind: 'spawn',
      from: 'rageHud/value',
      ttlMs: 2500,
    }])
  })

  it('条件结算绑定界面只提供常驻和按时长隐藏', () => {
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气值界面',
        children: [{ id: 'value', component: 'test.float', inputs: { value: 0 } }],
      },
    }
    let latest = graphWith([
      { when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'inc' }, do: [] },
    ])
    function Harness(): JSX.Element {
      const [graph, setGraph] = useState(latest)
      latest = graph
      return <NodeInspector graph={graph} nodeId="gate" overlays={overlays} onChange={setGraph} />
    }

    const { container } = render(<Harness />)
    const settlement = container.querySelector<HTMLElement>('[data-settlement-index="0"]')!

    addAction(['绑定界面', /怒气值界面/], settlement)
    const disappearance = screen.getByRole('combobox', { name: '消失方式' })
    expect(Array.from(disappearance.querySelectorAll('option')).map((option) => option.textContent)).toEqual(['常驻', '按时长隐藏'])
    // 绑定即带确定时长，作者要常驻得显式选。
    expect(disappearance).toHaveValue('duration')

    fireEvent.change(disappearance, { target: { value: 'persistent' } })
    expect(latest.nodes[0]?.data.reactions?.[0]?.do).toEqual([{
      kind: 'spawn',
      from: 'rageHud/value',
    }])
    expect(screen.queryByRole('spinbutton', { name: '显示时长' })).toBeNull()

    fireEvent.change(disappearance, { target: { value: 'duration' } })
    expect(latest.nodes[0]?.data.reactions?.[0]?.do).toEqual([{
      kind: 'spawn',
      from: 'rageHud/value',
      ttlMs: 2500,
    }])
  })

  it('条件结算可隐藏当前节点已经添加的整个界面', () => {
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气值界面',
        children: [{ id: 'value', component: 'test.float', inputs: { value: 0 } }],
      },
    }
    let latest = graphWith([
      { when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'dec' }, do: [] },
    ])
    latest.nodes[0]!.data.overlayNodes = [{ id: 'boss-rage-hud', overlay: 'rageHud' }]
    function Harness(): JSX.Element {
      const [graph, setGraph] = useState(latest)
      latest = graph
      return <NodeInspector graph={graph} nodeId="gate" overlays={overlays} onChange={setGraph} />
    }

    const { container } = render(<Harness />)
    const settlement = container.querySelector<HTMLElement>('[data-settlement-index="0"]')!
    expect(addActionOptions(settlement)).toContainEqual({ label: '隐藏界面', disabled: false })
    addAction('隐藏界面', settlement)

    expect(latest.nodes[0]?.data.reactions?.[0]?.do).toEqual([{
      kind: 'hideOverlay',
      mountId: 'boss-rage-hud',
    }])
    expect(screen.getByRole('combobox', { name: '目标界面' })).toHaveDisplayValue('怒气值界面')
  })

  it('条件结算可重复添加界面，并用与节点界面相同的折叠组件属性卡片逐项配置和移除', () => {
    registerComponent('test-rage-float', {
      inputs: [{ key: 'value', label: '飘字数值', valueType: 'number' }],
    })
    registerComponent('test-dialogue', {
      inputs: [
        { key: 'speaker', label: '说话人', valueType: 'string' },
        { key: 'text', label: '台词', valueType: 'string' },
      ],
    })
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气飘字',
        children: [{ id: 'value', component: 'test-rage-float', inputs: { value: -25 } }],
      },
      dialogue: {
        id: 'dialogue',
        title: '字幕对白',
        children: [{ id: 'line', component: 'test-dialogue', inputs: { text: '……' } }],
      },
    }
    let latest = graphWith([{
      when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'inc' },
      do: [],
    }])
    function Harness(): JSX.Element {
      const [graph, setGraph] = useState(latest)
      latest = graph
      return <NodeInspector graph={graph} nodeId="gate" overlays={overlays} onChange={setGraph} />
    }

    const { container } = render(<Harness />)
    // 候选带子层，一次手势就选定模板；两条绑定各自指向自己的界面，不用落好再回卡片里改。
    addAction(['绑定界面', /怒气飘字/])
    addAction(['绑定界面', /字幕对白/])
    const spawnCards = container.querySelectorAll<HTMLElement>('[data-action-kind="spawn"]')

    expect(latest.nodes[0]?.data.reactions?.[0]?.do).toEqual([
      { kind: 'spawn', from: 'rageHud/value', ttlMs: 2500 },
      { kind: 'spawn', from: 'dialogue/line', ttlMs: 2500 },
    ])
    const componentCards = container.querySelectorAll<HTMLDetailsElement>('[data-component-inputs-disclosure]')
    expect(spawnCards).toHaveLength(2)
    expect(componentCards).toHaveLength(2)
    expect(componentCards[0]?.open).toBe(false)
    fireEvent.click(componentCards[0]!.querySelector('summary')!)
    expect(componentCards[0]?.open).toBe(true)
    expect(spawnCards[0]).toHaveTextContent('飘字数值')
    expect(spawnCards[1]).toHaveTextContent('说话人')
    expect(spawnCards[1]).toHaveTextContent('台词')
    fireEvent.change(componentCards[0]!.querySelector('input')!, { target: { value: '80' } })
    expect(latest.nodes[0]?.data.reactions?.[0]?.do[0]).toEqual({
      kind: 'spawn',
      from: 'rageHud/value',
      ttlMs: 2500,
      inputs: { value: 80 },
    })

    // 「解除绑定」现在是卡片头那枚垃圾桶图标；文案仍是它的无障碍名。
    fireEvent.click(within(spawnCards[0]!).getByRole('button', { name: '解除绑定' }))
    expect(latest.nodes[0]?.data.reactions?.[0]?.do).toEqual([
      { kind: 'spawn', from: 'dialogue/line', ttlMs: 2500 },
    ])
    expect(container.querySelectorAll('[data-action-kind="spawn"]')).toHaveLength(1)
  })

  it('条件结算切换界面时改用新界面的配置项并清除旧模板覆盖', () => {
    registerComponent('test-rage-float', {
      inputs: [{ key: 'value', label: '飘字数值', valueType: 'number' }],
    })
    registerComponent('test-dialogue', {
      inputs: [
        { key: 'speaker', label: '说话人', valueType: 'string' },
        { key: 'text', label: '台词', valueType: 'string' },
      ],
    })
    const overlays: Record<string, Overlay> = {
      rageHud: {
        id: 'rageHud',
        title: '怒气飘字',
        children: [{ id: 'value', component: 'test-rage-float', inputs: { value: -25 } }],
      },
      dialogue: {
        id: 'dialogue',
        title: '字幕对白',
        children: [{ id: 'line', component: 'test-dialogue', inputs: { text: '……' } }],
      },
    }
    let latest = graphWith([{
      when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'inc' },
      do: [{
        kind: 'spawn',
        from: 'rageHud/value',
        ttlMs: 1200,
        inputs: { value: { expr: 'delta' }, legacyParam: '旧参数' },
        layout: { left: 0.2, top: 0.3, width: 0.4, height: 0.2 },
      }],
    }])
    function Harness(): JSX.Element {
      const [graph, setGraph] = useState(latest)
      latest = graph
      return <NodeInspector graph={graph} nodeId="gate" overlays={overlays} onChange={setGraph} />
    }

    const { container } = render(<Harness />)
    const settlement = container.querySelector<HTMLElement>('[data-settlement-index="0"]')!
    const templateSelect = Array.from(settlement.querySelectorAll('select'))
      .find((select) => select.value === 'rageHud/value')!

    expect(settlement.textContent).toContain('飘字数值')
    expect(settlement.textContent).not.toContain('说话人')
    fireEvent.change(templateSelect, { target: { value: 'dialogue/line' } })

    expect(settlement.textContent).toContain('说话人')
    expect(settlement.textContent).toContain('台词')
    expect(settlement.textContent).not.toContain('legacyParam')
    expect(latest.nodes[0]?.data.reactions?.[0]?.do[0]).toEqual({
      kind: 'spawn',
      from: 'dialogue/line',
      ttlMs: 1200,
    })

    fireEvent.click(Array.from(settlement.querySelectorAll('button')).find((button) => button.textContent === '删除结算')!)
    expect(latest.nodes[0]?.data.reactions).toBeUndefined()
    expect(screen.getByText('无结算')).toBeTruthy()
  })

  it('条件结算复用出边 ConditionEditor，并支持完整比较运算符', () => {
    const onChange = vi.fn()
    const entities = {
      'ent-player': { id: 'ent-player', name: '玩家', attrs: { hp: 100 }, attrMeta: { hp: { label: '生命值', max: 100 } } },
    }
    const initial = graphWith([
      {
        when: { type: 'state', condition: { all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'eq', value: 50 }] } },
        do: [],
      },
    ])
    render(
      <NodeInspector graph={initial} nodeId="gate" entities={entities} onChange={onChange} />,
    )

    expect(screen.getByText('条件结算')).toHaveAttribute('data-settlement-trigger', 'condition')
    expect(screen.getByRole('combobox', { name: '条件类型' })).toHaveValue('state')
    expect(screen.getByRole('combobox', { name: '比较运算符' })).toHaveValue('eq')
    expect(screen.getByRole('textbox', { name: '比较值' })).toHaveValue('50')
    expect(['gte', 'lte', 'gt', 'lt', 'eq', 'neq']).toEqual(
      Array.from((screen.getByRole('combobox', { name: '比较运算符' }) as HTMLSelectElement).options).map((option) => option.value),
    )

    fireEvent.change(screen.getByRole('combobox', { name: '比较运算符' }), { target: { value: 'neq' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    expect(next.nodes[0]?.data.reactions?.[0]?.when).toEqual({
      type: 'state',
      condition: { all: [{ type: 'attr', entityId: 'ent-player', attr: 'hp', op: 'neq', value: 50 }] },
    })
  })
})
