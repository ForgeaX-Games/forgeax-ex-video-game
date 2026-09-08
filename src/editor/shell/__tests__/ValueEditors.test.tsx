// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setLocale } from '../../../i18n'
import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { TextValueEditor } from '../TextValueEditor'
import { ValueExprEditor } from '../ValueExprEditor'

afterEach(() => {
  cleanup()
  setLocale('zh')
})

const entities: Record<string, Entity> = {
  hero: {
    id: 'hero',
    name: '主角',
    attrs: { hp: 100 },
    attrMeta: { hp: { label: '生命值' } },
  },
}

const variables: Record<string, Variable> = {
  rage: { id: 'rage', name: '怒气', initial: 0 },
}

const formulas: Record<string, Formula> = {
  damage: {
    id: 'damage',
    name: '伤害公式',
    ast: { t: 'num', id: 'n0', v: 10 },
  },
}

function chooseCascade(trigger: HTMLElement, ...labels: string[]): void {
  fireEvent.click(trigger)
  for (const label of labels) {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  }
}

describe('numberExpr dropdown labels', () => {
  it('renders the entity creation cascader in natural English', () => {
    setLocale('en')
    render(
      <ValueExprEditor
        value={0}
        entities={{}}
        variables={{}}
        formulas={{}}
        createEntity={{ onCreate: vi.fn() }}
        createAttribute={{ onCreate: vi.fn() }}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Entity attributes' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New entity' }))

    expect(screen.getByRole('dialog', { name: 'Create entity "Entity"' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'New entity name' })).toHaveValue('Entity')
    expect(screen.getByRole('textbox', { name: 'New attribute name' })).toHaveValue('Attribute')
    expect(screen.getByRole('textbox', { name: 'New attribute initial value' })).toHaveValue('0')
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('labels manually entered text as a constant', () => {
    render(
      <TextValueEditor
        value="敌方"
        entities={{}}
        variables={{}}
        onChange={() => undefined}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveTextContent('常量')
    expect(picker.parentElement).not.toHaveClass('is-narrow-safe')
    expect(picker.parentElement?.parentElement).toHaveStyle({ flexWrap: 'nowrap' })
    expect(screen.getByRole('textbox', { name: '固定文本' })).toHaveStyle({ minWidth: '120px' })
    fireEvent.click(picker)
    expect(screen.getByRole('menuitem', { name: '常量' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '固定文本（手动输入）' })).toBeNull()
  })

  it('cascades through an entity before selecting text state', () => {
    const onChange = vi.fn()
    render(
      <TextValueEditor
        value={{ ref: 'entity.hero.name' }}
        entities={entities}
        variables={variables}
        onChange={onChange}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveTextContent('主角')
    fireEvent.click(picker)
    expect(screen.getByRole('menuitem', { name: '实体' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '实体' }))
    expect(screen.getByRole('menuitem', { name: '主角' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    const entityNameOption = screen.getByRole('menuitem', { name: '名称' })
    expect(entityNameOption).toHaveAttribute('title', '名称：主角')
    expect(entityNameOption.querySelector('.gc-cascade-item-secondary')).toHaveTextContent('主角')
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '变量' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: '生命值' }))
    expect(onChange).toHaveBeenCalledWith({ ref: 'entity.hero.attr.hp' })
  })

  it('limits entity-name fields to constants and entity names', () => {
    render(
      <TextValueEditor
        value={{ ref: 'entity.hero.name' }}
        entities={entities}
        variables={variables}
        formulas={formulas}
        entityNameOnly
        createVariable={{ onCreate: vi.fn() }}
        createFormula={{ onCreate: vi.fn() }}
        onChange={() => undefined}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    fireEvent.click(picker)
    expect(screen.getByRole('menuitem', { name: '实体' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '常量' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '变量' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '公式' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '实体' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    expect(screen.getByRole('menuitem', { name: '名称' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '生命值' })).toBeNull()
  })

  it('creates and selects a variable from a numeric cascader', () => {
    const onCreate = vi.fn()
    const onChange = vi.fn()
    render(
      <ValueExprEditor
        value={0}
        entities={{}}
        variables={{}}
        formulas={{}}
        createVariable={{ onCreate }}
        onChange={onChange}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '数值内容' })
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('menuitem', { name: '变量' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增变量' }))
    expect(screen.getByRole('textbox', { name: '新变量初始值' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '确认' })).toBeDisabled()
    expect(screen.queryByRole('textbox', { name: '新变量 ID' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '新变量显示名' }), {
      target: { value: '连击' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新变量初始值' }), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(onCreate).toHaveBeenCalledWith({
      variableId: 'var0',
      name: '连击',
      initialValue: 3,
    })
    expect(onChange).toHaveBeenCalledWith({
      expr: 'var.var0',
      pick: {
        mode: 'pick',
        terms: [{ op: '+', source: 'var', refId: 'var0' }],
      },
    })
  })

  it('keeps variable creation visible without blocking existing variable selection', () => {
    const onChange = vi.fn()
    render(
      <ValueExprEditor
        value={0}
        entities={{}}
        variables={variables}
        formulas={{}}
        createVariable={{ onCreate: vi.fn() }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '数值内容' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '变量' }))

    expect(screen.getByRole('menuitem', { name: '怒气' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增变量' }))
    expect(screen.queryByRole('textbox', { name: '新变量 ID' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新变量初始值' })).toHaveValue('')

    fireEvent.click(screen.getByRole('menuitem', { name: '怒气' }))
    expect(onChange).toHaveBeenCalledWith({
      expr: 'var.rage',
      pick: {
        mode: 'pick',
        terms: [{ op: '+', source: 'var', refId: 'rage' }],
      },
    })
  })

  it('keeps entity and attribute creation visible beside existing numeric choices', () => {
    const onChange = vi.fn()
    render(
      <ValueExprEditor
        value={0}
        entities={entities}
        variables={{}}
        formulas={{}}
        createEntity={{
          template: { entityId: 'enemy', name: '敌方' },
          onCreate: vi.fn(),
        }}
        createAttribute={{
          template: {
            attrId: 'hp',
            initialValue: 100,
            meta: { label: '生命值', initial: 100 },
          },
          onCreate: vi.fn(),
        }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '数值内容' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))

    expect(screen.getByRole('menuitem', { name: '主角' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    const hpOption = screen.getByRole('menuitem', { name: '生命值' })
    expect(hpOption).toHaveAttribute('title', '生命值：100')
    expect(hpOption.querySelector('.gc-cascade-item-secondary')).toHaveTextContent('100')
    fireEvent.click(screen.getByRole('menuitem', { name: '新增属性' }))
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '生命值' }))
    expect(onChange).toHaveBeenCalledWith({
      expr: 'entity.hero.attr.hp',
      pick: {
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: 'hero', attr: 'hp' }],
      },
    })
  })

  it('uses generic entity and attribute drafts when creation templates are absent', () => {
    const { unmount } = render(
      <ValueExprEditor
        value={0}
        entities={entities}
        variables={{}}
        formulas={{}}
        createEntity={{ onCreate: vi.fn() }}
        createAttribute={{ onCreate: vi.fn() }}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '数值内容' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增属性' }))
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新属性初始值' })).toHaveValue('0')

    unmount()
    render(
      <TextValueEditor
        value=""
        entities={entities}
        variables={{}}
        formulas={{}}
        createEntity={{ onCreate: vi.fn() }}
        createAttribute={{ onCreate: vi.fn() }}
        onChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '文本内容' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '实体' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增属性' }))
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新属性初始值' })).toHaveValue('0')
  })

  it('creates and selects a formula from a numeric cascader', () => {
    const onCreate = vi.fn()
    const onChange = vi.fn()
    render(
      <ValueExprEditor
        value={0}
        entities={{}}
        variables={{}}
        formulas={{}}
        createFormula={{ onCreate }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '数值内容' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '公式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增公式' }))
    expect(screen.getByRole('textbox', { name: '新公式内容' })).toHaveAttribute(
      'placeholder',
      '公式详情，或发送给agent的公式描述\n如：max(?攻击力 * ?倍率 - ?防御力, 0)',
    )
    expect(screen.queryByRole('textbox', { name: '新公式 ID' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '新公式名' }), {
      target: { value: '新伤害' },
    })
    const confirm = screen.getByRole('button', { name: '确认' })
    const sendAgent = screen.getByRole('button', { name: '发送agent' })
    expect(sendAgent).toBeDisabled()
    expect(sendAgent.nextElementSibling).toBe(confirm)
    expect(screen.getByRole('textbox', { name: '新公式内容' })).toHaveAttribute('aria-invalid', 'true')
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '新公式内容' }), {
      target: { value: '10 +' },
    })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '新公式内容' }), {
      target: { value: '１０　＋ ５' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    expect(onCreate).toHaveBeenCalledWith({
      formulaId: 'formula0',
      name: '新伤害',
      ast: {
        t: 'bin',
        id: 'n0',
        op: '+',
        a: { t: 'num', id: 'n1', v: 10 },
        b: { t: 'num', id: 'n2', v: 5 },
      },
    })
    expect(onChange).toHaveBeenCalledWith({
      expr: '10 + 5',
      pick: {
        mode: 'formula',
        formulaId: 'formula0',
        holeBindings: {},
      },
    })
  })

  it('creates and selects variables and formulas from dynamic text cascaders', () => {
    const onCreateVariable = vi.fn()
    const onCreateFormula = vi.fn()
    const onChange = vi.fn()
    const { unmount } = render(
      <TextValueEditor
        value=""
        entities={{}}
        variables={{}}
        formulas={{}}
        createVariable={{ onCreate: onCreateVariable }}
        onChange={onChange}
      />,
    )

    chooseCascade(
      screen.getByRole('combobox', { name: '文本内容' }),
      '变量',
      '新增变量',
    )
    expect(screen.getByRole('textbox', { name: '新变量初始值' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onCreateVariable).toHaveBeenCalledWith({
      variableId: 'var0',
      name: 'var0',
      initialValue: '',
    })
    expect(onChange).toHaveBeenCalledWith({ ref: 'var.var0' })

    unmount()
    onChange.mockClear()
    render(
      <TextValueEditor
        value=""
        entities={{}}
        variables={{}}
        formulas={{}}
        createFormula={{ onCreate: onCreateFormula }}
        onChange={onChange}
      />,
    )
    chooseCascade(
      screen.getByRole('combobox', { name: '文本内容' }),
      '公式',
      '新增公式',
    )
    expect(screen.getByRole('textbox', { name: '新公式内容' })).toHaveAttribute(
      'placeholder',
      '公式详情，或发送给agent的公式描述\n如：max(?攻击力 * ?倍率 - ?防御力, 0)',
    )
    expect(screen.getByRole('button', { name: '发送agent' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '新公式内容' }), {
      target: { value: '7' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onCreateFormula).toHaveBeenCalledWith({
      formulaId: 'formula0',
      name: 'formula0',
      ast: { t: 'num', id: 'n0', v: 7 },
    })
    expect(onChange).toHaveBeenCalledWith({
      expr: '7',
      pick: {
        mode: 'formula',
        formulaId: 'formula0',
        holeBindings: {},
      },
    })
  })

  it('keeps entity and attribute creation visible beside existing dynamic text choices', () => {
    const onCreateAttribute = vi.fn()
    const onChange = vi.fn()
    render(
      <TextValueEditor
        value=""
        entities={entities}
        variables={{}}
        formulas={{}}
        createEntity={{
          template: { entityId: 'enemy', name: '敌方' },
          onCreate: vi.fn(),
        }}
        createAttribute={{
          template: {
            attrId: 'hp',
            initialValue: 100,
            meta: { label: '生命值', initial: 100 },
          },
          onCreate: onCreateAttribute,
        }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '文本内容' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '实体' }))

    expect(screen.getByRole('menuitem', { name: '主角' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增属性' }))
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(onCreateAttribute).toHaveBeenCalledWith({
      entityId: 'hero',
      attrId: 'hp2',
      initialValue: 100,
      meta: { label: '生命值', initial: 100 },
    })
    expect(onChange).toHaveBeenCalledWith({ ref: 'entity.hero.attr.hp2' })
  })

  it('shows the field note as a placeholder when a text reference is unavailable', () => {
    render(
      <TextValueEditor
        value={{ ref: 'entity.missing.name' }}
        entities={{}}
        variables={{}}
        onChange={() => undefined}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '文本内容' })
    expect(picker).toHaveTextContent('文本：我方 · 状态：entity.hero.name / var.qi')
    fireEvent.click(picker)
    expect(screen.queryByRole('menuitem', { name: '当前引用（保持原值）' })).toBeNull()
  })

  it('cascades through entity attributes without changing expression ids', () => {
    const onChange = vi.fn()
    render(
      <ValueExprEditor
        value={0}
        entities={entities}
        variables={variables}
        formulas={formulas}
        onChange={onChange}
      />,
    )

    const picker = screen.getByRole('combobox', { name: '数值内容' })
    fireEvent.click(picker)
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '变量' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '公式' })).toBeTruthy()

    fireEvent.click(screen.getByRole('menuitem', { name: '生命值' }))
    expect(onChange).toHaveBeenCalledWith({
      expr: 'entity.hero.attr.hp',
      pick: {
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: 'hero', attr: 'hp' }],
      },
    })
  })

  it('keeps horizontal overflow on the popup and vertical overflow in each column', () => {
    render(
      <ValueExprEditor
        value={0}
        entities={entities}
        variables={variables}
        formulas={formulas}
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '数值内容' }))
    const panel = screen.getByRole('menu', { name: '数值内容选项' })
    expect(panel.style.width).toBe('')
    expect(panel.style.height).toBe('')
    const css = document.querySelector('style[data-reel-style="gc-cascading-picker"]')?.textContent ?? ''
    expect(css).toContain('overflow-x: auto')
    expect(css).toContain('overflow-x: auto; overflow-y: hidden')
    expect(css).toContain('height: min(280px, calc(100vh - 16px))')
    expect(css).toContain('overflow-y: auto')
  })
})
