/**
 * Server-authoritative revision for `blueprint.json`.
 *
 * The revision lives only at the persistence boundary, never inside the
 * editor's pure document functions: `parseGraph` and `applyPatchGraphOps` both
 * run `normalizeDocument`, which rebuilds the document from `manifest.packs`
 * via `documentFromBlueprints` and therefore drops any top-level field. So a
 * write reads the revision from the raw bytes, compares it against the
 * caller's `expectedRevision`, and stamps the next value immediately before
 * writing.
 *
 * Clients MUST NOT be trusted to supply the next value — a UI `save-graph`
 * round-trips whatever document it last read.
 */
import { createHash } from 'node:crypto'


/** Revision of a document that has never been stamped (including legacy files). */
export const DOCUMENT_REVISION_INITIAL = 0
/** Revision of a legacy/missing `assets/manifest.json` stamp. */
export const ASSET_MANIFEST_REVISION_INITIAL = DOCUMENT_REVISION_INITIAL

/** Stable error code so callers can branch on conflict without string matching. */
export const REVISION_CONFLICT_CODE = 'revision.conflict'
export const IDEMPOTENCY_CONFLICT_CODE = 'idempotency.conflict'
export const MUTATION_RECEIPTS_FIELD = '_extensionMutationReceipts'
const MAX_MUTATION_RECEIPTS = 64

export interface RevisionConflict {
  code: typeof REVISION_CONFLICT_CODE
  message: string
  currentRevision: number
}

export interface AssetManifestRevisionConflict extends RevisionConflict {
  scope: 'asset-manifest'
}

export interface MutationReceipt {
  key: string
  operation: string
  fingerprint: string
  revision: number
  payload: Record<string, unknown>
}

export interface IdempotencyConflict {
  code: typeof IDEMPOTENCY_CONFLICT_CODE
  message: string
  currentRevision: number
}

const decoder = new TextDecoder()

/**
 * Read the stamped revision straight from the persisted bytes.
 *
 * Anything unparseable, non-integer, negative, or beyond the safe-integer range
 * degrades to {@link DOCUMENT_REVISION_INITIAL} rather than throwing: a
 * corrupted counter must not make an otherwise readable blueprint unwritable.
 */
export function readDocumentRevision(bytes: Uint8Array | null): number {
  if (!bytes) return DOCUMENT_REVISION_INITIAL
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(bytes))
  } catch {
    return DOCUMENT_REVISION_INITIAL
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return DOCUMENT_REVISION_INITIAL
  }
  const revision = (parsed as { revision?: unknown }).revision
  if (
    typeof revision !== 'number'
    || !Number.isSafeInteger(revision)
    || revision < DOCUMENT_REVISION_INITIAL
  ) {
    return DOCUMENT_REVISION_INITIAL
  }
  return revision
}

export function nextDocumentRevision(current: number): number {
  return current + 1
}

export function readAssetManifestRevision(bytes: Uint8Array | null): number {
  return readDocumentRevision(bytes)
}

export function nextAssetManifestRevision(current: number): number {
  return nextDocumentRevision(current)
}

/**
 * 每个写域最后一次被改动时的文档修订号。
 *
 * 为什么需要它：并发组里三条线同时写 `blueprint.json`，文件锁保证不会损坏，
 * 但整文件修订号会让后到者一律撞冲突——即使它改的是完全不相干的子树。
 * 记录「谁在哪个修订号动过哪个域」之后，冲突判定收窄成「**我的域**被别人动过」。
 *
 * 存的是修订号而不是自增计数：这样调用方仍然只需带整文件 `expectedRevision`，
 * 不必多传参数，也就不会多一个填错的机会。
 */
export const SCOPE_REVISIONS_FIELD = 'scopeRevisions'

export type ScopeRevisions = Record<string, number>

export function readScopeRevisions(bytes: Uint8Array | null): ScopeRevisions {
  if (!bytes) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(bytes))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const value = (parsed as Record<string, unknown>)[SCOPE_REVISIONS_FIELD]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([scope, revision]) => (
      typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0
        ? [[scope, revision] as const]
        : []
    )),
  )
}

export function readAssetManifestScopeRevisions(bytes: Uint8Array | null): ScopeRevisions {
  return readScopeRevisions(bytes)
}

export function stampDocumentRevision<T extends object>(
  doc: T,
  revision: number,
  receipts: readonly MutationReceipt[] = [],
  scopes?: { previous: ScopeRevisions, touched: readonly string[] },
): T & {
  revision: number
  [MUTATION_RECEIPTS_FIELD]?: MutationReceipt[]
  [SCOPE_REVISIONS_FIELD]?: ScopeRevisions
} {
  const scopeRevisions = scopes
    ? { ...scopes.previous, ...Object.fromEntries(scopes.touched.map((scope) => [scope, revision])) }
    : undefined
  return {
    ...doc,
    revision,
    ...(receipts.length > 0
      ? { [MUTATION_RECEIPTS_FIELD]: receipts.slice(-MAX_MUTATION_RECEIPTS) }
      : {}),
    ...(scopeRevisions && Object.keys(scopeRevisions).length > 0
      ? { [SCOPE_REVISIONS_FIELD]: scopeRevisions }
      : {}),
  }
}

export function stampAssetManifestRevision<T extends object>(
  manifest: T,
  revision: number,
  receipts: readonly MutationReceipt[] = [],
  scopes?: { previous: ScopeRevisions, touched: readonly string[] },
): T & {
  revision: number
  [MUTATION_RECEIPTS_FIELD]?: MutationReceipt[]
  [SCOPE_REVISIONS_FIELD]?: ScopeRevisions
} {
  return stampDocumentRevision(manifest, revision, receipts, scopes)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  )
}

/** Stable request identity without coupling the persisted receipt to object key order. */
export function mutationFingerprint(value: unknown): string {
  const canonical = JSON.stringify(stableValue(value)) ?? 'null'
  return createHash('sha256').update(canonical).digest('hex')
}

export function readMutationReceipts(bytes: Uint8Array | null): MutationReceipt[] {
  if (!bytes) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(bytes))
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
  const value = (parsed as Record<string, unknown>)[MUTATION_RECEIPTS_FIELD]
  if (!Array.isArray(value)) return []
  return value.filter((candidate): candidate is MutationReceipt => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false
    const receipt = candidate as Partial<MutationReceipt>
    return typeof receipt.key === 'string'
      && typeof receipt.operation === 'string'
      && typeof receipt.fingerprint === 'string'
      && typeof receipt.revision === 'number'
      && Number.isSafeInteger(receipt.revision)
      && receipt.revision >= 0
      && typeof receipt.payload === 'object'
      && receipt.payload !== null
      && !Array.isArray(receipt.payload)
  }).slice(-MAX_MUTATION_RECEIPTS)
}

export function appendMutationReceipt(
  receipts: readonly MutationReceipt[],
  receipt: MutationReceipt | undefined,
): MutationReceipt[] {
  if (!receipt) return [...receipts].slice(-MAX_MUTATION_RECEIPTS)
  return [...receipts.filter((item) => item.key !== receipt.key), receipt]
    .slice(-MAX_MUTATION_RECEIPTS)
}

export function resolveMutationReceipt(
  receipts: readonly MutationReceipt[],
  input: { key?: string; operation: string; fingerprint: string; currentRevision: number },
): MutationReceipt | IdempotencyConflict | null {
  if (!input.key) return null
  const receipt = [...receipts].reverse().find((item) => item.key === input.key)
  if (!receipt) return null
  if (receipt.operation === input.operation && receipt.fingerprint === input.fingerprint) {
    return receipt
  }
  return {
    code: IDEMPOTENCY_CONFLICT_CODE,
    message: `idempotencyKey '${input.key}' 已用于另一项写入；请为不同 mutation 使用新 key。`,
    currentRevision: input.currentRevision,
  }
}

/**
 * Compare a caller's claimed revision against the persisted one.
 *
 * `undefined` opts out of the check, which keeps every existing caller working
 * while `expectedRevision` is adopted incrementally. A claim ahead of the
 * document is also a conflict — it means the client invented a revision.
 */
export function revisionConflict(
  expectedRevision: number | undefined,
  currentRevision: number,
): RevisionConflict | null {
  if (expectedRevision === undefined) return null
  if (expectedRevision === currentRevision) return null
  return {
    code: REVISION_CONFLICT_CODE,
    message:
      `蓝图已被其它写入更新：expectedRevision ${expectedRevision}，当前 revision ${currentRevision}。`
      + '请重新 get-graph 读取最新内容后基于它重试，不要覆盖。',
    currentRevision,
  }
}

/**
 * 写域级冲突判定：只有当**调用方要写的域**在它读取之后被别人改过，才算冲突。
 *
 * 这是并发组能真正并行的前提。三条线各写自己的域时，文档修订号会前进，
 * 但彼此的域修订号不动，所以都能通过；只有两条线抢同一个域才会撞。
 *
 * 缺 `scopeRevisions` 的历史文件退回整文件比较：宁可多报一次冲突（可安全重试），
 * 也不要放过一次真实的覆盖。
 */
export function scopedRevisionConflict(
  expectedRevision: number | undefined,
  currentRevision: number,
  scopeRevisions: ScopeRevisions,
  writeScope: readonly string[] | undefined,
): RevisionConflict | null {
  if (expectedRevision === undefined) return null
  if (expectedRevision === currentRevision) return null
  if (!writeScope || writeScope.length === 0) {
    return revisionConflict(expectedRevision, currentRevision)
  }
  const conflicting = writeScope.filter((scope) => (scopeRevisions[scope] ?? 0) > expectedRevision)
  if (conflicting.length === 0) return null
  return {
    code: REVISION_CONFLICT_CODE,
    message:
      `写域 ${conflicting.join('、')} 已被其它写入更新：expectedRevision ${expectedRevision}，`
      + `当前 revision ${currentRevision}。请重新读取最新内容后基于它重试，不要覆盖。`,
    currentRevision,
  }
}

export function assetManifestScopedRevisionConflict(
  expectedRevision: number | undefined,
  currentRevision: number,
  scopeRevisions: ScopeRevisions,
  writeScope: readonly string[] | undefined,
): AssetManifestRevisionConflict | null {
  const conflict = scopedRevisionConflict(
    expectedRevision,
    currentRevision,
    scopeRevisions,
    writeScope,
  )
  if (!conflict) return null
  return {
    ...conflict,
    scope: 'asset-manifest',
    message: conflict.message.replace('写域', '资产清单写域'),
  }
}
