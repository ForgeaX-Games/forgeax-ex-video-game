import { RULE_ID_PREFIXES } from '@/authoring/rules/rule-authoring'
import { t as translateUi, tf as formatUi } from '../../i18n'
/**
 * 通用数值表达式编辑器 —— 直接选择具体状态值或具名公式；固定值使用普通输入框。
 * 条款链（±×÷、留空实体）的编排完全收在「规则 → 公式」Tab（见 ScenarioInspector.tsx 的
 * FormulaRow + TermChainEditor）；这里不重复一份「当场拼公式」的入口——要用公式，先去规则页定义，
 * 再回这里选它、填空。
 */
import { useState, type CSSProperties } from 'react'
import type { Entity, NumOrExpr, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'
import {
  catalogIdOccupied,
  formulaFromCreateRequest,
  nextAvailableCatalogId,
  nextCatalogId,
  parseFormulaCreateContent,
  type EntityAttributeCreateRequest,
  type EntityCreateRequest,
  type FormulaCreateRequest,
  type VariableCreateRequest,
} from '@/authoring/formulas/meta-catalog'
import { EffectOpButtons } from './OpSymbolButtons'
import { LooseNumberInput } from './TermChainEditor'
import { FormulaApplyEditor } from './FormulaApplyEditor'
import { compileFormula } from '@/authoring/formulas/formula-apply'
import {
  attrDisplayName,
  attrValueText,
  compileValuePick,
  entityDisplayName,
  findEntity,
  findFormula,
  formulaDisplayName,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
  resolveValuePick,
  type EffectDisplayOp,
  type ValueExprInput,
  type ValuePick,
  variableDisplayName,
} from './valueExprPick'

const row: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'nowrap',
  width: '100%',
  minWidth: 0,
}
const fieldLabel: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }

type ContentChoice =
  | { key: 'const'; kind: 'const'; label: string }
  | { key: string; kind: 'entity'; label: string; entityId: string; attr: string }
  | { key: string; kind: 'var'; label: string; varId: string }
  | { key: string; kind: 'formula'; label: string; formulaId: string }

export interface ValueExprAttributeCreateConfig {
  template?: Omit<EntityAttributeCreateRequest, 'entityId'>
  onCreate: (request: EntityAttributeCreateRequest) => void
}

export interface ValueExprEntityCreateConfig {
  template?: EntityCreateRequest
  onCreate: (request: EntityCreateRequest) => void
}

export interface ValueExprVariableCreateConfig {
  onCreate: (request: VariableCreateRequest) => void
}

export interface ValueExprFormulaCreateConfig {
  onCreate: (request: FormulaCreateRequest) => void
}

export type ValueExprSourceKind = 'entity' | 'var' | 'formula' | 'const'

function choiceKey(kind: 'entity' | 'var' | 'formula', ...parts: string[]): string {
  return `${kind}:${parts.map(encodeURIComponent).join(':')}`
}

function nextAvailableAttrId(entity: Entity | undefined, requestedId: string): string {
  const occupied = new Set([
    ...Object.keys(entity?.attrs ?? {}),
    ...Object.keys(entity?.attrMeta ?? {}),
  ])
  if (!occupied.has(requestedId)) return requestedId
  const suffix = /^(.*?)(\d+)$/.exec(requestedId)
  const prefix = suffix?.[1] ?? requestedId
  let index = suffix ? Number(suffix[2]) + 1 : 2
  while (occupied.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

const ATTR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

interface CreateDraft {
  entityId: string
  entityName: string
  attrId: string
  attrLabel: string
  initialValue: string
}

interface VariableCreateDraft {
  variableId: string
  name: string
  initialValue: string
}

interface FormulaCreateDraft {
  formulaId: string
  name: string
  content: string
}

function parsedInitialValue(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function attributeIdOccupied(entity: Entity | undefined, attrId: string): boolean {
  return Object.hasOwn(entity?.attrs ?? {}, attrId)
    || Object.hasOwn(entity?.attrMeta ?? {}, attrId)
}

export function ValueExprEditor({
  value,
  storedPick,
  entities,
  variables,
  formulas,
  onChange,
  onClear,
  emptyWhenUndefined = false,
  emptyLabel = '使用控件实时值',
  hintText,
  effectOp,
  preferredEntityIds,
  preferredAttrIds,
  allowAttribute,
  createAttribute,
  createEntity,
  createVariable,
  createFormula,
  fieldLabels,
  fieldLabelWidth,
  stackControls = false,
  assignmentLayout = false,
  propertyLayout = false,
  allowedSources = ['entity', 'var', 'formula', 'const'],
  pickerAriaLabel = '数值内容',
  numericOnly = false,
}: {
  value: ValueExprInput | undefined
  storedPick?: unknown
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  /** 公式库（「规则 → 公式」维护）；非空时「应用公式」模式才可选。 */
  formulas?: Record<string, Formula>
  onChange: (next: NumOrExpr) => void
  onClear?: () => void
  /** 只把 undefined 显示为空态，不在菜单中提供清空选项。 */
  emptyWhenUndefined?: boolean
  emptyLabel?: string
  hintText?: string
  /** 组件语义上的首选实体，越靠前优先级越高。 */
  preferredEntityIds?: readonly string[]
  /** 组件字段语义上的首选属性，越靠前优先级越高。 */
  preferredAttrIds?: readonly string[]
  /** 逐实体限制属性候选；变量、公式和固定值仍按原能力提供。 */
  allowAttribute?: (entity: Entity | undefined, attrId: string) => boolean
  /** 在每个实体的级联菜单内提供配置、创建并选择属性入口。 */
  createAttribute?: ValueExprAttributeCreateConfig
  /** 在实体属性级联菜单内提供配置、创建并选择实体入口。 */
  createEntity?: ValueExprEntityCreateConfig
  /** 在级联菜单内配置、创建并选择变量。 */
  createVariable?: ValueExprVariableCreateConfig
  /** 在级联菜单内配置、创建并选择公式。 */
  createFormula?: ValueExprFormulaCreateConfig
  /** 挂了这个 = 这个值要配一个 Effect「运算」符号按钮，嵌进编辑器顶部（跟常量/应用公式同一行）。 */
  effectOp?: { op: EffectDisplayOp; onOpChange: (next: EffectDisplayOp) => void }
  /** Effect 表单使用显式字段名区分“取什么值”和“输入多少”，避免与目标实体属性混淆。 */
  fieldLabels?: { source: string; value: string }
  fieldLabelWidth?: CSSProperties['width']
  /** 窄栏紧凑表单中让内容选择器与值输入上下排列。 */
  stackControls?: boolean
  /**
   * 右栏「赋值」布局：运算符与来源级联同一行；
   * 常量/公式才显示第二行，实体属性与变量不显示第二行。
   */
  assignmentLayout?: boolean
  /**
   * 右栏参数区级联布局：与效果区「效果主体」一致（label | 级联）；
   * 公式预览/参数行沿用 property 样式。
   */
  propertyLayout?: boolean
  /** 限制级联菜单的数据来源；创建入口随对应来源保留。 */
  allowedSources?: readonly ValueExprSourceKind[]
  pickerAriaLabel?: string
  /** 排除已知字符串属性和变量；无初值的旧数据仍作为未知数值保留。 */
  numericOnly?: boolean
}): JSX.Element {
  const [createDrafts, setCreateDrafts] = useState<Record<string, CreateDraft>>({})
  const [variableCreateDrafts, setVariableCreateDrafts] = useState<Record<string, VariableCreateDraft>>({})
  const [formulaCreateDrafts, setFormulaCreateDrafts] = useState<Record<string, FormulaCreateDraft>>({})
  const createAttributeTemplate = createAttribute
    ? createAttribute.template ?? {
      attrId: 'attr0',
      initialValue: 0,
      meta: { label: translateUi('cascade.default.attribute'), initial: 0 },
    }
    : undefined
  const createEntityTemplate = createEntity
    ? createEntity.template ?? {
      entityId: nextCatalogId('entity', entities),
      name: translateUi('cascade.default.entity'),
    }
    : undefined
  const draftFor = (key: string, defaults: CreateDraft): CreateDraft => ({
    ...defaults,
    ...createDrafts[key],
  })
  const patchDraft = (key: string, defaults: CreateDraft, patch: Partial<CreateDraft>): void => {
    setCreateDrafts((current) => ({
      ...current,
      [key]: { ...defaults, ...current[key], ...patch },
    }))
  }
  const pick = resolveValuePick(value, entities, variables, storedPick)
  const formulaOpts = listFormulaOptions(formulas)
  const directTerm = pick.mode === 'pick' ? pick.terms[0] : undefined
  const directBinding = pick.mode === 'pick'
    && pick.terms.length === 1
    && (directTerm?.source === 'entity' || directTerm?.source === 'var')
    && (directTerm.op === undefined || directTerm.op === '+' || directTerm.op === '*')
  const entityRank = new Map((preferredEntityIds ?? []).map((id, index) => [id, index]))
  const attrRank = new Map((preferredAttrIds ?? []).map((id, index) => [id, index]))
  const orderedEntities = listEntityOptions(entities).sort((a, b) => {
    const rankA = entityRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rankB = entityRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return rankA - rankB
  })
  const entityChoicesByEntity = orderedEntities.map((entity) => {
    const source = findEntity(entities, entity.id)
    const entityName = entityDisplayName(source, entity.id)
    const choices: ContentChoice[] = listAttrOptions(
      source,
      numericOnly ? { numbersOnly: true } : undefined,
    )
      .filter((attr) => !allowAttribute || allowAttribute(source, attr.id))
      .sort((a, b) => {
        const rankA = attrRank.get(a.id) ?? Number.MAX_SAFE_INTEGER
        const rankB = attrRank.get(b.id) ?? Number.MAX_SAFE_INTEGER
        if (rankA !== rankB) return rankA - rankB
        return attrDisplayName(source, a.id).localeCompare(attrDisplayName(source, b.id), 'zh-CN')
      })
      .map((attr) => ({
        key: choiceKey('entity', entity.id, attr.id),
        kind: 'entity' as const,
        label: `${entityName}${translateUi('ui.object.8af2350cfd65')}${attrDisplayName(source, attr.id)}`,
        entityId: entity.id,
        attr: attr.id,
      }))
    return { entity, entityName, source, choices }
  })
  const entityChoices = entityChoicesByEntity.flatMap((entry) => entry.choices)
  const createActions = new Map<string, {
    entityRequest?: EntityCreateRequest
    attributeRequest: EntityAttributeCreateRequest
    selectedValue: NumOrExpr
  }>()
  const variableCreateActions = new Map<string, {
    request: VariableCreateRequest
    selectedValue: NumOrExpr
  }>()
  const formulaCreateActions = new Map<string, {
    request: FormulaCreateRequest
    selectedValue: NumOrExpr
  }>()
  const variableChoices: ContentChoice[] = listVarOptions(
    variables,
    numericOnly ? { numbersOnly: true } : undefined,
  ).map((variable) => ({
    key: choiceKey('var', variable.id),
    kind: 'var',
    label: variableDisplayName(variables?.[variable.id], variable.id),
    varId: variable.id,
  }))
  const formulaChoices: ContentChoice[] = formulaOpts.map((formula) => ({
    key: choiceKey('formula', formula.id),
    kind: 'formula',
    label: formulaDisplayName(findFormula(formulas, formula.id), formula.id),
    formulaId: formula.id,
  }))
  const choices: ContentChoice[] = [
    { key: 'const', kind: 'const', label: translateUi('ui.object.7dc406c92803') },
    ...entityChoices,
    ...variableChoices,
    ...formulaChoices,
  ]
  const empty = value === undefined && (onClear != null || emptyWhenUndefined)
  const selectedKey = empty
    ? 'empty'
    : pick.mode === 'const'
    ? 'const'
    : pick.mode === 'formula'
      ? choiceKey('formula', pick.formulaId)
      : directBinding && directTerm?.source === 'entity'
        ? choiceKey('entity', directTerm.refId, directTerm.attr ?? '')
        : directBinding && directTerm?.source === 'var'
          ? choiceKey('var', directTerm.refId)
          : 'legacy'
  const selectedKnown = selectedKey === 'empty' || choices.some((choice) => choice.key === selectedKey)
  const selectedChoice = choices.find((choice) => choice.key === selectedKey)
  const createEntityAction = createEntity
    && createEntityTemplate
    && createAttribute
    && createAttributeTemplate
    ? (() => {
      const defaultEntityId = nextAvailableCatalogId(createEntityTemplate.entityId, entities)
      const draftKey = `create-entity:${encodeURIComponent(defaultEntityId)}:${encodeURIComponent(createAttributeTemplate.attrId)}`
      const defaults: CreateDraft = {
        entityId: defaultEntityId,
        entityName: createEntityTemplate.name,
        attrId: createAttributeTemplate.attrId,
        attrLabel: createAttributeTemplate.meta?.label ?? createAttributeTemplate.attrId,
        initialValue: String(createAttributeTemplate.initialValue),
      }
      const draft = draftFor(draftKey, defaults)
      const initialValue = parsedInitialValue(draft.initialValue)
      const entityId = draft.entityId.trim()
      const attrId = draft.attrId.trim()
      const attributeRequest: EntityAttributeCreateRequest = {
        ...createAttributeTemplate,
        entityId,
        attrId,
        initialValue: initialValue ?? 0,
        meta: {
          ...createAttributeTemplate.meta,
          label: draft.attrLabel.trim() || undefined,
          initial: initialValue ?? 0,
        },
      }
      const entityRequest: EntityCreateRequest = {
        entityId,
        name: draft.entityName.trim(),
      }
      const candidate: Entity = {
        id: entityId,
        name: entityRequest.name,
        attrs: { [attrId]: attributeRequest.initialValue },
        attrMeta: { [attrId]: attributeRequest.meta ?? {} },
      }
      const valid = !!entityId
        && !catalogIdOccupied(entities, entityId)
        && ATTR_ID_PATTERN.test(attrId)
        && initialValue !== undefined
        && (!allowAttribute || allowAttribute(candidate, attrId))
      const actionKey = `${draftKey}:confirm`
      createActions.set(actionKey, {
        entityRequest,
        attributeRequest,
        selectedValue: compileValuePick({
          mode: 'pick',
          terms: [{
            op: '+',
            source: 'entity',
            refId: entityId,
            attr: attrId,
          }],
        }),
      })
      return {
        key: `configure:${actionKey}`,
        presentation: 'create' as const,
        label: formatUi('cascade.create.entity', { name: draft.entityName.trim() || createEntityTemplate.name }),
        children: [
          {
            key: `detail:${actionKey}:entity-name`,
            label: translateUi('cascade.field.entityName'),
            editor: {
              value: draft.entityName,
              ariaLabel: translateUi('cascade.aria.entityName'),
              onChange: (value: string) => patchDraft(draftKey, defaults, { entityName: value }),
            },
          },
          {
            key: `detail:${actionKey}:label`,
            label: translateUi('cascade.field.attributeName'),
            editor: {
              value: draft.attrLabel,
              ariaLabel: translateUi('cascade.aria.attributeName'),
              invalid: !!allowAttribute && !allowAttribute(candidate, attrId),
              onChange: (value: string) => patchDraft(draftKey, defaults, { attrLabel: value }),
            },
          },
          {
            key: `detail:${actionKey}:initial`,
            label: translateUi('cascade.field.initialValue'),
            editor: {
              value: draft.initialValue,
              ariaLabel: translateUi('cascade.aria.attributeInitialValue'),
              inputMode: 'decimal' as const,
              invalid: initialValue === undefined,
              onChange: (value: string) => patchDraft(draftKey, defaults, { initialValue: value }),
            },
          },
          {
            key: actionKey,
            label: translateUi('ui.object.f4ed02d48c46'),
            value: actionKey,
            presentation: 'confirm' as const,
            disabled: !valid,
          },
        ],
      }
    })()
    : undefined
  const entityBranches: CascadingPickerOption[] = entityChoicesByEntity
    .filter((entry) => entry.choices.length > 0 || (createAttribute && createAttributeTemplate))
    .map((entry) => ({
      key: `entity:${encodeURIComponent(entry.entity.id)}`,
      label: entry.entityName,
      children: [
        ...entry.choices.map((choice) => ({
          key: choice.key,
          label: choice.kind === 'entity'
            ? attrDisplayName(entry.source, choice.attr)
            : choice.label,
          secondaryText: choice.kind === 'entity'
            ? attrValueText(entry.source, choice.attr)
            : undefined,
          value: choice.key,
        })),
        ...(createAttribute && createAttributeTemplate
          ? (() => {
            const draftKey = `create-attr:${encodeURIComponent(entry.entity.id)}:${encodeURIComponent(createAttributeTemplate.attrId)}`
            const defaults: CreateDraft = {
              entityId: entry.entity.id,
              entityName: entry.entityName,
              attrId: nextAvailableAttrId(entry.source, createAttributeTemplate.attrId),
              attrLabel: createAttributeTemplate.meta?.label ?? createAttributeTemplate.attrId,
              initialValue: String(createAttributeTemplate.initialValue),
            }
            const draft = draftFor(draftKey, defaults)
            const initialValue = parsedInitialValue(draft.initialValue)
            const attrId = draft.attrId.trim()
            const request: EntityAttributeCreateRequest = {
              ...createAttributeTemplate,
              entityId: entry.entity.id,
              attrId,
              initialValue: initialValue ?? 0,
              meta: {
                ...createAttributeTemplate.meta,
                label: draft.attrLabel.trim() || undefined,
                initial: initialValue ?? 0,
              },
            }
            const candidate: Entity = {
              ...(entry.source ?? { id: entry.entity.id }),
              attrs: { ...entry.source?.attrs, [attrId]: request.initialValue },
              attrMeta: { ...entry.source?.attrMeta, [attrId]: request.meta ?? {} },
            }
            const valid = ATTR_ID_PATTERN.test(attrId)
              && !attributeIdOccupied(entry.source, attrId)
              && initialValue !== undefined
              && (!allowAttribute || allowAttribute(candidate, attrId))
            const actionKey = `${draftKey}:confirm`
            createActions.set(actionKey, {
              attributeRequest: request,
              selectedValue: compileValuePick({
                mode: 'pick',
                terms: [{ op: '+', source: 'entity', refId: entry.entity.id, attr: request.attrId }],
              }),
            })
            return [{
              key: `configure:${actionKey}`,
              presentation: 'create' as const,
              label: formatUi('cascade.create.attribute', { name: draft.attrLabel.trim() || request.attrId }),
              children: [
                {
                  key: `detail:${actionKey}:label`,
                  label: translateUi('cascade.field.attributeName'),
                  editor: {
                    value: draft.attrLabel,
                    ariaLabel: translateUi('cascade.aria.attributeName'),
                    invalid: !!allowAttribute && !allowAttribute(candidate, attrId),
                    onChange: (value: string) => patchDraft(draftKey, defaults, { attrLabel: value }),
                  },
                },
                {
                  key: `detail:${actionKey}:initial`,
                  label: translateUi('cascade.field.initialValue'),
                  editor: {
                    value: draft.initialValue,
                    ariaLabel: translateUi('cascade.aria.attributeInitialValue'),
                    inputMode: 'decimal' as const,
                    invalid: initialValue === undefined,
                    onChange: (value: string) => patchDraft(draftKey, defaults, { initialValue: value }),
                  },
                },
                {
                  key: actionKey,
                  label: translateUi('ui.object.f4ed02d48c46'),
                  value: actionKey,
                  presentation: 'confirm' as const,
                  disabled: !valid,
                },
              ],
            }]
          })()
          : []),
      ],
    }))
  const pickerOptions: CascadingPickerOption[] = [
    ...(allowedSources.includes('entity') && (entityBranches.length > 0 || createEntityAction) ? [{
      key: 'entity-values',
      label: translateUi('ui.object.affaf4aa389a'),
      children: [
        ...entityBranches,
        ...(createEntityAction ? [createEntityAction] : []),
      ],
    }] : []),
    ...(allowedSources.includes('var') && (variableChoices.length > 0 || createVariable) ? [{
      key: 'variable-values',
      label: translateUi('ui.object.a772fa4ebe36'),
      children: [
        ...variableChoices.map((choice) => ({
          key: choice.key,
          label: choice.label,
          value: choice.key,
        })),
        ...(createVariable ? (() => {
          const defaultId = nextCatalogId('var', variables)
          const draftKey = `create-variable:${encodeURIComponent(defaultId)}`
          const defaults: VariableCreateDraft = {
            variableId: defaultId,
            name: defaultId,
            initialValue: '',
          }
          const draft = { ...defaults, ...variableCreateDrafts[draftKey] }
          const variableId = draft.variableId.trim()
          const initialValue = parsedInitialValue(draft.initialValue)
          const request: VariableCreateRequest = {
            variableId,
            name: draft.name.trim(),
            initialValue: initialValue ?? 0,
          }
          const actionKey = `${draftKey}:confirm`
          variableCreateActions.set(actionKey, {
            request,
            selectedValue: compileValuePick({
              mode: 'pick',
              terms: [{ op: '+', source: 'var', refId: variableId }],
            }),
          })
          const patch = (change: Partial<VariableCreateDraft>): void => {
            setVariableCreateDrafts((current) => ({
              ...current,
              [draftKey]: { ...defaults, ...current[draftKey], ...change },
            }))
          }
          return [{
            key: `configure:${actionKey}`,
            presentation: 'create' as const,
            label: formatUi('cascade.create.variable', { name: draft.name.trim() || variableId || defaultId }),
            children: [
              {
                key: `detail:${actionKey}:name`,
                label: translateUi('cascade.field.variableName'),
                editor: {
                  value: draft.name,
                  ariaLabel: translateUi('cascade.aria.variableName'),
                  onChange: (value: string) => patch({ name: value }),
                },
              },
              {
                key: `detail:${actionKey}:initial`,
                label: translateUi('cascade.field.initialValue'),
                editor: {
                  value: draft.initialValue,
                  ariaLabel: translateUi('cascade.aria.variableInitialValue'),
                  inputMode: 'decimal' as const,
                  invalid: initialValue === undefined,
                  onChange: (value: string) => patch({ initialValue: value }),
                },
              },
              {
                key: actionKey,
                label: translateUi('ui.object.f4ed02d48c46'),
                value: actionKey,
                presentation: 'confirm' as const,
                disabled: !variableId
                  || catalogIdOccupied(variables, variableId)
                  || initialValue === undefined,
              },
            ],
          }]
        })() : []),
      ],
    }] : []),
    ...(allowedSources.includes('formula') && (formulaChoices.length > 0 || createFormula) ? [{
      key: 'formula-values',
      label: translateUi('ui.object.f3fccedacbce'),
      children: [
        ...formulaChoices.map((choice) => ({
          key: choice.key,
          label: choice.label,
          value: choice.key,
        })),
        ...(createFormula ? (() => {
          const defaultId = nextCatalogId(RULE_ID_PREFIXES.formula, formulas)
          const draftKey = `create-formula:${encodeURIComponent(defaultId)}`
          const defaults: FormulaCreateDraft = {
            formulaId: defaultId,
            name: defaultId,
            content: '',
          }
          const draft = { ...defaults, ...formulaCreateDrafts[draftKey] }
          const formulaId = draft.formulaId.trim()
          let formulaAst: FormulaCreateRequest['ast'] | undefined
          let formulaError: string | undefined
          if (!draft.content.trim()) {
            formulaError = translateUi('cascade.error.formulaRequired')
          } else {
            try {
              formulaAst = parseFormulaCreateContent(draft.content, entities, variables)
            } catch (error) {
              formulaError = error instanceof Error ? error.message : String(error)
            }
          }
          const request: FormulaCreateRequest | undefined = formulaAst
            ? { formulaId, name: draft.name.trim(), ast: formulaAst }
            : undefined
          const actionKey = `${draftKey}:confirm`
          if (request) {
            formulaCreateActions.set(actionKey, {
              request,
              selectedValue: compileFormula(formulaFromCreateRequest(request), {}, entities),
            })
          }
          const patch = (change: Partial<FormulaCreateDraft>): void => {
            setFormulaCreateDrafts((current) => ({
              ...current,
              [draftKey]: { ...defaults, ...current[draftKey], ...change },
            }))
          }
          return [{
            key: `configure:${actionKey}`,
            presentation: 'create' as const,
            label: formatUi('cascade.create.formula', { name: draft.name.trim() || formulaId || defaultId }),
            children: [
              {
                key: `detail:${actionKey}:name`,
                label: translateUi('cascade.field.formulaName'),
                editor: {
                  value: draft.name,
                  ariaLabel: translateUi('cascade.aria.formulaName'),
                  onChange: (value: string) => patch({ name: value }),
                },
              },
              {
                key: `detail:${actionKey}:content`,
                label: translateUi('ui.object.08e984f92035'),
                editor: {
                  value: draft.content,
                  ariaLabel: translateUi('cascade.aria.formulaContent'),
                  placeholder: translateUi('ui.object.0f20c830dac4'),
                  multiline: true,
                  invalid: !formulaAst,
                  error: formulaError,
                  onChange: (value: string) => patch({ content: value }),
                },
              },
              {
                key: `${actionKey}:agent`,
                label: translateUi('ui.object.cb82411f226f'),
                presentation: 'agent' as const,
                disabled: true,
              },
              {
                key: actionKey,
                label: translateUi('ui.object.f4ed02d48c46'),
                value: actionKey,
                presentation: 'confirm' as const,
                disabled: !formulaId
                  || catalogIdOccupied(formulas, formulaId)
                  || !formulaAst,
              },
            ],
          }]
        })() : []),
      ],
    }] : []),
    ...(allowedSources.includes('const') ? [{ key: 'const', label: translateUi('ui.object.7dc406c92803'), value: 'const' }] : []),
    ...(onClear ? [{ key: 'empty', label: emptyLabel, value: 'empty' }] : []),
  ]
  const selectedLabel = selectedKey === 'empty'
    ? onClear ? emptyLabel : ''
    : selectedKnown
      ? selectedChoice?.label ?? '常量'
      : ''
  const formulaMode = !empty && pick.mode === 'formula'

  function selectContent(key: string): void {
    if (key === 'empty') {
      onClear?.()
      return
    }
    const createAction = createActions.get(key)
    if (createAction && createAttribute) {
      if (createAction.entityRequest && createEntity) {
        createEntity.onCreate(createAction.entityRequest)
      }
      createAttribute.onCreate(createAction.attributeRequest)
      onChange(createAction.selectedValue)
      return
    }
    const variableCreateAction = variableCreateActions.get(key)
    if (variableCreateAction && createVariable) {
      createVariable.onCreate(variableCreateAction.request)
      onChange(variableCreateAction.selectedValue)
      return
    }
    const formulaCreateAction = formulaCreateActions.get(key)
    if (formulaCreateAction && createFormula) {
      createFormula.onCreate(formulaCreateAction.request)
      onChange(formulaCreateAction.selectedValue)
      return
    }
    const choice = choices.find((item) => item.key === key)
    if (!choice) return
    if (choice.kind === 'const') {
      // 保留正负号（旧实现 Math.abs 会把扣血负数抹成正数）
      const n = typeof value === 'number' ? value : pick.mode === 'const' ? pick.const : 0
      onChange(n)
      return
    }
    if (choice.kind === 'entity') {
      onChange(compileValuePick({
        mode: 'pick',
        terms: [{ op: '+', source: 'entity', refId: choice.entityId, attr: choice.attr }],
      }))
      return
    }
    if (choice.kind === 'var') {
      onChange(compileValuePick({
        mode: 'pick',
        terms: [{ op: '+', source: 'var', refId: choice.varId }],
      }))
      return
    }
    const formula = findFormula(formulas, choice.formulaId)
    if (!formula) return
    onChange(compileFormula(formula, {}, entities))
  }

  // 旧版「选取公式」（当场拼 ±×÷ 条款链）留下的数据：只读展示 + 提示改走规则页，不再提供编辑入口。
  const legacyPick = pick.mode === 'pick' ? compileValuePick(pick) : undefined
  const legacyPickLabel = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !value.pick
      ? value.expr
      : legacyPick == null
        ? ''
        : typeof legacyPick === 'number'
          ? String(legacyPick)
          : legacyPick.expr
  const resolvedFieldLabel = fieldLabelWidth === undefined
    ? fieldLabel
    : { ...fieldLabel, width: fieldLabelWidth }
  const picker = (
    <CascadingPicker
      ariaLabel={fieldLabels?.source ?? pickerAriaLabel}
      value={selectedKey}
      displayValue={selectedLabel}
      placeholder={translateUi('ui.copy.ff0c5c0da4ec')}
      options={pickerOptions}
      onSelect={selectContent}
      narrowSafe={stackControls || assignmentLayout || propertyLayout}
    />
  )
  const sourceControl = assignmentLayout && effectOp ? (
    <div
      data-value-expression-source
      className="editor-property-assign-row"
      style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', minWidth: 0 }}
    >
      <EffectOpButtons op={effectOp.op} onChange={effectOp.onOpChange} variant="symbol" />
      <div style={{ flex: 1, minWidth: 0 }}>{picker}</div>
    </div>
  ) : (
    <>
      {fieldLabels ? <span style={resolvedFieldLabel}>{fieldLabels.source}</span> : null}
      {effectOp && <EffectOpButtons op={effectOp.op} onChange={effectOp.onOpChange} />}
      {picker}
    </>
  )

  return (
    <div
      data-value-expression
      data-assignment-layout={assignmentLayout ? 'true' : undefined}
      data-property-layout={propertyLayout ? 'true' : undefined}
      style={formulaMode || fieldLabels || stackControls || assignmentLayout || propertyLayout
        ? { ...row, flexDirection: 'column', alignItems: 'stretch' }
        : row}
      title={hintText}
    >
      {fieldLabels && !assignmentLayout
        ? <div data-value-expression-source style={row}>{sourceControl}</div>
        : sourceControl}

      {!empty && pick.mode === 'const' && (
        fieldLabels && !assignmentLayout ? (
          <div data-value-expression-value style={row}>
            <span style={resolvedFieldLabel}>{fieldLabels.value}</span>
            <LooseNumberInput
              value={pick.const}
              onChange={(n) => onChange(n)}
              aria-label={fieldLabels.value}
              placeholder={translateUi('ui.copy.31d746e1f70d')}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        ) : (
          <LooseNumberInput
            value={pick.const}
            onChange={(n) => onChange(n)}
            aria-label={translateUi('ui.copy.9109637cfbc4')}
            placeholder={translateUi('ui.copy.31d746e1f70d')}
            style={stackControls || assignmentLayout || propertyLayout
              ? { flex: 'none', width: '100%', minWidth: 0 }
              : { flex: '0 1 32%', minWidth: 96 }}
          />
        )
      )}

      {!empty && pick.mode === 'pick' && !directBinding && !assignmentLayout && (
        <input
          aria-label={translateUi('ui.copy.fe0ca17de683')}
          value={legacyPickLabel}
          readOnly
          title={translateUi('ui.copy.9e224b8e26ee')}
          style={stackControls || propertyLayout
            ? { flex: 'none', width: '100%', minWidth: 0, boxSizing: 'border-box' }
            : { flex: '0 1 40%', minWidth: 120, boxSizing: 'border-box' }}
        />
      )}

      {!empty && pick.mode === 'formula' && (
        <FormulaApplyEditor
          formulaId={pick.formulaId}
          holeBindings={pick.holeBindings}
          formulas={formulas}
          entities={entities}
          variables={variables}
          onChange={onChange}
          showFormulaPicker={false}
          propertyLayout={assignmentLayout || propertyLayout}
          createAttribute={createAttribute}
          createEntity={createEntity}
          createVariable={createVariable}
        />
      )}

    </div>
  )
}

/** 飘字专用包装：同时写回 valuePick sidecar 与 damageValue。 */
export function FloatValuePickEditor({
  valuePick,
  damageValue,
  entities,
  variables,
  formulas,
  onChange,
}: {
  valuePick: unknown
  damageValue: NumOrExpr
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  formulas?: Record<string, Formula>
  onChange: (next: { valuePick: ValuePick; damageValue: NumOrExpr }) => void
}): JSX.Element {
  return (
    <ValueExprEditor
      value={damageValue}
      storedPick={valuePick}
      entities={entities}
      variables={variables}
      formulas={formulas}
      hintText="结算时写入同一公式；文案可用 {v} 显示结果。"
      onChange={(damageValueNext) => {
        onChange({
          valuePick: resolveValuePick(damageValueNext, entities, variables),
          damageValue: damageValueNext,
        })
      }}
    />
  )
}
