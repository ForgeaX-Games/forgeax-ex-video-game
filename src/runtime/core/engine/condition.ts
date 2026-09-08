/**
 * 条件求值（图原生、通用）—— 对 GraphCondition 在运行态上求值。all[] 之间 AND。
 *
 * 通用化（方向 C）：无 hp 特判。`attr` 比 attr 值、`attrRatio` = attrs[attr]/attrMeta[attr].max、
 * `attrCompare` 比两实体同名 attr。死亡即 `attrRatio hp lte 0`（hp 只是约定名的 attr）。
 */
import type { CmpOp, GraphClause, GraphCondition } from '../schema/graph-schema'
import type { MutableState } from './apply-effects'

export interface ConditionTarget {
  state: MutableState
  visited: Set<string>
}

function cmp(a: number, op: CmpOp, b: number): boolean {
  switch (op) {
    case 'gte':
      return a >= b
    case 'lte':
      return a <= b
    case 'gt':
      return a > b
    case 'lt':
      return a < b
    case 'eq':
      return a === b
    case 'neq':
      return a !== b
  }
}

function attrRatio(state: MutableState, entityId: string, attr: string): number {
  const e = state.entities[entityId]
  const max = e?.attrMeta?.[attr]?.max
  if (!e || !max) return 0
  return (e.attrs[attr] ?? 0) / max
}

function resolveTextValue(value: string | { ref: string }, state: MutableState): string {
  if (typeof value === 'string') return value
  const path = value.ref.split('.')
  if (path[0] === 'var') return state.textVars?.[path.slice(1).join('.')] ?? ''
  return value.ref
}

function evalClause(c: GraphClause, t: ConditionTarget): boolean {
  const { state } = t
  switch (c.type) {
    case 'var':
      if (c.valueType === 'text') {
        const current = state.textVars?.[c.varId] ?? ''
        const expected = resolveTextValue(c.value, state)
        return c.op === 'eq' ? current === expected : current !== expected
      }
      return cmp(state.vars[c.varId] ?? 0, c.op, c.value)
    case 'flag':
      return (state.flags[c.varId] ?? 0) === (c.equals ? 1 : 0)
    case 'visited':
      return t.visited.has(c.nodeId)
    case 'hasItem':
      return (state.items?.[c.itemId] ?? 0) >= (c.count ?? 1)
    case 'attr':
      return cmp(state.entities[c.entityId]?.attrs[c.attr] ?? 0, c.op, c.value)
    case 'attrRatio':
      return cmp(attrRatio(state, c.entityId, c.attr), c.op, c.value)
    case 'attrCompare': {
      const l = state.entities[c.left]?.attrs[c.attr] ?? 0
      const r = state.entities[c.right]?.attrs[c.attr] ?? 0
      return cmp(l, c.op, r)
    }
    case 'score':
      return cmp(state.score, c.op, c.value)
    default:
      return false
  }
}

export function evaluateCondition(cond: GraphCondition | undefined, t: ConditionTarget): boolean {
  // `all` 缺失的 condition 由 runtime.shape.valid 报错，但硬门可能已被放行，
  // 这里按「无子句」处理，宁可不约束也不能让一次求值炸掉整个运行时。
  const clauses = cond?.all
  if (!Array.isArray(clauses) || clauses.length === 0) return true
  return clauses.every((c) => evalClause(c, t))
}

const OP_SYM: Record<CmpOp, string> = { gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=', neq: '≠' }

/** 把单个 clause 渲染成"带实时值 + 是否成立"的可读串（供运行日志解释"为什么进入"）。 */
export function describeClause(c: GraphClause, t: ConditionTarget): string {
  const { state } = t
  const ok = evalClause(c, t) ? '✓' : '✗'
  switch (c.type) {
    case 'var':
      if (c.valueType === 'text') {
        const current = state.textVars?.[c.varId] ?? ''
        const expected = resolveTextValue(c.value, state)
        return `${c.varId}(${current}) ${OP_SYM[c.op]} ${expected} ${ok}`
      }
      return `${c.varId}(${state.vars[c.varId] ?? 0}) ${OP_SYM[c.op]} ${c.value} ${ok}`
    case 'flag':
      return `${c.varId}=${(state.flags[c.varId] ?? 0) === 1}（需 ${c.equals}）${ok}`
    case 'visited':
      return `到过「${c.nodeId}」${ok}`
    case 'hasItem':
      return `拥有 ${c.itemId}（现 ${state.items?.[c.itemId] ?? 0}/${c.count ?? 1}）${ok}`
    case 'attr':
      return `${c.entityId}.${c.attr}(${state.entities[c.entityId]?.attrs[c.attr] ?? 0}) ${OP_SYM[c.op]} ${c.value} ${ok}`
    case 'attrRatio': {
      const e = state.entities[c.entityId]
      const cur = e?.attrs[c.attr] ?? 0
      const max = e?.attrMeta?.[c.attr]?.max
      return `${c.entityId}.${c.attr}比例(${attrRatio(state, c.entityId, c.attr).toFixed(2)}=${cur}/${max ?? '?'}) ${OP_SYM[c.op]} ${c.value} ${ok}`
    }
    case 'attrCompare': {
      const l = state.entities[c.left]?.attrs[c.attr] ?? 0
      const r = state.entities[c.right]?.attrs[c.attr] ?? 0
      return `${c.left}.${c.attr}(${l}) ${OP_SYM[c.op]} ${c.right}.${c.attr}(${r}) ${ok}`
    }
    case 'score':
      return `score(${state.score}) ${OP_SYM[c.op]} ${c.value} ${ok}`
    default:
      return String((c as { type?: string }).type ?? '?')
  }
}

/** 整条 GraphCondition 的可读解释（all[] 之间"且"，含实时值）。 */
export function describeCondition(cond: GraphCondition | undefined, t: ConditionTarget): string {
  if (!cond || cond.all.length === 0) return '无条件（恒真）'
  return cond.all.map((c) => describeClause(c, t)).join(' 且 ')
}
