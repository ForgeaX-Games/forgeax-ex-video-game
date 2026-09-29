/**
 * Graph store client — Extension package tip is the SSOT.
 *
 *   · Tip = `GET/PUT …/package` (working-tree blueprint).
 *   · Close/flush may call `versions.checkpoint` (internal commit, not listed).
 */
import { getExtensionHost } from '../../lib/extension-host'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

export interface GraphStore {
  /** Remote tip document (package.blueprint). */
  project: GraphLibraryDocument | null
  /** Tip content revision from Host (optimistic lock). */
  revision: string | null
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
