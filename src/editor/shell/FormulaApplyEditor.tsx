import { t as translateUi, tf as formatUi } from '../../i18n'
/**
 * 应用公式 —— ValueExprEditor 第三模式的填空 UI：选一个具名公式，给它的每个留空位按类型填值
 * （实体属性：选实体+属性；数值：输入常数；变量：选变量），实时编译回 NumOrExpr。
 */
import type { CSSProperties, JSX } from 'react'
import { useMemo, useState } from 'react'
import { isNumericScalar, type Entity, type NumOrExpr, type Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula, FormulaHoleBinding } from '@/authoring/blueprint/formula-authoring'
import { tryEvalExpr, type EvalCtx } from '@/runtime/core/engine/expr'
import { createRng } from '@/runtime/core/engine/rng'
import { LooseNumberInput } from './TermChainEditor'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'
import { AiParameterFillButton } from './AiParameterFillButton'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { buildFormulaContextReference } from './formula-agent-context'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { NiSelect } from './ni-ui'
import {
  compileFormula,
  formulaHoleBindingIssues,
  formulaHoles,
  formulaPreview,
  missingFormulaVariables,
} from '@/authoring/formulas/formula-apply'
import {
  attrDisplayName,
  attrValueText,
  entityDisplayName,
  findEntity,
  findFormula,
  listAttrOptions,
  listEntityOptions,
  listFormulaOptions,
  listVarOptions,
  variableDisplayName,
} from './valueExprPick'
import {
  catalogIdOccupied,
  ensureEntity,
  ensureEntityAttribute,
  nextAvailableCatalogId,
  nextCatalogId,
  type EntityAttributeCreateRequest,
  type EntityCreateRequest,
  type VariableCreateRequest,
} from '@/authoring/formulas/meta-catalog'

const box: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }
const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.65, lineHeight: 1.4 }
const holeLbl: CSSProperties = { fontSize: 11, opacity: 0.8, minWidth: 120 }
const ATTR_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/

function BindingIncompleteAlert({
  children,
  onFill,
}: {
  children: string
  onFill?: () => void
}): JSX.Element {
  return (
    <div
      role="alert"
      data-formula-binding-alert
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        boxSizing: 'border-box',
        padding: '0 8px 0 10px',
        borderRadius: 8,
        background: '#222',
        color: '#ff6b6b',
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      <AiParameterFillButton
        ariaLabel="AI 补全参数"
        title={translateUi('ui.copy.2eb6e1d18365')}
        onClick={onFill}
      />
    </div>
  )
}

interface FormulaCreateDraft {
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

interface FormulaAttributeCreateConfig {
  template?: Omit<EntityAttributeCreateRequest, 'entityId'>
  onCreate: (request: EntityAttributeCreateRequest) => void
}

interface FormulaEntityCreateConfig {
  template?: EntityCreateRequest
  onCreate: (request: EntityCreateRequest) => void
}

interface FormulaVariableCreateConfig {
  onCreate: (request: VariableCreateRequest) => void
}

function validEntityId(value: string): boolean {
  const id = value.trim()
  return !!id && id !== '.' && id !== '..' && !/[\\/]/.test(id)
}

function inferredInitialValue(attrId: string, label: string): number {
  const semantic = `${attrId} ${label}`.toLowerCase()
  if (/hp|health|血量|生命/.test(semantic)) return 100
  if (/qi|energy|rage|mana|气力|能量|怒气/.test(semantic)) return 5
  return 0
}

function parsedInitialValue(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

type FormulaAttributeSemantic = 'current-hp' | 'max-hp' | 'current-qi' | 'max-qi'

const SEMANTIC_ATTR_IDS: Record<FormulaAttributeSemantic, readonly string[]> = {
  'current-hp': ['hp', 'health'],
  'max-hp': ['hpMax', 'maxHp', 'healthMax', 'maxHealth'],
  'current-qi': ['qi', 'energy', 'rage', 'mana'],
  'max-qi': ['qiMax', 'maxQi', 'energyMax', 'maxEnergy', 'rageMax', 'maxRage', 'manaMax', 'maxMana'],
}

function normalizedSemanticText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.\-—:：/\\()[\]（）【】]/g, '')
}

function formulaAttributeSemantic(label: string): FormulaAttributeSemantic | undefined {
  const text = normalizedSemanticText(label)
  const maximum = /最大|上限|峰值|maximum|max|limit|cap/.test(text)
  const hp = /血量|生命值?|health|hitpoints?|hp/.test(text)
  const qi = /气力|能量|怒气|energy|rage|mana|qi/.test(text)
  if (hp) return maximum ? 'max-hp' : 'current-hp'
  if (qi) return maximum ? 'max-qi' : 'current-qi'
  return undefined
}

function labelMatchesSemantic(label: string, semantic: FormulaAttributeSemantic): boolean {
  return formulaAttributeSemantic(label) === semantic
}

function attributeMatchesHole(
  entity: Entity | undefined,
  attrId: string,
  label: string,
  suggestAttr: string | undefined,
): boolean {
  const semantic = formulaAttributeSemantic(label)
  const displayName = entity?.attrMeta?.[attrId]?.label?.trim()
  if (semantic) {
    if (displayName) return labelMatchesSemantic(displayName, semantic)
    return SEMANTIC_ATTR_IDS[semantic].some((candidate) =>
      candidate.toLowerCase() === attrId.toLowerCase())
  }
  if (suggestAttr) return attrId.toLowerCase() === suggestAttr.toLowerCase()
  return true
}

function inferredAttrId(label: string, suggestAttr: string | undefined): string {
  if (suggestAttr) return suggestAttr
  const semantic = formulaAttributeSemantic(label)
  if (semantic) return SEMANTIC_ATTR_IDS[semantic][0]!
  const ascii = label.trim()
    .replace(/[^A-Za-z0-9_-]+/g, ' ')
    .trim()
    .replace(/\s+([A-Za-z0-9])/g, (_, letter: string) => letter.toUpperCase())
    .replace(/^[^A-Za-z_]+/, '')
  return ascii || 'value'
}

function attributeIdOccupied(entity: Entity | undefined, attrId: string): boolean {
  return Object.hasOwn(entity?.attrs ?? {}, attrId)
    || Object.hasOwn(entity?.attrMeta ?? {}, attrId)
}

function nextAvailableAttrId(entity: Entity | undefined, requestedId: string): string {
  if (!attributeIdOccupied(entity, requestedId)) return requestedId
  const suffix = /^(.*?)(\d+)$/.exec(requestedId)
  const prefix = suffix?.[1] ?? requestedId
  let index = suffix ? Number(suffix[2]) + 1 : 2
  while (attributeIdOccupied(entity, `${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

function initialValueForHole(
  template: Omit<EntityAttributeCreateRequest, 'entityId'> | undefined,
  attrId: string,
  label: string,
  suggestAttr: string | undefined,
): number {
  if (template) {
    const templateEntity: Entity = {
      id: 'template',
      attrs: { [template.attrId]: template.initialValue },
      attrMeta: { [template.attrId]: template.meta ?? {} },
    }
    if (attributeMatchesHole(templateEntity, template.attrId, label, suggestAttr)) {
      return template.initialValue
    }
  }
  return inferredInitialValue(attrId, label)
}

function entityAttrKey(entityId: string, attrId: string): string {
  return `entity:${encodeURIComponent(entityId)}:${encodeURIComponent(attrId)}`
}

function parseEntityAttrKey(value: string): { entityId: string; attrId: string } | undefined {
  const match = /^entity:([^:]+):(.+)$/.exec(value)
  if (!match) return undefined
  return {
    entityId: decodeURIComponent(match[1]!),
    attrId: decodeURIComponent(match[2]!),
  }
}

function variableKey(varId: string): string {
  return `var:${encodeURIComponent(varId)}`
}

function parseVariableKey(value: string): string | undefined {
  const match = /^var:(.+)$/.exec(value)
  return match ? decodeURIComponent(match[1]!) : undefined
}

/** 样例求值上下文：实体 attrs 原样、变量取 initial；每次试算另建 seed 0 RNG。 */
function sampleCtx(entities?: Record<string, Entity>, variables?: Record<string, Variable>): EvalCtx {
  const ents: EvalCtx['entities'] = {}
  for (const [id, e] of Object.entries(entities ?? {})) {
    ents[id] = { attrs: Object.fromEntries(
      Object.entries(e.attrs ?? {}).filter(([, value]) => isNumericScalar(value)),
    ) as Record<string, number> }
  }
  const vars: Record<string, number> = {}
  for (const [id, v] of Object.entries(variables ?? {})) {
    if (isNumericScalar(v.initial)) vars[id] = v.initial
  }
  return { entities: ents, vars, flags: {}, score: 0 }
}

export function FormulaApplyEditor({
  formulaId,
  holeBindings,
  formulas,
  entities,
  variables,
  onChange,
  showFormulaPicker = true,
  propertyLayout = false,
  createAttribute,
  createEntity,
  createVariable,
}: {
  formulaId: string
  holeBindings: Record<string, FormulaHoleBinding>
  formulas: Record<string, Formula> | undefined
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  onChange: (next: NumOrExpr) => void
  showFormulaPicker?: boolean
  /** 右栏赋值区：公式摘要占满一行；参数 label 与级联同一行。 */
  propertyLayout?: boolean
  createAttribute?: FormulaAttributeCreateConfig
  createEntity?: FormulaEntityCreateConfig
  createVariable?: FormulaVariableCreateConfig
}): JSX.Element {
  const [createDrafts, setCreateDrafts] = useState<Record<string, FormulaCreateDraft>>({})
  const [variableCreateDrafts, setVariableCreateDrafts] = useState<Record<string, VariableCreateDraft>>({})
  const options = listFormulaOptions(formulas)
  const formula = findFormula(formulas, formulaId)
  const holes = formula ? formulaHoles(formula) : []
  const bindingIssues = formula
    ? formulaHoleBindingIssues(formula, holeBindings, entities ?? {})
    : []
  const actionableIssueIds = new Set(bindingIssues.flatMap((issue) => {
    const hole = holes.find((candidate) => candidate.holeId === issue.holeId)
    const binding = holeBindings[issue.holeId]
    const usesEntityAttribute = hole?.kind === 'entityAttr' || binding?.kind === 'entityAttr'
    if (!hole || !usesEntityAttribute) return []
    const entityId = binding?.kind === 'entityAttr' ? binding.entityId : ''
    const entity = findEntity(entities, entityId)
    const actionableEntity = (!entityId || !entity) && !!createEntity && !!createAttribute
    const actionableAttribute = !!createAttribute
      && (!entity || !listAttrOptions(entity).some((option) =>
        attributeMatchesHole(entity, option.id, hole.label || hole.holeId, hole.suggestAttr)))
    return actionableEntity || actionableAttribute ? [issue.holeId] : []
  }))
  const visibleBindingIssues = bindingIssues.filter((issue) => !actionableIssueIds.has(issue.holeId))
  const missingVariables = formula ? missingFormulaVariables(formula, holeBindings, variables) : []
  const needsVariableBinding = holes.some((hole) => hole.kind === 'var')
  const hasDeclaredVariables = Object.keys(variables ?? {}).length > 0

  const game = useGraphScenario((s) => s.game)
  const blueprintId = useGraphScenario((s) => s.activeBlueprintId)
  const blueprintTitle = useGraphScenario((s) => s.blueprints[s.activeBlueprintId]?.title)
  function referenceFormula(): void {
    if (!forgeaxHost.available || !formula) return
    forgeaxHost.composer.insertReference(buildFormulaContextReference({
      gameId: game,
      blueprintId,
      blueprintTitle,
      formulaKey: formulaId,
      formula,
      entities,
      variables,
      bindingIssues: visibleBindingIssues.map((issue) => ({ label: issue.label, reason: issue.reason })),
    }))
  }

  function pickFormula(nextId: string): void {
    const next = findFormula(formulas, nextId)
    if (!next) return
    onChange(compileFormula(next, {}, entities))
  }

  function setHole(holeId: string, binding: FormulaHoleBinding): void {
    if (!formula) return
    onChange(compileFormula(formula, { ...holeBindings, [holeId]: binding }, entities))
  }

  function draftFor(key: string, defaults: FormulaCreateDraft): FormulaCreateDraft {
    return { ...defaults, ...createDrafts[key] }
  }

  function patchCreateDraft(key: string, defaults: FormulaCreateDraft, patch: Partial<FormulaCreateDraft>): void {
    setCreateDrafts((current) => ({
      ...current,
      [key]: { ...defaults, ...current[key], ...patch },
    }))
  }

  const compiled = formula ? compileFormula(formula, holeBindings, entities) : undefined
  const compiledLabel = compiled == null ? '' : typeof compiled === 'number' ? String(compiled) : compiled.expr
  // 填满全部留空位后，拿样例实体/变量值实时算出结果（≈ 值），替代与顶部「公式：」重复的编译串展示。
  const ctx = useMemo(() => sampleCtx(entities, variables), [entities, variables])
  const sampleValue = compiledLabel && bindingIssues.length === 0 && missingVariables.length === 0
    ? tryEvalExpr(compiledLabel, { ...ctx, rng: createRng(0) })
    : null

  return (
    <div
      data-formula-apply={propertyLayout ? 'property' : undefined}
      style={propertyLayout
        ? { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0 }
        : box}
    >
      {showFormulaPicker ? (
        <div style={row} role="group" aria-label={translateUi('ui.copy.49eac9c3caa8')}>
          <NiSelect value={formulaId} onChange={pickFormula} ariaLabel="公式" style={{ flex: 1, minWidth: 140 }}>
            <option value="" disabled>{translateUi('ui.copy.d9083e69a8cc')}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </NiSelect>
        </div>
      ) : null}
      {!formula ? (
        <p style={hint}>{translateUi('ui.copy.01f8d7edb9a8')}</p>
      ) : (
        <>
          <p
            data-formula-preview
            style={propertyLayout
              ? {
                margin: 0,
                minHeight: 28,
                padding: '4px 10px',
                borderRadius: 8,
                background: '#181818',
                color: 'rgba(255,255,255,.45)',
                fontSize: 12,
                lineHeight: '20px',
                boxSizing: 'border-box',
              }
              : hint}
          >
            {translateUi('ui.copy.d4c129fa772a')}{formulaPreview(formula, holeBindings)}
          </p>
          {missingVariables.length > 0 ? (
            <p role="alert" style={{ ...hint, color: '#ffb86c' }}>
              {translateUi('ui.copy.964bd8adb44a')}{missingVariables.join('、')}{translateUi('ui.copy.09cde5b0b3a9')}</p>
          ) : needsVariableBinding && !hasDeclaredVariables && !createVariable ? (
            <p role="alert" style={{ ...hint, color: '#ffb86c' }}>
              {translateUi('ui.copy.b91fffbfaafc')}</p>
          ) : null}
          {holes.length > 0 ? holes.map((h) => {
              const binding = holeBindings[h.holeId]
              const label = h.label ?? '留空位'
              const boundEntityId = binding?.kind === 'entityAttr' ? binding.entityId : ''
              const boundEntity = findEntity(entities, boundEntityId)
              const boundAttrId = binding?.kind === 'entityAttr'
                ? binding.attr || h.suggestAttr || ''
                : ''
              const selectedEntity = binding?.kind === 'entityAttr'
                ? findEntity(entities, binding.entityId)
                : undefined
              const selectedAttrId = binding?.kind === 'entityAttr'
                ? binding.attr || h.suggestAttr || ''
                : ''
              const selectedAttrExists = !!selectedEntity
                && !!selectedAttrId
                && listAttrOptions(selectedEntity).some((option) =>
                  option.id === selectedAttrId
                  && attributeMatchesHole(selectedEntity, option.id, label, h.suggestAttr))
              const createActions = new Map<string, {
                entityRequest?: EntityCreateRequest
                attributeRequest: EntityAttributeCreateRequest
                binding: FormulaHoleBinding
              }>()
              const variableCreateActions = new Map<string, VariableCreateRequest>()
              const requestedAttrId = boundAttrId
                || createAttribute?.template?.attrId
                || inferredAttrId(label, h.suggestAttr)
              const entityBranches: CascadingPickerOption[] = listEntityOptions(entities)
                .map((entityOption) => {
                  const entity = findEntity(entities, entityOption.id)
                  const attrOptions = listAttrOptions(entity)
                    .filter((attrOption) =>
                      attributeMatchesHole(entity, attrOption.id, label, h.suggestAttr))
                  const children: CascadingPickerOption[] = attrOptions.map((attrOption) => ({
                    key: entityAttrKey(entityOption.id, attrOption.id),
                    label: attrDisplayName(entity, attrOption.id),
                    secondaryText: attrValueText(entity, attrOption.id),
                    value: entityAttrKey(entityOption.id, attrOption.id),
                  }))
                  if (createAttribute) {
                    const defaultAttrId = nextAvailableAttrId(entity, requestedAttrId)
                    const draftKey = [
                      'create-formula-attr',
                      encodeURIComponent(h.holeId),
                      encodeURIComponent(entityOption.id),
                    ].join(':')
                    const defaults: FormulaCreateDraft = {
                      entityId: entityOption.id,
                      entityName: entityDisplayName(entity, entityOption.id),
                      attrId: defaultAttrId,
                      attrLabel: label,
                      initialValue: String(initialValueForHole(
                        createAttribute.template,
                        defaultAttrId,
                        label,
                        h.suggestAttr,
                      )),
                    }
                    const draft = draftFor(draftKey, defaults)
                    const attrId = draft.attrId.trim()
                    const initialValue = parsedInitialValue(draft.initialValue)
                    const request: EntityAttributeCreateRequest = {
                      entityId: entityOption.id,
                      attrId,
                      initialValue: initialValue ?? 0,
                      meta: {
                        ...createAttribute.template?.meta,
                        label: draft.attrLabel.trim(),
                        initial: initialValue ?? 0,
                      },
                    }
                    const candidate: Entity = {
                      ...(entity ?? { id: entityOption.id }),
                      attrs: { ...entity?.attrs, [attrId]: initialValue ?? 0 },
                      attrMeta: { ...entity?.attrMeta, [attrId]: request.meta ?? {} },
                    }
                    const valid = ATTR_ID_PATTERN.test(attrId)
                      && !attributeIdOccupied(entity, attrId)
                      && !!draft.attrLabel.trim()
                      && initialValue !== undefined
                      && attributeMatchesHole(candidate, attrId, label, h.suggestAttr)
                    const actionKey = `${draftKey}:confirm`
                    createActions.set(actionKey, {
                      attributeRequest: request,
                      binding: { kind: 'entityAttr', entityId: entityOption.id, attr: attrId },
                    })
                    children.push({
                      key: `configure:${actionKey}`,
                      presentation: 'create',
                      label: formatUi('cascade.create.attribute', { name: draft.attrLabel.trim() || label }),
                      children: [
                        {
                          key: `detail:${actionKey}:label`,
                          label: translateUi('cascade.field.attributeName'),
                          editor: {
                            value: draft.attrLabel,
                            ariaLabel: translateUi('cascade.aria.attributeName'),
                            invalid: !attributeMatchesHole(candidate, attrId, label, h.suggestAttr),
                            onChange: (value: string) =>
                              patchCreateDraft(draftKey, defaults, { attrLabel: value }),
                          },
                        },
                        {
                          key: `detail:${actionKey}:initial`,
                          label: translateUi('cascade.field.initialValue'),
                          editor: {
                            value: draft.initialValue,
                            ariaLabel: translateUi('cascade.aria.attributeInitialValue'),
                            inputMode: 'decimal',
                            invalid: initialValue === undefined,
                            onChange: (value: string) =>
                              patchCreateDraft(draftKey, defaults, { initialValue: value }),
                          },
                        },
                        {
                          key: actionKey,
                          label: translateUi('ui.object.f4ed02d48c46'),
                          value: actionKey,
                          presentation: 'confirm',
                          disabled: !valid,
                        },
                      ],
                    })
                  }
                  return {
                    key: `entity:${encodeURIComponent(entityOption.id)}`,
                    label: entityDisplayName(entity, entityOption.id),
                    children,
                  }
                })
                .filter((entityOption) => entityOption.children.length > 0)
              if (createEntity && createAttribute) {
                const requestedEntityId = boundEntityId && !boundEntity
                  ? boundEntityId
                  : createEntity.template?.entityId || 'entity'
                const defaultEntityId = nextAvailableCatalogId(requestedEntityId, entities)
                const defaultEntityName = createEntity.template?.name
                  || (boundEntityId && !boundEntity ? boundEntityId : undefined)
                  || '实体'
                const draftKey = [
                  'create-formula-entity',
                  encodeURIComponent(h.holeId),
                  encodeURIComponent(defaultEntityId),
                ].join(':')
                const defaultAttrId = inferredAttrId(
                  label,
                  boundAttrId || h.suggestAttr || createAttribute.template?.attrId,
                )
                const defaults: FormulaCreateDraft = {
                  entityId: defaultEntityId,
                  entityName: defaultEntityName,
                  attrId: defaultAttrId,
                  attrLabel: label,
                  initialValue: String(initialValueForHole(
                    createAttribute.template,
                    defaultAttrId,
                    label,
                    h.suggestAttr,
                  )),
                }
                const draft = draftFor(draftKey, defaults)
                const entityId = draft.entityId.trim()
                const attrId = draft.attrId.trim()
                const initialValue = parsedInitialValue(draft.initialValue)
                const entityRequest: EntityCreateRequest = {
                  ...createEntity.template,
                  entityId,
                  name: draft.entityName.trim(),
                }
                const attributeRequest: EntityAttributeCreateRequest = {
                  entityId,
                  attrId,
                  initialValue: initialValue ?? 0,
                  meta: {
                    ...createAttribute.template?.meta,
                    label: draft.attrLabel.trim(),
                    initial: initialValue ?? 0,
                  },
                }
                const candidate: Entity = {
                  id: entityId,
                  name: entityRequest.name,
                  attrs: { [attrId]: initialValue ?? 0 },
                  attrMeta: { [attrId]: attributeRequest.meta ?? {} },
                }
                const valid = validEntityId(entityId)
                  && !catalogIdOccupied(entities, entityId)
                  && !!draft.entityName.trim()
                  && ATTR_ID_PATTERN.test(attrId)
                  && !!draft.attrLabel.trim()
                  && initialValue !== undefined
                  && attributeMatchesHole(candidate, attrId, label, h.suggestAttr)
                const actionKey = `${draftKey}:confirm`
                createActions.set(actionKey, {
                  entityRequest,
                  attributeRequest,
                  binding: { kind: 'entityAttr', entityId, attr: attrId },
                })
                entityBranches.push({
                  key: `configure:${actionKey}`,
                  presentation: 'create',
                  label: formatUi('cascade.create.entity', { name: draft.entityName.trim() || defaultEntityName }),
                  children: [
                    {
                      key: `detail:${actionKey}:entity-name`,
                      label: translateUi('cascade.field.entityName'),
                      editor: {
                        value: draft.entityName,
                        ariaLabel: translateUi('cascade.aria.entityName'),
                        invalid: !draft.entityName.trim(),
                        onChange: (value: string) =>
                          patchCreateDraft(draftKey, defaults, { entityName: value }),
                      },
                    },
                    {
                      key: `detail:${actionKey}:attr-label`,
                      label: translateUi('cascade.field.attributeName'),
                      editor: {
                        value: draft.attrLabel,
                        ariaLabel: translateUi('cascade.aria.attributeName'),
                        invalid: !attributeMatchesHole(candidate, attrId, label, h.suggestAttr),
                        onChange: (value: string) =>
                          patchCreateDraft(draftKey, defaults, { attrLabel: value }),
                      },
                    },
                    {
                      key: `detail:${actionKey}:initial`,
                      label: translateUi('cascade.field.initialValue'),
                      editor: {
                        value: draft.initialValue,
                        ariaLabel: translateUi('cascade.aria.attributeInitialValue'),
                        inputMode: 'decimal',
                        invalid: initialValue === undefined,
                        onChange: (value: string) =>
                          patchCreateDraft(draftKey, defaults, { initialValue: value }),
                      },
                    },
                    {
                      key: actionKey,
                      label: translateUi('ui.object.f4ed02d48c46'),
                      value: actionKey,
                      presentation: 'confirm',
                      disabled: !valid,
                    },
                  ],
                })
              }
              const entityAttributeOptions: CascadingPickerOption[] = entityBranches.length > 0
                ? [{
                  key: 'entity-attributes',
                  label: translateUi('ui.object.affaf4aa389a'),
                  children: entityBranches,
                }]
                : []
              const variableOptions: CascadingPickerOption[] = listVarOptions(variables, { valueType: 'number' }).map((option) => ({
                key: variableKey(option.id),
                label: variableDisplayName(variables?.[option.id], option.id),
                value: variableKey(option.id),
              }))
              if ((h.kind === 'number' || h.kind === 'var') && createVariable) {
                const defaultId = nextCatalogId('var', variables)
                const draftKey = [
                  'create-formula-variable',
                  encodeURIComponent(h.holeId),
                  encodeURIComponent(defaultId),
                ].join(':')
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
                variableCreateActions.set(actionKey, request)
                const patch = (change: Partial<VariableCreateDraft>): void => {
                  setVariableCreateDrafts((current) => ({
                    ...current,
                    [draftKey]: { ...defaults, ...current[draftKey], ...change },
                  }))
                }
                variableOptions.push({
                  key: `configure:${actionKey}`,
                  presentation: 'create',
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
                        inputMode: 'decimal',
                        invalid: initialValue === undefined,
                        onChange: (value: string) => patch({ initialValue: value }),
                      },
                    },
                    {
                      key: actionKey,
                      label: translateUi('ui.object.f4ed02d48c46'),
                      value: actionKey,
                      presentation: 'confirm',
                      disabled: !variableId
                        || catalogIdOccupied(variables, variableId)
                        || initialValue === undefined,
                    },
                  ],
                })
              }
              const sourceOptions: CascadingPickerOption[] = [
                ...(h.kind === 'number' || h.kind === 'entityAttr'
                  ? entityAttributeOptions
                  : []),
                ...(h.kind === 'number' || h.kind === 'var'
                  ? variableOptions.length > 0
                    ? [{
                      key: 'variables',
                      label: translateUi('ui.object.a772fa4ebe36'),
                      children: variableOptions,
                    }]
                    : []
                  : []),
                ...(h.kind === 'number'
                  ? [{ key: 'constant', label: translateUi('ui.object.7dc406c92803'), value: 'constant' }]
                  : []),
              ]
              const sourceValue = binding?.kind === 'number'
                ? 'constant'
                : binding?.kind === 'entityAttr' && selectedAttrExists
                  ? entityAttrKey(boundEntityId, selectedAttrId)
                  : binding?.kind === 'var' && binding.varId
                    ? variableKey(binding.varId)
                    : ''
              const sourceDisplayValue = binding?.kind === 'number'
                ? '常量'
                : binding?.kind === 'entityAttr' && selectedAttrExists
                  ? `${entityDisplayName(selectedEntity, boundEntityId)}的${attrDisplayName(selectedEntity, selectedAttrId)}`
                  : binding?.kind === 'var' && binding.varId
                    ? variableDisplayName(variables?.[binding.varId], binding.varId)
                    : ''
              const selectHoleSource = (value: string): void => {
                const createAction = createActions.get(value)
                if (createAction) {
                  let nextEntities = entities
                  if (createAction.entityRequest && createEntity) {
                    createEntity.onCreate(createAction.entityRequest)
                    nextEntities = ensureEntity(nextEntities, createAction.entityRequest)
                  }
                  if (createAttribute) {
                    createAttribute.onCreate(createAction.attributeRequest)
                    nextEntities = ensureEntityAttribute(
                      nextEntities,
                      createAction.attributeRequest,
                    )
                  }
                  if (formula) {
                    onChange(compileFormula(
                      formula,
                      { ...holeBindings, [h.holeId]: createAction.binding },
                      nextEntities,
                    ))
                  }
                  return
                }
                const variableCreateRequest = variableCreateActions.get(value)
                if (variableCreateRequest && createVariable) {
                  createVariable.onCreate(variableCreateRequest)
                  setHole(h.holeId, {
                    kind: 'var',
                    varId: variableCreateRequest.variableId,
                  })
                  return
                }
                if (value === 'constant') {
                  setHole(h.holeId, {
                    kind: 'number',
                    value: binding?.kind === 'number' ? binding.value : 0,
                  })
                  return
                }
                const varId = parseVariableKey(value)
                if (varId) {
                  setHole(h.holeId, { kind: 'var', varId })
                  return
                }
                const selected = parseEntityAttrKey(value)
                if (!selected) return
                setHole(h.holeId, {
                  kind: 'entityAttr',
                  entityId: selected.entityId,
                  attr: selected.attrId,
                })
              }
              const constantInput = h.kind === 'number' && binding?.kind === 'number' ? (
                <LooseNumberInput
                  value={binding.value}
                  onChange={(value) => setHole(h.holeId, { kind: 'number', value })}
                  aria-label={label}
                  style={propertyLayout
                    ? { flex: 'none', width: '100%', minWidth: 0 }
                    : { width: 120 }}
                />
              ) : null
              return (
                <div
                  key={h.holeId}
                  role="group"
                  aria-label={`${translateUi('ui.template.ba89685ccad4')}${label}`}
                  className={propertyLayout ? 'editor-property-formula-param' : undefined}
                  style={propertyLayout
                    ? { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0 }
                    : { ...row, border: '1px solid var(--gc-accent-line, #2a2a2a)', borderRadius: 6, padding: 6 }}
                >
                  {propertyLayout ? (
                    <div className="editor-property-formula-param-row">
                      <span>{translateUi('ui.copy.749d76524267')}</span>
                      <CascadingPicker
                        ariaLabel={`${label}来源`}
                        value={sourceValue}
                        displayValue={sourceDisplayValue || label}
                        placeholder={translateUi('ui.copy.9a4e0fbb871e')}
                        options={sourceOptions}
                        narrowSafe
                        onSelect={selectHoleSource}
                      />
                    </div>
                  ) : (
                    <>
                      <span style={holeLbl}>{label}{h.kind === 'entityAttr' && h.suggestAttr ? `${translateUi('ui.template.fdcfe1c77d7b')}${h.suggestAttr}）` : ''}</span>
                      <CascadingPicker
                        ariaLabel={`${label}来源`}
                        value={sourceValue}
                        displayValue={sourceDisplayValue}
                        placeholder={translateUi('ui.copy.9a4e0fbb871e')}
                        options={sourceOptions}
                        onSelect={selectHoleSource}
                      />
                    </>
                  )}
                  {constantInput}
                </div>
              )
            }) : null}
          {visibleBindingIssues.length > 0 ? (
            <BindingIncompleteAlert onFill={referenceFormula}>
              {`${translateUi('ui.template.62c205481b14')}${visibleBindingIssues
                .map((issue) => `${issue.label}（${issue.reason}）`)
                .join('、')}${translateUi('ui.template.e32163f4a8bd')}`}
            </BindingIncompleteAlert>
          ) : propertyLayout ? null : bindingIssues.length > 0 ? null : sampleValue != null ? (
            <p style={hint}>≈ {sampleValue}<span style={{ opacity: 0.6 }}>{translateUi('ui.copy.42de17d6b837')}</span></p>
          ) : (
            <p style={hint}>{translateUi('ui.copy.f8f24461e645')}</p>
          )}
        </>
      )}
    </div>
  )
}
