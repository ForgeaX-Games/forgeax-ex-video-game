/**
 * 场景 meta 目录 —— 实体 / 属性 / 变量下拉选项（展示名称，写入 id）。
 * 新数据格式：EntitySpec→Entity、VarSpec→Variable（Variable 不再有 number/flag 之分）。
 */
import {
  isNumericScalar,
  variableValueKind,
  type AttrMeta,
  type Entity,
  type ScalarValue,
  type Variable,
} from '@/runtime/core/schema/graph-schema'
import {
  parseFormulaAuthoringText,
  type Formula,
  type FormulaAstNode,
} from '@/authoring/blueprint/formula-authoring'
import { applyRuleOps } from '@/authoring/rules/rule-authoring'
import {
  catalogIdOccupied,
  nextCatalogId,
  nextAvailableCatalogId,
} from '@/authoring/rules/catalog-ids'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'

export {
  catalogIdOccupied,
  nextCatalogId,
  nextAvailableCatalogId,
} from '@/authoring/rules/catalog-ids'

export interface EntityAttributeCreateRequest {
  entityId: string
  attrId: string
  initialValue: number
  meta?: AttrMeta
}

export interface EntityCreateRequest {
  entityId: string
  name: string
  kind?: string
}

export interface VariableCreateRequest {
  variableId: string
  name: string
  initialValue: ScalarValue
}

export interface FormulaCreateRequest {
  formulaId: string
  name: string
  ast: FormulaAstNode
}

export function ensureEntity(
  entities: Record<string, Entity> | undefined,
  request: EntityCreateRequest,
): Record<string, Entity> {
  const current = entities ?? {}
  const existing = Object.entries(current).find(([key, entity]) =>
    key === request.entityId || entity.id === request.entityId)
  if (existing) return current
  const result = applyRuleOps({ entities: current }, [{
    op: 'upsert-entity',
    entityId: request.entityId,
    name: request.name,
    kind: request.kind,
  }])
  return result.ok ? result.meta.entities ?? current : current
}

export function ensureVariable(
  variables: Record<string, Variable> | undefined,
  request: VariableCreateRequest,
): Record<string, Variable> {
  const current = variables ?? {}
  if (catalogIdOccupied(current, request.variableId)) return current
  const result = applyRuleOps({ variables: current }, [{
    op: 'upsert-variable',
    variableId: request.variableId,
    name: request.name,
    initial: request.initialValue,
  }])
  return result.ok ? result.meta.variables ?? current : current
}

export function formulaFromCreateRequest(request: FormulaCreateRequest): Formula {
  return {
    id: request.formulaId,
    name: request.name,
    ast: request.ast,
  }
}

export function parseFormulaCreateContent(
  content: string,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): FormulaAstNode {
  return parseFormulaAuthoringText(content, { entities, variables })
}

export function ensureFormula(
  formulas: Record<string, Formula> | undefined,
  request: FormulaCreateRequest,
  catalogs: {
    entities?: Record<string, Entity>
    variables?: Record<string, Variable>
  } = {},
): Record<string, Formula> {
  const current = formulas ?? {}
  if (catalogIdOccupied(current, request.formulaId)) return current
  const result = applyRuleOps({ formulas: current, ...catalogs }, [{
    op: 'upsert-formula',
    formulaId: request.formulaId,
    name: request.name,
    ast: request.ast,
  }])
  return result.ok ? result.meta.formulas ?? current : current
}

export function ensureEntityAttribute(
  entities: Record<string, Entity> | undefined,
  request: EntityAttributeCreateRequest,
): Record<string, Entity> | undefined {
  if (!entities) return entities
  const entry = Object.entries(entities).find(([key, entity]) =>
    key === request.entityId || entity.id === request.entityId)
  if (!entry) return entities

  const [, entity] = entry
  if (
    Object.hasOwn(entity.attrs ?? {}, request.attrId)
    || Object.hasOwn(entity.attrMeta ?? {}, request.attrId)
  ) {
    return entities
  }

  const result = applyRuleOps({ entities }, [{
    op: 'upsert-entity-attr',
    entityId: request.entityId,
    attrId: request.attrId,
    value: request.initialValue,
    meta: request.meta,
  }])
  return result.ok ? result.meta.entities : entities
}

export function findEntity(
  entities: Record<string, Entity> | undefined,
  id: string,
): Entity | undefined {
  if (!entities || !id) return undefined
  if (entities[id]) return entities[id]
  return Object.values(entities).find((e) => e.id === id)
}

export function entityDisplayName(entity: Entity | undefined, fallbackId: string): string {
  const name = entity?.name?.trim()
  const kind = entity?.kind?.trim()
  return name || kind || fallbackId
}

export function attrDisplayName(entity: Entity | undefined, attrId: string): string {
  return entity?.attrMeta?.[attrId]?.label?.trim() || attrId
}

export function attrValueText(entity: Entity | undefined, attrId: string): string {
  return String(entity?.attrs?.[attrId] ?? entity?.attrMeta?.[attrId]?.initial ?? 0)
}

export function variableDisplayName(variable: Variable | undefined, fallbackId: string): string {
  return variable?.name?.trim() || fallbackId
}

export function formulaDisplayName(formula: Formula | undefined, fallbackId: string): string {
  return formula?.name?.trim() || fallbackId
}

export function listEntityOptions(
  entities: Record<string, Entity> | undefined,
): Array<{ id: string; label: string }> {
  return Object.entries(entities ?? {}).map(([key, e]) => {
    const id = e.id ?? key
    const name = (e.name ?? '').trim()
    const kind = (e.kind ?? '').trim()
    const label = name ? authoringOptionLabel(name, id) : kind ? `${kind} · ${id}` : id
    return { id, label }
  })
}

export function listAttrOptions(
  ent: Entity | undefined,
  opts?: { numbersOnly?: boolean },
): Array<{ id: string; label: string }> {
  if (!ent) return []
  const keys = new Set<string>([
    ...Object.keys(ent.attrs ?? {}),
    ...Object.keys(ent.attrMeta ?? {}),
  ])
  const ids = [...keys]
  const filtered = opts?.numbersOnly
    ? ids.filter((id) => {
      const current = ent.attrs?.[id]
      return current === undefined
        ? ent.attrMeta?.[id] !== undefined
        : isNumericScalar(current)
    })
    : ids
  return filtered.sort().map((id) => {
    const label = ent.attrMeta?.[id]?.label?.trim()
    return { id, label: authoringOptionLabel(label, id) }
  })
}

/**
 * 变量下拉。新数据格式不再声明独立类型；缺少 initial 的旧变量按数值兼容。
 */
export function listVarOptions(
  variables: Record<string, Variable> | undefined,
  opts?: {
    valueType?: 'number' | 'text' | 'all'
    /** @deprecated 改用 valueType。 */
    numbersOnly?: boolean
    /** @deprecated flag 是独立运行时桶，不应从变量目录筛选。 */
    flagsOnly?: boolean
  },
): Array<{ id: string; label: string; valueType: 'number' | 'text' }> {
  const valueType = opts?.valueType ?? (opts?.numbersOnly ? 'number' : 'all')
  return Object.entries(variables ?? {}).filter(([, variable]) =>
    valueType === 'all' || variableValueKind(variable) === valueType,
  ).map(([key, v]) => {
    const id = v.id ?? key
    const name = (v.name ?? '').trim()
    return { id, label: authoringOptionLabel(name, id), valueType: variableValueKind(v) }
  })
}

/** 公式下拉（应用公式时选具名公式）。 */
export function listFormulaOptions(
  formulas: Record<string, Formula> | undefined,
): Array<{ id: string; label: string }> {
  return Object.entries(formulas ?? {}).map(([key, f]) => {
    const id = f.id ?? key
    const name = (f.name ?? '').trim()
    return { id, label: authoringOptionLabel(name, id) }
  })
}

export function findFormula(
  formulas: Record<string, Formula> | undefined,
  id: string,
): Formula | undefined {
  if (!formulas || !id) return undefined
  if (formulas[id]) return formulas[id]
  return Object.values(formulas).find((f) => f.id === id)
}
