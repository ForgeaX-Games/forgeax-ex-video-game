/**
 * effect 应用器（图原生、通用）—— 把声明式 GraphEffect 作用到可变运行态。
 *
 * 通用化（方向 C）：**没有 hp 特权**。实体只是一袋 attrs（+可选 attrMeta 约束）；`attr` effect 写任意
 * attr，按 attrMeta 的 min/max clamp。value 可为常量或表达式 `{expr}`（公式，就地声明，去 combatRules 散耦合）。
 */
import type {
  AttrMeta,
  BooleanValue,
  GraphEffect,
  NumOrExpr,
  NumericEffectOp,
  TextValue,
} from '../schema/graph-schema'
import { evalExpr, type EvalCtx } from './expr'
import type { Rng } from './rng'

export interface MutableEntity {
  attrs: Record<string, number>
  attrMeta?: Record<string, AttrMeta>
}

export interface MutableState {
  vars: Record<string, number>
  textVars?: Record<string, string>
  varMeta?: Record<string, { min?: number; max?: number }>
  entities: Record<string, MutableEntity>
  flags: Record<string, number>
  formulas?: Record<string, unknown>
  score: number
  items?: Record<string, number>
  rng?: Rng
  /** 已应用过的 once effect id 集合。 */
  appliedOnce?: Set<string>
}

function ctxFrom(state: MutableState, eventPayload?: Record<string, unknown>): EvalCtx {
  return {
    vars: state.vars,
    entities: state.entities,
    flags: state.flags,
    formulas: state.formulas,
    score: state.score,
    rng: state.rng,
    eventPayload,
  }
}

/**
 * 求值失败（缺公式 / 缺变量 / 解析失败）返回 undefined：调用方跳过这条 effect，
 * 不要把 ExprError 冒到 React 外打崩整页。合法结果 0 仍是 number。
 */
function resolveValue(value: NumOrExpr, state: MutableState, eventPayload?: Record<string, unknown>): number | undefined {
  if (typeof value === 'number') return value
  if (value && typeof value === 'object' && typeof value.expr === 'string') {
    try {
      return evalExpr(value.expr, ctxFrom(state, eventPayload))
    } catch {
      return undefined
    }
  }
  throw new Error(`bad effect value: ${JSON.stringify(value)}`)
}

function resolveTextValue(value: TextValue, state: MutableState, eventPayload?: Record<string, unknown>): string {
  if (typeof value === 'string') return value
  const path = value.ref.split('.')
  if (path[0] === 'var') return state.textVars?.[path.slice(1).join('.')] ?? ''
  if (path[0] === 'eventPayload') return String(eventPayload?.[path.slice(1).join('.')] ?? '')
  return value.ref
}

function resolveBooleanValue(value: BooleanValue, eventPayload?: Record<string, unknown>): boolean | undefined {
  if (typeof value === 'boolean') return value
  const path = value.ref.split('.')
  if (path[0] !== 'eventPayload') return undefined
  const resolved = eventPayload?.[path.slice(1).join('.')]
  return typeof resolved === 'boolean' ? resolved : undefined
}

function clamp(v: number, meta?: { min?: number; max?: number }): number {
  let out = v
  if (meta?.min !== undefined) out = Math.max(meta.min, out)
  if (meta?.max !== undefined) out = Math.min(meta.max, out)
  return out
}

/** 数值 op：add=加、mul=乘、set=设为。 */
export function applyNumericOp(op: NumericEffectOp, cur: number, val: number): number {
  switch (op) {
    case 'set':
      return val
    case 'mul':
      return cur * val
    case 'add':
    default:
      return cur + val
  }
}

/**
 * 一次 effect 写入的观测结果。写成 type 而非 interface：需要隐式索引签名才能直接当
 * `locals: Record<string, number>` 传给表达式求值。
 */
export type EffectWrite = { prev: number; next: number; delta: number }

/**
 * 读某 effect 写入目标的当前数值；`flag` / `item` 没有可比对的数值目标，返回 null。
 * 施加前后各调一次即得观测变化量——必须读观测值，因为 clamp 与 `once` 会让实际变化
 * 不等于作者写的 `value`。
 */
export function effectTargetValue(state: MutableState, eff: GraphEffect): number | null {
  if (eff.kind === 'var' && eff.valueType !== 'text') return state.vars[eff.varId] ?? 0
  if (eff.kind === 'attr') {
    const ent = state.entities[eff.entityId]
    return ent ? ent.attrs[eff.attr] ?? 0 : null
  }
  return null
}

/** 把一组 effect 顺序作用到 state（原地修改）。`eventPayload` 为组件事件出参，仅事件反应执行期传入。 */
export function applyEffects(state: MutableState, effects: readonly GraphEffect[], eventPayload?: Record<string, unknown>): void {
  for (const eff of effects) {
    // once：仅首次生效（跨回合循环用）。
    if ('once' in eff && eff.once && eff.id) {
      state.appliedOnce ??= new Set()
      if (state.appliedOnce.has(eff.id)) continue
      state.appliedOnce.add(eff.id)
    }
    switch (eff.kind) {
      case 'var': {
        if (eff.valueType === 'text') {
          const textVars = (state.textVars ??= {})
          textVars[eff.varId] = resolveTextValue(eff.value, state, eventPayload)
          break
        }
        const cur = state.vars[eff.varId] ?? 0
        const val = resolveValue(eff.value, state, eventPayload)
        if (val === undefined) break
        state.vars[eff.varId] = clamp(applyNumericOp(eff.op, cur, val), state.varMeta?.[eff.varId])
        break
      }
      case 'attr': {
        const ent = state.entities[eff.entityId]
        if (!ent) break
        const cur = ent.attrs[eff.attr] ?? 0
        const val = resolveValue(eff.value, state, eventPayload)
        if (val === undefined) break
        ent.attrs[eff.attr] = clamp(applyNumericOp(eff.op, cur, val), ent.attrMeta?.[eff.attr])
        break
      }
      case 'flag': {
        const value = resolveBooleanValue(eff.value, eventPayload)
        if (value === undefined) break
        state.flags[eff.varId] = value ? 1 : 0
        break
      }
      case 'item': {
        state.items ??= {}
        const cur = state.items[eff.itemId] ?? 0
        const val = resolveValue(eff.count, state, eventPayload)
        if (val === undefined) break
        state.items[eff.itemId] = eff.op === 'give' ? cur + val : Math.max(0, cur - val)
        break
      }
    }
  }
}
