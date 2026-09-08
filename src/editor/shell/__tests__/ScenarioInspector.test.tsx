import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

function renderInspector(value: ScenarioMeta, section: 'variables' | 'entities' | 'formulas') {
  const onChange = vi.fn()
  render(<ScenarioInspector value={value} section={section} onChange={onChange} />)
  return { onChange }
}

describe('ScenarioInspector rules editing', () => {
  it('shows the shared empty state for variables and opens creation from it', () => {
    renderInspector({}, 'variables')

    const empty = document.querySelector('.gc-rule-empty')
    expect(empty).toBeTruthy()
    expect(empty).toHaveTextContent('暂无变量')
    expect(empty?.querySelector('img')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新建变量' }))

    expect(screen.getByRole('dialog', { name: '新建变量' })).toBeTruthy()
  })

  it('keeps the shared variable toolbar sticky and renders IDs as static text', () => {
    renderInspector({
      variables: {
        health: { id: 'health', initial: 10 },
        rage: { id: 'rage', initial: 0 },
      },
    }, 'variables')
    const toolbar = screen.getByRole('button', { name: '＋ 新建变量' }).closest('.gc-rule-toolbar')
    expect(toolbar).toHaveStyle({ position: 'sticky', top: '0px' })
    expect(screen.getByTitle('health')).toHaveTextContent('health')
    expect(screen.queryByLabelText('变量 ID')).toBeNull()
  })

  it('allows a numeric attribute value to be cleared before blur, then restores zero', () => {
    const { onChange } = renderInspector({
      entities: { hero: { id: 'hero', attrs: { hp: 12 } } },
    }, 'entities')
    const value = screen.getByLabelText('属性「hp」的数值')
    fireEvent.focus(value)
    fireEvent.change(value, { target: { value: '' } })
    expect(value).toHaveValue('')
    fireEvent.blur(value)
    expect(onChange).toHaveBeenLastCalledWith({
      entities: { hero: { id: 'hero', attrs: { hp: 0 }, attrMeta: { hp: { initial: 0 } } } },
    })
  })

  it('renders numeric limits in the shared rule table columns', () => {
    renderInspector({
      variables: {
        qi: { id: 'qi', name: '气力', initial: 8, min: 0, max: 10 },
      },
    }, 'variables')

    expect(screen.getByLabelText('qi 的最小值')).toHaveValue('0')
    expect(screen.getByLabelText('qi 的最大值')).toHaveValue('10')
    expect(screen.getByLabelText('qi 的初值')).toHaveValue('8')
  })

  it('creates a numeric variable by default and allows selecting text', () => {
    const { onChange } = renderInspector({}, 'variables')
    fireEvent.click(screen.getByRole('button', { name: '新建变量' }))

    const type = screen.getByLabelText('变量类型')
    expect(type).toHaveTextContent('数值')

    fireEvent.click(type)
    fireEvent.click(screen.getByRole('option', { name: '文本' }))
    const dialog = screen.getByRole('dialog', { name: '新建变量' })
    const [name, id] = Array.from(dialog.querySelectorAll('input'))
    fireEvent.change(name!, { target: { value: '章节标题' } })
    fireEvent.change(id!, { target: { value: 'chapterTitle' } })
    fireEvent.click(dialog.querySelector('.is-danger')!)

    expect(onChange).toHaveBeenCalledWith({
      variables: {
        chapterTitle: { id: 'chapterTitle', name: '章节标题', initial: '' },
      },
    })
  })

  it('keeps text variables below numeric variables with type-specific headings', () => {
    renderInspector({
      variables: {
        score: { id: 'score', initial: 1, min: 0, max: 10 },
        title: { id: 'title', initial: '序章' },
      },
    }, 'variables')

    const headers = Array.from(document.querySelectorAll('.gc-rule-variable-head'))
    expect(headers).toHaveLength(2)
    expect(headers[0]).toHaveTextContent('数值')
    expect(headers[1]).toHaveTextContent('文本')
    expect(screen.getByLabelText('title 的文本')).toHaveValue('序章')
    expect(screen.queryByLabelText('title 的最小值')).toBeNull()
    expect(screen.queryByLabelText('title 的最大值')).toBeNull()
  })
})
