import { parseExpr, serializeExpr, type Node as ExprNode } from '@/runtime/core/engine/expr'
import type { BlueprintDoc, Entity, ScenarioMetaFields, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'

export type ScenarioIdRename =
  | { kind: 'entity'; oldId: string; newId: string; name?: string }
  | { kind: 'variable'; oldId: string; newId: string; name?: string }
  | { kind: 'formula'; oldId: string; newId: string; name?: string }
  | { kind: 'attribute'; entityId: string; oldId: string; newId: string; name?: string }

export type ScenarioIdRenameResult =
  | { ok: true; meta: ScenarioMetaFields; blueprints: Record<string, BlueprintDoc> }
  | { ok: false; reason: 'empty_id' | 'duplicate_id' | 'not_found' }

function renameRecord<T>(record: Record<string, T>, oldId: string, newId: string, value: T): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([id, current]) => [id === oldId ? newId : id, id === oldId ? value : current]),
  )
}

function rewriteExpr(expr: string, rename: ScenarioIdRename): string {
  try {
    const rewrite = (node: ExprNode): ExprNode => {
      switch (node.t) {
        case 'num':
          return node
        case 'ref': {
          const path = [...node.path]
          if (rename.kind === 'variable' && path[0] === 'var' && path[1] === rename.oldId) path[1] = rename.newId
          if (rename.kind === 'entity' && path[0] === 'entity' && path[1] === rename.oldId) path[1] = rename.newId
          if (rename.kind === 'attribute' && path[0] === 'entity' && path[1] === rename.entityId && path[2] === 'attr' && path[3] === rename.oldId) path[3] = rename.newId
          return { ...node, path }
        }
        case 'unary':
          return { ...node, x: rewrite(node.x) }
        case 'bin':
          return { ...node, a: rewrite(node.a), b: rewrite(node.b) }
        case 'call':
          return { ...node, args: node.args.map(rewrite) }
      }
    }
    return serializeExpr(rewrite(parseExpr(expr)))
  } catch {
    return expr
  }
}

function rewriteReference(ref: string, rename: ScenarioIdRename): string {
  if (rename.kind === 'entity' && ref.startsWith(`entity.${rename.oldId}.`)) {
    return `entity.${rename.newId}${ref.slice(rename.oldId.length + 'entity.'.length)}`
  }
  if (rename.kind === 'variable' && ref === `var.${rename.oldId}`) return `var.${rename.newId}`
  if (rename.kind === 'attribute' && ref === `entity.${rename.entityId}.attr.${rename.oldId}`) {
    return `entity.${rename.entityId}.attr.${rename.newId}`
  }
  return ref
}

/**
 * 修改所有已知的规则 ID 引用。表达式必须先解析为 AST 再改路径，解析失败的自由文本保持不动。
 */
function rewriteTree(value: unknown, rename: ScenarioIdRename): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteTree(item, rename))
  if (!value || typeof value !== 'object') return value

  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) out[key] = rewriteTree(child, rename)

  if (typeof source.expr === 'string') out.expr = rewriteExpr(source.expr, rename)
  if (typeof source.ref === 'string') out.ref = rewriteReference(source.ref, rename)
  if (source.type === 'watch' && typeof source.of === 'string') out.of = rewriteReference(source.of, rename)

  if (rename.kind === 'entity') {
    if (source.entityId === rename.oldId) out.entityId = rename.newId
    if (source.left === rename.oldId) out.left = rename.newId
    if (source.right === rename.oldId) out.right = rename.newId
    if (source.refId === rename.oldId && source.source === 'entity') out.refId = rename.newId
    if ((source.bind === rename.oldId || source.entity === rename.oldId) && typeof source.bind === 'string') out.bind = rename.newId
    if (source.entity === rename.oldId && typeof source.entity === 'string') out.entity = rename.newId
  }
  if (rename.kind === 'variable') {
    if (source.varId === rename.oldId) out.varId = rename.newId
    if (source.refId === rename.oldId && source.source === 'var') out.refId = rename.newId
  }
  if (rename.kind === 'formula' && source.formulaId === rename.oldId) out.formulaId = rename.newId
  if (rename.kind === 'attribute') {
    const targetsEntity = source.entityId === rename.entityId || (source.refId === rename.entityId && source.source === 'entity')
    if (targetsEntity && source.attr === rename.oldId) out.attr = rename.newId
    if (source.suggestAttr === rename.oldId && source.entityId === rename.entityId) out.suggestAttr = rename.newId
  }
  if (source.inputs && typeof source.inputs === 'object' && !Array.isArray(source.inputs)) {
    const inputs = source.inputs as Record<string, unknown>
    const nextInputs = { ...(out.inputs as Record<string, unknown>) }
    const boundEntity = typeof inputs.bind === 'string' ? inputs.bind : typeof inputs.entity === 'string' ? inputs.entity : undefined
    if (rename.kind === 'entity') {
      if (nextInputs.bind === rename.oldId) nextInputs.bind = rename.newId
      if (nextInputs.entity === rename.oldId) nextInputs.entity = rename.newId
    }
    if (rename.kind === 'attribute' && boundEntity === rename.entityId && nextInputs.attr === rename.oldId) {
      nextInputs.attr = rename.newId
    }
    out.inputs = nextInputs
  }
  return out
}

export function renameScenarioId(
  meta: ScenarioMetaFields,
  blueprints: Record<string, BlueprintDoc>,
  rename: ScenarioIdRename,
): ScenarioIdRenameResult {
  const newId = rename.newId.trim()
  if (!newId) return { ok: false, reason: 'empty_id' }

  const nextMeta = structuredClone(meta)
  if (rename.kind === 'entity') {
    const entities = nextMeta.entities ?? {}
    const entity = entities[rename.oldId]
    if (!entity) return { ok: false, reason: 'not_found' }
    if (newId !== rename.oldId && entities[newId]) return { ok: false, reason: 'duplicate_id' }
    nextMeta.entities = renameRecord(entities, rename.oldId, newId, {
      ...entity,
      id: newId,
      ...(rename.name !== undefined ? { name: rename.name } : {}),
    })
  } else if (rename.kind === 'variable') {
    const variables = nextMeta.variables ?? {}
    const variable = variables[rename.oldId]
    if (!variable) return { ok: false, reason: 'not_found' }
    if (newId !== rename.oldId && variables[newId]) return { ok: false, reason: 'duplicate_id' }
    nextMeta.variables = renameRecord(variables, rename.oldId, newId, {
      ...variable,
      id: newId,
      ...(rename.name !== undefined ? { name: rename.name } : {}),
    })
  } else if (rename.kind === 'formula') {
    const formulas = nextMeta.formulas as Record<string, Formula> | undefined
    const formula = formulas?.[rename.oldId]
    if (!formula) return { ok: false, reason: 'not_found' }
    if (newId !== rename.oldId && formulas?.[newId]) return { ok: false, reason: 'duplicate_id' }
    nextMeta.formulas = renameRecord(formulas!, rename.oldId, newId, {
      ...formula,
      id: newId,
      ...(rename.name !== undefined ? { name: rename.name } : {}),
    })
  } else {
    const entity = nextMeta.entities?.[rename.entityId]
    if (!entity?.attrs?.[rename.oldId] && entity?.attrs?.[rename.oldId] !== 0) return { ok: false, reason: 'not_found' }
    if (newId !== rename.oldId && entity.attrs?.[newId] !== undefined) return { ok: false, reason: 'duplicate_id' }
    const attrs = renameRecord(entity.attrs ?? {}, rename.oldId, newId, entity.attrs![rename.oldId]!)
    const attrMeta = entity.attrMeta?.[rename.oldId] !== undefined
      ? renameRecord(entity.attrMeta, rename.oldId, newId, {
          ...entity.attrMeta[rename.oldId]!,
          ...(rename.name !== undefined ? { label: rename.name } : {}),
        })
      : entity.attrMeta
    nextMeta.entities = { ...nextMeta.entities, [rename.entityId]: { ...entity, attrs, attrMeta } }
  }

  const rewrittenMeta = rewriteTree(nextMeta, rename) as ScenarioMetaFields
  const rewrittenBlueprints = rewriteTree(blueprints, rename) as Record<string, BlueprintDoc>
  if (rename.kind === 'entity' || rename.kind === 'variable') {
    for (const blueprint of Object.values(rewrittenBlueprints)) {
      if (rename.kind === 'entity' && blueprint.requires?.entities) {
        blueprint.requires.entities = blueprint.requires.entities.map((id) => id === rename.oldId ? newId : id)
      }
      if (rename.kind === 'variable' && blueprint.requires?.vars) {
        blueprint.requires.vars = blueprint.requires.vars.map((id) => id === rename.oldId ? newId : id)
      }
    }
  }
  return { ok: true, meta: rewrittenMeta, blueprints: rewrittenBlueprints }
}
