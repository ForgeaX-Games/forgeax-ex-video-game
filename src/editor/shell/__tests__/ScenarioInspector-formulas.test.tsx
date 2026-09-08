// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ScenarioInspector, type ScenarioMeta } from '../ScenarioInspector'

afterEach(cleanup)

describe('ScenarioInspector formulas', () => {
  it('shows the shared empty state for formulas and opens creation from it', () => {
    render(<ScenarioInspector value={{}} section="formulas" onChange={() => undefined} />)

    const empty = document.querySelector('.gc-rule-empty')
    expect(empty).toBeTruthy()
    expect(empty).toHaveTextContent('暂无公式')
    expect(empty?.querySelector('img')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新建公式' }))

    expect(screen.getByRole('dialog', { name: '新建公式' })).toBeTruthy()
  })

  it('creates a formula with an empty expression', () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState<ScenarioMeta>({})
      return <ScenarioInspector value={value} section="formulas" onChange={setValue} />
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建公式' }))
    fireEvent.change(screen.getByRole('textbox', { name: '公式名称' }), { target: { value: '伤害' } })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    expect(input.value).toBe('')
    expect(input).toHaveAttribute('placeholder', '例如:var.a-b')

    fireEvent.focus(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(0)
  })

  it('uses the shared rule toolbar and accordion primitives', () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            'formula0': {
              id: 'formula0',
              name: '减法',
              description: '打',
              ast: { t: 'num', id: 'n0', v: 1 },
            },
            'formula1': {
              id: 'formula1',
              name: '加法',
              ast: { t: 'num', id: 'n0', v: 2 },
            },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    expect(screen.getByRole('button', { name: '＋ 新建公式' })).toBeTruthy()
    expect(screen.getByPlaceholderText('搜索公式')).toHaveAttribute('aria-label', '搜索公式')
    expect(screen.queryByText('新建实体')).toBeNull()
    expect(screen.queryByPlaceholderText('搜索实体')).toBeNull()

    const open = screen.getByRole('button', { name: '折叠公式 减法' })
    const closed = screen.getByRole('button', { name: '展开公式 加法' })
    expect(open).toHaveClass('is-open')
    expect(open).toHaveClass('sir-formula-toggle')
    expect(closed).not.toHaveClass('is-open')
    expect(closed).toHaveClass('sir-formula-toggle')
    expect(closed).toHaveStyle({ color: 'rgba(255,255,255,.34)' })
    // '打' 是公式的 description（描述输入框仍存在，断言其值）
    expect(screen.getByDisplayValue('打')).toBeTruthy()

    fireEvent.click(closed)
    expect(screen.getByRole('button', { name: '折叠公式 加法' })).toHaveClass('is-open')
  })

  it('shows formula guidance in an accessible click popover', async () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    const nameInput = screen.getByText('伤害')
    expect(nameInput).toBeTruthy()

    const trigger = screen.getByRole('button', { name: '查看公式填写帮助' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: '公式填写帮助' })).toBeNull()

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '公式填写帮助' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByText('添加公式')).toBeTruthy()
    expect(within(dialog).getByText('添加实体 / 变量 / 函数')).toBeTruthy()
    expect(within(dialog).getByText('参数留空')).toBeTruthy()
    expect(within(dialog).getByText('公式示例')).toBeTruthy()
    expect(within(dialog).getByText('示例目标：')).toBeTruthy()
    expect(within(dialog).getByText('示例原理：')).toBeTruthy()
    expect(dialog.querySelector('code.sir-formula-help-example')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '公式示例' })).toBeNull()

    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog', { name: '公式填写帮助' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '公式填写帮助' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('wraps formula guidance prose and long inline tokens within the popover', () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看公式填写帮助' }))
    const dialog = screen.getByRole('dialog', { name: '公式填写帮助' })
    const list = dialog.querySelector<HTMLElement>('.sir-formula-help-list')
    const listItem = list?.querySelector<HTMLElement>(':scope > li')
    const paragraph = listItem?.querySelector<HTMLElement>('p')
    const inlineCode = paragraph?.querySelector<HTMLElement>('code')
    const lateHostFallback = document.createElement('style')
    lateHostFallback.textContent = ':where(p), :where(code) { white-space: nowrap; overflow-wrap: normal; }'
    document.head.append(lateHostFallback)

    try {
      expect(list).toBeTruthy()
      expect(listItem).toBeTruthy()
      expect(paragraph).toBeTruthy()
      expect(inlineCode).toBeTruthy()
      expect(Number.parseFloat(getComputedStyle(list as HTMLElement).minWidth)).toBe(0)
      expect(Number.parseFloat(getComputedStyle(listItem as HTMLElement).minWidth)).toBe(0)
      expect(getComputedStyle(paragraph as HTMLElement).whiteSpace).toBe('normal')
      expect(getComputedStyle(paragraph as HTMLElement).overflowWrap).toBe('anywhere')
      expect(getComputedStyle(inlineCode as HTMLElement).whiteSpace).toBe('normal')
      expect(getComputedStyle(inlineCode as HTMLElement).overflowWrap).toBe('anywhere')
    } finally {
      lateHostFallback.remove()
    }
  })

  it('shows parsing failure and the shared AI affordance after the help icon', async () => {
    render(
      <ScenarioInspector
        value={{ formulas: { damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } } } }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, { target: { value: 'max(' } })

    const help = screen.getByRole('button', { name: '查看公式填写帮助' })
    const error = await screen.findByText('公式解析失败')
    const ai = screen.getByRole('button', { name: 'AI 修复公式' })
    expect(help.nextElementSibling).toBe(error)
    expect(error.nextElementSibling).toBe(ai)
    expect(error).toHaveClass('sir-formula-error')
    const detail = error.getAttribute('data-error-detail')
    expect(detail).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerEnter(error)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent(`错误详情：${detail}`)
    expect(tooltip.parentElement).toBe(document.body)
    expect(error).toHaveAttribute('aria-describedby', tooltip.id)
    fireEvent.pointerLeave(error)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.focus(error)
    expect(screen.getByRole('tooltip')).toHaveTextContent(`错误详情：${detail}`)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(error).toHaveAttribute('tabindex', '0')
    fireEvent.blur(error)

    expect(ai).toBeEnabled()
    expect(ai).toHaveAttribute('title', '引用到 Agent 对话')
    expect(screen.getAllByText('公式解析失败')).toHaveLength(1)
    expect(screen.queryByText('无法解析')).toBeNull()
    expect(screen.queryByText(/^错误详情：/)).toBeNull()

    fireEvent.change(input, { target: { value: 'max(1, 2)' } })
    await waitFor(() => expect(screen.queryByText('公式解析失败')).toBeNull())
    expect(screen.queryByRole('button', { name: 'AI 修复公式' })).toBeNull()
  })

  it('clears parsing failure when the formula row collapses', async () => {
    render(
      <ScenarioInspector
        value={{ formulas: { damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } } } }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '公式表达式' }), { target: { value: 'max(' } })
    expect(await screen.findByText('公式解析失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '折叠公式 伤害' }))
    expect(screen.queryByText('公式解析失败')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开公式 伤害' }))
    expect(screen.queryByText('公式解析失败')).toBeNull()
  })

  it('closes formula guidance when the row collapses', () => {
    render(
      <ScenarioInspector
        value={{ formulas: { damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } } } }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '查看公式填写帮助' }))
    expect(screen.getByRole('dialog', { name: '公式填写帮助' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '折叠公式 伤害' }))
    expect(screen.queryByRole('dialog', { name: '公式填写帮助' })).toBeNull()
  })

  it('filters formulas by name, id, and description', () => {
    render(
      <ScenarioInspector
        value={{
          formulas: {
            damage: { id: 'damage', name: '减法', description: '扣除防御', ast: { t: 'num', id: 'n0', v: 1 } },
            heal: { id: 'heal', name: '加法', ast: { t: 'num', id: 'n0', v: 2 } },
          },
        }}
        section="formulas"
        onChange={() => undefined}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '搜索公式' }), { target: { value: '防御' } })
    // 公式名称展示为 span：用文本查询验证搜索过滤仍工作
    expect(screen.getByText('减法')).toBeTruthy()
    expect(screen.queryByText('加法')).toBeNull()
  })

  it('validates a formula ID while renaming its name', () => {
    function Harness(): JSX.Element {
      const [value, setValue] = useState<ScenarioMeta>({
        formulas: {
          damage: { id: 'damage', name: '伤害', ast: { t: 'num', id: 'n0', v: 1 } },
        },
      })
      return (
        <>
          <ScenarioInspector value={value} section="formulas" onChange={setValue} />
          <output data-testid="formulas-state">{JSON.stringify(value.formulas)}</output>
        </>
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '伤害更多操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))

    const dialog = screen.getByRole('dialog', { name: '重命名' })
    const idInput = within(dialog).getByLabelText('公式 ID')
    const confirm = within(dialog).getByRole('button', { name: '确认' })

    fireEvent.change(idInput, { target: { value: '1damage' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('ID 只能包含大小写英文字母、数字和下划线，且不能以数字开头')
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('公式名称'), { target: { value: '暴击伤害' } })
    fireEvent.change(idInput, { target: { value: 'damage' } })
    expect(confirm).toBeEnabled()

    fireEvent.click(confirm)
    expect(screen.getByTestId('formulas-state')).toHaveTextContent(
      '"damage":{"id":"damage","name":"暴击伤害"',
    )
  })
})
