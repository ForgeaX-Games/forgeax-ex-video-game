/**
 * Package status shared by every surface that must not touch an uninitialized
 * package.
 *
 * The host answers `load`/`save` with `package_uninitialized` until the package
 * is seeded, so any surface that reads or writes the tip has to pass this gate
 * first — otherwise it only produces rejected promises the caller cannot use.
 */
export type PackageState = 'uninitialized' | 'initialized' | 'inconsistent'
export type PackageStatus = { state: PackageState; missing?: string[] }

export function statusOf(value: unknown): PackageStatus | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { state?: unknown; missing?: unknown }
  if (
    candidate.state !== 'uninitialized'
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
