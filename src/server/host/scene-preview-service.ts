import type { ExtensionContext } from '@forgeax/extension-host/node'
import { normalizeDocument, validateDocument } from '@/authoring/blueprint/blueprint-project'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import type { AssetManifest, MediaAsset, SceneDefinition } from '@/authoring/assets/registry-types'
import {
  HOST_MANIFEST_LOCK,
  readHostManifestSnapshot,
  writeHostManifestRevision,
} from '../asset-registry'
import { assetEntityDefinitions, normalizeAssetCatalogState } from './asset-entity-catalog'
import { scenePreviewShapeKey, type ScenePreviewMode } from '@/runtime/core/schema/scene-preview'
import {
  generateScenePreviews,
  requiredScenePreviewTargets,
  type ScenePreviewGenerationResult,
  type ScenePreviewTarget,
} from '../generation/scene-previews'
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

/**
 * 场景参考图批量生成的编排，与 `character-preview-service.ts` 对称。
 *
 * 三段结构固定：锁内 preflight（幂等重放 / 修订冲突 / 目标推导 / 规模上限）→
 * 锁外并发出图 → 锁内登记与绑定主预览。出图放在锁外是必须的：那是唯一的长耗时
 * 操作，握着写锁出图会让整个工作台在几十秒内无法写入。
 */

const BLUEPRINT_FILE = 'blueprint.json'
const GRAPH_SAVE_LOCK = 'game-video-graph-save'
const SCENE_PREVIEW_GENERATION_LOCK = 'game-video-scene-preview-generation'
/** 与角色一致的系统上限：超过说明总脉络的场景规模异常，应回到总脉络而不是硬出图。 */
export const MAX_AUTOMATIC_SCENE_PREVIEWS = 50
const decoder = new TextDecoder()

export interface GenerateScenePreviewsRequest {
  expectedRevision: number
  activityRevision: number
  idempotencyKey: string
  sceneIds?: string[]
  mode: ScenePreviewMode
  angleCount?: number
  skipReady: boolean
}

export interface ScenePreviewBatchPayload {
  ok: boolean
  revision: number
  replayed: boolean
  results: ScenePreviewGenerationResult[]
  totals: { required: number, generated: number, skipped: number, failed: number }
  errors?: string[]
}

export type ScenePreviewBatchOutcome =
  | ScenePreviewBatchPayload
  | { ok: false, conflict: RevisionConflict | IdempotencyConflict }
  | ScenePreviewBatchPayload & { ok: false, errorCode: string }

function parseProject(bytes: Uint8Array | null): GraphLibraryDocument | null {
  if (!bytes) return null
  try {
    return normalizeDocument(JSON.parse(decoder.decode(bytes)) as GraphLibraryDocument)
  } catch {
    return null
  }
}

function readySceneAssets(manifest: AssetManifest): Map<string, MediaAsset> {
  try {
    return new Map(manifest.assets.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return []
      const asset = value as MediaAsset
      return typeof asset.id === 'string'
        && asset.productionType === 'scene_ref'
        && asset.status === 'ready'
        ? [[asset.id, asset] as const]
        : []
    }))
  } catch {
    return new Map()
  }
}

function receipt(
  input: GenerateScenePreviewsRequest,
  fingerprint: string,
  revision: number,
  payload: ScenePreviewBatchPayload,
): MutationReceipt {
  return {
    key: input.idempotencyKey,
    operation: 'generate-scene-previews',
    fingerprint,
    revision,
    payload: payload as unknown as Record<string, unknown>,
  }
}

function totals(
  required: number,
  results: readonly ScenePreviewGenerationResult[],
): ScenePreviewBatchPayload['totals'] {
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
): ScenePreviewBatchPayload & { ok: false, errorCode: string } {
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

/**
 * 出图期间场景设定可能被改过（用户手改或返工）。此时旧图已经对不上新设定，
 * 不能绑定，否则用户会看到与描述不符的图。
 */
function unchangedTargetIds(
  project: GraphLibraryDocument,
  scenes: Readonly<Record<string, SceneDefinition>>,
  targets: readonly ScenePreviewTarget[],
): Set<string> {
  const current = new Map(
    requiredScenePreviewTargets(project, scenes).map((target) => [target.sceneId, target]),
  )
  return new Set(targets.flatMap((target) => (
    current.get(target.sceneId)?.sourcePromptHash === target.sourcePromptHash ? [target.sceneId] : []
  )))
}

export async function runScenePreviewBatch(
  context: ExtensionContext,
  input: GenerateScenePreviewsRequest,
): Promise<ScenePreviewBatchOutcome> {
  const fingerprint = mutationFingerprint({
    activityRevision: input.activityRevision,
    sceneIds: input.sceneIds ?? null,
    // 形态进指纹：同一批次换 mode 就是另一件事，不能当同一次写重放。
    shape: scenePreviewShapeKey(input),
    skipReady: input.skipReady,
  })
  return context.files.withLocks([SCENE_PREVIEW_GENERATION_LOCK], async () => {
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
        operation: 'generate-scene-previews',
        fingerprint,
        currentRevision: revision,
      })
      if (prior && 'code' in prior) return { kind: 'conflict' as const, conflict: prior }
      if (prior) {
        return {
          kind: 'replay' as const,
          payload: { ...prior.payload, replayed: true } as unknown as ScenePreviewBatchPayload,
        }
      }
      // 出图只写自己那条线的域：另一条线并发落盘不应让这里撞冲突。
      const conflict = assetManifestScopedRevisionConflict(
        input.expectedRevision,
        revision,
        scopeRevisions,
        ['scenes'],
      )
      if (conflict) return { kind: 'conflict' as const, conflict }
      const project = parseProject(bytes)
      if (!project) return { kind: 'error' as const, revision, errors: ['缺少或无法读取 blueprint.json'] }
      const scenes = assetEntityDefinitions(assetManifest).scenes
      try {
        const requiredTargets = requiredScenePreviewTargets(project, scenes)
        if (requiredTargets.length > MAX_AUTOMATIC_SCENE_PREVIEWS) {
          return { kind: 'limit' as const, revision, required: requiredTargets.length }
        }
        const targets = input.sceneIds
          ? requiredScenePreviewTargets(project, scenes, input.sceneIds)
          : requiredTargets
        return { kind: 'ready' as const, revision, targets }
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
        'scenes.preview.system-limit-exceeded',
        [`节点引用场景 ${preflight.required} 个，超过系统自动生成上限 ${MAX_AUTOMATIC_SCENE_PREVIEWS}`],
        preflight.required,
      )
    }
    if (preflight.kind === 'error') {
      return failedBatch(preflight.revision, 'scenes.preview.invalid-targets', preflight.errors)
    }

    const results = await generateScenePreviews(context, {
      targets: preflight.targets,
      activityRevision: input.activityRevision,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      ...(input.angleCount === undefined ? {} : { angleCount: input.angleCount }),
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
      const scenes = assetEntityDefinitions(assetManifest).scenes
      const bindable = unchangedTargetIds(project, scenes, preflight.targets)
      const readyAssets = readySceneAssets(assetManifest)
      const assetCatalog = normalizeAssetCatalogState(assetManifest.assetCatalog)
      for (const result of results) {
        if (result.status === 'failed' || !bindable.has(result.sceneId)) continue
        const scene = assetCatalog.entities.scene[result.sceneId]
        const asset = readyAssets.get(result.asset.id)
        const previewMeta = asset?.meta?.scenePreview
        const owner = previewMeta && typeof previewMeta === 'object' && !Array.isArray(previewMeta)
          ? (previewMeta as Record<string, unknown>).sceneId
          : undefined
        // 只绑定确实属于该场景的资产：防止并发或重放把别人的图绑上来。
        if (scene && owner === result.sceneId) {
          assetCatalog.entities.scene[result.sceneId] = {
            ...scene,
            current: { assetId: result.asset.id },
            history: scene.history.some((entry) => entry.assetId === result.asset.id)
              ? scene.history
              : [...scene.history, { assetId: result.asset.id, appliedAt: Date.now(), source: 'generate' }],
            updatedAt: Date.now(),
          }
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
        .filter((target) => !bindable.has(target.sceneId))
        .map((target) => `场景 ${target.sceneId} 在生图期间发生变化，生成资产未绑定`)
      const payload: ScenePreviewBatchPayload = {
        ok: batchTotals.failed === 0 && stale.length === 0,
        revision,
        replayed: false,
        results,
        totals: batchTotals,
        ...((batchTotals.failed > 0 || stale.length > 0) ? {
          errors: [
            ...results.flatMap((result) => result.status === 'failed' ? [`场景 ${result.sceneId}: ${result.error}`] : []),
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
          touchedScopes: ['scenes'],
          receipts: nextReceipts,
        },
      )
      return payload
    })
  })
}
