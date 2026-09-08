import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import type { Entity } from '@/runtime/core/schema/graph-schema'
import { ComponentFormFields } from '../component-form-fields'
import { CATALOG_CSS } from '../catalogCss'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

registerTestComponents()

let catalogStyle: HTMLStyleElement

beforeAll(() => {
  catalogStyle = document.createElement('style')
  catalogStyle.textContent = CATALOG_CSS
  document.head.append(catalogStyle)
})

afterAll(() => catalogStyle.remove())

function EntityHarness({ initial }: { initial: Record<string, Entity> }): JSX.Element {
  const [value, setValue] = useState<ScenarioMeta>({ entities: initial })
  return (
    <>
      <ScenarioInspector value={value} section="entities" onChange={setValue} />
      <output data-testid="entities-state">{JSON.stringify(value.entities)}</output>
    </>
  )
}

describe('ScenarioInspector entity attributes', () => {
  it('centers a vector chevron in the aligned entity header', () => {
    render(<EntityHarness initial={{ hero: { id: 'hero', name: '主角', attrs: {} } }} />)

    const toggle = screen.getByRole('button', { name: '折叠实体 主角' })
    const head = toggle.closest('.gc-rule-accordion-head')
    expect(toggle.querySelector('svg')).not.toBeNull()
    expect(getComputedStyle(toggle).display).toBe('grid')
    expect(getComputedStyle(toggle).placeItems).toBe('center')
    expect(getComputedStyle(toggle).marginTop).toBe('')
    expect(head).not.toBeNull()
    expect(getComputedStyle(head!).alignItems).toBe('center')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows a long entity name at its natural width and wraps when the row is constrained', () => {
    const longName = '一个不会被截断的很长实体名称'
    render(<EntityHarness initial={{ hero: { id: 'hero', name: longName, attrs: {} } }} />)

    const name = screen.getByText(longName)
    const identity = name.closest('.gc-rule-identity')
    const nameStyle = getComputedStyle(name)

    expect(name.tagName).toBe('SPAN')
    expect(nameStyle.maxWidth).toBe('100%')
    expect(nameStyle.whiteSpace).toBe('normal')
    expect(nameStyle.overflowWrap).toBe('anywhere')
    expect(identity).not.toBeNull()
    expect(getComputedStyle(identity!).flexWrap).toBe('wrap')
  })

  it('shows the entity empty state and opens creation from it', () => {
    render(<EntityHarness initial={{}} />)

    expect(screen.getByText('暂无实体')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^新建实体$/ }))

    expect(screen.getByRole('dialog', { name: '新建实体' })).toBeInTheDocument()
  })

  it('shows the search empty state when no entity matches', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', name: '主角', attrs: {} },
      }} />,
    )

    fireEvent.change(screen.getByLabelText('搜索实体'), { target: { value: '怪物' } })

    expect(screen.getByText('暂无搜索结果')).toBeInTheDocument()
    expect(screen.queryByText('主角')).toBeNull()
  })
  it('seeds new entities and attributes with numbered display names', () => {
    render(<EntityHarness initial={{}} />)

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建实体' }))
    expect(screen.getByRole('dialog', { name: '新建实体' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('实体名称'), { target: { value: '主角' } })
    fireEvent.change(screen.getByLabelText('实体id'), { target: { value: '1hero' } })
    expect(screen.getByText('只能输入英文字母、数字和下划线，且不能以数字开头')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '确认' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.getByRole('alert')).toHaveTextContent('实体id无效')
    fireEvent.change(screen.getByLabelText('实体id'), { target: { value: 'hero' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.queryByText('暂无属性')).toBeNull()
    expect(document.querySelector('.gc-rule-id-pair-name')).toHaveTextContent('属性1')

    fireEvent.click(screen.getByRole('button', { name: '新增属性' }))
    expect(screen.getByRole('dialog', { name: '新建属性' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('属性名称'), { target: { value: '生命值' } })
    fireEvent.change(screen.getByLabelText('属性id'), { target: { value: 'hp' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    const names = document.querySelectorAll('.gc-rule-id-pair-name')
    expect(names[0]).toHaveTextContent('属性1')
    expect(names[1]).toHaveTextContent('生命值')
    expect(screen.queryByLabelText('hero 的属性名称')).toBeNull()
  })

  it('greys out the create button while name or id is missing and says which one on click', () => {
    render(<EntityHarness initial={{}} />)

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建实体' }))
    expect(screen.getByRole('button', { name: '确认' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.getByRole('alert')).toHaveTextContent('未填入实体名称')

    fireEvent.change(screen.getByLabelText('实体名称'), { target: { value: '主角' } })
    fireEvent.change(screen.getByLabelText('实体id'), { target: { value: '' } })
    expect(screen.getByLabelText('实体id')).not.toHaveAttribute('aria-invalid')
    expect(document.querySelector('.gc-rule-id-error')).toBeNull()
    expect(screen.getByRole('button', { name: '确认' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(screen.getByRole('alert')).toHaveTextContent('未填入实体id')

    fireEvent.change(screen.getByLabelText('实体id'), { target: { value: 'hero' } })
    expect(screen.getByRole('button', { name: '确认' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('renders entity and property IDs as static summaries', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { attr0: 10 },
            attrMeta: { attr0: { label: '生命', max: 100 } },
          },
        }}
      />,
    )

    expect(screen.getByTitle('attr0')).toHaveTextContent('attr0')
    expect(screen.queryByRole('textbox', { name: 'hero 的属性 ID' })).toBeNull()
    expect(document.querySelector('.gc-rule-accordion-id-value')).toHaveTextContent('hero')
    expect(screen.queryByRole('textbox', { name: '实体 ID' })).toBeNull()
  })

  it('closes an entity overflow menu when clicking outside', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', name: '主角', attrs: {} },
      }} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '实体 主角更多操作' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens rename and delete confirmation dialogs from the overflow menu', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', name: '主角', attrs: {} },
      }} />,
    )

    const overflow = screen.getByRole('button', { name: '实体 主角更多操作' })
    fireEvent.click(overflow)
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    expect(screen.getByRole('dialog', { name: '重命名实体 主角' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭弹窗' }))

    fireEvent.click(overflow)
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByRole('dialog', { name: '删除实体 主角' })).toHaveTextContent('确认删除[主角]吗？')
  })

  it('stores each attribute initial value independently', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            name: '主角',
            attrs: { stamina: 40, staminaMax: 100 },
            attrMeta: { stamina: { label: '耐力', min: 0, initial: 300, max: 300 } },
          },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('属性「staminaMax」的数值'), {
      target: { value: '120' },
    })
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"staminaMax":120')
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"staminaMax":{"initial":120}',
    )

    fireEvent.change(screen.getByLabelText('属性「stamina」的数值'), {
      target: { value: '75' },
    })

    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"stamina":{"label":"耐力","min":0,"initial":75,"max":300}',
    )
  })

  it('allows a required attribute value to stay empty until blur', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            attrs: { hp: 60, hpMax: 100 },
            attrMeta: { hp: { initial: 60, max: 100 } },
          },
        }}
      />,
    )

    const hpInput = screen.getByLabelText('属性「hp」的数值')
    fireEvent.focus(hpInput)
    fireEvent.change(hpInput, { target: { value: '' } })

    expect(hpInput).toHaveValue('')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hp":60')

    fireEvent.blur(hpInput)

    expect(hpInput).toHaveValue('0')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":0,"hpMax":100}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hp":{"initial":0,"max":100}')
  })

  it('does not couple independent attributes when their value changes', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            attrs: { hp: 80, hpMax: 100 },
            attrMeta: { hp: { min: 0, initial: 80, max: 100 } },
          },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('属性「hpMax」的数值'), {
      target: { value: '50' },
    })

    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":80,"hpMax":50}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"hp":{"min":0,"initial":80,"max":100}',
    )
  })

  it('edits an entity property range in the table columns', () => {
    render(
      <EntityHarness
        initial={{
          hero: {
            id: 'hero',
            attrs: { hp: 80 },
            attrMeta: { hp: { initial: 80 } },
          },
        }}
      />,
    )

    fireEvent.change(screen.getByLabelText('hero 的 hp 最小值'), {
      target: { value: '10' },
    })
    fireEvent.blur(screen.getByLabelText('hero 的 hp 最小值'))
    fireEvent.change(screen.getByLabelText('hero 的 hp 最大值'), {
      target: { value: '60' },
    })
    fireEvent.blur(screen.getByLabelText('hero 的 hp 最大值'))

    expect(screen.getByTestId('entities-state')).toHaveTextContent('"attrs":{"hp":60}')
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hp":{"initial":60,"min":10,"max":60}')
  })

  it('edits string attributes without a type switcher', () => {
    render(
      <EntityHarness initial={{
        hero: { id: 'hero', attrs: { title: '' } },
      }} />,
    )
    expect(screen.queryByLabelText('属性「title」的数值类型')).toBeNull()
    expect(screen.queryByRole('button', { name: /高级设置/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('属性「title」的数值'), { target: { value: '守护者' } })
    expect(screen.getByTestId('entities-state')).toHaveTextContent('"title":"守护者"')
  })
})
