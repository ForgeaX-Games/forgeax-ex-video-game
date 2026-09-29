/**
 * Package status shared by every surface that must not touch an uninitialized
 * package.
 *
 * A video-game workflow may legitimately have only part of the portable package
 * while it is being authored. The gate only blocks package boot until a
 * blueprint exists; workflow-state and document surfaces remain usable earlier.
 */
export type PackageState = 'uninitialized' | 'partial' | 'initialized' | 'inconsistent'
export type PackageStatus = { state: PackageState; missing?: string[] }

export function statusOf(value: unknown): PackageStatus | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { state?: unknown; missing?: unknown }
  if (
    candidate.state !== 'uninitialized'
    && candidate.state !== 'partial'
    && candidate.state !== 'initialized'
    && candidate.state !== 'inconsistent'
  ) return null
  return {
    state: candidate.state,
    missing: Array.isArray(candidate.missing)
      ? candidate.missing.filter((item): item is string => typeof item === 'string')
      : undefined,
  }
}
