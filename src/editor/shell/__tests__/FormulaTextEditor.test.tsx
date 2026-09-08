// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { previewFormula } from '@/authoring/blueprint/formula-authoring'
import { FormulaTextEditor } from '../FormulaTextEditor'

afterEach(cleanup)

describe('FormulaTextEditor hole guidance', () => {
  it('highlights holes in the multiline editor without rendering a permanent example', () => {
    const { container } = render(
      <FormulaTextEditor
        ast={{
          t: 'bin',
          id: 'sum',
          op: '+',
          a: { t: 'hole', id: 'h-atk', holeId: '攻击力', kind: 'number', label: '攻击力' },
          b: { t: 'hole', id: 'h-bonus', holeId: '加成', kind: 'number', label: '加成' },
        }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('region', { name: '公式示例' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '公式表达式' }), {
      target: { value: '?攻击力 +\n?加成' },
    })
    const highlight = container.querySelector('.gc-fx-highlight')
    expect(highlight?.textContent).toBe('?攻击力 +\n?加成')
    // 默认输出纯文本（无彩色 tag）；需要高亮时给 FormulaSyntax 传 tagged。
    expect(highlight?.querySelectorAll('.gc-fx-hole-tag')).toHaveLength(0)
    expect(container.querySelectorAll('.gc-fx-hole-tag')).toHaveLength(0)
  })

  it('highlights function names as ref tags when followed by (', () => {
    const { container } = render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        onChange={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: '公式表达式' }), {
      target: { value: 'max(?攻击力, 0) + floor(?倍率)' },
    })
    const highlight = container.querySelector('.gc-fx-highlight')
    // 默认输出纯文本：不再有 fn-tag / hole-tag 包裹，textContent 仍逐字还原输入。
    expect(highlight?.querySelectorAll('.gc-fx-fn-tag')).toHaveLength(0)
    expect(highlight?.querySelectorAll('.gc-fx-hole-tag')).toHaveLength(0)
    expect(highlight?.textContent).toBe('max(?攻击力, 0) + floor(?倍率)')
  })

  it('renders nested function calls as plain text by default (tags opt-in)', () => {
    const { container } = render(
      <FormulaTextEditor ast={{ t: 'num', id: 'n0', v: 0 }} onChange={vi.fn()} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: '公式表达式' }), {
      target: { value: 'max(floor(?x), 1)' },
    })
    const highlight = container.querySelector('.gc-fx-highlight')
    // 默认无彩色 tag，括号嵌套仍以纯文本完整还原。
    expect(highlight?.querySelectorAll('.gc-fx-fn-tag')).toHaveLength(0)
    expect(highlight?.textContent).toBe('max(floor(?x), 1)')
  })
})

describe('FormulaTextEditor input state', () => {
  it('renders a new draft formula empty and commits the first expression normally', () => {
    const onChange = vi.fn()
    const onEmpty = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        empty
        onEmpty={onEmpty}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', '例如:var.a-b')

    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ t: 'num', v: 25 }))
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('selects the initial zero so the first edit replaces it', () => {
    const onChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    fireEvent.focus(input)

    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(1)

    fireEvent.change(input, { target: { value: '25', selectionStart: 2, selectionEnd: 2 } })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ t: 'num', v: 25 }))
  })

  it('clearing the input calls onEmpty instead of falling back to a 0 ast', () => {
    const onChange = vi.fn()
    const onEmpty = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 25 }}
        onEmpty={onEmpty}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    // 编辑后删空 → 应走 onEmpty（保持空），不应回退 onChange({t:'num',v:0}) 让 "0" 复活。
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(onEmpty).toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ t: 'num', v: 0 }))
  })

  it('reports parsing errors without duplicating the short error or parameter count', async () => {
    const onChange = vi.fn()
    const onParseFailureChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'hole', id: 'h-atk', holeId: '攻击力', kind: 'number', label: '攻击力' }}
        onParseFailureChange={onParseFailureChange}
        onChange={onChange}
      />,
    )

    expect(screen.queryByText(/参数 1/)).toBeNull()
    expect(screen.getByText('试算')).toBeTruthy()

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, { target: { value: 'max(' } })
    await waitFor(() => expect(onParseFailureChange).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'game-video.formula-parse-failure.v1',
      invalidDraft: 'max(',
      parserDiagnostic: expect.any(String),
    })))
    expect(input).toHaveClass('is-err')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('无法解析')).toBeNull()
    expect(screen.queryByText(/^错误详情：/)).toBeNull()
    // 编辑器在解析失败时仍正常渲染（输入框可见，未卸载）。
    expect(screen.getByRole('textbox', { name: '公式表达式' })).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'max(1, 2)' } })
    await waitFor(() => expect(onParseFailureChange).toHaveBeenLastCalledWith(null))
  })

  it('inserts a tool fragment at the saved selection after the toolbar takes focus', () => {
    render(
      <FormulaTextEditor
        ast={{
          t: 'bin',
          id: 'sum',
          op: '+',
          a: { t: 'num', id: 'one', v: 1 },
          b: { t: 'num', id: 'two', v: 2 },
        }}
        onChange={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    const insertHole = screen.getByRole('button', { name: '插入参数' })
    fireEvent.focus(input)
    input.setSelectionRange(4, 5)
    fireEvent.select(input)
    fireEvent.blur(input, { relatedTarget: insertHole })
    fireEvent.click(insertHole)

    expect(input.value).toBe('1 + ?参数')
    expect(input.selectionStart).toBe('1 + ?参数'.length)
    expect(input.selectionEnd).toBe('1 + ?参数'.length)
  })
})

describe('FormulaTextEditor authoring syntax', () => {
  const entities = {
    'ent-player': {
      id: 'ent-player',
      name: '玩家',
      attrs: { attack: 80, 'attack-power': 100 },
    },
    'ent-boss': {
      id: 'ent-boss',
      name: '敌人',
      attrs: { defense: 50 },
    },
  }

  it('uses common dropdowns for entity, variable, and function insertion', () => {
    const variables = {
      combo: { id: 'combo', name: '连击', initial: 1 },
    }
    const { container } = render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        empty
        entities={entities}
        variables={variables}
        onChange={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' }) as HTMLTextAreaElement
    const entity = screen.getByRole('combobox', { name: '插入实体属性' })
    const variable = screen.getByRole('combobox', { name: '插入变量' })
    const fn = screen.getByRole('combobox', { name: '插入函数' })
    const parameter = screen.getByRole('button', { name: '插入参数' })
    expect(entity).toHaveTextContent('实体')
    expect(variable).toHaveTextContent('变量')
    expect(fn).toHaveTextContent('函数')
    expect(entity.querySelector('.gc-cascade-trigger-add')).toHaveStyle({ width: '18px', height: '18px' })
    expect(variable.querySelector('.gc-cascade-trigger-add')).toHaveStyle({ width: '18px', height: '18px' })
    expect(fn.querySelector('.gc-cascade-trigger-add')).toHaveStyle({ width: '18px', height: '18px' })
    expect(entity.querySelector('.gc-cascade-trigger-add > img')).toBeInTheDocument()
    expect(variable.querySelector('.gc-cascade-trigger-add > img')).toBeInTheDocument()
    expect(fn.querySelector('.gc-cascade-trigger-add > img')).toBeInTheDocument()
    expect(parameter.querySelector('.gc-fx-tool-add')).toHaveClass('gc-fx-tool-add')
    expect(parameter.querySelector('.gc-fx-tool-label')).toHaveTextContent('参数留空')
    expect(parameter).toHaveTextContent('参数留空')
    expect(parameter.querySelector('.gc-fx-tool-add > img')).toBeInTheDocument()
    expect(container.querySelector('.gc-fx-tools select')).toBeNull()

    fireEvent.click(entity)
    fireEvent.click(screen.getByRole('menuitem', { name: /玩家/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'attack' }))
    expect(input.value).toBe('entity.ent-player.attr.attack')

    fireEvent.click(variable)
    fireEvent.click(screen.getByRole('menuitem', { name: /连击/ }))
    expect(input.value).toBe('entity.ent-player.attr.attackvar.combo')

    fireEvent.click(fn)
    fireEvent.click(screen.getByRole('menuitem', { name: 'max()' }))
    expect(input.value).toBe('entity.ent-player.attr.attackvar.combomax()')

    fireEvent.click(parameter)
    expect(input.value).toBe('entity.ent-player.attr.attackvar.combomax()?参数')
  })

  it('keeps empty catalog actions visible and disabled', () => {
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        empty
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: '插入实体属性' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '插入变量' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '插入函数' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '插入参数' })).toBeEnabled()
  })

  it('enables the entity/variable pickers when empty but create callbacks are provided', () => {
    const onCreateEntity = vi.fn()
    const onCreateEntityAttribute = vi.fn()
    const onCreateVariable = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        empty
        onCreateEntity={onCreateEntity}
        onCreateEntityAttribute={onCreateEntityAttribute}
        onCreateVariable={onCreateVariable}
        onChange={vi.fn()}
      />,
    )
    // 传了 create 回调 → 即使数据为空，按钮也启用（picker 里有「新建」项）
    expect(screen.getByRole('combobox', { name: '插入实体属性' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: '插入变量' })).toBeEnabled()
  })

  it('does not commit while browsing a portal menu and commits once on outside click', () => {
    const onChange = vi.fn()
    render(
      <>
        <FormulaTextEditor
          ast={{ t: 'num', id: 'n0', v: 0 }}
          entities={entities}
          onChange={onChange}
        />
        <button type="button">外部</button>
      </>,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    const entity = screen.getByRole('combobox', { name: '插入实体属性' })
    fireEvent.change(input, { target: { value: '1 + 2' } })
    fireEvent.blur(input, { relatedTarget: entity })
    fireEvent.click(entity)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByRole('button', { name: '外部' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('commits no-space subtraction using the current entity catalog', () => {
    const onChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        entities={entities}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, {
      target: {
        value: 'entity.ent-player.attr.attack-entity.ent-boss.attr.defense',
      },
    })
    fireEvent.blur(input)

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ t: 'bin', op: '-' }))
  })

  it('normalizes full-width input and Unicode spacing through the shared authoring parser', () => {
    const onChange = vi.fn()
    render(
      <FormulaTextEditor
        ast={{ t: 'num', id: 'n0', v: 0 }}
        onChange={onChange}
      />,
    )

    const input = screen.getByRole('textbox', { name: '公式表达式' })
    fireEvent.change(input, {
      target: { value: 'ｍａｘ（　１０　－ ３，０　）' },
    })
    expect(screen.getByText('≈ 7')).toBeTruthy()
    fireEvent.blur(input)

    expect(previewFormula(onChange.mock.calls[0]![0])).toBe('max(10 - 3, 0)')
  })

  it('visually groups hyphenated references without offering score as authoring input', () => {
    const { container } = render(
      <FormulaTextEditor
        ast={{
          t: 'bin',
          id: 'sum',
          op: '+',
          a: {
            t: 'ref',
            id: 'attack',
            ref: { kind: 'entityAttr', entityId: 'ent-player', attr: 'attack-power' },
          },
          b: { t: 'ref', id: 'score', ref: { kind: 'score' } },
        }}
        entities={entities}
        onChange={vi.fn()}
      />,
    )

    // 默认输出纯文本（无 gc-fx-ref-tag）；ref 仍以原文本出现在高亮层中。
    expect(container.querySelector('.gc-fx-ref-tag')).toBeNull()
    expect(container.querySelector('.gc-fx-highlight')?.textContent)
      .toContain('entity.ent-player.attr.attack-power')
    expect(container.querySelector('.gc-fx-score-tag')).toBeNull()
    expect(screen.queryByRole('button', { name: '插入局面分' })).toBeNull()
    expect(screen.queryByText(/局面分/)).toBeNull()
  })
})
