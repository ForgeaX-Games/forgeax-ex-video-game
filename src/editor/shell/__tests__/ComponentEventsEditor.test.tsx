// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import { registerComponent, unregisterComponent } from '@/runtime/core/registry/component-registry'
import type { Entity, GameGraph, OverlayEventRef, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { ComponentEventsEditor } from '../ComponentEventsEditor'
import { ComponentInputsDisclosure } from '../ComponentInputsDisclosure'
import { ComponentFormFields } from '../component-form-fields'
import {
  ensureEntity,
  ensureEntityAttribute,
  ensureFormula,
  ensureVariable,
} from '@/authoring/formulas/meta-catalog'
import { NodeInspector } from '../NodeInspector'
import { OverlaySchemeEditor } from '../OverlaySchemeEditor'

registerTestComponents()
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const event: OverlayEventRef = {
  eventId: 'pass',
  mountId: 'hud',
  childId: 'q',
  localEventId: 'pass',
  label: '成功',
  componentId: 'qte',
}

function chooseCascade(trigger: HTMLElement, ...labels: string[]): void {
  fireEvent.click(trigger)
  for (const label of labels) {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  }
}

describe('ComponentInputsDisclosure summary', () => {
  it('summarizes an opaque fixture label without catalog-specific rules', () => {
    render(
      <ComponentInputsDisclosure
        childId="test.hud-0"
        componentId="test.hud"
        values={{ label: { ref: 'entity.hero.name' } }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('label=[object Object]')).toBeTruthy()
  })
})

describe('ComponentEventsEditor', () => {
  it('catalog mode writes stable keys and never offers advance', () => {
    const onCatalogChange = vi.fn()
    render(
      <ComponentEventsEditor
        mode="catalog"
        events={[event]}
        spawnOptions={[]}
        onCatalogChange={onCatalogChange}
      />,
    )
    expect(screen.queryByText('q:pass')).toBeNull()
    expect(screen.queryByText('目录动作（所有挂载继承）')).toBeNull()
    // 动作类型收在通用下拉里，展开后才能断言「目录模式不提供添加连线」。
    fireEvent.click(screen.getByRole('button', { name: '添加动作' }))
    expect(screen.queryByRole('button', { name: /添加连线/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /效果/ }))
    expect(onCatalogChange).toHaveBeenCalledWith([
      expect.objectContaining({ when: { type: 'event', id: 'q:pass' } }),
    ])
  })

  it('mount mode edits additions without showing catalog or mount action labels', () => {
    render(
      <ComponentEventsEditor
        mode="mount"
        events={[event]}
        catalogReactions={[{
          when: { type: 'event', id: 'q:pass' },
          do: [{ kind: 'effect', effects: [] }],
        }]}
        spawnOptions={[]}
        onMountActionsChange={vi.fn()}
      />,
    )
    expect(screen.queryByText(/目录继承动作/)).toBeNull()
    expect(screen.queryByText(/挂载追加动作/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加动作' }))
    expect(screen.getByRole('button', { name: /添加连线/ })).toBeTruthy()
  })

  it('renders one advance action with custom route controls and preserves it when side effects change', () => {
    const onMountActionsChange = vi.fn()
    const { container } = render(
      <ComponentEventsEditor
        mode="mount"
        events={[event]}
        mountReactions={[{
          when: { type: 'event', id: 'pass' },
          do: [{ kind: 'advance', edgeId: 'edge-1' }],
        }]}
        spawnOptions={[]}
        renderRoute={() => <div>从事件节点到目标节点</div>}
        onMountActionsChange={onMountActionsChange}
      />,
    )

    // 事件响应行用胶囊概览这条事件已加的响应；卡片标题仍在行下面。
    const responseRow = container.querySelector<HTMLElement>('.ni-ov-event-row')!
    const advanceCard = container.querySelector<HTMLElement>('[data-action-kind="advance"]')!
    expect(within(responseRow).getByText('添加连线')).toBeTruthy()
    expect(within(advanceCard).getByText('添加连线')).toBeTruthy()
    expect(screen.getByText('从事件节点到目标节点')).toBeTruthy()
    expect(screen.queryByText('走边')).toBeNull()
    // 已经有一条推进，候选里就不该再出现它。
    fireEvent.click(screen.getByRole('button', { name: '添加动作' }))
    expect(screen.queryByRole('button', { name: /添加连线/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '添加效果' }))
    expect(onMountActionsChange).toHaveBeenCalledWith(event, [
      { kind: 'advance', edgeId: 'edge-1' },
      expect.objectContaining({ kind: 'effect' }),
    ])
  })

  it('enables applying formulas inside catalog event effects when the formula library is provided', () => {
    const formula: Formula = {
      id: 'formula-damage',
      name: '伤害',
      ast: { t: 'num', id: 'n0', v: 12 },
    }
    render(
      <ComponentEventsEditor
        mode="catalog"
        events={[event]}
        catalogReactions={[{
          when: { type: 'event', id: 'q:pass' },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'var', varId: '', op: 'set', value: 0 }],
          }],
        }]}
        spawnOptions={[]}
        pickers={{ formulas: { 'formula-damage': formula } }}
        onCatalogChange={vi.fn()}
      />,
    )

    const content = screen.getByRole('combobox', { name: '数值来源' })
    fireEvent.click(content)
    fireEvent.click(screen.getByRole('menuitem', { name: '公式' }))
    expect(screen.getByRole('menuitem', { name: '伤害' })).toBeTruthy()
  })
})

describe('NodeInspector overlay events', () => {
  it('creates and selects variables and formulas from mounted component inputs', () => {
    const initialGraph: GameGraph = {
      nodes: [{
        id: 'n1',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '飘字节点',
          overlayNodes: [{ overlay: 'hud' }],
        },
      }],
      edges: [],
    }
    let latestGraph = initialGraph
    let latestVariables: Record<string, Variable> = {}
    let latestFormulas: Record<string, Formula> = {}
    function Harness(): JSX.Element {
      const [graph, setGraph] = useState(initialGraph)
      const [variables, setVariables] = useState<Record<string, Variable>>({})
      const [formulas, setFormulas] = useState<Record<string, Formula>>({})
      latestGraph = graph
      latestVariables = variables
      latestFormulas = formulas
      return (
        <NodeInspector
          graph={graph}
          nodeId="n1"
          overlays={{
            hud: {
              id: 'hud',
              children: [{
                id: 'gain',
                component: 'test.float',
                inputs: { parameter: '+50' },
              }],
            },
          }}
          variables={variables}
          formulas={formulas}
          onCreateVariable={(request) => {
            setVariables((current) => ensureVariable(current, request))
          }}
          onCreateFormula={(request) => {
            setFormulas((current) => ensureFormula(current, request))
          }}
          onChange={setGraph}
        />
      )
    }
    const { container } = render(<Harness />)
    const disclosure = container.querySelector('details[data-component-inputs-disclosure]')!
    fireEvent.click(disclosure.querySelector('summary')!)

    chooseCascade(
      screen.getByRole('combobox', { name: '文本内容' }),
      '变量',
      '新增变量',
    )
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: '新变量初始值' }), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(latestVariables.var0).toEqual({ id: 'var0', name: 'var0', initial: '0' })
    expect(latestGraph.nodes[0]?.data.overlayNodes?.[0]?.overrides?.gain?.inputs?.parameter).toEqual({
      ref: 'var.var0',
    })

    chooseCascade(
      screen.getByRole('combobox', { name: '文本内容' }),
      '公式',
      '新增公式',
    )
    fireEvent.change(screen.getByRole('textbox', { name: '新公式内容' }), {
      target: { value: '3 * 4' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(latestFormulas['formula0']).toMatchObject({
      id: 'formula0',
      ast: { t: 'bin', id: 'n0', op: '*' },
    })
    expect(latestGraph.nodes[0]?.data.overlayNodes?.[0]?.overrides?.gain?.inputs?.parameter).toMatchObject({
      expr: '3 * 4',
      pick: { mode: 'formula', formulaId: 'formula0', holeBindings: {} },
    })
  })

  it('omits the event response area when the mounted overlay exports no events', () => {
    const graph: GameGraph = {
      nodes: [{
        id: 'n1',
        type: 'perf',
        position: { x: 0, y: 0 },
        inputs: [],
        outputs: [],
        data: {
          name: '无事件节点',
          overlayNodes: [{ overlay: 'hud' }],
        },
      }],
      edges: [],
    }
    render(
      <NodeInspector
        graph={graph}
        nodeId="n1"
        overlays={{
          hud: {
            id: 'hud',
            children: [{ id: 'damage', component: 'test.float', inputs: {} }],
          },
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByText('事件响应')).toBeNull()
    expect(screen.queryByText(/无导出事件/)).toBeNull()
    expect(screen.queryByText('位置')).toBeNull()
    expect(screen.queryByText('继承方案')).toBeNull()
    expect(screen.queryByText(/细调/)).toBeNull()
  })

  it('rewrites mount reaction aliases to one local event key when routing changes', () => {
    const onChange = vi.fn()
    const graph: GameGraph = {
      nodes: [
        {
          id: 'n1',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: {
            name: '事件节点',
            overlayNodes: [{
              overlay: 'hud',
              reactions: [
                { when: { type: 'event', id: 'q:pass' }, do: [{ kind: 'effect', effects: [] }] },
                { when: { type: 'event', id: 'hud:q:pass' }, do: [{ kind: 'advance', edgeId: 'stale' }] },
              ],
            }],
          },
        },
        {
          id: 'n2',
          type: 'perf',
          position: { x: 100, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: '目标节点' },
        },
      ],
      edges: [],
    }

    render(
      <NodeInspector
        graph={graph}
        nodeId="n1"
        overlays={{
          hud: {
            id: 'hud',
            children: [{
              id: 'q',
              component: 'qte',
              inputs: { events: [{ id: 'pass', label: '成功' }] },
            }],
          },
        }}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('目标节点'), { target: { value: 'n2' } })

    const next = onChange.mock.calls.at(-1)?.[0] as GameGraph
    const reactions = next.nodes[0]?.data.overlayNodes?.[0]?.reactions ?? []
    const eventReactions = reactions.filter((reaction) => reaction.when.type === 'event')
    expect(eventReactions).toHaveLength(1)
    expect(eventReactions[0]?.when).toEqual({ type: 'event', id: 'pass' })
    expect(eventReactions[0]?.do.map((action) => action.kind)).toEqual(['effect', 'advance'])
  })
})

describe('OverlaySchemeEditor selected child', () => {
  it('separates the canvas workspace, bottom tabs, and component property panel', () => {
    const onRemoveChild = vi.fn()
    render(
      <OverlaySchemeEditor
        overlayId="hud"
        overlay={{
          id: 'hud',
          children: [
            { id: 'damage', component: 'test.float', inputs: { parameter: '-25' } },
            { id: 'gain', component: 'test.float', inputs: { parameter: '+50' } },
          ],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={onRemoveChild}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('overlay-scheme-workspace')).toBeTruthy()
    expect(screen.getByTestId('component-property-panel')).toBeTruthy()
    expect(screen.getByRole('tab', { name: '图层' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('overlay-layers')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /测试飘字 · damage/ }))
    expect(screen.getByRole('heading', { name: '文本信息' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '删除控件' }))
    expect(onRemoveChild).toHaveBeenCalledWith('damage')
  })

  it('does not render scheme management inside the canvas', () => {
    render(
      <OverlaySchemeEditor
        overlayId="scheme-9"
        overlay={{ id: 'scheme-9', title: '第1个新方案', children: [] }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    expect(screen.queryByDisplayValue('第1个新方案')).toBeNull()
    expect(screen.queryByText('scheme-9')).toBeNull()
  })

  it('leaves custom scheme deletion to the global navigation', () => {
    const onRemove = vi.fn()
    render(
      <OverlaySchemeEditor
        overlayId="custom-hud"
        overlay={{ id: 'custom-hud', title: '战斗界面', children: [] }}
        entities={{}}
        variables={{}}
        usageCount={2}
        onRename={vi.fn()}
        onRemove={onRemove}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('defaults overlapping components to the visually topmost child', async () => {
    const { container } = render(
      <OverlaySchemeEditor
        overlayId="double-subtitle"
        overlay={{
          id: 'double-subtitle',
          children: [
            { id: 'subtitle-a', component: 'test.dialogue', inputs: { text: 'A' } },
            { id: 'subtitle-b', component: 'test.dialogue', inputs: { text: 'B' } },
          ],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-canvas-item="subtitle-b"]')?.classList.contains('is-selected')).toBe(true)
    })
    expect(container.querySelector('[data-canvas-item="subtitle-a"]')?.classList.contains('is-selected')).toBe(false)
  })

  it('uses a full editor viewport backed by full-stage logical coordinates', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 50,
          y: 60,
          left: 50,
          top: 60,
          right: 150,
          bottom: 90,
          width: 100,
          height: 30,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    render(
      <OverlaySchemeEditor
        overlayId="double-subtitle"
        overlay={{
          id: 'double-subtitle',
          children: [{
            id: 'subtitle-a',
            component: 'test.dialogue',
            inputs: { text: 'A' },
            layout: { left: 0, top: 0, width: 1, height: 1 },
          }],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    await waitFor(() => expect(document.querySelector('[data-overlay-design-canvas]')).toBeTruthy())
    expect(document.querySelector('[data-overlay-bounds-readout]')).toBeNull()
    expect(screen.queryByRole('button', { name: /调整dialogue大小/ })).toBeNull()
    expect(document.querySelectorAll('[data-overflow-child]')).toHaveLength(0)
    expect((document.querySelector('[data-overlay-content-clip]') as HTMLElement).style.clipPath).toContain('inset(')
    expect(document.querySelector('[data-overlay-design-canvas]')).toHaveStyle({
      left: '0%', top: '0%', width: '100%', height: '100%',
    })
    expect(document.querySelector('[data-overlay-coordinate-stage]')).toHaveStyle({
      left: '0%', top: '0%', width: '100%', height: '100%',
    })
    expect(screen.queryByRole('button', { name: /调整覆盖物画布大小/ })).toBeNull()
  })

  it('defaults to the first child and immediately shows parameters and events below the canvas', () => {
    render(
      <OverlaySchemeEditor
        overlayId="hud"
        overlay={{
          id: 'hud',
          children: [{
            id: 'q',
            component: 'qte',
            inputs: { events: [{ id: 'pass', label: '成功' }], timeoutMs: 800 },
          }],
        }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overlay-selected-child-editor')).toBeTruthy()
    expect(screen.getByText(/^参数 ·/)).toBeTruthy()
    expect(screen.getByText('事件')).toBeTruthy()
    expect(screen.queryByText('q:pass')).toBeNull()
    expect(screen.queryByRole('button', { name: /调整qte大小/ })).toBeNull()
  })

  it('keeps base structure locked while allowing catalog event actions', () => {
    const onReactionsChange = vi.fn()
    const { container } = render(
      <OverlaySchemeEditor
        overlayId="base:TEST_CHOICE"
        overlay={{ id: 'base:TEST_CHOICE', children: [{ id: 'choice', component: 'test.choice', inputs: {} }] }}
        entities={{}}
        variables={{}}
        usageCount={0}
        locked
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={onReactionsChange}
      />,
    )
    expect(container.querySelector('[data-overlay-design-canvas]')).toBeNull()
    expect(container.querySelector('[data-overlay-centered-child="choice"]')).toBeTruthy()
    expect(screen.queryByText('虚拟画布尺寸')).toBeNull()
    expect(screen.queryByLabelText('界面方案画布')).toBeNull()
    expect(screen.getByLabelText('控件边界')).toBeTruthy()
    expect(container.querySelector('[data-canvas-item="choice"]')).toHaveClass('is-selected')
    expect(screen.getByTestId('overlay-event-editor')).not.toHaveAttribute('disabled')
    expect(screen.queryByText('choice:ying')).toBeNull()
    const effectButtons = screen.getAllByRole('button', { name: '添加效果' })
    const spawnButtons = screen.getAllByRole('button', { name: '添加界面' })
    expect(effectButtons[0]).not.toBeDisabled()
    expect(spawnButtons[0]).not.toBeDisabled()
    fireEvent.click(effectButtons[0]!)
    expect(onReactionsChange).toHaveBeenCalled()
    fireEvent.click(spawnButtons[0]!)
    expect(onReactionsChange).toHaveBeenCalledTimes(2)
  })

  it('does not render an event section for a component without exported events', () => {
    render(
      <OverlaySchemeEditor
        overlayId="float"
        overlay={{ id: 'float', children: [{ id: 'damage', component: 'test.float', inputs: { parameter: '-25' } }] }}
        entities={{}}
        variables={{}}
        usageCount={0}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        onPromptChange={vi.fn()}
        onAddChild={vi.fn()}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('overlay-selected-child-editor')).toBeTruthy()
    expect(screen.queryByText('事件')).toBeNull()
  })
})

describe('ComponentFormFields defaults', () => {
  it.each([
    [
      'test.notice',
      { fixedText: '获得道具', parameter: '〈xxx〉', color: '#f0f0f0', fontSize: 2.4, durationMs: 1600 },
      ['固定文本', '参数', '字色', '字号', '总时长ms'],
    ],
    [
      'test.float',
      { fixedText: '', parameter: '-25', color: '#ff5a5a', fontSize: 3.5, durationMs: 1100 },
      ['固定文本', '参数', '字色', '字号', '总时长ms'],
    ],
    [
      'test.float',
      { fixedText: '', parameter: '+50', color: '#ffd54a', fontSize: 3.5, durationMs: 1100 },
      ['固定文本', '参数', '字色', '字号', '总时长ms'],
    ],
  ])('gives %s compact parameters one full-width row with readable labels', (componentId, values, labels) => {
    render(
      <ComponentFormFields
        componentId={componentId}
        values={values}
        density="compact"
        labelWidth="7em"
        onChange={() => undefined}
      />,
    )

    for (const label of labels) {
      const row = screen.getByText(label).parentElement!
      expect(row.style.display).toBe('grid')
      expect(row.style.width).toBe('100%')
      expect(row.style.gridTemplateColumns).toBe(
        label === '参数' ? '7em minmax(0, 1fr)' : '7em minmax(0, 320px)',
      )
    }

    for (const input of screen.queryAllByRole('spinbutton')) {
      expect(input).toHaveStyle({ width: '100%' })
    }

    const parameterRow = screen.getByText('参数').parentElement!
    const picker = within(parameterRow).getByRole('combobox', { name: '文本内容' })
    const controlRow = picker.parentElement?.parentElement as HTMLElement
    const literalInput = within(parameterRow).getByRole('textbox', { name: '固定文本' })
    expect(controlRow).toHaveStyle({ flexDirection: 'column', alignItems: 'stretch' })
    expect(picker.parentElement).toHaveClass('is-narrow-safe')
    expect(literalInput).toHaveStyle({ width: '100%', minWidth: '0' })
  })

  it('lets fixed text span the full property-panel row', () => {
    render(
      <ComponentFormFields
        componentId="test.notice"
        values={{ fixedText: '获得道具' }}
        density="property"
        onChange={() => undefined}
      />,
    )

    const field = screen.getByText('固定文本', { selector: 'span' }).closest('.cff-property-field')
    expect(field).toHaveClass('is-full-width')
    expect(field).toHaveStyle({ gridColumn: '1 / -1' })
  })

  it('stacks formula selection above its parameter bindings in compact component fields', () => {
    const formula: Formula = {
      id: 'formula-layout',
      name: '伤害公式',
      ast: {
        t: 'hole',
        id: 'coefficient',
        holeId: 'coefficient',
        kind: 'number',
        label: '系数',
      },
    }
    render(
      <ComponentFormFields
        componentId="test.float"
        values={{
          parameter: {
            expr: '0',
            pick: {
              mode: 'formula',
              formulaId: formula.id,
              holeBindings: {},
            },
          },
        }}
        pickers={{ formulas: { [formula.id]: formula } }}
        density="compact"
        labelWidth="7em"
        onChange={() => undefined}
      />,
    )

    const valueRow = screen.getByText('参数').parentElement!
    const picker = within(valueRow).getByRole('combobox', { name: '文本内容' })
    const valueEditor = picker.parentElement?.parentElement?.parentElement as HTMLElement

    expect(valueRow.style.alignItems).toBe('start')
    expect(screen.getByText('参数')).toHaveStyle({ paddingTop: '6px' })
    expect(valueEditor.style.flexDirection).toBe('column')
    expect(valueEditor.style.width).toBe('100%')
    expect(within(valueRow).getByRole('group', { name: '参数：系数' })).toBeTruthy()
  })

  it('forwards formula attribute creation from TEST_FLOAT into the binding editor', () => {
    const formula: Formula = {
      id: 'formula-hp-max',
      name: '生命上限公式',
      ast: {
        t: 'hole',
        id: 'max-hp',
        holeId: 'maxHp',
        kind: 'entityAttr',
        label: '生命上限',
        suggestAttr: 'hpMax',
      },
    }
    render(
      <ComponentFormFields
        componentId="test.float"
        values={{
          parameter: {
            expr: '0',
            pick: {
              mode: 'formula',
              formulaId: formula.id,
              holeBindings: {
                maxHp: { kind: 'entityAttr', entityId: 'ent-0', attr: 'hpMax' },
              },
            },
          },
        }}
        pickers={{
          formulas: { [formula.id]: formula },
          entities: {
            'ent-0': { id: 'ent-0', name: '我方', attrs: { hp: 80 } },
          },
        }}
        density="compact"
        onCreateEntityAttribute={vi.fn()}
        onChange={() => undefined}
      />,
    )

    expect(screen.queryByText(/参数绑定未完成/)).toBeNull()
    chooseCascade(
      screen.getByRole('combobox', { name: '生命上限来源' }),
      '实体属性',
      '我方',
      '新增属性',
    )
    expect(screen.queryByRole('textbox', { name: '我方的新属性 ID' })).toBeNull()
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
  })

  it('never offers an unset/default option for interface enum settings', () => {
    registerComponent('test-enum-input', {
      inputs: [
        {
          key: 'mode',
          label: '模式',
          valueType: 'string',
          default: 'second',
          options: [
            { value: 'first', label: '第一项' },
            { value: 'second', label: '第二项' },
          ],
        },
        {
          key: 'alignment',
          label: '对齐',
          valueType: 'string',
          options: [
            { value: 'left', label: '左侧' },
            { value: 'right', label: '右侧' },
          ],
        },
      ],
    })

    render(
      <ComponentFormFields
        componentId="test-enum-input"
        values={{}}
        onChange={() => undefined}
      />,
    )

    const mode = screen.getByRole('combobox', { name: '模式' })
    const alignment = screen.getByRole('combobox', { name: '对齐' })
    expect(mode).toHaveValue('second')
    expect(alignment).toHaveValue('left')
    expect(within(mode).queryByRole('option', { name: /默认|未选|未设置/ })).toBeNull()
    expect(within(alignment).queryByRole('option', { name: /默认|未选|未设置/ })).toBeNull()
    expect(within(mode).getAllByRole('option')).toHaveLength(2)
    expect(within(alignment).getAllByRole('option')).toHaveLength(2)

    unregisterComponent('test-enum-input')
  })

  it('shows declared defaults as placeholders and preserves explicitly empty text', () => {
    registerComponent('test-default-input', {
      inputs: [
        { key: 'text', label: '文本', valueType: 'string', default: '默认文本' },
        { key: 'count', label: '数量', valueType: 'number', default: 3 },
      ],
    })
    const onChange = vi.fn()
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({ text: '原文本' })
      return (
        <ComponentFormFields
          componentId="test-default-input"
          values={values}
          onChange={(next) => {
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)
    const input = screen.getByDisplayValue('原文本')
    expect(input.getAttribute('placeholder')).toBe('默认文本')
    expect(screen.getByPlaceholderText('3')).toBeTruthy()

    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenNthCalledWith(1, { text: '' })

    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    unregisterComponent('test-default-input')
  })

  it('fills a declared numeric default only after an emptied input loses focus', () => {
    registerComponent('test-number-default-input', {
      inputs: [{ key: 'hp', label: '血量', valueType: 'number', default: 60 }],
    })
    const onChange = vi.fn()
    function Harness(): JSX.Element {
      const [values, setValues] = useState<Record<string, unknown>>({ hp: 60 })
      return (
        <ComponentFormFields
          componentId="test-number-default-input"
          values={values}
          onChange={(next) => {
            setValues(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    const input = screen.getByDisplayValue('60')
    fireEvent.change(input, { target: { value: '' } })

    expect(input).toHaveValue(null)
    expect(onChange).toHaveBeenNthCalledWith(1, {})

    fireEvent.blur(input)

    expect(input).toHaveValue(60)
    expect(onChange).toHaveBeenNthCalledWith(2, { hp: 60 })
    unregisterComponent('test-number-default-input')
  })

  it('edits damage float text parameter as either a constant or an applied formula', () => {
    const formula: Formula = {
      id: 'formula-float-damage',
      name: '飘字伤害',
      ast: { t: 'num', id: 'n0', v: -12 },
    }
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="test.float"
        values={{ parameter: '-25' }}
        pickers={{ formulas: { [formula.id]: formula } }}
        onChange={onChange}
      />,
    )

    expect(within(screen.getByText('参数').parentElement!)
      .getByRole('textbox', { name: '固定文本' })).toHaveValue('-25')
    chooseCascade(screen.getByRole('combobox', { name: '文本内容' }), '公式', '飘字伤害')
    expect(onChange).toHaveBeenCalledWith({
      parameter: {
        expr: '-12',
        pick: {
          mode: 'formula',
          formulaId: formula.id,
          holeBindings: {},
        },
      },
    })
  })

  it('uses a blank parameter without offering an unset option', () => {
    const formula: Formula = {
      id: 'formula-float-damage',
      name: '飘字伤害',
      ast: { t: 'num', id: 'n0', v: -12 },
    }
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="test.float"
        values={{}}
        pickers={{ formulas: { [formula.id]: formula } }}
        onChange={onChange}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveValue('literal')
    expect(within(screen.getByText('参数').parentElement!)
      .getByRole('textbox', { name: '固定文本' })).toHaveValue('')
    fireEvent.click(picker)
    expect(screen.queryByRole('menuitem', { name: '未设置（使用组件默认）' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '公式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '飘字伤害' }))
    expect(onChange).toHaveBeenLastCalledWith({
      parameter: {
        expr: '-12',
        pick: {
          mode: 'formula',
          formulaId: formula.id,
          holeBindings: {},
        },
      },
    })
  })

  it('shows inferred state content without rewriting the stored expression', () => {
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="test.float"
        values={{ parameter: { ref: 'entity.hero.attr.hp' } }}
        pickers={{
          entities: {
            hero: { id: 'hero', name: '主角', attrs: { hp: 80, attack: 12 } },
          },
          variables: {
            qi: { id: 'qi', name: '气力', initial: 2 },
          },
        }}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('combobox', { name: '文本内容' })).toHaveValue('entity-attr:hero:hp')
    expect(screen.queryByText(/常量：10 · 状态：entity\.hero\.attr\.hp \/ var\.qi/)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('uses dynamic text pickers for subtitle speaker and dialogue text', () => {
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="test.dialogue"
        values={{}}
        pickers={{
          entities: {
            hero: { id: 'hero', name: '空藏', attrs: { hp: 80 } },
          },
          variables: {
            qi: { id: 'qi', name: '气力', initial: 3 },
          },
        }}
        onChange={onChange}
      />,
    )

    const pickers = screen.getAllByRole('combobox', { name: '文本内容' })
    expect(pickers).toHaveLength(2)
    fireEvent.click(pickers[0]!)
    expect(screen.queryByRole('menuitem', { name: '变量' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '实体' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '空藏' }))
    expect(screen.queryByRole('menuitem', { name: 'hp' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '名称' }))
    expect(onChange).toHaveBeenCalledWith({
      speaker: { ref: 'entity.hero.name' },
    })
    chooseCascade(pickers[1]!, '变量', '气力')
    expect(onChange).toHaveBeenCalledWith({
      text: { ref: 'var.qi' },
    })
  })

  it('uses a dynamic text picker for interaction copy but not its trigger key', () => {
    const onChange = vi.fn()
    render(
      <ComponentFormFields
        componentId="test.text"
        values={{}}
        pickers={{
          variables: {
            qi: { id: 'qi', name: '气力', initial: 3 },
          },
        }}
        onChange={onChange}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    chooseCascade(picker, '变量', '气力')
    expect(onChange).toHaveBeenCalledWith({
      text: { ref: 'var.qi' },
    })
    const triggerRow = screen.getByText('触发按键').parentElement!
    expect(within(triggerRow).getByRole('textbox')).toBeTruthy()
    expect(within(triggerRow).queryByRole('combobox')).toBeNull()
  })
})
