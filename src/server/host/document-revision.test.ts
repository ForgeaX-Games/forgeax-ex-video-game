import { describe, expect, it } from 'vitest'
import {
  ASSET_MANIFEST_REVISION_INITIAL,
  DOCUMENT_REVISION_INITIAL,
  IDEMPOTENCY_CONFLICT_CODE,
  REVISION_CONFLICT_CODE,
  appendMutationReceipt,
  assetManifestScopedRevisionConflict,
  mutationFingerprint,
  nextAssetManifestRevision,
  nextDocumentRevision,
  readAssetManifestRevision,
  readAssetManifestScopeRevisions,
  readDocumentRevision,
  readMutationReceipts,
  resolveMutationReceipt,
  revisionConflict,
  stampAssetManifestRevision,
  stampDocumentRevision,
} from './document-revision'

const encoder = new TextEncoder()

function bytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

describe('readDocumentRevision', () => {
  it('treats a legacy document without a revision as the initial revision', () => {
    expect(readDocumentRevision(bytes({ version: 'game-video.graph.v1' })))
      .toBe(DOCUMENT_REVISION_INITIAL)
  })

  it('reads a stamped revision', () => {
    expect(readDocumentRevision(bytes({ revision: 7 }))).toBe(7)
  })

  it('treats a missing file as the initial revision', () => {
    expect(readDocumentRevision(null)).toBe(DOCUMENT_REVISION_INITIAL)
  })

  it('falls back to the initial revision for unparseable or hostile values', () => {
    expect(readDocumentRevision(encoder.encode('not json'))).toBe(DOCUMENT_REVISION_INITIAL)
    expect(readDocumentRevision(bytes({ revision: -1 }))).toBe(DOCUMENT_REVISION_INITIAL)
    expect(readDocumentRevision(bytes({ revision: 1.5 }))).toBe(DOCUMENT_REVISION_INITIAL)
    expect(readDocumentRevision(bytes({ revision: '3' }))).toBe(DOCUMENT_REVISION_INITIAL)
    expect(readDocumentRevision(bytes({ revision: Number.MAX_SAFE_INTEGER + 2 })))
      .toBe(DOCUMENT_REVISION_INITIAL)
    expect(readDocumentRevision(bytes(['not', 'an', 'object']))).toBe(DOCUMENT_REVISION_INITIAL)
    expect(readDocumentRevision(bytes(null))).toBe(DOCUMENT_REVISION_INITIAL)
  })
})

describe('nextDocumentRevision', () => {
  it('advances monotonically', () => {
    expect(nextDocumentRevision(DOCUMENT_REVISION_INITIAL)).toBe(1)
    expect(nextDocumentRevision(41)).toBe(42)
  })
})

describe('asset manifest revision', () => {
  it('treats a missing revision as zero and advances independently from graph revisions', () => {
    expect(readAssetManifestRevision(bytes({ version: 2, assets: [] })))
      .toBe(ASSET_MANIFEST_REVISION_INITIAL)
    expect(nextAssetManifestRevision(ASSET_MANIFEST_REVISION_INITIAL)).toBe(1)
  })

  it('stamps asset scopes and permits a stale caller only when its own scope is unchanged', () => {
    const first = stampAssetManifestRevision(
      { version: 2, assets: [] },
      1,
      [],
      { previous: {}, touched: ['characters'] },
    )
    const persisted = bytes(first)

    expect(readAssetManifestRevision(persisted)).toBe(1)
    expect(readAssetManifestScopeRevisions(persisted)).toEqual({ characters: 1 })
    expect(assetManifestScopedRevisionConflict(
      0,
      1,
      readAssetManifestScopeRevisions(persisted),
      ['scenes'],
    )).toBeNull()
    expect(assetManifestScopedRevisionConflict(
      0,
      1,
      readAssetManifestScopeRevisions(persisted),
      ['characters'],
    )).toMatchObject({
      code: REVISION_CONFLICT_CODE,
      currentRevision: 1,
      scope: 'asset-manifest',
    })
  })
})

describe('stampDocumentRevision', () => {
  it('stamps without mutating the source document', () => {
    const doc = { version: 'game-video.graph.v1' }
    const stamped = stampDocumentRevision(doc, 3)

    expect(stamped.revision).toBe(3)
    expect(doc).not.toHaveProperty('revision')
  })

  it('overwrites a stale client-supplied revision', () => {
    // A UI `save-graph` round-trips the document it read, so its `revision` is
    // whatever it last saw. Only the server may decide the next value.
    expect(stampDocumentRevision({ revision: 99 }, 4).revision).toBe(4)
  })
})

describe('revisionConflict', () => {
  it('skips the check when the caller does not claim a revision', () => {
    expect(revisionConflict(undefined, 5)).toBeNull()
  })

  it('accepts a caller writing against the current revision', () => {
    expect(revisionConflict(5, 5)).toBeNull()
  })

  it('rejects a caller writing against a stale revision', () => {
    const conflict = revisionConflict(4, 5)

    expect(conflict?.code).toBe(REVISION_CONFLICT_CODE)
    expect(conflict?.currentRevision).toBe(5)
    expect(conflict?.message).toContain('4')
    expect(conflict?.message).toContain('5')
  })

  it('rejects a caller claiming a revision ahead of the document', () => {
    // Guards against a client that stamped its own optimistic revision.
    expect(revisionConflict(9, 5)?.code).toBe(REVISION_CONFLICT_CODE)
  })
})

describe('mutation receipts', () => {
  const receipt = {
    key: 'rules.catalog:4:wukong',
    operation: 'patch-rules',
    fingerprint: mutationFingerprint({ ops: [{ op: 'upsert-variable', id: 'a' }] }),
    revision: 3,
    payload: { results: [{ id: 'a' }] },
  }

  it('fingerprints object keys deterministically', () => {
    expect(mutationFingerprint({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(mutationFingerprint({ a: { c: 3, d: 4 }, b: 2 }))
  })

  it('persists and reads a bounded receipt alongside the revision', () => {
    const stamped = stampDocumentRevision({ version: 'v1' }, 3, [receipt])
    expect(readMutationReceipts(bytes(stamped))).toEqual([receipt])
  })

  it('replays the same mutation and rejects key reuse for a different mutation', () => {
    expect(resolveMutationReceipt([receipt], {
      key: receipt.key,
      operation: receipt.operation,
      fingerprint: receipt.fingerprint,
      currentRevision: 4,
    })).toEqual(receipt)
    expect(resolveMutationReceipt([receipt], {
      key: receipt.key,
      operation: receipt.operation,
      fingerprint: mutationFingerprint({ ops: [] }),
      currentRevision: 4,
    })).toMatchObject({ code: IDEMPOTENCY_CONFLICT_CODE, currentRevision: 4 })
  })

  it('replaces an older receipt with the same key', () => {
    expect(appendMutationReceipt([receipt], { ...receipt, revision: 4 })[0]!.revision).toBe(4)
  })
})
