// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeyConflictInput } from '../KeyConflictInput'

afterEach(cleanup)

describe('KeyConflictInput', () => {
  it('shows 按键重复 badge and hover tooltip when conflicting', () => {
    const { container } = render(
      <KeyConflictInput
        value="C"
        conflict
        tooltip="按键C已应用于战斗技能条-重攻击"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByDisplayValue('C')).toBeTruthy()
    expect(screen.getByText('按键重复')).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerEnter(screen.getByDisplayValue('C').closest('[data-key-conflict]')!)
    expect(screen.getByRole('tooltip').textContent).toBe('按键C已应用于战斗技能条-重攻击')
    const styles = container.ownerDocument.querySelector(
      'style[data-reel-style="key-conflict-input"]',
    )?.textContent
    expect(styles).toContain('.kci-field.is-conflict {\n  background: #ff6b6b;')
    expect(styles).toContain('background: rgba(61, 61, 61, 1);')
  })

  it('keeps a plain field when there is no conflict', () => {
    render(<KeyConflictInput value="X" conflict={false} onChange={vi.fn()} />)
    expect(screen.queryByText('按键重复')).toBeNull()
    fireEvent.pointerEnter(screen.getByDisplayValue('X').parentElement!.parentElement!)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
