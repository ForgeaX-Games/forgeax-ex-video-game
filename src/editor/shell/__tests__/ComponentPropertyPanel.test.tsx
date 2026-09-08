// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerComponent, unregisterComponent } from '@/runtime/core/registry/component-registry'
import {
  TEST_SKILL,
  TEST_TEXT,
  TestSkillManifest,
  TestTextManifest,
} from '../../../runtime/__tests__/test-components'
import { ComponentPropertyPanel } from '../ComponentPropertyPanel'

afterEach(() => {
  cleanup()
  unregisterComponent(TEST_SKILL)
  unregisterComponent(TEST_TEXT)
})

const baseProps = {
  entities: {},
  variables: {},
  onRemoveChild: vi.fn(),
  onPatchChild: vi.fn(),
  onReactionsChange: vi.fn(),
}

describe('ComponentPropertyPanel', () => {
  it('matches the responsive Figma shell and keeps the component label dynamic', () => {
    const onRemoveChild = vi.fn()
    const selectedChild = {
      id: 'q',
      component: 'qte',
      inputs: { timeoutMs: 800 },
    }

    const { container } = render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'hud', children: [selectedChild] }}
        selectedChild={selectedChild}
        onRemoveChild={onRemoveChild}
      />,
    )

    const panel = screen.getByTestId('component-property-panel')
    expect(panel.style.maxWidth).toBe('480px')
    expect(panel).toHaveStyle({ background: '#303030', borderLeft: '1px solid rgba(0,0,0,.4)' })
    expect(screen.queryByRole('tab', { name: 'Agent' })).toBeNull()
    // cpp-tabs 已移除：组件名改由 cpp-title 标题展示，不再有 tab 页签。
    expect(screen.queryByRole('tab', { name: 'qte' })).toBeNull()
    expect(screen.getByText('qte')).toBeTruthy()
    expect(screen.getByRole('button', { name: '更多操作' })).toBeDisabled()
    const actions = screen.getByLabelText('控件操作')
    const actionButtons = within(actions).getAllByRole('button')
    const visibilityButton = screen.getByRole('button', { name: '控件当前显示（显隐暂不可用）' })
    expect(actionButtons[1]).toBe(visibilityButton)
    expect(visibilityButton).toBeDisabled()
    expect(visibilityButton).toHaveAttribute('aria-pressed', 'true')
    expect(visibilityButton.querySelector('svg')).toHaveAttribute('data-icon', 'eye-open')

    const deleteButton = screen.getByRole('button', { name: '删除控件' })
    const deleteIcon = deleteButton.querySelector('img[data-icon="figma-delete"]')
    expect(deleteIcon).toHaveAttribute('alt', '')
    expect(deleteButton).not.toHaveTextContent('×')

    fireEvent.click(deleteButton)
    expect(onRemoveChild).toHaveBeenCalledWith('q')
    const styles = container.querySelector('style')?.textContent
    expect(styles).toContain('width: clamp(360px, 36vw, 480px)')
    expect(styles).toContain('.cpp-section-body input')
    expect(styles).toContain("input[type='number']::-webkit-inner-spin-button")
    expect(styles).toContain('-webkit-appearance: none;')
    expect(styles).not.toContain('.cpp-tab')
    expect(styles).toContain('.cpp-panel input:focus')
    expect(styles).toContain('outline: none !important;\n    box-shadow: none !important;')
    expect(styles).toContain("border-color: rgba(255, 255, 255, 0.08) !important;")
    expect(styles).toContain(".gc-cascade-trigger[aria-expanded='true']")
    expect(styles).toContain('.cff-property-grid')
    expect(styles).toContain('.cff-property-field.is-expression')
    expect(styles).not.toContain('\n  body input')
  })

  it('lays out new manifest fields without changing their value semantics', () => {
    registerComponent(TEST_SKILL, TestSkillManifest)
    const onPatchChild = vi.fn()
    const selectedChild = {
      id: 'skills',
      component: TEST_SKILL,
      inputs: {
        lightResource: { expr: 'max(floor(entity.hero.attr.attack * 2), 0)' },
        lightCost: 100,
      },
    }

    const { container } = render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'battle', children: [selectedChild] }}
        selectedChild={selectedChild}
        onPatchChild={onPatchChild}
      />,
    )

    const parameterBody = container.querySelector('.cpp-section-body')
    expect(parameterBody).toHaveClass('is-new-component')
    const propertyGrid = container.querySelector<HTMLElement>('.cff-property-grid')
    expect(propertyGrid?.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(container.querySelectorAll('.cff-property-field.is-expression').length).toBeGreaterThan(1)
    expect(screen.getByRole('heading', { name: '交互按键' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '战斗参数' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '轻攻击事件' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '重攻击事件' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '冥想事件' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '灭世事件' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /^参数 ·/ })).toBeNull()
    expect(screen.queryByRole('heading', { name: '事件' })).toBeNull()
    const sectionTitles = screen.getAllByRole('heading').map((heading) => heading.textContent)
    expect(sectionTitles.indexOf('战斗参数')).toBeLessThan(sectionTitles.indexOf('轻攻击事件'))
    expect(sectionTitles.indexOf('灭世事件')).toBeLessThan(sectionTitles.indexOf('交互按键'))
    const lightEventSection = screen.getByRole('heading', { name: '轻攻击事件' }).closest('section')
    expect(lightEventSection).toHaveClass('cpp-section')
    expect(getComputedStyle(lightEventSection!).borderTopWidth).not.toBe('0px')
    expect(container.querySelector('style')?.textContent).toContain(
      ".cpp-scroll > .cpp-section:first-child",
    )
    const keySection = container.querySelector("[data-parameter-section='交互按键']")!
    expect(keySection.querySelectorAll('.cff-property-field')).toHaveLength(4)
    const styles = container.querySelector('style')?.textContent
    expect(styles).toContain(
      ".cpp-section[data-parameter-section='交互按键'] .cff-property-grid",
    )
    expect(styles).toContain(
      '.cpp-section-body.is-new-component .cff-property-field {\n    grid-column: 1 / -1;',
    )
    expect(styles).not.toContain('.cff-property-field:nth-last-child(-n + 2)')
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;')
    expect(styles).toContain('.editor-property-cascade-field')
    expect(styles).toContain('row-gap: 12px;')
    expect(styles).toContain('display: contents !important;')
    expect(styles).toContain('grid-column: 1 / -1;')
    expect(styles).toContain(
      '.cpp-section-body.is-new-component [data-node-action-toolbar]',
    )
    const battleSection = container.querySelector("[data-parameter-section='战斗参数']")!
    expect(battleSection.querySelectorAll('.editor-property-cascade-field').length).toBeGreaterThan(1)
    expect(screen.getByText('轻攻击资源')).toBeTruthy()
    expect(screen.getByLabelText('历史表达式')).toHaveValue(
      'max(floor(entity.hero.attr.attack * 2), 0)',
    )

    const constantInputs = screen.getAllByLabelText('常量数值')
    expect(constantInputs[0]).toHaveValue('100')
    expect(constantInputs[0]?.closest('[data-property-layout="true"]')).toBeTruthy()
    fireEvent.change(constantInputs[0]!, { target: { value: '75' } })
    expect(onPatchChild).toHaveBeenCalledWith('skills', {
      inputs: expect.objectContaining({
        lightResource: { expr: 'max(floor(entity.hero.attr.attack * 2), 0)' },
        lightCost: 75,
      }),
    })
  })

  it('keeps manifest-driven parameters and exported events in separate sections', () => {
    const selectedChild = {
      id: 'q',
      component: 'qte',
      inputs: { events: [{ id: 'pass', label: '成功' }], timeoutMs: 800 },
    }

    render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'hud', children: [selectedChild] }}
        selectedChild={selectedChild}
      />,
    )

    expect(screen.getByRole('heading', { name: /^参数 ·/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '事件' })).toBeTruthy()
    expect(screen.getByTestId('overlay-event-editor')).toBeTruthy()
    expect(screen.queryByText('q:pass')).toBeNull()
  })

  it('uses the property layout for effect actions', () => {
    registerComponent(TEST_SKILL, TestSkillManifest)
    const selectedChild = {
      id: 'skills',
      component: TEST_SKILL,
      inputs: {},
    }

    const entities = {
      hero: {
        id: 'hero',
        name: '主角',
        attrs: { hp: 100, nickname: '剑客' },
        attrMeta: { hp: { label: '血量' }, nickname: { label: '昵称' } },
      },
    }
    const variables = {
      score: { id: 'score', name: '数值变量', initial: 10 },
      title: { id: 'title', name: '文本变量', initial: '勇者' },
    }
    const { container, rerender } = render(
      <ComponentPropertyPanel
        {...baseProps}
        entities={entities}
        variables={variables}
        overlay={{
          id: 'battle',
          children: [selectedChild],
          reactions: [{
            when: { type: 'event', id: 'skills:light' },
            do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'hero', attr: 'hp', op: 'add', value: 10 }] }],
          }],
        }}
        selectedChild={selectedChild}
        onCreateVariable={vi.fn()}
      />,
    )

    expect(screen.getByText('效果一')).toBeTruthy()
    expect(screen.getByText('效果主体')).toBeTruthy()
    expect(screen.getByText('赋值')).toBeTruthy()
    // 右栏用「效果一」这套自己的卡片头，不走动作卡片通用的那一只。
    expect(container.querySelector('.ni-na-card-head')).toBeNull()
    expect(screen.queryByText('操作')).toBeNull()
    expect(screen.queryByText('数值')).toBeNull()
    expect(container.querySelector<HTMLElement>("[data-property-effect-action='true']")?.style.borderBottom).toBe('0px')
    expect(screen.getByRole('button', { name: '删除效果' }).querySelector('svg')).toHaveAttribute('data-icon', 'trash-filled')
    expect(screen.getByRole('combobox', { name: '效果主体' })).toBeTruthy()
    const effectEditor = container.querySelector<HTMLElement>('[data-property-effect-editor]')!
    const operation = within(effectEditor).getByRole('group', { name: '运算' })
    expect(within(operation).getAllByRole('button').map((button) => button.textContent)).toEqual([
      '+', '−', '×', '÷', '=',
    ])
    expect(within(effectEditor).getByLabelText('常量数值')).toHaveValue('10')
    expect(screen.getAllByText('新增')).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: '添加效果' })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: '添加界面' })).toHaveLength(4)
    const addBlocks = container.querySelectorAll<HTMLElement>('[data-node-action-add]')
    expect(addBlocks).toHaveLength(4)
    expect([...addBlocks].filter((block) => block.dataset.hasActions === 'true')).toHaveLength(1)
    expect(container.querySelector('style')?.textContent).toContain('height: 28px;')
    expect(container.querySelector('style')?.textContent).toContain('.editor-property-effect-header')
    expect(container.querySelector('style')?.textContent).toContain('.editor-property-add-title')
    expect(container.querySelector('style')?.textContent).toContain(
      "[data-node-action-add][data-has-actions='true']",
    )
    expect(container.querySelector('style')?.textContent).toContain('.editor-property-assign-row')
    expect(container.querySelector('style')?.textContent).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr));',
    )
    expect(container.querySelector('style')?.textContent).toContain(
      '.editor-property-assign-row .gc-mini-action.is-on',
    )
    expect(container.querySelector('style')?.textContent).toContain('width: 28px !important;')
    expect(container.querySelector('style')?.textContent).toContain('height: 28px !important;')
    expect(container.querySelector('style')?.textContent).toContain('font-size: 12px !important;')
    expect(container.querySelector('style')?.textContent).toContain('border-color: #ffffff;')
    expect(effectEditor.querySelector('.editor-property-cascade-field')).toBeTruthy()
    expect(effectEditor.querySelector('.editor-property-assign-field')).toBeTruthy()

    fireEvent.click(within(effectEditor).getByRole('combobox', { name: '效果主体' }))
    const subjectMenu = screen.getByRole('menu', { name: '效果主体选项' })
    expect(within(subjectMenu).queryByText('常量')).toBeNull()
    expect(within(subjectMenu).queryByText('公式')).toBeNull()
    expect(within(subjectMenu).queryByText('昵称')).toBeNull()
    fireEvent.click(within(subjectMenu).getByRole('menuitem', { name: '变量' }))
    expect(within(subjectMenu).getByText(/数值变量/)).toBeTruthy()
    expect(within(subjectMenu).queryByText(/文本变量/)).toBeNull()
    expect(within(subjectMenu).getByRole('menuitem', { name: '新增变量' })).toBeTruthy()

    fireEvent.click(within(effectEditor).getByRole('combobox', { name: '效果主体' }))
    fireEvent.click(within(effectEditor).getByRole('combobox', { name: '数值内容' }))
    const valueMenu = screen.getByRole('menu', { name: '数值内容选项' })
    fireEvent.click(within(valueMenu).getByRole('menuitem', { name: '实体属性' }))
    fireEvent.click(within(valueMenu).getByRole('menuitem', { name: '主角' }))
    expect(within(valueMenu).queryByText('昵称')).toBeNull()
    fireEvent.click(within(valueMenu).getByRole('menuitem', { name: '变量' }))
    expect(within(valueMenu).getByText(/数值变量/)).toBeTruthy()
    expect(within(valueMenu).queryByText(/文本变量/)).toBeNull()

    rerender(
      <ComponentPropertyPanel
        {...baseProps}
        entities={entities}
        variables={variables}
        overlay={{
          id: 'battle',
          children: [selectedChild],
          reactions: [{
            when: { type: 'event', id: 'skills:light' },
            do: [{
              kind: 'effect',
              effects: [{
                kind: 'attr',
                entityId: 'hero',
                attr: 'hp',
                op: 'add',
                value: { expr: 'entity.hero.attr.hp', pick: { mode: 'pick', terms: [{ op: '+', source: 'entity', refId: 'hero', attr: 'hp' }] } },
              }],
            }],
          }],
        }}
        selectedChild={selectedChild}
        onCreateVariable={vi.fn()}
      />,
    )
    expect(within(container.querySelector<HTMLElement>('[data-property-effect-editor]')!)
      .queryByLabelText('常量数值')).toBeNull()
  })

  it('numbers property effects and keeps a divider between them', () => {
    registerComponent(TEST_SKILL, TestSkillManifest)
    const selectedChild = {
      id: 'skills',
      component: TEST_SKILL,
      inputs: {},
    }
    const { container } = render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{
          id: 'battle',
          children: [selectedChild],
          reactions: [{
            when: { type: 'event', id: 'skills:light' },
            do: [
              { kind: 'effect', effects: [{ kind: 'attr', entityId: 'hero', attr: 'hp', op: 'add', value: 10 }] },
              { kind: 'effect', effects: [{ kind: 'attr', entityId: 'hero', attr: 'hp', op: 'set', value: 100 }] },
            ],
          }],
        }}
        selectedChild={selectedChild}
      />,
    )

    expect(screen.getByText('效果一')).toBeTruthy()
    expect(screen.getByText('效果二')).toBeTruthy()
    const effectActions = container.querySelectorAll<HTMLElement>("[data-property-effect-action='true']")
    expect(effectActions).toHaveLength(2)
    expect(effectActions[0]?.style.borderBottom).toContain('1px')
    expect(effectActions[1]?.style.borderBottom).toBe('0px')
  })

  it('preserves locked editing and the dark unselected state', () => {
    const selectedChild = {
      id: 'q',
      component: 'qte',
      inputs: { events: [{ id: 'pass', label: '成功' }], timeoutMs: 800 },
    }
    const { rerender } = render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'hud', children: [selectedChild] }}
        selectedChild={selectedChild}
        locked
      />,
    )

    expect(screen.queryByRole('button', { name: '删除控件' })).toBeNull()
    expect(screen.getByText(/不能增删或拖动控件/)).toBeTruthy()
    expect(screen.getByTestId('overlay-event-editor')).not.toBeDisabled()

    rerender(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'empty', children: [] }}
      />,
    )
    expect(screen.getByText('在画布或图层中选择一个控件。')).toBeTruthy()
    // cpp-tabs 已移除：「组件」标题改由 cpp-title 展示，不再以 tab 形式出现。
    expect(screen.queryByRole('tab', { name: '控件' })).toBeNull()
    expect(screen.getByText('控件')).toBeTruthy()
  })

  it('marks duplicate interaction keys in the 交互按键 section', () => {
    registerComponent(TEST_SKILL, TestSkillManifest)
    const selectedChild = {
      id: 'skills',
      component: TEST_SKILL,
      inputs: { heavyKey: 'C' },
    }
    const conflicts = new Map([
      ['hud/skills/heavyKey', {
        site: {
          id: 'hud/skills/heavyKey',
          overlayId: 'hud',
          overlayTitle: '战斗 HUD',
          childId: 'skills',
          componentId: TEST_SKILL,
          componentName: '战斗技能条',
          inputKey: 'heavyKey',
          inputLabel: '重攻击按键',
          interactionName: '重攻击',
          key: 'C',
          normalizedKey: 'C',
        },
        others: [{
          id: 'other/opt/triggerKey',
          overlayId: 'other',
          overlayTitle: '新方案 3',
          childId: 'opt',
          componentId: TEST_TEXT,
          componentName: '文字交互',
          inputKey: 'triggerKey',
          inputLabel: '触发按键',
          interactionName: '触发',
          key: 'C',
          normalizedKey: 'C',
        }],
      }],
    ])

    const { rerender } = render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'hud', children: [selectedChild] }}
        selectedChild={selectedChild}
        keyConflicts={conflicts}
      />,
    )

    const heavy = screen.getByDisplayValue('C')
    expect(heavy.closest('[data-key-conflict="true"]')).toBeTruthy()
    expect(screen.getByText('按键重复')).toBeTruthy()
    fireEvent.pointerEnter(heavy.closest('[data-key-conflict]')!)
    expect(screen.getByRole('tooltip').textContent).toBe('按键C已应用于文字交互-触发')

    const conflictField = heavy.closest<HTMLElement>('[data-key-conflict="true"]')!
    const scrollIntoView = vi.fn()
    conflictField.scrollIntoView = scrollIntoView
    rerender(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'hud', children: [selectedChild] }}
        selectedChild={selectedChild}
        keyConflicts={conflicts}
        keyConflictFocusRequest={{ childId: 'skills', nonce: 1 }}
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  it('does not focus or activate controls when field labels are clicked', () => {
    registerComponent(TEST_TEXT, TestTextManifest)
    const selectedChild = {
      id: 'option',
      component: TEST_TEXT,
      inputs: {},
    }
    const { container } = render(
      <ComponentPropertyPanel
        {...baseProps}
        overlay={{ id: 'hud', children: [selectedChild] }}
        selectedChild={selectedChild}
      />,
    )

    const fontSizeInput = container.querySelector<HTMLInputElement>('input[type="number"]')!
    const fontSizeLabel = screen.getByText('字号')
    const fontSizeLayout = fontSizeLabel.closest<HTMLElement>('.cff-field-layout')!
    fireEvent.click(fontSizeLabel)
    expect(document.activeElement).not.toBe(fontSizeInput)
    expect(getComputedStyle(fontSizeLayout).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')

    fireEvent.click(screen.getByText('字色'))
    expect(document.querySelector('.gc-cp-panel')).toBeNull()
    expect(container.querySelector('.cff-property-grid label')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '#F0F0F0' }))
    expect(document.querySelector('.gc-cp-panel')).toBeTruthy()
  })

  it('stretches to fill a host slot that is flex flex-col (height pull-through)', () => {
    // 宿主 slot（game-video-inspector-slot）是 display:flex; flex-direction:column。
    // .cpp-panel 作为其 flex 子项，主轴=垂直：flex-grow 必须 > 0 才会沿主轴拉满高度，
    // 否则 height:100% 在 flex 子项上不可靠、会塌成内容高（即「高度没拉通」）。
    const { container } = render(
      <div style={{ display: 'flex', flexDirection: 'column', height: 600 }}>
        <ComponentPropertyPanel
          {...baseProps}
          overlay={{ id: 'hud', children: [] }}
        />
      </div>,
    )
    const panel = screen.getByTestId('component-property-panel')
    const cs = getComputedStyle(panel)
    // flex:1 1 auto → flexGrow=1（沿垂直主轴拉伸）；旧的 flex:0 0 ... → flexGrow=0（不拉通）。
    expect(cs.flexGrow).toBe('1')
    // 宽度钳制仍保留（查注入的 CSS 文本，不依赖 happy-dom 对 clamp() 的计算解析）。
    expect(container.querySelector('style')?.textContent).toContain('width: clamp(360px, 36vw, 480px)')
  })
})
