import { createHash } from 'node:crypto'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import {
  createHostAssetRegistry,
  type HostAssetRegistry,
} from '../asset-registry'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import type { MediaAsset } from '@/authoring/assets/registry-types'
import type { CharacterDefinition } from '@/authoring/assets/registry-types'
import { generated } from './orchestrate'
import { DEFAULT_GENERATION_CONCURRENCY, mapWithConcurrency } from './concurrency'
import {
  buildCharacterPreviewPrompt,
  CHARACTER_PREVIEW_DEFAULT_MODE,
  CHARACTER_PREVIEW_MODES,
  CHARACTER_PREVIEW_PRESETS,
  type CharacterPreviewMode,
} from '@/runtime/core/schema/character-preview'
import { KINO_DEFAULT_IMAGE_MODEL } from '@/runtime/core/schema/kino-image-schema'
import { publicGenerationError } from './preview-failure'

export interface CharacterPreviewTarget {
  characterId: string
  name: string
  description: string
  sourcePrompt: string
  sourcePromptHash: string
  existingAssetId?: string
}

export type CharacterPreviewGenerationResult =
  | { characterId: string; status: 'generated'; asset: MediaAsset }
  | { characterId: string; status: 'skipped'; reason: 'ready'; asset: MediaAsset }
  | { characterId: string; status: 'failed'; error: string }

export function characterPreviewSourceHash(description: string, prompt: string): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({
    description: description.trim(),
    prompt: prompt.trim(),
  })).digest('hex')}`
}

/**
 * 素材身份 = 角色 + 出图形态 + 出图 prompt 哈希；与场景同构，理由见 `scenePreviewAssetId`。
 *
 * 形态必须进 id：三视图与立绘是两张不同用途的图，共用 id 会互相覆盖。
 */
export function characterPreviewAssetId(
  target: CharacterPreviewTarget,
  mode: CharacterPreviewMode = CHARACTER_PREVIEW_DEFAULT_MODE,
): string {
  return `a-charref-${target.characterId}-${mode}-${target.sourcePromptHash.slice(7, 17)}`
}

function characterPreviewMeta(asset: MediaAsset): Record<string, unknown> | undefined {
  const preview = asset.meta?.characterPreview
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return undefined
  return preview as Record<string, unknown>
}

function assetSourcePromptHash(asset: MediaAsset): string | undefined {
  const value = characterPreviewMeta(asset)?.sourcePromptHash
  return typeof value === 'string' ? value : undefined
}

/** 存量资产没有形态字段，按历史默认解释成三视图。 */
function assetMode(asset: MediaAsset): CharacterPreviewMode {
  const value = characterPreviewMeta(asset)?.mode
  return typeof value === 'string' && (CHARACTER_PREVIEW_MODES as readonly string[]).includes(value)
    ? value as CharacterPreviewMode
    : CHARACTER_PREVIEW_DEFAULT_MODE
}

/**
 * `mode` 只在出图路径传：那里知道这一批要的是哪种形态，形态不符必须重出。
 * 巡检与节点生产上下文不关心形态，只问「这张图还对得上设定吗」，省略即可。
 */
export function isCurrentCharacterPreview(
  asset: MediaAsset | null | undefined,
  sourcePrompt: string,
  description: string,
  mode?: CharacterPreviewMode,
): asset is MediaAsset {
  if (!asset || asset.productionType !== 'character_ref' || asset.status !== 'ready') return false
  if (mode && assetMode(asset) !== mode) return false
  const expectedHash = characterPreviewSourceHash(description, sourcePrompt)
  return assetSourcePromptHash(asset) === expectedHash
    || (!assetSourcePromptHash(asset) && asset.prompt?.trim() === sourcePrompt.trim())
}

export function requiredCharacterPreviewTargets(
  project: GraphLibraryDocument,
  characters: Readonly<Record<string, CharacterDefinition>>,
  characterIds?: readonly string[],
): CharacterPreviewTarget[] {
  const requested = characterIds ? new Set(characterIds) : undefined
  // 预览只服务实际画面：目录里未被节点使用的条目不产生生成费用；
  // 同一角色只要有任一节点声明 onScreen !== false，就属于目标集合。
  const onScreen = new Set<string>()
  for (const blueprint of Object.values(project.manifest.packs)) {
    for (const node of blueprint.graph.nodes) {
      for (const binding of node.data.cast ?? []) {
        if (binding.onScreen !== false) onScreen.add(binding.characterId)
      }
    }
  }
  if (requested) {
    for (const id of requested) {
      if (!characters[id]) throw new TypeError(`Unknown character: ${id}`)
      if (!onScreen.has(id)) throw new TypeError(`Character is not required by an on-screen cast: ${id}`)
    }
  }
  return [...onScreen]
    .filter((id) => !requested || requested.has(id))
    .sort()
    .map((characterId) => {
      const character = characters[characterId]
      if (!character) throw new TypeError(`On-screen cast references unknown character: ${characterId}`)
      const sourcePrompt = character.appearance?.previewPrompt?.trim() ?? ''
      return {
        characterId,
        name: character.name,
        description: character.appearance.description,
        sourcePrompt,
        sourcePromptHash: characterPreviewSourceHash(character.appearance.description, sourcePrompt),
        ...(character.currentAssetId ? { existingAssetId: character.currentAssetId } : {}),
      }
    })
}

export async function generateCharacterPreviews(
  context: ExtensionContext,
  input: {
    targets: readonly CharacterPreviewTarget[]
    activityRevision: number
    idempotencyKey: string
    mode: CharacterPreviewMode
    skipReady: boolean
  },
  registry: HostAssetRegistry = createHostAssetRegistry(context),
): Promise<CharacterPreviewGenerationResult[]> {
  const characterAssets = await registry.list({ productionType: 'character_ref' })
  // 批内并发：出图是这一步的墙钟大头，逐个 await 会让 N 个角色变成 N 倍等待。
  // 上限固定，避免限流与计费突刺；顺序由 mapWithConcurrency 保持。
  return mapWithConcurrency(input.targets, DEFAULT_GENERATION_CONCURRENCY, async (target) => {
    const assetId = characterPreviewAssetId(target, input.mode)
    const bound = target.existingAssetId
      ? await registry.get(target.existingAssetId)
      : undefined
    const operationAsset = await registry.get(assetId)
    const replayAsset = operationAsset ?? characterAssets.find((asset) => {
      const preview = asset.meta?.characterPreview
      if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return false
      const metadata = preview as Record<string, unknown>
      return metadata.characterId === target.characterId
        && metadata.sourcePromptHash === target.sourcePromptHash
        && metadata.idempotencyKey === input.idempotencyKey
        && assetMode(asset) === input.mode
    })
    const isStaleGenerating = replayAsset?.status === 'generating'
      && (Date.now() - (replayAsset.updatedAt || replayAsset.createdAt) > 60000)
    if (replayAsset?.status === 'generating' && !isStaleGenerating) {
      return {
        characterId: target.characterId,
        status: 'failed' as const,
        error: '相同 idempotencyKey 的生成状态仍未确定；为避免重复计费，未再次提交图片生成',
      }
    }
    const existing = isCurrentCharacterPreview(bound, target.sourcePrompt, target.description, input.mode)
      ? bound
      : isCurrentCharacterPreview(replayAsset, target.sourcePrompt, target.description, input.mode)
        ? replayAsset
        : undefined
    const existingPreview = existing?.meta?.characterPreview
    const existingKey = existingPreview && typeof existingPreview === 'object' && !Array.isArray(existingPreview)
      ? (existingPreview as Record<string, unknown>).idempotencyKey
      : undefined
    if (existing && (input.skipReady || existingKey === input.idempotencyKey)) {
      return { characterId: target.characterId, status: 'skipped' as const, reason: 'ready' as const, asset: existing }
    }
    const effectivePrompt = buildCharacterPreviewPrompt(target, input.mode)
    const preset = CHARACTER_PREVIEW_PRESETS[input.mode]
    const now = Date.now()
    await registry.upsert({
      id: assetId,
      kind: 'image',
      productionType: 'character_ref',
      status: 'generating',
      label: `${target.name} · ${input.mode === 'turnaround' ? '角色三视图' : '角色参考图'}`,
      prompt: effectivePrompt,
      sourceModule: 'game-video',
      createdAt: now,
      updatedAt: now,
      meta: {
        characterPreview: {
          characterId: target.characterId,
          sourcePrompt: target.sourcePrompt,
          sourcePromptHash: target.sourcePromptHash,
          generationTrigger: 'workflow-auto',
          activityRevision: input.activityRevision,
          mode: input.mode,
          idempotencyKey: input.idempotencyKey,
        },
      },
    })
    try {
      const output = await context.models.generateImage({
        prompt: effectivePrompt,
        model: KINO_DEFAULT_IMAGE_MODEL,
        aspectRatio: preset.aspectRatio,
        metadata: {
          productionType: 'character_ref',
          characterId: target.characterId,
          generationTrigger: 'workflow-auto',
          activityRevision: input.activityRevision,
          idempotencyKey: `${input.idempotencyKey}:${target.characterId}:${target.sourcePromptHash}`,
        },
      })
      const generatedAsset = generated(output.assets, 'image')
      const registration = {
        registryId: assetId,
        productionType: 'character_ref' as const,
        label: `${target.name} · ${input.mode === 'turnaround' ? '角色三视图' : '角色参考图'}`,
        prompt: effectivePrompt,
        meta: {
          characterPreview: {
            characterId: target.characterId,
            sourcePrompt: target.sourcePrompt,
            sourcePromptHash: target.sourcePromptHash,
            generationTrigger: 'workflow-auto',
            activityRevision: input.activityRevision,
            mode: input.mode,
            idempotencyKey: input.idempotencyKey,
          },
        },
        provenance: {
          origin: 'generation' as const,
          recipe: {
            version: 1 as const,
            parameters: {
              model: KINO_DEFAULT_IMAGE_MODEL,
              mode: input.mode,
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
          filenamePrefix: input.mode === 'turnaround'
            ? 'character-turnaround'
            : 'character-portrait',
        })
      return { characterId: target.characterId, status: 'generated' as const, asset }
    } catch (error) {
      // 单张失败不拖垮整批：已成功的角色保留，缺口进结构化清单。
      const message = publicGenerationError(error, 'Character preview generation failed')
      await registry.update(assetId, { status: 'failed', error: message })
      return { characterId: target.characterId, status: 'failed' as const, error: message }
    }
  })
}
