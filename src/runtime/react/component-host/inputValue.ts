import { evalExpr, type EvalCtx } from '@/runtime/core/engine/expr'
import { createRng } from '@/runtime/core/engine/rng'
import type { SkinCtx } from './rendererRegistry'

export function resolveNumericValue(value: unknown, ctx: SkinCtx | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const expr = typeof value === 'string'
    ? value
    : value && typeof value === 'object'
      ? (value as { expr?: unknown }).expr
      : undefined
  if (typeof expr !== 'string' || !expr.trim()) return undefined
  try {
    const result = evalExpr(expr, evalCtxFromSkin(ctx))
    return Number.isFinite(result) ? result : undefined
  } catch {
    return undefined
  }
}

export function resolveTextValue(value: unknown, ctx: SkinCtx | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined
  if (!value || typeof value !== 'object') return undefined
  if (typeof (value as { expr?: unknown }).expr === 'string') {
    const numeric = resolveNumericValue(value, ctx)
    if (numeric !== undefined) return `-${Math.abs(Object.is(numeric, -0) ? 0 : numeric)}`
  }
  const ref = (value as { ref?: unknown }).ref
  if (typeof ref !== 'string' || !ref.trim()) return undefined
  const path = ref.split('.')
  if (path[0] === 'entity') {
    const entity = ctx?.hud.entities[path[1] ?? '']
    if (path[2] === 'name') return entity?.name ?? path[1]
    if (path[2] === 'attr' && path[3]) return String(entity?.attrs[path[3]] ?? 0)
  }
  if (path[0] === 'var') {
    const id = path.slice(1).join('.')
    return ctx?.condition?.state.textVars?.[id]
      ?? ctx?.hud.textVars?.[id]
      ?? String(ctx?.hud.vars[id] ?? 0)
  }
  if (path[0] === 'score') return String(ctx?.hud.score ?? 0)
  return ref
}

export function resolveTextDurationMs(value: unknown, fallback = 1100): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function evalCtxFromSkin(ctx: SkinCtx | undefined): EvalCtx {
  const state = ctx?.condition?.state
  if (state) {
    const rngState = state.rng?.getState()
    return {
      vars: state.vars,
      entities: state.entities,
      flags: state.flags,
      formulas: state.formulas,
      score: state.score,
      rng: rngState ? createRng(rngState.seed, rngState.step) : createRng(0),
    }
  }
  const hud = ctx?.hud
  return {
    vars: hud?.vars,
    entities: hud
      ? Object.fromEntries(Object.entries(hud.entities).map(([id, entity]) => [id, { attrs: entity.attrs }]))
      : undefined,
    flags: hud?.flags,
    score: hud?.score,
    rng: createRng(0),
  }
}

