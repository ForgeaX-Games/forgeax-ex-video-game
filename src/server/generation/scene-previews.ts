import { createHash } from 'node:crypto'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import type { SceneDefinition } from '@/authoring/assets/registry-types'
import { createHostAssetRegistry, type HostAssetRegistry } from '../asset-registry'
import { KINO_DEFAULT_IMAGE_MODEL } from '@/runtime/core/schema/kino-image-schema'
import {
  buildScenePreviewPrompt,
  normalizeSceneAngleCount,
  SCENE_PREVIEW_DEFAULT_MODE,
  SCENE_PREVIEW_LEGACY_MODE,
  SCENE_PREVIEW_PRESETS,
  scenePreviewShapeKey,
  type ScenePreviewMode,
  type ScenePreviewShape,
} from '@/runtime/core/schema/scene-preview'
import { generated } from './orchestrate'
import { DEFAULT_GENERATION_CONCURRENCY, mapWithConcurrency } from './concurrency'
import { publicGenerationError } from './preview-failure'

/**
 * 场景参考图的目标推导与新鲜度判定，与 `character-previews.ts` 严格对称。
 *
 * 关键约束：目标集合由 **Host 从 manifest 场景实体与蓝图引用共同推导**，
 * Agent 只能选择已有实体的子集。
 * 否则模型可以「顺手」把没出场的场景也生成一遍，直接变成额外出图开销。
 */

export interface ScenePreviewTarget {
  sceneId: string
  name: string
  description: string
  sourcePrompt: string
  sourcePromptHash: string
  existingAssetId?: string
}

export function scenePreviewSourceHash(description: string, prompt: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    description: description.trim(),
    prompt: prompt.trim(),
  })).digest('hex')}`
}

/**
 * 素材身份 = 场景 + 出图形态 + 出图 prompt 哈希。**不含幂等键**。
 *
 * 键进 id 会让同一个场景、同一份 prompt 的每次重试都新建一条记录：实测
 * `scene_cave` 连试 4 次就在素材清单里留下 4 条 failed，侧栏看起来像「又生成了一次」。
 * 重试应该更新同一条记录（failed → ready），幂等重放由 mutation receipts 那层负责。
 *
 * 形态必须进 id：单幅图与多机位图是两张不同用途的图，共用 id 会互相覆盖。
 */
export function scenePreviewAssetId(target: ScenePreviewTarget, shape: ScenePreviewShape = {}): string {
  return `a-sceneref-${target.sceneId}-${scenePreviewShapeKey(shape)}-${target.sourcePromptHash.slice(7, 17)}`
}

function scenePreviewMeta(asset: MediaAsset): Record<string, unknown> | undefined {
  const preview = asset.meta?.scenePreview
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return undefined
  return preview as Record<string, unknown>
}

function assetSourcePromptHash(asset: MediaAsset): string | undefined {
  const value = scenePreviewMeta(asset)?.sourcePromptHash
  return typeof value === 'string' ? value : undefined
}

/** 存量资产没有形态字段，按历史口径解释成单幅图。 */
function assetShapeKey(asset: MediaAsset): string {
  const meta = scenePreviewMeta(asset)
  const mode = typeof meta?.mode === 'string' ? meta.mode as ScenePreviewMode : SCENE_PREVIEW_LEGACY_MODE
  const angleCount = typeof meta?.angleCount === 'number' ? meta.angleCount : undefined
  return scenePreviewShapeKey({ mode, angleCount })
}

/**
 * 已绑定的参考图是否还对得上当前设定。
 *
 * 用 sourcePromptHash 而不是比字符串：场景描述或 Prompt 被改过之后，
 * 旧图必须被判为过期，否则用户改了设定却还看着老图。
 *
 * `shape` 只在出图路径传：那里知道这一批要的是哪种形态，形态不符必须重出。
 * 巡检与节点生产上下文不关心形态，只问「这张图还对得上设定吗」，省略即可。
 */
export function isCurrentScenePreview(
  asset: MediaAsset | null | undefined,
  sourcePrompt: string,
  description: string,
  shape?: ScenePreviewShape,
): asset is MediaAsset {
  if (!asset || asset.productionType !== 'scene_ref' || asset.status !== 'ready') return false
  if (shape) {
    const targetMode = shape.mode ?? SCENE_PREVIEW_DEFAULT_MODE
    const currentMode = (asset.meta?.scenePreview as Record<string, unknown> | undefined)?.mode ?? SCENE_PREVIEW_LEGACY_MODE
    if (targetMode !== currentMode) return false
    if (shape.angleCount !== undefined && assetShapeKey(asset) !== scenePreviewShapeKey(shape)) return false
  }
  const expectedHash = scenePreviewSourceHash(description, sourcePrompt)
  return assetSourcePromptHash(asset) === expectedHash
    || (!assetSourcePromptHash(asset) && asset.prompt?.trim() === sourcePrompt.trim())
}

/**
 * 需要出图的场景只来自蓝图节点实际使用声明。
 * 目录中的未使用条目仍可保留，但不会被自动生成或阻塞引用就绪检查。
 */
export function referencedSceneIds(
  project: GraphLibraryDocument,
  _scenes: Readonly<Record<string, SceneDefinition>>,
): Set<string> {
  const referenced = new Set<string>()
  for (const blueprint of Object.values(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      for (const binding of node.data.scenes ?? []) {
        referenced.add(binding.sceneId)
      }
    }
  }
  return referenced
}

export type ScenePreviewGenerationResult =
  | { sceneId: string, status: 'generated', asset: MediaAsset }
  | { sceneId: string, status: 'skipped', reason: 'ready', asset: MediaAsset }
  | { sceneId: string, status: 'failed', error: string }

/**
 * 出图并登记 `scene_ref`，与角色出图同构。
 *
 * 批内并发：出图是这一步的墙钟大头，逐个 await 会让 N 个场景变成 N 倍等待。
 * 上限固定以避免限流与计费突刺；单张失败不拖垮整批。
 */
export async function generateScenePreviews(
  context: ExtensionContext,
  input: {
    targets: readonly ScenePreviewTarget[]
    activityRevision: number
    idempotencyKey: string
    mode: ScenePreviewMode
    angleCount?: number
    skipReady: boolean
  },
  registry: HostAssetRegistry = createHostAssetRegistry(context),
): Promise<ScenePreviewGenerationResult[]> {
  const sceneAssets = await registry.list({ productionType: 'scene_ref' })
  const explicitAngleCount = input.angleCount === undefined ? undefined : normalizeSceneAngleCount(input.angleCount)
  const angleCount = normalizeSceneAngleCount(input.angleCount)
  const matchShape: ScenePreviewShape = { mode: input.mode, ...(explicitAngleCount !== undefined ? { angleCount: explicitAngleCount } : {}) }
  const generationShape: ScenePreviewShape = { mode: input.mode, angleCount }
  const shapeKey = scenePreviewShapeKey(generationShape)
  const preset = SCENE_PREVIEW_PRESETS[input.mode]
  const label = (name: string) => (
    `${name} · ${input.mode === 'multiview' ? '场景多机位设定图' : '场景参考图'}`
  )
  return mapWithConcurrency(input.targets, DEFAULT_GENERATION_CONCURRENCY, async (target) => {
    const assetId = scenePreviewAssetId(target, generationShape)
    const bound = target.existingAssetId ? await registry.get(target.existingAssetId) : undefined
    const operationAsset = await registry.get(assetId)
    const replayAsset = operationAsset ?? sceneAssets.find((asset) => {
      const preview = asset.meta?.scenePreview
      if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return false
      const metadata = preview as Record<string, unknown>
      return metadata.sceneId === target.sceneId
        && metadata.sourcePromptHash === target.sourcePromptHash
        && metadata.idempotencyKey === input.idempotencyKey
        && assetShapeKey(asset) === shapeKey
    })
    const isStaleGenerating = replayAsset?.status === 'generating'
      && (Date.now() - (replayAsset.updatedAt || replayAsset.createdAt) > 60000)
    if (replayAsset?.status === 'generating' && !isStaleGenerating) {
      return {
        sceneId: target.sceneId,
        status: 'failed' as const,
        error: '相同 idempotencyKey 的生成状态仍未确定；为避免重复计费，未再次提交图片生成',
      }
    }
    const existing = isCurrentScenePreview(bound, target.sourcePrompt, target.description, matchShape)
      ? bound
      : isCurrentScenePreview(replayAsset, target.sourcePrompt, target.description, matchShape)
        ? replayAsset
        : sceneAssets.find((asset) => (
            isCurrentScenePreview(asset, target.sourcePrompt, target.description, matchShape)
            && (asset.meta?.scenePreview as Record<string, unknown> | undefined)?.sceneId === target.sceneId
          ))
    const existingPreview = existing?.meta?.scenePreview
    const existingKey = existingPreview && typeof existingPreview === 'object' && !Array.isArray(existingPreview)
      ? (existingPreview as Record<string, unknown>).idempotencyKey
      : undefined
    if (existing && (input.skipReady || existingKey === input.idempotencyKey)) {
      return { sceneId: target.sceneId, status: 'skipped' as const, reason: 'ready' as const, asset: existing }
    }
    const effectivePrompt = buildScenePreviewPrompt(target, generationShape)
    const now = Date.now()
    const meta = {
      scenePreview: {
        sceneId: target.sceneId,
        sourcePrompt: target.sourcePrompt,
        sourcePromptHash: target.sourcePromptHash,
        generationTrigger: 'workflow-auto',
        activityRevision: input.activityRevision,
        mode: input.mode,
        ...(input.mode === 'multiview' ? { angleCount } : {}),
        idempotencyKey: input.idempotencyKey,
      },
    }
    await registry.upsert({
      id: assetId,
      kind: 'image',
      productionType: 'scene_ref',
      status: 'generating',
      label: label(target.name),
      prompt: effectivePrompt,
      sourceModule: 'game-video',
      createdAt: now,
      updatedAt: now,
      meta,
    })
    try {
      const output = await context.models.generateImage({
        prompt: effectivePrompt,
        model: KINO_DEFAULT_IMAGE_MODEL,
        aspectRatio: preset.aspectRatio,
        metadata: {
          productionType: 'scene_ref',
          sceneId: target.sceneId,
          generationTrigger: 'workflow-auto',
          activityRevision: input.activityRevision,
          idempotencyKey: `${input.idempotencyKey}:${target.sceneId}:${shapeKey}:${target.sourcePromptHash}`,
        },
      })
      const generatedAsset = generated(output.assets, 'image')
      const registration = {
        registryId: assetId,
        productionType: 'scene_ref' as const,
        label: label(target.name),
        prompt: effectivePrompt,
        meta,
        provenance: {
          origin: 'generation' as const,
          recipe: {
            version: 1 as const,
            parameters: {
              model: KINO_DEFAULT_IMAGE_MODEL,
              mode: input.mode,
              ...(input.mode === 'multiview' ? { angleCount } : {}),
              aspectRatio: preset.aspectRatio,
              size: preset.size,
            },
          },
        },
      }
      const asset = generatedAsset.metadata?.provider === 'kino'
        ? await registry.registerGenerated(generatedAsset, registration)
        : await registry.persistGenerated(generatedAsset, {
          ...registration,
          filenamePrefix: input.mode === 'multiview' ? 'scene-multiview' : 'scene-reference',
        })
      return { sceneId: target.sceneId, status: 'generated' as const, asset }
    } catch (error) {
      const message = publicGenerationError(error, 'Scene preview generation failed')
      await registry.update(assetId, { status: 'failed', error: message })
      return { sceneId: target.sceneId, status: 'failed' as const, error: message }
    }
  })
}

export function requiredScenePreviewTargets(
  project: GraphLibraryDocument,
  scenes: Readonly<Record<string, SceneDefinition>>,
  sceneIds?: readonly string[],
): ScenePreviewTarget[] {
  const requested = sceneIds ? new Set(sceneIds) : undefined
  const referenced = referencedSceneIds(project, scenes)
  if (requested) {
    for (const id of requested) {
      if (!scenes[id]) throw new TypeError(`Unknown scene: ${id}`)
      if (!referenced.has(id)) throw new TypeError(`Scene is not referenced by any node: ${id}`)
    }
  }
  return [...referenced]
    .filter((id) => !requested || requested.has(id))
    .sort()
    .map((sceneId) => {
      const scene = scenes[sceneId]
      if (!scene) throw new TypeError(`Node references unknown scene: ${sceneId}`)
      const sourcePrompt = scene.visual.previewPrompt.trim()
      return {
        sceneId,
        name: scene.name,
        description: scene.visual.description,
        sourcePrompt,
        sourcePromptHash: scenePreviewSourceHash(scene.visual.description, sourcePrompt),
        ...(scene.currentAssetId ? { existingAssetId: scene.currentAssetId } : {}),
      }
    })
}
