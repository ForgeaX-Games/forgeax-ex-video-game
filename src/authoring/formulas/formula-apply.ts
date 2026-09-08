/**
 * 公式（Formula）编译 / 回填 —— 把「公式定义（AST）+ 留空位绑定」编译成具体 NumOrExpr，并在公式库
 * 变化时批量回溯刷新所有已应用处的 expr 缓存。
 *
 * 设计：公式定义（`Formula.ast`）+ 每处应用的 holeBindings 是 SSOT；写进字段的 `expr` 字符串是
 * **派生缓存**，由 `compileFormula`/`recompileFormulaUsages` 这两个纯函数算出来（内部走
 * `serializeFormula` → 运行时 `serializeExpr`，序列化只此一套）。`runtime/engine/expr.ts` 全程
 * 不知道"公式"这个概念，只读普通表达式字符串——回溯刷新完全是编辑器侧的一次性数据变换。
 */
import type { Entity, NumOrExpr, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula, FormulaAstNode, FormulaHoleBinding, FormulaHoleKind, FormulaPick } from '@/authoring/blueprint/formula-authoring'
import { normalizeHoleBinding, previewFormula, serializeFormula } from '@/authoring/blueprint/formula-authoring'
import { findEntity, listAttrOptions } from './meta-catalog'

export interface FormulaHole {
  /** 稳定寻址键 = 该 hole 节点的 holeId，对应 holeBindings 的 key。 */
  holeId: string
  kind: FormulaHoleKind
  label?: string
  /** entityAttr 空位作者预置的约定属性名（应用时缺省取所选实体该属性 / 第一个属性）。 */
  suggestAttr?: string
}

export interface FormulaHoleBindingIssue {
  holeId: string
  label: string
  reason: string
}

/** 深度遍历 AST 收集全部留空位（应用公式时据此渲染填空控件）。 */
export function formulaHoles(formula: Formula): FormulaHole[] {
  const out: FormulaHole[] = []
  const seen = new Set<string>()
  const walk = (n: FormulaAstNode): void => {
    switch (n.t) {
      case 'hole':
        if (!seen.has(n.holeId)) {
          seen.add(n.holeId)
          out.push({ holeId: n.holeId, kind: n.kind, label: n.label, suggestAttr: n.suggestAttr })
        }
        break
      case 'unary':
        walk(n.x)
        break
      case 'bin':
        walk(n.a)
        walk(n.b)
        break
      case 'call':
        n.args.forEach(walk)
        break
      default:
        break
    }
  }
  walk(formula.ast)
  return out
}

function entityBindingIssue(
  hole: FormulaHole,
  binding: Extract<FormulaHoleBinding, { kind: 'entityAttr' }>,
  entities: Record<string, Entity> | undefined,
): string | undefined {
  if (!binding.entityId) return '尚未选择实体'
  if (entities === undefined) {
    return binding.attr || hole.suggestAttr ? undefined : '尚未选择属性'
  }
  const entity = findEntity(entities, binding.entityId)
  if (!entity) return `实体「${binding.entityId}」已不存在`
  const attr = binding.attr || hole.suggestAttr
  if (!attr) return '尚未选择属性'
  if (!listAttrOptions(entity).some((option) => option.id === attr)) {
    return `属性「${attr}」已不存在`
  }
  return undefined
}

/** 普通数值参数可绑定常量、实体属性或变量；显式实体/变量参数仍保持各自类型。 */
function holeBindingIssue(
  hole: FormulaHole,
  binding: FormulaHoleBinding | undefined,
  entities: Record<string, Entity> | undefined,
): string | undefined {
  if (!binding) return hole.kind === 'number' ? '尚未选择数值来源' : '尚未绑定'
  if (hole.kind === 'entityAttr' && binding.kind !== 'entityAttr') return '需要绑定实体属性'
  if (hole.kind === 'var' && binding.kind !== 'var') return '需要绑定变量'
  if (binding.kind === 'number') return undefined
  if (binding.kind === 'var') return binding.varId ? undefined : '尚未选择变量'
  return entityBindingIssue(hole, binding, entities)
}

/** 返回每个缺失或失效绑定的具体原因，供应用 UI 明确提示。 */
export function formulaHoleBindingIssues(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
  entities?: Record<string, Entity>,
): FormulaHoleBindingIssue[] {
  return formulaHoles(formula).flatMap((hole) => {
    const reason = holeBindingIssue(
      hole,
      normalizeHoleBinding(holeBindings[hole.holeId]),
      entities,
    )
    return reason
      ? [{ holeId: hole.holeId, label: hole.label || hole.holeId, reason }]
      : []
  })
}

/** 尚未填全的留空位；调用方据此阻止把半成品误当完整公式。 */
export function missingFormulaHoles(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
  entities?: Record<string, Entity>,
): FormulaHole[] {
  const missingIds = new Set(
    formulaHoleBindingIssues(formula, holeBindings, entities).map((issue) => issue.holeId),
  )
  return formulaHoles(formula).filter((hole) => missingIds.has(hole.holeId))
}

/** 公式内直接引用和变量空位绑定中，当前变量目录尚未声明的 id。 */
export function missingFormulaVariables(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding>,
  variables: Record<string, Variable> | undefined,
): string[] {
  const referenced = new Set<string>()
  const walk = (node: FormulaAstNode): void => {
    switch (node.t) {
      case 'ref':
        if (node.ref.kind === 'var' && node.ref.varId) referenced.add(node.ref.varId)
        break
      case 'unary':
        walk(node.x)
        break
      case 'bin':
        walk(node.a)
        walk(node.b)
        break
      case 'call':
        node.args.forEach(walk)
        break
      default:
        break
    }
  }
  walk(formula.ast)
  for (const hole of formulaHoles(formula)) {
    if (hole.kind !== 'var') continue
    const binding = normalizeHoleBinding(holeBindings[hole.holeId])
    if (binding?.kind === 'var' && binding.varId) referenced.add(binding.varId)
  }
  const declared = new Set<string>()
  for (const [key, variable] of Object.entries(variables ?? {})) {
    declared.add(key)
    if (variable.id) declared.add(variable.id)
  }
  return [...referenced].filter((id) => !declared.has(id))
}

/** 只读预览文案（公式定义列表 / 应用公式时的只读展示共用）：未填空位标 ❓。 */
export function formulaPreview(
  formula: Formula,
  holeBindings: Record<string, FormulaHoleBinding> = {},
): string {
  return previewFormula(formula.ast, holeBindings)
}

/**
 * 归一 holeBindings：把旧形状 / 松散值转成 typed，并为 entityAttr 空位补默认属性。
 * 不完整或失效值仍保留在 sidecar，确保作者可以继续填写并看到准确提示。
 */
function resolveBindings(
  formula: Formula,
  holeBindings: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): Record<string, FormulaHoleBinding> {
  const holes = formulaHoles(formula)
  const out: Record<string, FormulaHoleBinding> = {}
  for (const hole of holes) {
    const b = normalizeHoleBinding(holeBindings[hole.holeId])
    if (!b) continue
    if (b.kind === 'entityAttr') {
      const attr = b.attr
        || hole.suggestAttr
        || listAttrOptions(findEntity(entities, b.entityId))[0]?.id
      out[hole.holeId] = { kind: 'entityAttr', entityId: b.entityId, attr }
    } else {
      out[hole.holeId] = b
    }
  }
  return out
}

/** 编译一次「应用公式」：具体 NumOrExpr + 编辑器专属的 formula pick sidecar。 */
export function compileFormula(
  formula: Formula,
  holeBindings: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): NumOrExpr {
  const resolved = resolveBindings(formula, holeBindings, entities)
  const holesById = new Map(formulaHoles(formula).map((hole) => [hole.holeId, hole]))
  const compilable = Object.fromEntries(
    Object.entries(resolved).filter(([holeId, binding]) => {
      const hole = holesById.get(holeId)
      return hole && !holeBindingIssue(hole, binding, entities)
    }),
  )
  const expr = serializeFormula(formula.ast, compilable) ?? '0'
  const pick: FormulaPick = { mode: 'formula', formulaId: formula.id, holeBindings: resolved }
  return { expr, pick } as unknown as NumOrExpr
}

interface FormulaPickNode {
  expr: string
  pick: FormulaPick
}

function asFormulaPickNode(v: unknown): FormulaPickNode | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (typeof o.expr !== 'string') return undefined
  const p = o.pick
  if (!p || typeof p !== 'object') return undefined
  const pm = p as Record<string, unknown>
  if (pm.mode !== 'formula' || typeof pm.formulaId !== 'string' || typeof pm.holeBindings !== 'object' || !pm.holeBindings) {
    return undefined
  }
  return { expr: o.expr, pick: { mode: 'formula', formulaId: pm.formulaId, holeBindings: pm.holeBindings as Record<string, FormulaHoleBinding> } }
}

/**
 * 深度遍历任意可序列化值（scenario/graph 的 JSON 树），把所有形如
 * `{ expr, pick: {mode:'formula', formulaId, holeBindings} }` 的节点按公式库**当前**定义重新编译。
 * - 公式已被删除 → 原样保留旧 `expr`（不报错、不清空）。
 * - 没变化的分支保持原对象引用（避免无谓的 zundo 历史抖动 / 无意义的 re-render）。
 * - 结构无关：不管这个形状此刻藏在 Effect.value、numberExpr 组件输入还是别的地方都会命中，
 *   不用逐个字段枚举，未来新增的数值字段天然也被覆盖。
 */
export function recompileFormulaUsages<T>(
  tree: T,
  formulas: Record<string, Formula> | undefined,
  entities: Record<string, Entity> | undefined,
): T {
  if (!formulas || Object.keys(formulas).length === 0) return tree
  function walk(v: unknown): unknown {
    const node = asFormulaPickNode(v)
    if (node) {
      const formula = formulas![node.pick.formulaId]
      if (!formula) return v
      const next = compileFormula(formula, node.pick.holeBindings, entities)
      const nextExpr = typeof next === 'number' ? String(next) : next.expr
      return nextExpr === node.expr ? v : next
    }
    if (Array.isArray(v)) {
      let changed = false
      const out = v.map((item) => {
        const nv = walk(item)
        if (nv !== item) changed = true
        return nv
      })
      return changed ? out : v
    }
    if (v && typeof v === 'object') {
      let changed = false
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const nv = walk(val)
        if (nv !== val) changed = true
        out[k] = nv
      }
      return changed ? out : v
    }
    return v
  }
  return walk(tree) as T
}
