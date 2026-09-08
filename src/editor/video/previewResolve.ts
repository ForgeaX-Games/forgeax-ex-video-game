/**
 * 视频编辑器预览叠层 —— 按当前场景初始态求值，展示与试玩一致的真实文案/效果摘要。
 *
 * 全部为纯函数：入参 GraphEffect / 选项预览项 / QteCue + 一个求值上下文（由 initState 建）。
 * 表达式失败绝不抛错（编辑器随时半成品），回退「无法求值 / ?」。运行时消费见 FloatText 绘制时 resolve。
 */
import type { Entity, GraphCondition, GraphEffect, NumOrExpr, Variable } from '@/runtime/core/schema/graph-schema'
import type { FloatTextParams, QteCue } from './overlayMaterialTypes'
import { tryEvalExpr, type EvalCtx } from '@/runtime/core/engine/expr'
import type { MutableState } from '@/runtime/core/engine/apply-effects'
import { evaluateCondition } from '@/runtime/core/engine/condition'
import { findEntity } from '@/authoring/formulas/meta-catalog'

/** 选项预览项（label + 关联的 event reaction 效果 + 逐项门控条件）。 */
export interface ChoicePreviewOption {
  label: string
  effects?: GraphEffect[]
  condition?: GraphCondition
}

export interface PreviewEvalContext {
  evalCtx: EvalCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
}

function ctxFromState(state: MutableState): EvalCtx {
  return {
    vars: state.vars,
    entities: state.entities,
    flags: state.flags,
    score: state.score,
    rng: state.rng,
  }
}

function signed(v: number): string {
  return v > 0 ? `+${v}` : String(v)
}

function resolveEffectValueSafe(
  value: unknown,
  state: MutableState,
): { val: number | null; expr?: string } {
  if (typeof value === 'number') return { val: value }
  if (value && typeof value === 'object' && typeof (value as { expr?: string }).expr === 'string') {
    const expr = (value as { expr: string }).expr
    return { val: tryEvalExpr(expr, ctxFromState(state)), expr }
  }
  return { val: 0 }
}

function effectNumericValueSafe(eff: GraphEffect, state: MutableState): { val: number | null; expr?: string } {
  if (eff.kind === 'attr' || eff.kind === 'var') {
    return resolveEffectValueSafe(eff.value, state)
  }
  return { val: 0 }
}

function formatDelta(op: 'add' | 'mul' | 'set', val: number | null, expr?: string): string {
  if (val === null) return expr ? `（无法求值: ${expr}）` : '（无法求值）'
  if (op === 'set') return `=${val}`
  if (op === 'mul') return `×${val}`
  return signed(val)
}

function entityLabel(entities: Record<string, Entity> | undefined, id: string): string {
  const ent = findEntity(entities, id)
  const name = (ent?.name ?? '').trim()
  if (name) return name
  if (ent?.kind === 'player') return '玩家'
  if (ent?.kind === 'boss') return 'Boss'
  return id
}

function attrLabel(ent: Entity | undefined, attr: string): string {
  return ent?.attrMeta?.[attr]?.label?.trim() || attr
}

function varLabel(variables: Record<string, Variable> | undefined, id: string): string {
  const v = variables?.[id]
  return (v?.name ?? '').trim() || id
}

/** 单条 effect 求值后的可读摘要（如「Boss.hp −100」）。 */
export function summarizeEffect(
  eff: GraphEffect,
  state: MutableState,
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
): string {
  switch (eff.kind) {
    case 'attr': {
      const ent = findEntity(entities, eff.entityId)
      const { val, expr } = effectNumericValueSafe(eff, state)
      return `${entityLabel(entities, eff.entityId)}.${attrLabel(ent, eff.attr)} ${formatDelta(eff.op, val, expr)}`
    }
    case 'var': {
      const { val, expr } = effectNumericValueSafe(eff, state)
      return `${varLabel(variables, eff.varId)} ${formatDelta(eff.op, val, expr)}`
    }
    case 'flag':
      return `${varLabel(variables, eff.varId)} ${eff.value ? '开' : '关'}`
    case 'item':
      return `道具 ${eff.itemId} ${eff.op === 'give' ? '+' : '−'}${eff.count}`
    default:
      return ''
  }
}

export function summarizeEffects(
  effects: GraphEffect[] | undefined,
  state: MutableState,
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
): string {
  if (!effects?.length) return ''
  return effects
    .map((e) => summarizeEffect(e, state, entities, variables))
    .filter(Boolean)
    .join('；')
}

/** `NumOrExpr` → `tryEvalExpr` 认的源码（常量数字转字面量）；空值给 `''`。 */
function exprSrc(v: NumOrExpr | string | undefined): string {
  return v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v.expr
}

/** 飘字预览主文案：有 expr 时按初始态求值替换 `{v}`（signed）；失败回退 `?`。 */
export function resolveFloatTextPreviewLabel(
  inputs: FloatTextParams,
  ctx: PreviewEvalContext,
): string {
  const text = (inputs.text ?? '').trim()
  const expr = exprSrc(inputs.expr).trim()
  if (!text && !expr) return ''
  if (!expr) return text
  const v = tryEvalExpr(expr, ctx.evalCtx)
  if (v === null) {
    if (text.includes('{v}')) return text.replace('{v}', '?')
    return text || '?'
  }
  const num = signed(v)
  return text ? text.replace('{v}', num) : num
}

function optionLocked(opt: ChoicePreviewOption, state: MutableState): boolean {
  if (!opt.condition) return false
  return !evaluateCondition(opt.condition, { state, visited: new Set() })
}

/** 选项预览：每条选项文案 + 求值后的效果摘要；锁定项标注。 */
export function resolveChoicePreviewDetail(
  options: ChoicePreviewOption[],
  ctx: PreviewEvalContext,
  state: MutableState,
): string {
  if (!options.length) return ''
  return options
    .map((o) => {
      const label = o.label.trim()
      const fx = summarizeEffects(o.effects, state, ctx.entities, ctx.variables)
      const locked = optionLocked(o, state) ? '（锁定）' : ''
      return fx ? `• ${label}${locked}：${fx}` : `• ${label}${locked}`
    })
    .join('\n')
}

export interface QteOutcomePreview {
  handle: string
  /** 展示文案（来自 manifest.events.label）；缺省回退 handle。 */
  label?: string
  effects: GraphEffect[]
  fallsBackToPass?: boolean
}

/** QTE 结算预览：各档求值后的改数值摘要。 */
export function resolveQteOutcomesPreviewDetail(
  outcomes: QteOutcomePreview[],
  state: MutableState,
  ctx: PreviewEvalContext,
): string {
  return outcomes
    .map((o) => {
      const fx = summarizeEffects(o.effects, state, ctx.entities, ctx.variables)
      if (!fx) return ''
      const name = o.label || o.handle
      const hint = o.fallsBackToPass ? '（含未单独配置的相邻档）' : ''
      return `${name}${hint}：${fx}`
    })
    .filter(Boolean)
    .join('\n')
}

/** 单个 QTE cue 预览主文案。 */
export function resolveQteCuePreviewLabel(cue: QteCue): string {
  return (cue.label ?? '').trim() || (cue.shape ?? 'tap').toUpperCase()
}
