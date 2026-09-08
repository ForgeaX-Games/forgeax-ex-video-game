import type { ExtensionContext } from '@forgeax/extension-host/node'
import { normalizeDocument, validateDocument } from '@/authoring/blueprint/blueprint-project'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import type { AssetManifest, CharacterDefinition, MediaAsset } from '@/authoring/assets/registry-types'
import {
  HOST_MANIFEST_LOCK,
  readHostManifestSnapshot,
  writeHostManifestRevision,
} from '../asset-registry'
import { assetEntityDefinitions, normalizeAssetCatalogState } from './asset-entity-catalog'
import {
  generateCharacterPreviews,
  requiredCharacterPreviewTargets,
  type CharacterPreviewGenerationResult,
  type CharacterPreviewTarget,
} from '../generation/character-previews'
import {
  appendMutationReceipt,
  assetManifestScopedRevisionConflict,
  mutationFingerprint,
  nextAssetManifestRevision,
  resolveMutationReceipt,
  type IdempotencyConflict,
  type MutationReceipt,
  type RevisionConflict,
} from './document-revision'

const BLUEPRINT_FILE = 'blueprint.json'
const GRAPH_SAVE_LOCK = 'game-video-graph-save'
const CHARACTER_PREVIEW_GENERATION_LOCK = 'game-video-character-preview-generation'
export const MAX_AUTOMATIC_CHARACTER_PREVIEWS = 50
const decoder = new TextDecoder()

export interface GenerateCharacterPreviewsRequest {
  expectedRevision: number
  activityRevision: number
  idempotencyKey: string
  characterIds?: string[]
  mode: 'turnaround' | 'portrait'
  skipReady: boolean
}

export interface CharacterPreviewBatchPayload {
  ok: boolean
  revision: number
  replayed: boolean
  results: CharacterPreviewGenerationResult[]
  totals: { required: number; generated: number; skipped: number; failed: number }
  errors?: string[]
}

export type CharacterPreviewBatchOutcome =
  | CharacterPreviewBatchPayload
  | { ok: false; conflict: RevisionConflict | IdempotencyConflict }
  | CharacterPreviewBatchPayload & { ok: false; errorCode: string }

function parseProject(bytes: Uint8Array | null): GraphLibraryDocument | null {
  if (!bytes) return null
  try {
    return normalizeDocument(JSON.parse(decoder.decode(bytes)) as GraphLibraryDocument)
  } catch {
    return null
  }
}

function readyCharacterAssets(manifest: AssetManifest): Map<string, MediaAsset> {
  try {
    return new Map(manifest.assets.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const asset = value as MediaAsset
      return typeof asset.id === 'string'
        && asset.productionType === 'character_ref'
        && asset.status === 'ready'
        ? [[asset.id, asset] as const]
        : []
    }))
  } catch {
    return new Map()
  }
}

function receipt(
  input: GenerateCharacterPreviewsRequest,
  fingerprint: string,
  revision: number,
  payload: CharacterPreviewBatchPayload,
): MutationReceipt {
  return {
    key: input.idempotencyKey,
    operation: 'generate-character-previews',
    fingerprint,
    revision,
    payload: payload as unknown as Record<string, unknown>,
  }
}

function totals(
  required: number,
  results: readonly CharacterPreviewGenerationResult[],
): CharacterPreviewBatchPayload['totals'] {
  return {
    required,
    generated: results.filter((result) => result.status === 'generated').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  }
}

function failedBatch(
  revision: number,
  errorCode: string,
  errors: string[],
  required = 0,
): CharacterPreviewBatchPayload & { ok: false; errorCode: string } {
  return {
    ok: false,
    revision,
    replayed: false,
    results: [],
    totals: { required, generated: 0, skipped: 0, failed: 0 },
    errorCode,
    errors,
  }
}

function unchangedTargetIds(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
  targets: readonly CharacterPreviewTarget[],
): Set<string> {
  const current = new Map(
    requiredCharacterPreviewTargets(project, characters).map((target) => [target.characterId, target]),
  )
  return new Set(targets.flatMap((target) => {
    const latest = current.get(target.characterId)
    return latest?.sourcePromptHash === target.sourcePromptHash
      ? [target.characterId]
      : []
  }))
}

/** Generates the workflow's on-screen character references and safely binds current results. */
export async function runGenerateCharacterPreviews(
  context: ExtensionContext,
  input: GenerateCharacterPreviewsRequest,
): Promise<CharacterPreviewBatchOutcome> {
  const fingerprint = mutationFingerprint({
    activityRevision: input.activityRevision,
    characterIds: input.characterIds ?? null,
    mode: input.mode,
    skipReady: input.skipReady,
  })
  return context.files.withLocks([CHARACTER_PREVIEW_GENERATION_LOCK], async () => {
    const preflight = await context.files.withLocks([GRAPH_SAVE_LOCK, HOST_MANIFEST_LOCK], async () => {
      const [bytes, assetSnapshot] = await Promise.all([
        context.files.read(BLUEPRINT_FILE),
        readHostManifestSnapshot(context.files),
      ])
      const {
        manifest: assetManifest,
        revision,
        receipts,
        scopeRevisions,
      } = assetSnapshot
      const prior = resolveMutationReceipt(receipts, {
        key: input.idempotencyKey,
        operation: 'generate-character-previews',
        fingerprint,
        currentRevision: revision,
      })
      if (prior && 'code' in prior) return { kind: 'conflict' as const, conflict: prior }
      if (prior) {
        return {
          kind: 'replay' as const,
          payload: { ...prior.payload, replayed: true } as unknown as CharacterPreviewBatchPayload,
        }
      }
      // 出图只写自己那条线的域：另一条线并发落盘不应让这里撞冲突。
      const conflict = assetManifestScopedRevisionConflict(
        input.expectedRevision,
        revision,
        scopeRevisions,
        ['characters'],
      )
      if (conflict) return { kind: 'conflict' as const, conflict }
      const project = parseProject(bytes)
      if (!project) return { kind: 'error' as const, revision, errors: ['缺少或无法读取 blueprint.json'] }
      const characters = assetEntityDefinitions(assetManifest).characters
      try {
        const requiredTargets = requiredCharacterPreviewTargets(project, characters)
        if (requiredTargets.length > MAX_AUTOMATIC_CHARACTER_PREVIEWS) {
          return {
            kind: 'limit' as const,
            revision,
            required: requiredTargets.length,
          }
        }
        const targets = input.characterIds
          ? requiredCharacterPreviewTargets(project, characters, input.characterIds)
          : requiredTargets
        return {
          kind: 'ready' as const,
          revision,
          targets,
        }
      } catch (error) {
        return {
          kind: 'error' as const,
          revision,
          errors: [error instanceof Error ? error.message : String(error)],
        }
      }
    })
    if (preflight.kind === 'conflict') return { ok: false, conflict: preflight.conflict }
    if (preflight.kind === 'replay') return preflight.payload
    if (preflight.kind === 'limit') {
      return failedBatch(
        preflight.revision,
        'characters.preview.system-limit-exceeded',
        [`必需屏幕角色 ${preflight.required} 个，超过系统自动生成上限 ${MAX_AUTOMATIC_CHARACTER_PREVIEWS}`],
        preflight.required,
      )
    }
    if (preflight.kind === 'error') {
      return failedBatch(preflight.revision, 'characters.preview.invalid-targets', preflight.errors)
    }

    const results = await generateCharacterPreviews(context, {
      targets: preflight.targets,
      activityRevision: input.activityRevision,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      skipReady: input.skipReady,
    })

    return context.files.withLocks([HOST_MANIFEST_LOCK], async () => {
      const [bytes, assetSnapshot] = await Promise.all([
        context.files.read(BLUEPRINT_FILE),
        readHostManifestSnapshot(context.files),
      ])
      const {
        manifest: assetManifest,
        revision: currentRevision,
        receipts,
      } = assetSnapshot
      const project = parseProject(bytes)
      if (!project) {
        return failedBatch(
          currentRevision,
          'project.invalid',
          ['生图完成，但 blueprint.json 当前无法读取，生成资产未绑定'],
          preflight.targets.length,
        )
      }
      const characters = assetEntityDefinitions(assetManifest).characters
      const bindable = unchangedTargetIds(project, characters, preflight.targets)
      const readyAssets = readyCharacterAssets(assetManifest)
      const assetCatalog = normalizeAssetCatalogState(assetManifest.assetCatalog)
      for (const result of results) {
        if (result.status === 'failed' || !bindable.has(result.characterId)) continue
        const character = assetCatalog.entities.character[result.characterId]
        const asset = readyAssets.get(result.asset.id)
        const previewMeta = asset?.meta?.characterPreview
        const owner = previewMeta && typeof previewMeta === 'object' && !Array.isArray(previewMeta)
          ? (previewMeta as Record<string, unknown>).characterId
          : undefined
        if (character && owner === result.characterId) assetCatalog.entities.character[result.characterId] = {
          ...character,
          current: { assetId: result.asset.id },
          history: character.history.some((entry) => entry.assetId === result.asset.id)
            ? character.history
            : [...character.history, { assetId: result.asset.id, appliedAt: Date.now(), source: 'generate' }],
          updatedAt: Date.now(),
        }
      }
      const next = normalizeDocument(project)
      const validationErrors = validateDocument(next)
      if (validationErrors.length) {
        return failedBatch(
          currentRevision,
          'validation.failed',
          validationErrors,
          preflight.targets.length,
        )
      }
      const revision = nextAssetManifestRevision(currentRevision)
      const batchTotals = totals(preflight.targets.length, results)
      const stale = preflight.targets
        .filter((target) => !bindable.has(target.characterId))
        .map((target) => `角色 ${target.characterId} 在生图期间发生变化，生成资产未绑定`)
      const payload: CharacterPreviewBatchPayload = {
        ok: batchTotals.failed === 0 && stale.length === 0,
        revision,
        replayed: false,
        results,
        totals: batchTotals,
        ...((batchTotals.failed > 0 || stale.length > 0) ? {
          errors: [
            ...results.flatMap((result) => result.status === 'failed' ? [`角色 ${result.characterId}: ${result.error}`] : []),
            ...stale,
          ],
        } : {}),
      }
      const nextReceipts = appendMutationReceipt(
        receipts,
        receipt(input, fingerprint, revision, payload),
      )
      await writeHostManifestRevision(
        context.files,
        { ...assetManifest, assetCatalog },
        {
          touchedScopes: ['characters'],
          receipts: nextReceipts,
        },
      )
      return payload
    })
  })
}
