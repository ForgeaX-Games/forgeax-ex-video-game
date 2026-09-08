// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula, FormulaHoleBinding } from '@/authoring/blueprint/formula-authoring'
import { FormulaApplyEditor } from '../FormulaApplyEditor'
import { ensureEntityAttribute, ensureVariable } from '@/authoring/formulas/meta-catalog'

afterEach(cleanup)

function chooseCascade(trigger: HTMLElement, ...labels: string[]): void {
  fireEvent.click(trigger)
  for (const label of labels) {
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
  }
}

describe('FormulaApplyEditor variable guidance', () => {
  it('renders incomplete parameter binding as a dark warning bar with AI entry', () => {
    const formula: Formula = {
      id: 'formula-param',
      name: '参数公式',
      ast: { t: 'hole', id: 'param', holeId: 'param', kind: 'number', label: '参数' },
    }
    const { container } = render(
      <FormulaApplyEditor
        formulaId={formula.id}
        holeBindings={{}}
        formulas={{ [formula.id]: formula }}
        entities={{}}
        variables={{}}
        propertyLayout
        onChange={vi.fn()}
      />,
    )

    const alert = container.querySelector<HTMLElement>('[data-formula-binding-alert]')!
    expect(alert).toHaveStyle({
      background: '#222',
      color: '#ff6b6b',
      borderRadius: '8px',
      padding: '0px 8px 0px 10px',
    })
    expect(alert.style.gap).toBe('')
    expect(alert.style.minHeight).toBe('')
    expect(alert).toHaveTextContent('参数绑定未完成：参数（尚未选择数值来源），补全后才会用于结算')
    const aiButton = screen.getByRole('button', { name: 'AI 补全参数' })
    expect(aiButton).toBeEnabled()
    expect(aiButton).toHaveStyle({ width: '18px', height: '18px', cursor: 'pointer' })
    expect(aiButton).toHaveAttribute('title', '引用到 Agent 对话')
    expect(aiButton.querySelector('img')).toHaveAttribute('width', '18')
    expect(aiButton.querySelector('img')).toHaveAttribute('height', '18')
  })

  it('prompts the author to create a variable referenced by the selected formula', () => {
    const formula: Formula = {
      id: 'formula-rage',
      name: '怒气伤害',
      ast: { t: 'ref', id: 'r0', ref: { kind: 'var', varId: 'rage' } },
    }
    render(
      <FormulaApplyEditor
        formulaId={formula.id}
        holeBindings={{}}
        formulas={{ [formula.id]: formula }}
        entities={{}}
        variables={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('公式引用的变量「rage」尚未创建，请先到「规则 → 变量」创建变量。')).toBeTruthy()
  })

  it('prompts for creating variables when the selected formula has an unbound variable slot', () => {
    const formula: Formula = {
      id: 'formula-slot',
      name: '变量加成',
      ast: { t: 'hole', id: 'h0', holeId: 'bonus', kind: 'var', label: '加成变量' },
    }
    render(
      <FormulaApplyEditor
        formulaId={formula.id}
        holeBindings={{}}
        formulas={{ [formula.id]: formula }}
        entities={{}}
        variables={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('该公式需要变量，请先到「规则 → 变量」创建变量。')).toBeTruthy()
  })

  it('creates and binds a variable from a formula slot', () => {
    const formula: Formula = {
      id: 'formula-slot',
      name: '变量加成',
      ast: { t: 'hole', id: 'h0', holeId: 'bonus', kind: 'var', label: '加成变量' },
    }
    let latestVariables: Record<string, Variable> = {}
    const onChange = vi.fn()
    function Harness(): JSX.Element {
      const [variables, setVariables] = useState<Record<string, Variable>>({})
      latestVariables = variables
      return (
        <FormulaApplyEditor
          formulaId={formula.id}
          holeBindings={{}}
          formulas={{ [formula.id]: formula }}
          entities={{}}
          variables={variables}
          createVariable={{
            onCreate: (request) => setVariables((current) => ensureVariable(current, request)),
          }}
          onChange={onChange}
        />
      )
    }
    render(<Harness />)

    expect(screen.queryByText('该公式需要变量，请先到「规则 → 变量」创建变量。')).toBeNull()
    chooseCascade(
      screen.getByRole('combobox', { name: '加成变量来源' }),
      '变量',
      '新增变量',
    )
    expect(screen.queryByRole('textbox', { name: '加成变量的新变量 ID' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '新变量显示名' }), {
      target: { value: '加成率' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新变量初始值' }), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(latestVariables.var0).toEqual({
      id: 'var0',
      name: '加成率',
      initial: 2,
    })
    expect(onChange).toHaveBeenCalledWith({
      expr: 'var.var0',
      pick: {
        mode: 'formula',
        formulaId: 'formula-slot',
        holeBindings: {
          bonus: { kind: 'var', varId: 'var0' },
        },
      },
    })
  })

  it('keeps random sample output stable across unrelated rerenders', () => {
    const formula: Formula = {
      id: 'formula-random',
      name: '随机伤害',
      ast: {
        t: 'unary',
        id: 'neg',
        op: '-',
        x: {
          t: 'call',
          id: 'floor',
          name: 'floor',
          args: [{
            t: 'bin',
            id: 'mul',
            op: '*',
            a: { t: 'num', id: 'base', v: 10 },
            b: {
              t: 'bin',
              id: 'random-factor',
              op: '+',
              a: { t: 'num', id: 'min-factor', v: 0.85 },
              b: {
                t: 'bin',
                id: 'random-span',
                op: '*',
                a: { t: 'call', id: 'rand', name: 'rand', args: [] },
                b: { t: 'num', id: 'span', v: 0.3 },
              },
            },
          }],
        },
      },
    }
    function Harness(): JSX.Element {
      const [, rerender] = useState(0)
      return (
        <>
          <button type="button" onClick={() => rerender((value) => value + 1)}>刷新</button>
          <FormulaApplyEditor
            formulaId={formula.id}
            holeBindings={{}}
            formulas={{ [formula.id]: formula }}
            entities={{}}
            variables={{}}
            onChange={vi.fn()}
          />
        </>
      )
    }
    render(<Harness />)
    const first = screen.getByText(/^≈ /).textContent
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(screen.getByText(/^≈ /).textContent).toBe(first)
  })
})

describe('FormulaApplyEditor reusable entity parameters', () => {
  const formula: Formula = {
    id: 'formula-damage',
    name: '通用伤害',
    ast: {
      t: 'bin',
      id: 'damage',
      op: '-',
      a: { t: 'hole', id: 'attacker', holeId: 'attacker', kind: 'number', label: '攻击方属性' },
      b: { t: 'hole', id: 'defender', holeId: 'defender', kind: 'number', label: '防御方属性' },
    },
  }
  const entities = {
    player: { id: 'player', name: '玩家', attrs: { attack: 40, defense: 10 } },
    boss: { id: 'boss', name: 'Boss', attrs: { attack: 55, defense: 20 } },
  }

  it('binds both formula parameters to entity attributes and allows rebinding the defender', () => {
    const onChange = vi.fn()
    function Harness(): JSX.Element {
      const [bindings, setBindings] = useState<Record<string, FormulaHoleBinding>>({})
      return (
        <FormulaApplyEditor
          formulaId={formula.id}
          holeBindings={bindings}
          formulas={{ [formula.id]: formula }}
          entities={entities}
          variables={{}}
          onChange={(next) => {
            onChange(next)
            const formulaValue = next as {
              pick?: { mode?: string; holeBindings?: Record<string, FormulaHoleBinding> }
            }
            if (formulaValue.pick?.mode === 'formula' && formulaValue.pick.holeBindings) {
              setBindings(formulaValue.pick.holeBindings)
            }
          }}
        />
      )
    }

    render(<Harness />)
    const attacker = screen.getByRole('group', { name: '参数：攻击方属性' })
    const defender = screen.getByRole('group', { name: '参数：防御方属性' })
    expect(within(attacker).getAllByRole('combobox')).toHaveLength(1)
    expect(within(defender).getAllByRole('combobox')).toHaveLength(1)

    chooseCascade(
      within(attacker).getByRole('combobox', { name: '攻击方属性来源' }),
      '实体属性',
      '玩家',
      'attack',
    )

    chooseCascade(
      within(defender).getByRole('combobox', { name: '防御方属性来源' }),
      '实体属性',
      'Boss',
      'defense',
    )

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      expr: 'entity.player.attr.attack - entity.boss.attr.defense',
    }))
    expect(screen.getByText(/^≈ 20/)).toBeTruthy()

    chooseCascade(
      within(defender).getByRole('combobox', { name: '防御方属性来源' }),
      '实体属性',
      '玩家',
      'defense',
    )

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      expr: 'entity.player.attr.attack - entity.player.attr.defense',
    }))
  })

  it('shows the exact stale entity binding instead of silently treating it as zero', () => {
    render(
      <FormulaApplyEditor
        formulaId={formula.id}
        holeBindings={{
          attacker: { kind: 'entityAttr', entityId: 'deleted-enemy', attr: 'attack' },
          defender: { kind: 'entityAttr', entityId: 'boss', attr: 'defense' },
        }}
        formulas={{ [formula.id]: formula }}
        entities={entities}
        variables={{}}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent)
      .toContain('攻击方属性（实体「deleted-enemy」已不存在）')
    expect(screen.queryByText(/^≈ /)).toBeNull()
  })

  it('offers confirmed creation for a missing formula attribute and selects it immediately', () => {
    const maxFormula: Formula = {
      id: 'formula-max-hp',
      name: '恢复公式',
      ast: {
        t: 'hole',
        id: 'max-hp',
        holeId: 'maxHp',
        kind: 'entityAttr',
        label: '生命上限',
        suggestAttr: 'hpMax',
      },
    }
    let latestBindings: Record<string, FormulaHoleBinding> = {
      maxHp: { kind: 'entityAttr', entityId: 'ent-0', attr: 'hpMax' },
    }
    function Harness(): JSX.Element {
      const [entities, setEntities] = useState<Record<string, Entity>>({
        'ent-0': {
          id: 'ent-0',
          name: '我方',
          attrs: { hp: 80 },
          attrMeta: { hp: { label: '当前血量', initial: 80 } },
        },
      })
      const [bindings, setBindings] = useState(latestBindings)
      latestBindings = bindings
      return (
        <>
          <FormulaApplyEditor
            formulaId={maxFormula.id}
            holeBindings={bindings}
            formulas={{ [maxFormula.id]: maxFormula }}
            entities={entities}
            variables={{}}
            createAttribute={{
              template: {
                attrId: 'qiMax',
                initialValue: 5,
                meta: { label: '气力上限', initial: 5, min: 0 },
              },
              onCreate: (request) => {
                setEntities((current) => ensureEntityAttribute(current, request) ?? current)
              },
            }}
            onChange={(next) => {
              const formulaValue = next as {
                pick?: { mode?: string; holeBindings?: Record<string, FormulaHoleBinding> }
              }
              if (formulaValue.pick?.mode === 'formula' && formulaValue.pick.holeBindings) {
                setBindings(formulaValue.pick.holeBindings)
              }
            }}
          />
          <output data-testid="entities-state">{JSON.stringify(entities)}</output>
        </>
      )
    }
    render(<Harness />)

    expect(screen.queryByText(/参数绑定未完成/)).toBeNull()
    chooseCascade(
      screen.getByRole('combobox', { name: '生命上限来源' }),
      '实体属性',
      '我方',
      '新增属性',
    )
    expect(screen.queryByRole('textbox', { name: '我方的新属性 ID' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新属性显示名' })).toHaveValue('生命上限')
    expect(screen.getByRole('textbox', { name: '新属性初始值' })).toHaveValue('100')

    fireEvent.change(screen.getByRole('textbox', { name: '新属性显示名' }), {
      target: { value: '最大生命' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '新属性初始值' }), {
      target: { value: '150' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(screen.getByTestId('entities-state')).toHaveTextContent('"hpMax":150')
    expect(screen.getByTestId('entities-state')).toHaveTextContent(
      '"hpMax":{"label":"最大生命","initial":150,"min":0}',
    )
    expect(latestBindings.maxHp).toEqual({
      kind: 'entityAttr',
      entityId: 'ent-0',
      attr: 'hpMax',
    })
    expect(screen.queryByText(/参数绑定未完成/)).toBeNull()
  })

  it('creates an entity and formula attribute from an empty rule catalog', () => {
    const hpFormula: Formula = {
      id: 'formula-current-hp',
      name: '当前生命',
      ast: {
        t: 'hole',
        id: 'current-hp',
        holeId: 'currentHp',
        kind: 'entityAttr',
        label: '当前血量',
        suggestAttr: 'hp',
      },
    }
    let latestBindings: Record<string, FormulaHoleBinding> = {}
    function Harness(): JSX.Element {
      const [entities, setEntities] = useState<Record<string, Entity>>({})
      const [bindings, setBindings] = useState<Record<string, FormulaHoleBinding>>({})
      latestBindings = bindings
      return (
        <>
          <FormulaApplyEditor
            formulaId={hpFormula.id}
            holeBindings={bindings}
            formulas={{ [hpFormula.id]: hpFormula }}
            entities={entities}
            variables={{}}
            createEntity={{
              onCreate: (request) => {
                setEntities((current) => ({
                  ...current,
                  [request.entityId]: {
                    id: request.entityId,
                    name: request.name,
                    attrs: {},
                    attrMeta: {},
                  },
                }))
              },
            }}
            createAttribute={{
              onCreate: (request) => {
                setEntities((current) => ensureEntityAttribute(current, request) ?? current)
              },
            }}
            onChange={(next) => {
              const formulaValue = next as {
                pick?: { mode?: string; holeBindings?: Record<string, FormulaHoleBinding> }
              }
              if (formulaValue.pick?.mode === 'formula' && formulaValue.pick.holeBindings) {
                setBindings(formulaValue.pick.holeBindings)
              }
            }}
          />
          <output data-testid="empty-entities-state">{JSON.stringify(entities)}</output>
        </>
      )
    }
    render(<Harness />)

    chooseCascade(
      screen.getByRole('combobox', { name: '当前血量来源' }),
      '实体属性',
      '新增实体',
    )
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新实体显示名' })).toHaveValue('实体')
    expect(screen.queryByRole('textbox', { name: '新属性 ID' })).toBeNull()
    expect(screen.getByRole('textbox', { name: '新属性显示名' })).toHaveValue('当前血量')
    expect(screen.getByRole('textbox', { name: '新属性初始值' })).toHaveValue('100')

    fireEvent.change(screen.getByRole('textbox', { name: '新实体显示名' }), {
      target: { value: '敌方' },
    })
    fireEvent.click(screen.getByRole('button', { name: '确认' }))

    expect(screen.getByTestId('empty-entities-state')).toHaveTextContent(
      '"entity":{"id":"entity","name":"敌方","attrs":{"hp":100}',
    )
    expect(latestBindings.currentHp).toEqual({
      kind: 'entityAttr',
      entityId: 'entity',
      attr: 'hp',
    })
  })

  it('keeps entity and attribute creation visible beside existing formula bindings', () => {
    const hpFormula: Formula = {
      id: 'formula-current-hp',
      name: '当前生命',
      ast: {
        t: 'hole',
        id: 'current-hp',
        holeId: 'currentHp',
        kind: 'entityAttr',
        label: '当前血量',
        suggestAttr: 'hp',
      },
    }
    const onChange = vi.fn()
    const hpEntities = {
      hero: {
        id: 'hero',
        name: '主角',
        attrs: { hp: 100 },
        attrMeta: { hp: { label: '生命值', initial: 100 } },
      },
    }
    render(
      <FormulaApplyEditor
        formulaId={hpFormula.id}
        holeBindings={{}}
        formulas={{ [hpFormula.id]: hpFormula }}
        entities={hpEntities}
        variables={{}}
        createEntity={{
          template: { entityId: 'enemy', name: '敌方' },
          onCreate: vi.fn(),
        }}
        createAttribute={{
          template: {
            attrId: 'hp',
            initialValue: 100,
            meta: { label: '当前血量', initial: 100 },
          },
          onCreate: vi.fn(),
        }}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: '当前血量来源' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '实体属性' }))

    expect(screen.getByRole('menuitem', { name: '主角' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增实体' }))
    expect(screen.queryByRole('textbox', { name: '新实体 ID' })).toBeNull()
    let menuLabels = screen.getAllByRole('menuitem')
      .map((item) => item.getAttribute('aria-label'))
    expect(menuLabels.indexOf('主角')).toBeLessThan(menuLabels.indexOf('新增实体'))

    fireEvent.click(screen.getByRole('menuitem', { name: '主角' }))
    expect(screen.getByRole('menuitem', { name: '生命值' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增属性' }))
    expect(screen.queryByRole('textbox', { name: '主角的新属性 ID' })).toBeNull()
    menuLabels = screen.getAllByRole('menuitem')
      .map((item) => item.getAttribute('aria-label'))
    expect(menuLabels.indexOf('生命值')).toBeLessThan(menuLabels.indexOf('新增属性'))

    fireEvent.click(screen.getByRole('menuitem', { name: '生命值' }))
    expect(onChange).toHaveBeenCalledWith({
      expr: 'entity.hero.attr.hp',
      pick: {
        mode: 'formula',
        formulaId: hpFormula.id,
        holeBindings: {
          currentHp: { kind: 'entityAttr', entityId: 'hero', attr: 'hp' },
        },
      },
    })
  })
})
