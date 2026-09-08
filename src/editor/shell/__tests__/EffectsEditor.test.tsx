// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphCondition, GraphEffect } from '@/runtime/core/schema/graph-schema'
import { ConditionEditor, EffectsEditor } from '../editors'

afterEach(cleanup)

describe('EffectsEditor numeric operations', () => {
  it('uses one caller-provided label width for effect targets and value fields', () => {
    render(
      <EffectsEditor
        value={[{
          kind: 'attr',
          entityId: 'hero',
          attr: 'hp',
          op: 'add',
          value: 70,
        }]}
        entities={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { hp: 100 },
            attrMeta: { hp: { label: '生命值' } },
          },
        }}
        labelWidth="77px"
        onChange={vi.fn()}
      />,
    )

    // 排除 .ni-select-value：那是 NiSelect 壳里显示当前选项的装饰 span（如「类型」选中「属性」），
    // 与同名字段标签撞文本；这里量的是标签本身。
    for (const label of ['类型', '实体', '属性', '操作', '数值来源', '数值']) {
      expect(screen.getByText(label, { selector: 'span:not(.ni-select-value)' })).toHaveStyle({ width: '77px' })
    }
  })

  it('lets subtraction and division own their operation state while keeping the operand editable', () => {
    let latest: GraphEffect[] = []
    function Harness(): JSX.Element {
      const [effects, setEffects] = useState<GraphEffect[]>([{
        kind: 'attr',
        entityId: 'hero',
        attr: 'hp',
        op: 'add',
        value: 2,
      }])
      latest = effects
      return (
        <EffectsEditor
          value={effects}
          entities={{
            hero: {
              id: 'hero',
              name: '主角',
              attrs: { hp: 100 },
              attrMeta: { hp: { label: '生命值' } },
            },
          }}
          onChange={setEffects}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: '÷' }))
    expect(screen.getByRole('button', { name: '÷' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByLabelText('数值')).toHaveValue('2')
    expect(latest[0]).toMatchObject({ op: 'mul', value: { expr: '1/(2)' } })

    fireEvent.change(screen.getByLabelText('数值'), { target: { value: '4' } })
    expect(latest[0]).toMatchObject({ op: 'mul', value: { expr: '1/(4)' } })
    expect(screen.getByText('属性 · 主角 的 生命值')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(screen.getByRole('button', { name: '−' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByLabelText('数值')).toHaveValue('4')
    expect(latest[0]).toMatchObject({ op: 'add', value: { expr: '-(4)' } })
    expect(screen.getByText('属性 · 主角 的 生命值')).toBeTruthy()
    expect(screen.queryByText(/add|-\(4\)/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+' }))
    expect(screen.getByRole('button', { name: '+' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByLabelText('数值')).toHaveValue('4')
    expect(latest[0]).toMatchObject({ op: 'add', value: 4 })
  })

  it('replaces subtraction with division instead of nesting unary wraps', () => {
    let latest: GraphEffect[] = []
    function Harness(): JSX.Element {
      const [effects, setEffects] = useState<GraphEffect[]>([{
        kind: 'attr',
        entityId: 'hero',
        attr: 'hp',
        op: 'add',
        value: 10,
      }])
      latest = effects
      return (
        <EffectsEditor
          value={effects}
          propertyLayout
          entities={{
            hero: {
              id: 'hero',
              name: '主角',
              attrs: { hp: 100 },
              attrMeta: { hp: { label: '生命值' } },
            },
          }}
          onChange={setEffects}
        />
      )
    }

    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: '−' }))
    expect(latest[0]).toMatchObject({ op: 'add', value: { expr: '-(10)' } })

    // − → ÷：先还原到点 − 前的操作数，再套 ÷，不得出现 1/(-(10))
    fireEvent.click(screen.getByRole('button', { name: '÷' }))
    expect(screen.getByRole('button', { name: '÷' }).classList.contains('is-on')).toBe(true)
    expect(screen.getByRole('button', { name: '−' }).classList.contains('is-on')).toBe(false)
    expect(latest[0]).toMatchObject({ op: 'mul', value: { expr: '1/(10)' } })
  })

  it('keeps manual value mode after switching from an entity binding and then choosing subtraction', () => {
    let latest: GraphEffect[] = []
    function Harness(): JSX.Element {
      const [effects, setEffects] = useState<GraphEffect[]>([{
        kind: 'attr',
        entityId: 'hero',
        attr: 'hp',
        op: 'add',
        value: { expr: 'entity.hero.attr.hp' },
      }])
      latest = effects
      return (
        <EffectsEditor
          value={effects}
          entities={{ hero: { id: 'hero', name: '主角', attrs: { hp: 100 } } }}
          onChange={setEffects}
        />
      )
    }

    render(<Harness />)
    const source = screen.getByRole('combobox', { name: '数值来源' })
    fireEvent.click(source)
    fireEvent.click(screen.getByRole('menuitem', { name: '常量' }))
    fireEvent.click(screen.getByRole('button', { name: '−' }))

    expect(source).toHaveValue('const')
    expect(screen.queryByRole('menuitem', { name: '当前内容（保持原值）' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '数值' })).toHaveValue('0')
    fireEvent.change(screen.getByRole('textbox', { name: '数值' }), { target: { value: '50' } })
    expect(latest[0]).toMatchObject({ op: 'add', value: { expr: '-(50)' } })
  })

  it('uses cascading target pickers and keeps creation forms visible', () => {
    render(
      <EffectsEditor
        value={[{
          kind: 'attr',
          entityId: 'hero',
          attr: 'hp',
          op: 'add',
          value: 0,
        }]}
        entities={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { hp: 100 },
            attrMeta: { hp: { label: '生命值' } },
          },
        }}
        variables={{
          rage: { id: 'rage', name: '怒气', initial: 0 },
        }}
        formulas={{}}
        createEntity={{ onCreate: vi.fn() }}
        createAttribute={{ onCreate: vi.fn() }}
        createVariable={{ onCreate: vi.fn() }}
        createFormula={{ onCreate: vi.fn() }}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '实体' }))
    expect(screen.getByRole('menuitem', { name: '主角' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '效果目标的新实体 ID' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('combobox', { name: '属性' }))
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增属性' }))
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('combobox', { name: '数值来源' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '变量' }))
    expect(screen.getByRole('menuitem', { name: '怒气' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增变量' }))
    expect(screen.getByRole('textbox', { name: '新变量初始值' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
  })
})

describe('ConditionEditor score compatibility', () => {
  it('does not offer score for new conditions', () => {
    function Harness(): JSX.Element {
      const [condition, setCondition] = useState<GraphCondition | undefined>()
      return <ConditionEditor value={condition} nodeIds={[]} onChange={setCondition} />
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '+ 条件（AND）' }))

    const type = screen.getByRole('combobox', { name: '条件字段类型' })
    expect(type.querySelector('option[value="score"]')).toBeNull()
    expect(type.textContent).not.toContain('分数')
  })

  it('keeps an existing score condition editable for backward compatibility', () => {
    render(
      <ConditionEditor
        value={{ all: [{ type: 'score', op: 'gte', value: 10 }] }}
        nodeIds={[]}
        onChange={() => undefined}
      />,
    )

    const type = screen.getByRole('combobox', { name: '条件字段类型' })
    expect(type).toHaveValue('score')
    expect(type.querySelector('option[value="score"]')).not.toBeNull()
  })
})

describe('item authoring', () => {
  it('uses one item catalog for give/take effects and owned-item conditions', () => {
    const effectChange = vi.fn()
    const conditionChange = vi.fn()
    const { container } = render(
      <>
        <EffectsEditor
          value={[{ kind: 'item', itemId: 'lotus-key', op: 'give', count: 1 }]}
          pickers={{ itemIds: ['lotus-key', 'tea'] }}
          onChange={effectChange}
        />
        <ConditionEditor
          value={{ all: [{ type: 'hasItem', itemId: 'lotus-key', count: 1 }] }}
          nodeIds={[]}
          pickers={{ itemIds: ['lotus-key', 'tea'] }}
          onChange={conditionChange}
        />
      </>,
    )

    const itemInputs = screen.getAllByRole('combobox', { name: '道具' })
    expect(itemInputs).toHaveLength(2)
    for (const input of itemInputs) {
      expect(within(input).getByRole('option', { name: 'lotus-key' })).toBeTruthy()
      expect(within(input).getByRole('option', { name: 'tea' })).toBeTruthy()
    }
    expect(container.textContent).toContain('给予（增加持有数量）')
    expect(container.textContent).toContain('取走（减少且不低于 0）')
    expect(container.textContent).toContain('拥有数量至少')
  })
})
