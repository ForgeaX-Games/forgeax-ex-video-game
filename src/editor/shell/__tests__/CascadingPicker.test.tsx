// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CascadingPicker, type CascadingPickerOption } from '../CascadingPicker'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const options: CascadingPickerOption[] = [
  {
    key: 'entity',
    label: '实体属性',
    children: [
      {
        key: 'hero',
        label: '主角',
        children: [{
          key: 'hero-hp',
          label: '当前生命',
          secondaryText: '12345678901234567890',
          value: 'entity.hero.attr.hp',
        }],
      },
      {
        key: 'enemy',
        label: '敌方',
        children: [{ key: 'enemy-hp', label: '当前生命', value: 'entity.enemy.attr.hp' }],
      },
    ],
  },
  {
    key: 'variable',
    label: '变量',
    children: [{ key: 'rage', label: '怒气', value: 'var.rage' }],
  },
]

const createOptions: CascadingPickerOption[] = [
  {
    key: 'entity',
    label: '实体',
    children: [
      { key: 'hero', label: '主角', value: 'hero' },
      {
        key: 'create-entity',
        label: '配置「实体」实体',
        presentation: 'create',
        children: [
          {
            key: 'entity-id',
            label: '实体 ID',
            editor: {
              value: 'entity',
              ariaLabel: '新实体 ID',
              onChange: vi.fn(),
            },
          },
          {
            key: 'confirm',
            label: '确认创建并选择',
            value: 'confirm',
            presentation: 'confirm',
          },
        ],
      },
    ],
  },
]

function renderPicker(): void {
  render(
    <CascadingPicker
      ariaLabel="绑定属性"
      value="entity.hero.attr.hp"
      displayValue="主角的当前生命"
      options={options}
      onSelect={vi.fn()}
    />,
  )
}

describe('CascadingPicker interaction stability', () => {
  it('sizes the popup from visible columns and scrolls each column independently', () => {
    renderPicker()
    const trigger = screen.getByRole('combobox', { name: '绑定属性' })
    const arrow = trigger.querySelector('.gc-cascade-trigger-arrow')
    expect(arrow?.tagName.toLowerCase()).toBe('svg')
    expect(arrow?.querySelector('path')).toHaveAttribute('d', 'M1.5 2.25 6 6.75l4.5-4.5')
    expect(window.getComputedStyle(arrow!).display).toBe('block')
    expect(window.getComputedStyle(arrow!).width).toBe('12px')
    expect(window.getComputedStyle(arrow!).height).toBe('8px')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(window.getComputedStyle(arrow!).transform).toBe('rotateX(180deg)')

    const panel = screen.getByRole('menu', { name: '绑定属性选项' })
    expect(panel.style.width).toBe('')
    expect(panel.style.height).toBe('')
    expect(window.getComputedStyle(panel).overflowX).toBe('auto')
    expect(window.getComputedStyle(panel).overflowY).toBe('hidden')
    const pickerStyles = document.querySelector('style[data-reel-style="gc-cascading-picker"]')?.textContent
    expect(pickerStyles?.match(/background: rgba\(20, 20, 20, 1\);/g)).toHaveLength(2)
    expect(pickerStyles).toContain(
      'outline: none; box-shadow: none; border-color: rgba(255, 255, 255, 0.08);',
    )
    expect(panel.querySelector('.gc-cascade-content')).toBeTruthy()
    const initialColumns = within(panel).getAllByRole('group')
    expect(initialColumns).toHaveLength(3)
    expect(within(initialColumns[0]!).getByRole('menuitem', { name: '当前生命' })).toBeTruthy()
    expect(within(initialColumns[2]!).getByRole('menuitem', { name: '变量' })).toBeTruthy()
    for (const column of initialColumns) {
      expect(window.getComputedStyle(column).overflowY).toBe('auto')
    }
    const branchArrow = screen.getByRole('menuitem', { name: '实体属性' }).querySelector('.gc-cascade-item-arrow')
    expect(branchArrow).toHaveTextContent('‹')
    expect(window.getComputedStyle(branchArrow!).display).toBe('inline-flex')
    const attribute = screen.getByRole('menuitem', { name: '当前生命' })
    const attributeValue = attribute.querySelector('.gc-cascade-item-secondary')
    expect(attribute).toHaveAttribute('title', '当前生命：12345678901234567890')
    expect(attributeValue).toHaveTextContent('12345678901234567890')
    expect(window.getComputedStyle(attributeValue!).fontSize).toBe('10px')
    expect(window.getComputedStyle(attributeValue!).textOverflow).toBe('ellipsis')
    expect(window.getComputedStyle(attributeValue!).maxWidth).toBe('45%')
    expect(attribute.lastElementChild).toHaveClass('gc-cascade-item-mark')
    expect(attribute.lastElementChild).toHaveTextContent('✓')

    fireEvent.click(screen.getByRole('menuitem', { name: '变量' }))
    expect(within(panel).getAllByRole('group')).toHaveLength(2)
    expect(panel.style.width).toBe('')
    expect(panel.style.height).toBe('')
  })

  it('supports compact toolbar triggers, disabled state, and open lifecycle reasons', () => {
    const calls: Array<string> = []
    const onSelect = vi.fn(() => calls.push('select'))
    const onOpenChange = vi.fn((open: boolean, detail: { reason: string }) => {
      calls.push(`${open ? 'open' : 'close'}:${detail.reason}`)
    })
    const { rerender } = render(
      <CascadingPicker
        ariaLabel="插入变量"
        value=""
        displayValue="变量"
        options={[{ key: 'rage', label: '怒气', value: 'rage' }]}
        onSelect={onSelect}
        variant="toolbar"
        onOpenChange={onOpenChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '插入变量' })
    expect(trigger.parentElement).toHaveClass('is-toolbar')
    expect(trigger).toHaveTextContent('变量')
    expect(trigger.querySelector('.gc-cascade-trigger-add')).toHaveStyle({ width: '18px', height: '18px' })
    expect(trigger.querySelector('.gc-cascade-trigger-add > img')).toBeInTheDocument()
    expect(window.getComputedStyle(trigger).height).toBe('28px')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '怒气' }))
    expect(calls).toEqual(['open:trigger', 'select', 'close:select'])

    calls.length = 0
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(calls).toEqual(['open:trigger', 'close:escape'])

    calls.length = 0
    fireEvent.click(trigger)
    const outside = document.createElement('button')
    document.body.append(outside)
    fireEvent.pointerDown(outside)
    expect(calls).toEqual(['open:trigger', 'close:outside-pointer'])
    outside.remove()

    rerender(
      <CascadingPicker
        ariaLabel="插入变量"
        value=""
        displayValue="变量"
        options={[{ key: 'rage', label: '怒气', value: 'rage' }]}
        onSelect={onSelect}
        variant="toolbar"
        disabled
        onOpenChange={onOpenChange}
      />,
    )
    expect(trigger).toBeDisabled()
    calls.length = 0
    fireEvent.click(trigger)
    expect(screen.queryByRole('menu', { name: '插入变量选项' })).toBeNull()
    expect(calls).toEqual([])
  })

  it('opens branches on hover in the column to the left', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('combobox', { name: '绑定属性' }))

    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: '敌方' }))
    expect(screen.getAllByRole('menuitem', { name: '当前生命' })).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: '敌方' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: '主角' })).toHaveAttribute('aria-expanded', 'false')

    const groups = within(screen.getByRole('menu', { name: '绑定属性选项' })).getAllByRole('group')
    expect(within(groups[0]!).getByRole('menuitem', { name: '当前生命' })).toBeTruthy()
    expect(within(groups[1]!).getByRole('menuitem', { name: '敌方' })).toBeTruthy()
  })

  it('shows a named create action and opens its form in a separate popup', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('gc-cascade-item') && this.classList.contains('is-create')) {
        return {
          x: 500, y: 120, left: 500, top: 120, right: 690, bottom: 148,
          width: 190, height: 28, toJSON: () => ({}),
        } as DOMRect
      }
      if (this.classList.contains('gc-cascade-create-dialog')) {
        return {
          x: 0, y: 0, left: 0, top: 0, right: 260, bottom: 180,
          width: 260, height: 180, toJSON: () => ({}),
        } as DOMRect
      }
      return {
        x: 0, y: 0, left: 0, top: 0, right: 210, bottom: 30,
        width: 210, height: 30, toJSON: () => ({}),
      } as DOMRect
    })
    render(
      <CascadingPicker
        ariaLabel="实体"
        value="hero"
        displayValue="主角"
        options={createOptions}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '实体' }))

    const create = screen.getByRole('menuitem', { name: '新增实体' })
    expect(create).toHaveClass('is-create')
    expect(create).toHaveAttribute('title', '配置「实体」实体')
    expect(create).toHaveTextContent('+新增实体')
    expect(create.parentElement).toHaveClass('gc-cascade-create-block')
    expect(window.getComputedStyle(create.parentElement!).borderTopStyle).toBe('solid')
    expect(window.getComputedStyle(create).minHeight).toBe('28px')
    expect(window.getComputedStyle(create).marginLeft).toBe('8px')

    fireEvent.pointerEnter(create)
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()

    const menu = screen.getByRole('menu', { name: '实体选项' })
    const columnCount = within(menu).getAllByRole('group').length
    fireEvent.click(create)

    const dialog = screen.getByRole('dialog', { name: '配置「实体」实体' })
    const editor = screen.getByRole('textbox', { name: '新实体 ID' })
    expect(editor.closest('.gc-cascade-create-dialog')).toBe(dialog)
    expect(editor.closest('.gc-cascade-column')).toBeNull()
    expect(within(menu).getAllByRole('group')).toHaveLength(columnCount)
    expect(menu.querySelector('.gc-cascade-column.has-editor')).toBeNull()
    expect(dialog.style.position).toBe('fixed')
    expect(dialog.style.height).toBe('')
    expect(dialog.style.maxHeight).toBe('')
    expect(dialog.style.overflowY).toBe('')
    expect(dialog.style.left).toBe('235px')
    expect(dialog.style.top).toBe('120px')

    const confirm = screen.getByRole('button', { name: '确认' })
    expect(confirm).toHaveClass('is-confirm')
    expect(confirm.children).toHaveLength(1)
    expect(window.getComputedStyle(confirm).justifyContent).toBe('center')
    expect(window.getComputedStyle(confirm).height).toBe('28px')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '配置「实体」实体' })).toBeNull()
    expect(screen.getByRole('menu', { name: '实体选项' })).toBeTruthy()
  })
})
