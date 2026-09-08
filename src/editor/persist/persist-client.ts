/**
 * Graph store client — Extension package tip is the SSOT.
 *
 *   · Tip = `GET/PUT …/package` (working-tree blueprint).
 *   · User versions = explicit `versions.create` → visible `vN` tags.
 *   · Close/flush may call `versions.checkpoint` (internal commit, not listed).
 *   · Restore writes a tag back onto tip via `versions.restore`.
 */
import { getExtensionHost } from '../../lib/extension-host'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

/** Kept for existing imports; game-host versions are git tags. */
export interface VersionEntry {
  id: string
  savedAt: number
}
export interface GraphStore {
  /** Remote tip document (package.blueprint). */
  project: GraphLibraryDocument | null
  /** Tip content revision from Host (optimistic lock). */
  revision: string | null
  /** Compatibility field; always empty under game-host. */
  versions: VersionEntry[]
}

export interface CurrentVersion {
  tag: string | null
  commitHash: string | null
  dirty: boolean
}

/** User-visible game version entry (tag = vN). */
export interface GameVersion {
  tag: string
  createdAt: number
  message: string
}

function acceptedGameId(game: string): string {
  if (typeof game !== 'string' || game.length === 0) {
    throw new TypeError('Accepted game id is required')
  }
  return game
}

function packageBlueprint(value: unknown): GraphLibraryDocument | null {
  if (!value || typeof value !== 'object') return null
  const blueprint = (value as { blueprint?: unknown }).blueprint
  return blueprint && typeof blueprint === 'object' ? blueprint as GraphLibraryDocument : null
}

function packageRevision(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const revision = (value as { revision?: unknown }).revision
  return typeof revision === 'string' && revision.length > 0 ? revision : null
}

function isLibraryDocument(value: unknown): value is GraphLibraryDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = (value as { manifest?: unknown }).manifest
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  const candidate = manifest as { mainPackId?: unknown; packs?: unknown }
  return (
    typeof candidate.mainPackId === 'string'
    && candidate.mainPackId.length > 0
    && candidate.packs !== null
    && typeof candidate.packs === 'object'
    && !Array.isArray(candidate.packs)
  )
}

function currentVersionValue(value: unknown): CurrentVersion | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { tag?: unknown; commitHash?: unknown; dirty?: unknown }
  if (typeof candidate.tag !== 'string' || typeof candidate.commitHash !== 'string') return null
  return {
    tag: candidate.tag,
    commitHash: candidate.commitHash,
    dirty: candidate.dirty === true,
  }
}

function gameVersionValue(value: unknown): GameVersion | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { tag?: unknown; createdAt?: unknown; message?: unknown }
  const createdAt = typeof candidate.createdAt === 'number'
    ? candidate.createdAt
    : typeof candidate.createdAt === 'string' ? Date.parse(candidate.createdAt) / 1000 : NaN
  if (
    typeof candidate.tag !== 'string'
    || !Number.isFinite(createdAt)
    || typeof candidate.message !== 'string'
  ) return null
  return {
    tag: candidate.tag,
    createdAt,
    message: candidate.message,
  }
}

export async function loadStore(game: string): Promise<GraphStore> {
  acceptedGameId(game)
  const loaded = await getExtensionHost().gamePackage.load()
  const project = packageBlueprint(loaded)
  if (!isLibraryDocument(project)) {
    throw new TypeError('Host package blueprint is missing or invalid')
  }
  return {
    project,
    revision: packageRevision(loaded),
    versions: [],
  }
}

/**
 * Flush tip blueprint. Optional baseRevision enables Host optimistic locking.
 * Returns { ok, revision } — revision updates the local lock token on success.
 */
export async function saveProject(
  project: GraphLibraryDocument,
  game: string,
  baseRevision?: string | null,
): Promise<{ ok: boolean; revision: string | null }> {
  acceptedGameId(game)
  try {
    const saved = await getExtensionHost().gamePackage.save({
      blueprint: project,
      ...(baseRevision ? { baseRevision } : {}),
    })
    return { ok: true, revision: packageRevision(saved) }
  } catch {
    /* offline / host unavailable — best-effort */
  }
  return { ok: false, revision: null }
}

/** Create a user-visible version tag (vN). */
export async function commitVersion(game: string, message?: string): Promise<CurrentVersion | null> {
  acceptedGameId(game)
  const versions = getExtensionHost().versions
  if (!versions.supported()) return null
  try {
    const created = currentVersionValue(await versions.create(message ?? ''))
    return created ? { ...created, dirty: false } : null
  } catch {
    return null
  }
}

/** Internal tip checkpoint — not listed in user versions. */
export async function checkpointTip(
  game: string,
  message = '[extension] checkpoint',
): Promise<{ ok: boolean; commitHash: string | null }> {
  acceptedGameId(game)
  const versions = getExtensionHost().versions
  if (!versions.supported() || typeof versions.checkpoint !== 'function') {
    return { ok: false, commitHash: null }
  }
  try {
    const value = await versions.checkpoint(message)
    const commitHash =
      value && typeof value === 'object' && typeof (value as { commitHash?: unknown }).commitHash === 'string'
        ? (value as { commitHash: string }).commitHash
        : null
    return { ok: true, commitHash }
  } catch {
    return { ok: false, commitHash: null }
  }
}

/** Restore a user version onto tip, then return the tip blueprint. */
export async function restoreVersionToTip(
  game: string,
  tag: string,
): Promise<GraphLibraryDocument | null> {
  acceptedGameId(game)
  const versions = getExtensionHost().versions
  if (!versions.supported() || typeof versions.restore !== 'function') return null
  try {
    const restored = await versions.restore(tag)
    const fromRestore = packageBlueprint(restored)
    if (isLibraryDocument(fromRestore)) return fromRestore
    // Host restore may return package without requiring a second load.
    return packageBlueprint(await getExtensionHost().gamePackage.load())
  } catch {
    return null
  }
}

/** Read current HEAD version status (tag + hash + dirty). */
export async function currentVersion(game: string): Promise<CurrentVersion> {
  acceptedGameId(game)
  const versions = getExtensionHost().versions
  if (!versions.supported()) return { tag: null, commitHash: null, dirty: false }
  try {
    return currentVersionValue(await versions.current()) ?? { tag: null, commitHash: null, dirty: false }
  } catch {
    return { tag: null, commitHash: null, dirty: false }
  }
}

/** List user-visible versions (vN, newest first). */
export async function listVersions(game: string): Promise<GameVersion[]> {
  acceptedGameId(game)
  const versions = getExtensionHost().versions
  if (!versions.supported()) return []
  try {
    const value = await versions.list()
    return Array.isArray(value)
      ? value.map(gameVersionValue).filter((entry): entry is GameVersion => entry !== null)
      : []
  } catch {
    return []
  }
}

/**
 * Preview-only: read a historical tag package without mutating tip.
 * Prefer {@link restoreVersionToTip} for editor SSOT restore.
 */
export async function loadVersionProject(game: string, tag: string): Promise<GraphLibraryDocument | null> {
  acceptedGameId(game)
  const versions = getExtensionHost().versions
  if (!versions.supported()) return null
  try {
    return packageBlueprint(await versions.loadPackage(tag))
  } catch {
    return null
  }
}

/** @deprecated localStorage drafts are no longer the SSOT; kept as no-ops for call sites mid-migration. */
export function saveDraft(_project: GraphLibraryDocument, _game: string): void {}
export function clearDraft(_game: string): void {}
export function loadDraft(_game: string): GraphLibraryDocument | null {
  return null
}
