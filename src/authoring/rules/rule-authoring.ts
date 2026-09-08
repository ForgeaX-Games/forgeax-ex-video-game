/**
 * 规则作者 application service —— 实体 / 属性 / 变量 / 公式的批量 upsert 与 remove。
 *
 * 这是编辑器 UI 与 Agent `patch-rules` 的**同一套**语义：id 分配、默认字段、公式解析、
 * 引用校验和错误码都在这里，两侧只是不同 adapter。任何一侧自己再实现一遍，就会出现
 * 「UI 建的变量和 Agent 建的变量不一样」这类漂移。
 *
 * 纯函数、无 fs、无 React。整批要么全部生效、要么原样返回失败：调用方负责在
 * 文档锁内把结果落盘。
 *
 * 修改的是 `blueprint.json` 里的**作者态配置模板**，不是某个正在运行的 `GraphSession`；
 * 试玩会从这些初值创建隔离的可变运行状态。
 */
import type { AttrMeta, Entity, ScalarValue, Variable } from '@/runtime/core/schema/graph-schema'
import {
  parseFormulaAuthoringText,
  validateFormulaCalls,
  type Formula,
  type FormulaAstNode,
  type FormulaRef,
} from '@/authoring/blueprint/formula-authoring'
import { isValidNewRuleId, RULE_ID_RULE_TEXT } from '@/runtime/core/engine/formula-registry'
import { nextCatalogId } from '@/authoring/rules/catalog-ids'

/**
 * 与编辑器 UI 完全一致的 id 前缀。UI 侧调用点见 `editors.tsx` / `TextValueEditor.tsx`；
 * Agent 分配出的 id 必须和 UI 分配的不可区分。
 */
export const RULE_ID_PREFIXES = {
  entity: 'entity',
  variable: 'var',
  formula: 'formula',
} as const

export interface RuleAuthoringMeta {
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  formulas?: Record<string, Formula>
}

export type RuleOp =
  | { op: 'upsert-entity'; entityId?: string; name?: string; kind?: string }
  | { op: 'remove-entity'; entityId: string }
  | {
    op: 'upsert-entity-attr'
    entityId: string
    attrId: string
    value?: number
    meta?: AttrMeta
  }
  | { op: 'remove-entity-attr'; entityId: string; attrId: string }
  | {
    op: 'upsert-variable'
    variableId?: string
    name?: string
    initial?: ScalarValue
    min?: number
    max?: number
  }
  | { op: 'remove-variable'; variableId: string }
  | {
    op: 'upsert-formula'
    formulaId?: string
    name?: string
    description?: string
    /** 作者表达式文本；创建时必填，更新时省略表示保留原表达式。 */
    expressionText?: string
    /** UI adapter 已持有的规范 AST；不属于公开 `patch-rules` JSON schema。 */
    ast?: FormulaAstNode
  }
  | { op: 'remove-formula'; formulaId: string }

export interface RuleAuthoringError {
  code: string
  message: string
  /** 触发失败的 op 下标；跨 op 的引用冲突指向发起移除的那个 op。 */
  opIndex?: number
}

export interface RuleOpOutcome {
  op: RuleOp['op']
  /** 该 op 最终作用的对象 id（含自动分配的结果）。 */
  id: string
  attrId?: string
}

export type RuleAuthoringResult =
  | { ok: true; meta: RuleAuthoringMeta; results: RuleOpOutcome[] }
  | { ok: false; errors: RuleAuthoringError[]; failedOpIndex?: number }

interface PendingFormulaParse {
  opIndex: number
  formulaId: string
  expressionText: string
}

interface Removal {
  opIndex: number
  entityId?: string
  attrId?: string
  variableId?: string
}

function findKey(
  catalog: Record<string, { id?: string }> | undefined,
  id: string,
): string | undefined {
  if (!catalog || !id) return undefined
  if (Object.hasOwn(catalog, id)) return id
  return Object.keys(catalog).find((key) => catalog[key]!.id === id)
}

function collectRefs(node: FormulaAstNode, out: FormulaRef[] = []): FormulaRef[] {
  switch (node.t) {
    case 'ref':
      out.push(node.ref)
      return out
    case 'unary':
      return collectRefs(node.x, out)
    case 'bin':
      collectRefs(node.a, out)
      return collectRefs(node.b, out)
    case 'call':
      for (const arg of node.args) collectRefs(arg, out)
      return out
    default:
      // num / hole carry no concrete reference.
      return out
  }
}

function entityHasAttr(entity: Entity | undefined, attr: string): boolean {
  return Boolean(entity)
    && (Object.hasOwn(entity!.attrs ?? {}, attr) || Object.hasOwn(entity!.attrMeta ?? {}, attr))
}

/**
 * 应用一批规则 ops。
 *
 * 公式表达式在**全部结构 op 应用之后**才解析：解析器需要实体/变量目录消解带连字符的
 * id 歧义，所以同一批里「先建变量再建引用它的公式」必须成立。
 */
export function applyRuleOps(
  meta: RuleAuthoringMeta,
  ops: readonly RuleOp[],
): RuleAuthoringResult {
  if (!Array.isArray(ops) || ops.length === 0) {
    return {
      ok: false,
      errors: [{ code: 'rules.ops.empty', message: 'ops 必须是非空数组' }],
    }
  }

  const draft: Required<RuleAuthoringMeta> = {
    entities: { ...(meta.entities ?? {}) },
    variables: { ...(meta.variables ?? {}) },
    formulas: { ...(meta.formulas ?? {}) },
  }
  const results: RuleOpOutcome[] = []
  const pendingFormulas: PendingFormulaParse[] = []
  const removals: Removal[] = []

  const fail = (
    opIndex: number,
    code: string,
    message: string,
  ): RuleAuthoringResult => ({
    ok: false,
    errors: [{ code, message, opIndex }],
    failedOpIndex: opIndex,
  })

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!
    switch (op.op) {
      case 'upsert-entity': {
        const requested = op.entityId?.trim()
        const key = requested ? findKey(draft.entities, requested) : undefined
        // 与变量同一条规则：只管新建，历史 ID 继续可改可删。
        if (requested && !key && !isValidNewRuleId(requested)) {
          return fail(
            index,
            'rules.entity.invalid-id',
            `实体 ID ${requested} 不合法：${RULE_ID_RULE_TEXT}`,
          )
        }
        const id = key ?? requested ?? nextCatalogId(RULE_ID_PREFIXES.entity, draft.entities)
        const existing = key ? draft.entities[key]! : undefined
        draft.entities[id] = {
          ...(existing ?? { attrs: {}, attrMeta: {} }),
          id,
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.kind !== undefined ? { kind: op.kind } : {}),
        }
        results.push({ op: op.op, id })
        break
      }
      case 'remove-entity': {
        const key = findKey(draft.entities, op.entityId)
        if (!key) return fail(index, 'rules.entity.not-found', `实体不存在：${op.entityId}`)
        delete draft.entities[key]
        removals.push({ opIndex: index, entityId: key })
        results.push({ op: op.op, id: key })
        break
      }
      case 'upsert-entity-attr': {
        const key = findKey(draft.entities, op.entityId)
        if (!key) return fail(index, 'rules.entity.not-found', `实体不存在：${op.entityId}`)
        const attrExists = draft.entities[key]?.attrs?.[op.attrId] !== undefined
        if (!attrExists && !isValidNewRuleId(op.attrId)) {
          return fail(
            index,
            'rules.entity.invalid-attr-id',
            `属性 ID ${op.attrId} 不合法：${RULE_ID_RULE_TEXT}`,
          )
        }
        const attrId = op.attrId?.trim()
        if (!attrId) return fail(index, 'rules.attr.invalid', 'attrId 不能为空')
        const entity = draft.entities[key]!
        draft.entities[key] = {
          ...entity,
          attrs: { ...entity.attrs, [attrId]: op.value ?? op.meta?.initial ?? 0 },
          ...(op.meta
            ? { attrMeta: { ...entity.attrMeta, [attrId]: { ...entity.attrMeta?.[attrId], ...op.meta } } }
            : {}),
        }
        results.push({ op: op.op, id: key, attrId })
        break
      }
      case 'remove-entity-attr': {
        const key = findKey(draft.entities, op.entityId)
        if (!key) return fail(index, 'rules.entity.not-found', `实体不存在：${op.entityId}`)
        const entity = draft.entities[key]!
        if (!entityHasAttr(entity, op.attrId)) {
          return fail(index, 'rules.attr.not-found', `实体 ${key} 没有属性 ${op.attrId}`)
        }
        const attrs = { ...entity.attrs }
        const attrMeta = { ...entity.attrMeta }
        delete attrs[op.attrId]
        delete attrMeta[op.attrId]
        draft.entities[key] = { ...entity, attrs, attrMeta }
        removals.push({ opIndex: index, entityId: key, attrId: op.attrId })
        results.push({ op: op.op, id: key, attrId: op.attrId })
        break
      }
      case 'upsert-variable': {
        const requested = op.variableId?.trim()
        const key = requested ? findKey(draft.variables, requested) : undefined
        // 只校验**新建**：ID 已存在说明是更新，历史连字符 ID 必须继续可改可删。
        // 这也是为什么格式不能写进 patch-rules schema —— 那会连同更新一起拒掉。
        if (requested && !key && !isValidNewRuleId(requested)) {
          return fail(
            index,
            'rules.variable.invalid-id',
            `变量 ID ${requested} 不合法：${RULE_ID_RULE_TEXT}`,
          )
        }
        const id = key ?? requested ?? nextCatalogId(RULE_ID_PREFIXES.variable, draft.variables)
        draft.variables[id] = {
          ...(key ? draft.variables[key]! : {}),
          id,
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.initial !== undefined ? { initial: op.initial } : {}),
          ...(op.min !== undefined ? { min: op.min } : {}),
          ...(op.max !== undefined ? { max: op.max } : {}),
        }
        results.push({ op: op.op, id })
        break
      }
      case 'remove-variable': {
        const key = findKey(draft.variables, op.variableId)
        if (!key) return fail(index, 'rules.variable.not-found', `变量不存在：${op.variableId}`)
        delete draft.variables[key]
        removals.push({ opIndex: index, variableId: key })
        results.push({ op: op.op, id: key })
        break
      }
      case 'upsert-formula': {
        const requested = op.formulaId?.trim()
        const key = requested ? findKey(draft.formulas, requested) : undefined
        if (requested && !key && !isValidNewRuleId(requested)) {
          return fail(
            index,
            'rules.formula.invalid-id',
            `公式 ID ${requested} 不合法：${RULE_ID_RULE_TEXT}`,
          )
        }
        const id = key ?? requested ?? nextCatalogId(RULE_ID_PREFIXES.formula, draft.formulas)
        const existing = key ? draft.formulas[key]! : undefined
        const expressionText = op.expressionText?.trim()
        if (expressionText && op.ast) {
          return fail(
            index,
            'rules.formula.expression-ambiguous',
            `公式 ${id} 不能同时提交 expressionText 和 ast`,
          )
        }
        if (!existing && !expressionText && !op.ast) {
          return fail(
            index,
            'rules.formula.expression-required',
            `新建公式 ${id} 必须提供 expressionText`,
          )
        }
        draft.formulas[id] = {
          // 占位 AST：真实解析在结构 op 全部应用后进行。
          ast: existing?.ast ?? { t: 'num', id: 'n0', v: 0 },
          ...existing,
          id,
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.description !== undefined ? { description: op.description } : {}),
        }
        if (expressionText) pendingFormulas.push({ opIndex: index, formulaId: id, expressionText })
        if (op.ast) draft.formulas[id] = { ...draft.formulas[id]!, ast: op.ast }
        results.push({ op: op.op, id })
        break
      }
      case 'remove-formula': {
        const key = findKey(draft.formulas, op.formulaId)
        if (!key) return fail(index, 'rules.formula.not-found', `公式不存在：${op.formulaId}`)
        delete draft.formulas[key]
        results.push({ op: op.op, id: key })
        break
      }
      default:
        return fail(index, 'rules.op.unknown', `未知 op：${String((op as { op: string }).op)}`)
    }
  }

  // 公式表达式：按最终目录解析，让同批新建的实体/变量可被引用。
  for (const pending of pendingFormulas) {
    let ast: FormulaAstNode
    try {
      ast = parseFormulaAuthoringText(pending.expressionText, {
        entities: draft.entities,
        variables: draft.variables,
      })
    } catch (error) {
      return fail(
        pending.opIndex,
        'rules.formula.parse-failed',
        `公式 ${pending.formulaId} 表达式无法解析：${(error as Error).message}`,
      )
    }
    const callIssue = validateFormulaCalls(ast)[0]
    if (callIssue) {
      return fail(
        pending.opIndex,
        callIssue.code,
        `公式 ${pending.formulaId}：${callIssue.message}`,
      )
    }
    const current = draft.formulas[pending.formulaId]!
    const { draftEmpty: _draftEmpty, ...rest } = current
    draft.formulas[pending.formulaId] = { ...rest, ast }
  }

  // 直接提交 AST 的路径同样要过函数白名单，否则等于留了一个绕过入口。
  for (const [formulaId, formula] of Object.entries(draft.formulas)) {
    const callIssue = validateFormulaCalls(formula.ast)[0]
    if (callIssue) {
      return fail(0, callIssue.code, `公式 ${formulaId}：${callIssue.message}`)
    }
  }

  // 引用校验按最终状态执行，所以「删变量 + 删用它的公式」两种顺序都合法。
  const removedEntity = new Map<string, number>()
  const removedAttr = new Map<string, number>()
  const removedVariable = new Map<string, number>()
  for (const removal of removals) {
    if (removal.variableId) removedVariable.set(removal.variableId, removal.opIndex)
    else if (removal.attrId) removedAttr.set(`${removal.entityId}.${removal.attrId}`, removal.opIndex)
    else if (removal.entityId) removedEntity.set(removal.entityId, removal.opIndex)
  }

  for (const [formulaId, formula] of Object.entries(draft.formulas)) {
    for (const ref of collectRefs(formula.ast)) {
      if (ref.kind === 'score') continue
      if (ref.kind === 'var') {
        const variableKey = findKey(draft.variables, ref.varId)
        if (variableKey) {
          if (typeof draft.variables[variableKey]?.initial === 'string') {
            return fail(
              -1,
              'rules.formula.non-numeric-var',
              `公式 ${formulaId} 引用了文本变量 ${ref.varId}；公式只支持数值变量`,
            )
          }
          continue
        }
        const removedAt = removedVariable.get(ref.varId)
        if (removedAt !== undefined) {
          return fail(
            removedAt,
            'rules.variable.in-use',
            `变量 ${ref.varId} 仍被公式 ${formulaId} 引用，不能移除`,
          )
        }
        return fail(
          -1,
          'rules.formula.unknown-reference',
          `公式 ${formulaId} 引用了不存在的变量 ${ref.varId}`,
        )
      }
      const entityKey = findKey(draft.entities, ref.entityId)
      if (entityKey && entityHasAttr(draft.entities[entityKey], ref.attr)) continue
      const entityRemovedAt = removedEntity.get(ref.entityId)
      if (entityRemovedAt !== undefined) {
        return fail(
          entityRemovedAt,
          'rules.entity.in-use',
          `实体 ${ref.entityId} 仍被公式 ${formulaId} 引用，不能移除`,
        )
      }
      const attrRemovedAt = removedAttr.get(`${ref.entityId}.${ref.attr}`)
      if (attrRemovedAt !== undefined) {
        return fail(
          attrRemovedAt,
          'rules.attr.in-use',
          `属性 ${ref.entityId}.${ref.attr} 仍被公式 ${formulaId} 引用，不能移除`,
        )
      }
      return fail(
        -1,
        'rules.formula.unknown-reference',
        `公式 ${formulaId} 引用了不存在的 ${ref.entityId}.${ref.attr}`,
      )
    }
  }

  return { ok: true, meta: draft, results }
}
