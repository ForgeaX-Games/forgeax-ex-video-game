// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectDropdown } from '../SelectDropdown'

afterEach(cleanup)

describe('SelectDropdown', () => {
  it('uses CascadingPicker chrome for a flat option list', () => {
    const onChange = vi.fn()
    render(
      <SelectDropdown
        ariaLabel="界面或控件名"
        value=""
        placeholder="选择界面或组件…"
        options={[
          { value: 'hud/hp', label: '血条' },
          { value: 'hud/skill', label: '技能条' },
        ]}
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '界面或控件名' })
    expect(trigger).toHaveClass('gc-cascade-trigger')
    expect(trigger).toHaveTextContent('选择界面或组件…')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '技能条' }))
    expect(onChange).toHaveBeenCalledWith('hud/skill')
  })

  it('forwards toolbar, disabled, and open lifecycle props', () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <SelectDropdown
        ariaLabel="插入函数"
        value=""
        placeholder="函数"
        options={[{ value: 'max', label: 'max()' }]}
        onChange={vi.fn()}
        variant="toolbar"
        onOpenChange={onOpenChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: '插入函数' })
    expect(trigger.parentElement).toHaveClass('is-toolbar')
    fireEvent.click(trigger)
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.objectContaining({ reason: 'trigger' }))

    rerender(
      <SelectDropdown
        ariaLabel="插入函数"
        value=""
        placeholder="函数"
        options={[{ value: 'max', label: 'max()' }]}
        onChange={vi.fn()}
        variant="toolbar"
        disabled
        onOpenChange={onOpenChange}
      />,
    )
    expect(trigger).toBeDisabled()
  })
})
