/**
 * Manifest-driven input projection for RuntimeComponentHost.
 * Output is concrete values suitable to spread as leaf props.
 */
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import {
  resolveNumericValue,
  resolveTextDurationMs,
  resolveTextValue,
} from './inputValue'
import type { SkinCtx } from './rendererRegistry'

/**
 * Resolve authoring inputs against SkinCtx into concrete leaf props.
 * - numberExpr → number / string
 * - defaults → concrete leaf props
 */
export function resolveComponentInputs(
  manifest: ComponentManifest | undefined,
  rawInputs: Record<string, unknown>,
  ctx: SkinCtx | undefined,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...rawInputs }
  const inputDefs = manifest?.inputs ?? []

  for (const input of inputDefs) {
    if (input.component !== 'numberExpr') continue

    const raw = rawInputs[input.key] !== undefined ? rawInputs[input.key] : input.default

    if (input.valueType === 'number') {
      const value = resolveNumericValue(raw, ctx)
      if (value !== undefined) resolved[input.key] = value
      continue
    }

    if (input.valueType === 'string') {
      const value = resolveTextValue(raw, ctx)
      if (value !== undefined) resolved[input.key] = value
      else if (typeof input.default === 'string') resolved[input.key] = input.default
    }
  }

  // Fill remaining defaults (keys / colors / duration / fixedText …).
  for (const input of inputDefs) {
    if (resolved[input.key] === undefined && input.default !== undefined) {
      resolved[input.key] = input.default
    }
  }

  const durationDef = inputDefs.find((input) => input.key === 'durationMs')
  if (durationDef) {
    const fallback = typeof durationDef.default === 'number' ? durationDef.default : 1100
    resolved.durationMs = resolveTextDurationMs(resolved.durationMs, fallback)
  }

  return resolved
}
