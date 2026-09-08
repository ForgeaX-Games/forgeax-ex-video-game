import { t as translateUi } from '../../i18n'
import { useEffect, useRef, type JSX } from 'react'
import type { Entity, Overlay, OverlayReaction, Variable } from '@/runtime/core/schema/graph-schema'
import type { ComponentInput } from '@/runtime/core/schema/node-config-schema'
import { aggregateOverlayEvents } from '@/runtime/core/schema/overlay-events'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'
import deleteIconUrl from './assets/component-property-delete.svg?url'
import { ComponentEventsEditor } from './ComponentEventsEditor'
import {
  ComponentFormFields,
  type EntityAttributeCreateHandler,
  type EntityCreateHandler,
  type FormulaCreateHandler,
  type KeyBindingConflictContext,
  type VariableCreateHandler,
} from './component-form-fields'
import { componentTypeLabel } from './editors'
import { useComponentCatalogRevision } from './useComponentCatalogRevision'

interface ParameterSection {
  title: '文本信息' | '血量' | '交互按键' | '战斗参数' | '基础信息'
  keys: string[]
}

const PARAMETER_SECTION_ORDER: ParameterSection['title'][] = [
  '文本信息',
  '血量',
  '战斗参数',
  '基础信息',
  '交互按键',
]

function parameterSectionTitle(componentId: string, input: ComponentInput): ParameterSection['title'] {
  const key = input.key
  const label = input.label ?? key
  if (/key$/i.test(key) || /按键/.test(label)) return '交互按键'
  if (/(Resource|Cost)$/i.test(key)) return '战斗参数'
  if (componentId === 'BattleEnemyHpBar') return '血量'
  if (componentId === 'BattlePlayerHpBar') {
    return /^(label|current|max)$/.test(key) ? '血量' : '战斗参数'
  }
  if (
    /^(Dialogue|StatusNotice|DamageFloatText|GainFloatText|TextOption)$/.test(componentId)
    || /文本|文字|台词|说话人|字色|字号/.test(label)
  ) return '文本信息'
  return '基础信息'
}

function parameterSections(componentId: string): ParameterSection[] {
  const inputs = getComponentManifest(componentId)?.inputs ?? []
  const grouped = new Map<ParameterSection['title'], string[]>()
  for (const input of inputs) {
    const title = parameterSectionTitle(componentId, input)
    grouped.set(title, [...(grouped.get(title) ?? []), input.key])
  }
  return PARAMETER_SECTION_ORDER.flatMap((title) => {
    const keys = grouped.get(title)
    return keys?.length ? [{ title, keys }] : []
  })
}

function eventSectionTitle(event: { label?: string; localEventId: string }): string {
  const label = event.label?.trim() || event.localEventId
  return label.endsWith('事件') ? label : `${label}事件`
}

const panelStyles = `
  .cpp-panel,
  .cpp-panel * {
    box-sizing: border-box;
  }

  .cpp-panel {
    /* 外部 slot（inspectorEl）是 flex column：用 flex:1 沿主轴拉满高度，否则 height:100%
       在 flex 子项上不可靠、会塌成内容高。宽度仍由下面的 width 钳制；
       内联形态（.ose-root > .cpp-panel）由其 !important 规则覆盖，不受影响。 */
    flex: 1 1 auto;
    width: clamp(360px, 36vw, 480px);
    color: #fff;
  }

  .cpp-titlebar {
    display: flex;
    align-items: center;
    min-height: 52px;
    flex: 0 0 52px;
    padding: 0 28px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .cpp-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: #fff;
    font-size: 16px;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .cpp-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: 12px;
  }

  .cpp-action {
    display: inline-grid;
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font: inherit;
    font-size: 18px;
    line-height: 1;
  }

  .cpp-action svg {
    display: block;
    width: 16px;
    height: 16px;
  }

  .cpp-action:disabled {
    color: rgba(255, 255, 255, 0.28);
    cursor: not-allowed;
  }

  .cpp-action:not(:disabled):hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    cursor: pointer;
  }

  .cpp-action.is-delete img {
    display: block;
    width: 16px;
    height: 18px;
  }

  .cpp-scroll {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 0 24px 28px;
  }

  .cpp-section {
    position: relative;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.2);
  }

  /* 只去掉滚动区顶层首个 section 的顶线；事件区包在 wrapper 内时，
   * 其第一个事件（如「轻攻击事件」）不能再用 :first-child 消掉分割线。 */
  .cpp-scroll > .cpp-section:first-child,
  .cpp-scroll > .cpp-note:first-child + .cpp-section {
    border-top: 0;
  }

  .cpp-section + .cpp-section {
    margin-top: 20px;
  }

  .cpp-scroll > .cpp-section + [data-testid='overlay-event-editor'],
  .cpp-scroll > .cpp-note + [data-testid='overlay-event-editor'] {
    margin-top: 20px;
  }

  .cpp-section-title {
    display: flex;
    align-items: center;
    min-height: 20px;
    margin: 0 0 12px;
    color: #fff;
    font-size: 16px;
    font-weight: 500;
    line-height: 20px;
  }

  .cpp-section-title::before {
    content: '';
    width: 3px;
    height: 15px;
    flex: 0 0 3px;
    margin-right: 10px;
    border-radius: 2px;
    background: #ff9138;
  }

  .cpp-section-body {
    min-width: 0;
  }

  .cpp-section-body .cff-field-layout > span:first-child,
  .cpp-section-body .cff-field-layout > div:first-child {
    color: rgba(255, 255, 255, 0.6) !important;
    opacity: 1 !important;
    font-size: 14px !important;
  }

  .cpp-section-body input:not([type='checkbox']):not([type='radio']),
  .cpp-section-body select,
  .cpp-section-body textarea {
    min-height: 28px;
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    border-radius: 8px !important;
    background: #181818 !important;
    color: #fff !important;
  }

  .cpp-panel input:focus,
  .cpp-panel select:focus,
  .cpp-panel textarea:focus {
    outline: none !important;
    box-shadow: none !important;
    border-color: rgba(255, 255, 255, 0.08) !important;
  }

  .cpp-section-body .gc-cascade-trigger:hover,
  .cpp-section-body .gc-cascade-trigger:focus,
  .cpp-section-body .gc-cascade-trigger[aria-expanded='true'] {
    border-color: rgba(255, 255, 255, 0.08) !important;
  }

  .cpp-section-body input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .cpp-section-body input[type='number']::-webkit-inner-spin-button,
  .cpp-section-body input[type='number']::-webkit-outer-spin-button {
    margin: 0;
    -webkit-appearance: none;
  }

  .cpp-section-body input:not([type='checkbox']):not([type='radio']),
  .cpp-section-body textarea {
    padding-right: 8px;
    padding-left: 8px;
  }

  .cpp-section-body select {
    padding-right: 28px;
    padding-left: 8px;
  }

  .cpp-section-body button {
    min-height: 28px;
    border-color: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
  }

  /*
   * 新组件的动态参数在右栏使用参考图的分组节奏。结构仍完全来自
   * ComponentFormFields；这里只重排它已经输出的标签、来源选择器和值控件。
   */
  .cpp-section-body.is-new-component .cff-property-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    column-gap: 8px !important;
    align-items: start !important;
  }

  .cpp-section[data-parameter-section='交互按键'] .cff-property-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }

  .cpp-section-body.is-new-component .cff-property-field {
    grid-column: 1 / -1;
    min-width: 0;
    margin-bottom: 0 !important;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .cpp-section-body.is-new-component .cff-property-field:first-child {
    padding-top: 0;
  }

  .cpp-section-body.is-new-component .cff-property-field:last-child {
    padding-bottom: 0;
  }

  .cpp-section-body.is-new-component .cff-property-field .cff-field-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    column-gap: 8px !important;
  }

  .cpp-section-body.is-new-component .cff-property-field:last-child {
    border-bottom: 0;
  }

  .cpp-section-body.is-new-component
    .cff-property-field.is-expression:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .cpp-section[data-parameter-section='交互按键']
    .cff-property-field:not(:last-child) {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .cpp-section[data-parameter-section='交互按键']
    .cff-property-field:last-child {
    border-bottom: 0;
  }

  .cpp-section-body.is-new-component .cff-property-field.is-expression {
    grid-column: 1 / -1;
  }

  .cpp-section-body.is-new-component
    .cff-property-field.is-expression .editor-property-cascade-field {
    padding: 0;
  }

  .cpp-section-body.is-new-component .cff-property-field.is-expression .gc-cascade-root,
  .cpp-section-body.is-new-component .cff-property-field.is-expression input {
    min-width: 0 !important;
    flex: none !important;
    width: 100% !important;
  }

  .cpp-section-body.is-new-component
    .cpp-manifest-form input[aria-label='历史表达式'] {
    flex: none !important;
    width: 100% !important;
    min-height: 54px;
  }

  .cpp-section-body.is-new-component
    .cpp-manifest-form p {
    width: 100%;
    margin: 8px 0 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: #181818;
    line-height: 1.45;
  }

  .cpp-section-body.is-new-component
    .editor-property-effect-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 28px;
    margin-bottom: 4px;
  }

  .cpp-section-body.is-new-component
    .editor-property-effect-header b {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    font-weight: 600;
  }

  .cpp-section-body.is-new-component
    .editor-property-effect-header button {
    display: grid;
    width: 20px;
    height: 28px;
    min-height: 28px;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    cursor: pointer;
  }

  .cpp-section-body.is-new-component
    .editor-property-effect-header button:hover {
    color: #ff6b6b;
  }

  .cpp-section-body.is-new-component .editor-property-cascade-field {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    column-gap: 8px;
    row-gap: 12px;
    padding: 12px 0 0;
    min-width: 0;
    width: 100%;
  }

  .cpp-section-body.is-new-component .editor-property-cascade-field > span,
  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-field > span:first-child,
  .cpp-section-body.is-new-component
    .editor-property-formula-param-row > span {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    line-height: 28px;
  }

  .cpp-section-body.is-new-component
    .editor-property-cascade-field > .value-input-shell,
  .cpp-section-body.is-new-component
    .editor-property-cascade-field > .text-value-input-shell,
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-value-expression],
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-text-value-editor],
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-text-value-controls] {
    display: contents !important;
  }

  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-value-expression] > .gc-cascade-root,
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-text-value-controls] > .gc-cascade-root {
    grid-column: 2;
    min-width: 0;
    width: 100%;
  }

  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-value-expression] > :not(.gc-cascade-root),
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-text-value-controls] > :not(.gc-cascade-root),
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-text-value-editor] > :not([data-text-value-controls]),
  .cpp-section-body.is-new-component
    .editor-property-cascade-field [data-formula-apply] {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0 0;
    min-width: 0;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-field .value-input-shell,
  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-field [data-value-expression] {
    display: flex !important;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    min-width: 0;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-row {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    column-gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-row > :first-child {
    display: flex !important;
    align-items: center;
    justify-content: flex-start;
    gap: 8px !important;
    width: 100%;
    min-width: 0;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-row > :last-child {
    min-width: 0;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-row .gc-mini-action {
    box-sizing: border-box;
    width: 28px !important;
    height: 28px !important;
    min-width: 28px !important;
    min-height: 28px !important;
    flex: 0 0 28px !important;
    padding: 0 !important;
    border: 1px solid transparent;
    border-radius: 6px;
    background: #181818;
    color: rgba(255, 255, 255, 0.72);
    font-size: 12px !important;
    font-family: inherit;
    line-height: 1;
    display: grid;
    place-items: center;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .editor-property-assign-row .gc-mini-action.is-on {
    border-color: #ffffff;
    background: #181818;
    color: #ffffff;
    font-weight: 600;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-editor] .gc-cascade-root,
  .cpp-section-body.is-new-component
    [data-property-effect-editor] input {
    width: 100% !important;
    min-width: 0 !important;
  }

  .cpp-section-body.is-new-component
    .editor-property-formula-param-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: center;
    column-gap: 8px;
    width: 100%;
  }

  .cpp-section-body.is-new-component
    [data-property-effect-action]:first-child,
  .cpp-section-body.is-new-component
    [data-property-spawn-action]:first-child {
    padding-top: 0 !important;
  }

  .cpp-section-body.is-new-component
    [data-property-spawn-editor] .editor-property-cascade-field > .gc-cascade-root,
  .cpp-section-body.is-new-component
    [data-property-spawn-editor] .editor-property-cascade-field input {
    width: 100% !important;
    min-width: 0 !important;
  }

  .cpp-section-body.is-new-component .editor-property-spawn-props {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 12px 0 0 12px;
    min-width: 0;
  }

  .cpp-section-body.is-new-component .editor-property-spawn-props-title {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    font-weight: 600;
    line-height: 28px;
    margin-bottom: 4px;
  }

  .cpp-section-body.is-new-component
    .editor-property-spawn-props .cff-property-field {
    padding-left: 0;
  }

  .cpp-section-body.is-new-component
    .editor-property-spawn-props .cff-property-field:first-child {
    padding-top: 0;
  }

  .cpp-section-body.is-new-component
    .editor-property-spawn-props .cff-property-field:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }

  .cpp-section-body.is-new-component [data-node-action-add] {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
  }

  .cpp-section-body.is-new-component
    [data-node-action-add][data-has-actions='true'] {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .cpp-section-body.is-new-component .editor-property-add-title {
    color: rgba(255, 255, 255, 0.6);
    font-size: 14px;
    font-weight: 600;
    line-height: 28px;
  }

  .cpp-section-body.is-new-component [data-node-action-toolbar] {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 8px !important;
  }

  .cpp-section-body.is-new-component
    [data-node-action-toolbar] > button {
    width: 100% !important;
    max-width: none !important;
    min-width: 0 !important;
    height: 28px;
    min-height: 28px;
    border-radius: 8px !important;
    background: #191919 !important;
    color: #fff !important;
    font-size: 12px;
    text-align: center;
  }

  .cpp-note {
    margin: 0 0 12px;
    color: rgba(255, 255, 255, 0.55);
    font-size: 11px;
    line-height: 1.5;
  }

  .cpp-empty {
    display: grid;
    min-height: 180px;
    place-items: center;
    padding: 24px;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    line-height: 1.6;
    text-align: center;
  }
`

function VisibilityIcon({ visible }: { visible: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={visible ? 'eye-open' : 'eye-closed'}
    >
      {visible ? (
        <>
          <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.7" />
        </>
      ) : (
        <>
          <path d="m3 3 18 18" />
          <path d="M10.6 6.1A10.5 10.5 0 0 1 12 6c6.1 0 9.5 6 9.5 6a17 17 0 0 1-2.1 2.8M6.2 6.3C3.8 8 2.5 12 2.5 12s3.4 6 9.5 6c1.2 0 2.3-.2 3.3-.6" />
        </>
      )}
    </svg>
  )
}

export interface ComponentPropertyPanelProps {
  overlay: Overlay
  overlays?: Record<string, Overlay>
  selectedChild?: Overlay['children'][number]
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  formulas?: Record<string, Formula>
  itemIds?: readonly string[]
  locked?: boolean
  onRemoveChild: (childId: string) => void
  onPatchChild: (
    childId: string,
    patch: { inputs?: Record<string, unknown> },
  ) => void
  onReactionsChange: (reactions: OverlayReaction[] | undefined) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  /** 跨界面/节点的交互按键冲突表。 */
  keyConflicts?: KeyBindingConflictContext['conflicts']
  /** 画布告警图标触发的右栏定位请求；nonce 允许重复点击同一组件。 */
  keyConflictFocusRequest?: { childId: string; nonce: number }
}

export function ComponentPropertyPanel({
  overlay,
  overlays: overlayCatalog,
  selectedChild,
  entities,
  variables,
  formulas,
  itemIds = [],
  locked = false,
  onRemoveChild,
  onPatchChild,
  onReactionsChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  keyConflicts,
  keyConflictFocusRequest,
}: ComponentPropertyPanelProps): JSX.Element {
  useComponentCatalogRevision()
  const panelRef = useRef<HTMLElement>(null)
  const overlays = overlayCatalog ?? { [overlay.id]: overlay }
  const selectedEvents = selectedChild
    ? aggregateOverlayEvents(
        { id: overlay.id, children: [selectedChild] },
        getComponentManifest,
        { mountId: overlay.id },
      )
    : []
  const spawnOptions = Object.values(overlays).flatMap((definition) =>
    definition.children.map((child) => {
      const value = `${definition.id}/${child.id}`
      const name = [definition.title?.trim(), componentTypeLabel(child.component)]
        .filter((part, index, all) => part && all.indexOf(part) === index)
        .join(' · ')
      return { value, label: authoringOptionLabel(name, value) }
    }))
  const selectedLabel = selectedChild ? componentTypeLabel(selectedChild.component) : '控件'
  const selectedIsNewComponent = selectedChild
    ? !!getComponentManifest(selectedChild.component)
    : false
  const selectedParameterSections = selectedChild && selectedIsNewComponent
    ? parameterSections(selectedChild.component)
    : []
  const keyConflictContext: KeyBindingConflictContext | undefined = selectedChild && keyConflicts
    ? { overlayId: overlay.id, childId: selectedChild.id, conflicts: keyConflicts }
    : undefined

  useEffect(() => {
    if (!keyConflictFocusRequest || selectedChild?.id !== keyConflictFocusRequest.childId) return
    panelRef.current
      ?.querySelector<HTMLElement>('[data-key-conflict="true"]')
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [keyConflictFocusRequest, selectedChild?.id])
  const renderParameterSection = (
    section: { title: string; keys: string[] | undefined },
  ): JSX.Element | null => {
    if (!selectedChild) return null
    const titleId = `cpp-parameters-title-${section.title}`
    return (
      <section
        className="cpp-section"
        aria-labelledby={titleId}
        data-parameter-section={section.title}
        key={section.title}
      >
        <h2 className="cpp-section-title" id={titleId}>{section.title}</h2>
        <div className={`cpp-section-body${selectedIsNewComponent ? ' is-new-component' : ''}`}>
          <div className="cpp-manifest-form">
            <ComponentFormFields
              componentId={selectedChild.component}
              values={selectedChild.inputs ?? {}}
              pickers={{ entities, variables, formulas, itemIds }}
              includeKeys={section.keys}
              density={selectedIsNewComponent ? 'property' : 'compact'}
              labelWidth="7em"
              onChange={(inputs) => onPatchChild(selectedChild.id, { inputs })}
              onCreateEntityAttribute={onCreateEntityAttribute}
              onCreateEntity={onCreateEntity}
              onCreateVariable={onCreateVariable}
              onCreateFormula={onCreateFormula}
              keyConflicts={section.title === '交互按键' ? keyConflictContext : undefined}
            />
          </div>
        </div>
      </section>
    )
  }

  return (
    <aside
      ref={panelRef}
      className="cpp-panel"
      data-testid="component-property-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        maxWidth: 480,
        height: '100%',
        overflow: 'hidden',
        borderLeft: '1px solid rgba(0,0,0,.4)',
        background: '#303030',
        fontSize: 12,
        boxSizing: 'border-box',
      }}
    >
      <style>{panelStyles}</style>
      <div className="cpp-titlebar">
        <div className="cpp-title">{selectedLabel}</div>
        {selectedChild ? (
          <div className="cpp-actions" aria-label={translateUi('ui.copy.99600c99e935')}>
            <button
              className="cpp-action"
              type="button"
              aria-label={translateUi('ui.copy.77836d3a9942')}
              title={translateUi('ui.copy.62b65c93c5c6')}
              disabled
            >
              ⋯
            </button>
            <button
              className="cpp-action"
              type="button"
              aria-label={translateUi('ui.copy.605cbebfe97b')}
              title={translateUi('ui.copy.e24454a6182e')}
              aria-pressed="true"
              data-visibility="visible"
              disabled
            >
              <VisibilityIcon visible />
            </button>
            {!locked ? (
              <button
                className="cpp-action is-delete"
                type="button"
                aria-label={translateUi('ui.copy.42527a170054')}
                title={translateUi('ui.copy.4aef76ccc944')}
                onClick={() => onRemoveChild(selectedChild.id)}
              >
                <img src={deleteIconUrl} alt="" data-icon="figma-delete" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {!selectedChild ? (
        <div className="cpp-empty">{translateUi('ui.copy.1be39382f0b7')}</div>
      ) : (
        <div className="cpp-scroll" data-testid="overlay-selected-child-editor">
          {locked ? (
            <div className="cpp-note" style={{ paddingTop: 16 }}>
              {translateUi('ui.copy.aef532b5c4ef')}</div>
          ) : null}
          {(selectedIsNewComponent
            ? selectedParameterSections.filter((section) => section.title !== '交互按键')
            : [{ title: `${translateUi('ui.object.4bd05c8638e2')}${selectedLabel}`, keys: undefined }]
          ).map(renderParameterSection)}
          {selectedEvents.length > 0 && !selectedIsNewComponent ? (
            <section className="cpp-section" aria-labelledby="cpp-events-title">
              <h2 className="cpp-section-title" id="cpp-events-title">{translateUi('ui.copy.550e3280629d')}</h2>
              {locked ? (
                <div className="cpp-note">
                  {translateUi('ui.copy.53192c61215a')}</div>
              ) : null}
              <fieldset
                className="cpp-section-body"
                data-testid="overlay-event-editor"
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <ComponentEventsEditor
                  mode="catalog"
                  events={selectedEvents}
                  catalogReactions={overlay.reactions}
                  spawnOptions={spawnOptions}
                  overlays={overlays}
                  pickers={{ entities, variables, formulas, itemIds }}
                  onCreateEntityAttribute={onCreateEntityAttribute}
                  onCreateEntity={onCreateEntity}
                  onCreateVariable={onCreateVariable}
                  onCreateFormula={onCreateFormula}
                  onCatalogChange={onReactionsChange}
                />
              </fieldset>
            </section>
          ) : null}
          {selectedIsNewComponent && selectedEvents.length ? (
            <div data-testid="overlay-event-editor">
              {selectedEvents.map((event, eventIndex) => {
                const titleId = `cpp-event-title-${eventIndex}`
                return (
                  <section className="cpp-section" aria-labelledby={titleId} key={event.eventId}>
                    <h2 className="cpp-section-title" id={titleId}>{eventSectionTitle(event)}</h2>
                    <fieldset
                      className="cpp-section-body is-new-component"
                      data-event-section={event.localEventId}
                      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                    >
                      <ComponentEventsEditor
                        mode="catalog"
                        events={[event]}
                        catalogReactions={overlay.reactions}
                        spawnOptions={spawnOptions}
                        overlays={overlays}
                        pickers={{ entities, variables, formulas, itemIds }}
                        showEventTitle={false}
                        propertyLayout
                        onCreateEntityAttribute={onCreateEntityAttribute}
                        onCreateEntity={onCreateEntity}
                        onCreateVariable={onCreateVariable}
                        onCreateFormula={onCreateFormula}
                        onCatalogChange={onReactionsChange}
                      />
                    </fieldset>
                  </section>
                )
              })}
            </div>
          ) : null}
          {selectedIsNewComponent
            ? selectedParameterSections
              .filter((section) => section.title === '交互按键')
              .map(renderParameterSection)
            : null}
        </div>
      )}
    </aside>
  )
}
