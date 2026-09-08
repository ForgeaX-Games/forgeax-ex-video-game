import { createHostAssetRegistry, type HostAssetRegistry } from '../asset-registry'
import type { MediaAsset as HostMediaAsset, MediaReference } from '@forgeax/extension-host/contracts'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import type { MediaAsset, StyleAxes } from '@/authoring/assets/registry-types'
import { makeAssetId } from '@/authoring/assets/registry-types'
import { composeAxes, type ComposedAxes } from '../engine/axes'
import { generateVideoThroughHostCapability } from './video-capability'
import {
  buildNodeShotScriptPrompt,
  buildSeedanceVideoPrompt,
  buildShotGridStoryboardPrompt,
  buildShotImagePrompt,
  getShotCount,
  SEEDANCE_POLISH_SYSTEM_PROMPT,
  type RefCharacter,
  type SeedancePromptEntry,
  type ShotGridInput,
  type ShotImageInput,
  type ShotScriptInput,
  type VideoRefBinding,
} from '../engine'

export type KeyframeMode = 'keyframe' | 'grid_storyboard'
export interface KeyframeInput extends ShotImageInput {
  sceneNodeId: string
  refAssetIds?: string[]
  label?: string
  styleAxes?: StyleAxes
  mode?: KeyframeMode
  grid?: Omit<ShotGridInput, 'originalPrompt' | 'referenceCount' | 'sceneRefReady'>
}
export interface VideoGenInput {
  sceneNodeId: string; nodeName: string; seedancePrompt?: string; storyText?: string
  durationSeconds: number; artStyle?: string; styleKeywords?: string[]
  characterRefIds: string[]; sceneRefIds: string[]; continuityFirstFrameId?: string
  /** Internal segment continuation: previous generated registry video id. */
  continuityVideoId?: string
  label?: string; generateAudio?: boolean; styleAxes?: StyleAxes; extend?: boolean; transitionHint?: string
}
export interface HostGenerationOrchestrator {
  generateShotScript(input: ShotScriptInput & { styleAxes?: StyleAxes }): Promise<SeedancePromptEntry[]>
  generateKeyframe(input: KeyframeInput): Promise<MediaAsset>
  generateVideo(input: VideoGenInput): Promise<MediaAsset>
  generateNodeVideo(input: VideoGenInput): Promise<MediaAsset[]>
}

function assertRefs(input: VideoGenInput): void {
  if (!input.characterRefIds.some(Boolean) || !input.sceneRefIds.some(Boolean)) {
    throw new Error('视频生成缺必传参考图：character_ref（角色参考图）+ scene_ref（场景参考图）')
  }
}
export function generated(assets: HostMediaAsset[], type: 'image' | 'video'): HostMediaAsset {
  const asset = assets.find((candidate) => candidate.type === type)
  if (!asset) throw new Error(`Model gateway did not return a generated ${type}`)
  return asset
}
async function axes(registry: HostAssetRegistry, override?: StyleAxes): Promise<ComposedAxes> {
  return composeAxes({ ...(await registry.getStyleAxes() ?? {}), ...(override ?? {}) })
}
async function references(registry: HostAssetRegistry, ids: readonly string[]): Promise<MediaReference[]> {
  return Promise.all(ids.filter(Boolean).map((id) => registry.mediaReference(id)))
}
export function generationError(error: unknown): string {
  return (error instanceof Error ? error.message : 'Generation failed')
    .replace(/file:\/\/\S+/gi, '[redacted]').replace(/https?:\/\/\S+/gi, '[redacted]').slice(0, 400)
}
function optionalShotText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
function parseShotScript(raw: string, durationSeconds: number): SeedancePromptEntry[] {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as { shots?: unknown[] } | unknown[]
    const values = Array.isArray(parsed) ? parsed : parsed.shots ?? []
    const shots = values.flatMap((value, index) => {
      const shot = value as Partial<SeedancePromptEntry>
      if (typeof shot.seedancePrompt !== 'string' || !shot.seedancePrompt.trim()) return []
      const dialogueLine = optionalShotText(shot.dialogueLine)
      const voiceover = optionalShotText(shot.voiceover)
      return [{
        shotNumber: typeof shot.shotNumber === 'number' ? shot.shotNumber : index + 1,
        durationSeconds: typeof shot.durationSeconds === 'number' ? shot.durationSeconds : durationSeconds,
        seedancePrompt: shot.seedancePrompt.trim(),
        ...(dialogueLine ? { dialogueLine } : {}),
        ...(voiceover ? { voiceover } : {}),
      }]
    })
    if (shots.length) return shots
  } catch { /* plain text is a valid fallback */ }
  return [{ shotNumber: 1, durationSeconds, seedancePrompt: cleaned.slice(0, 700) }]
}
export function splitDurationIntoSegments(totalSeconds: number): number[] {
  const count = getShotCount(totalSeconds)
  const base = Math.floor(totalSeconds / count)
  return Array.from({ length: count }, (_, index) => base + (index < totalSeconds - base * count ? 1 : 0))
}

/** Host-capability-only generation; transport, environment and disk access stay in the host. */
export function createHostGenerationOrchestrator(context: ExtensionContext, registry = createHostAssetRegistry(context)): HostGenerationOrchestrator {
  const keyframe = async (input: KeyframeInput): Promise<MediaAsset> => {
    const mode = input.mode ?? 'keyframe'; const productionType = mode === 'grid_storyboard' ? 'grid_storyboard' : 'shot_image'
    const id = makeAssetId(); const label = input.label ?? (mode === 'grid_storyboard' ? `分镜故事板 · ${input.nodeName}` : `关键帧 · ${input.nodeName}`)
    await registry.upsert({ id, kind: 'image', productionType, status: 'generating', label, sceneNodeId: input.sceneNodeId, sourceModule: 'game-video', createdAt: Date.now(), updatedAt: Date.now() })
    try {
      const refs = await references(registry, input.refAssetIds ?? []); const style = await axes(registry, input.styleAxes)
      const base = buildShotImagePrompt({ ...input, uiStylePrompt: input.uiStylePrompt ?? style.uiStylePrompt, refsReady: refs.length > 0 })
      const prompt = mode === 'grid_storyboard' ? buildShotGridStoryboardPrompt({ ...(input.grid ?? {}), originalPrompt: base, referenceCount: refs.length, sceneRefReady: refs.length > 0 }) : base
      return await registry.persistGenerated(generated((await context.models.generateImage({ prompt, references: refs, aspectRatio: '1:1', metadata: { sceneNodeId: input.sceneNodeId, productionType } })).assets, 'image'), { registryId: id, filenamePrefix: mode === 'grid_storyboard' ? 'storyboard' : 'keyframe', productionType, sceneNodeId: input.sceneNodeId, label, prompt, meta: { refIds: input.refAssetIds ?? [], mode }, provenance: { origin: 'generation', recipe: { version: 1, inputs: (input.refAssetIds ?? []).map((assetId) => ({ assetId, role: 'reference' })), parameters: { mode, aspectRatio: '1:1', styleAxes: { ...(input.styleAxes?.artMedia ? { artMedia: input.styleAxes.artMedia } : {}), ...(input.styleAxes?.director ? { director: input.styleAxes.director } : {}), ...(input.styleAxes?.filmLook ? { filmLook: input.styleAxes.filmLook } : {}) } } } } })
    } catch (error) { await registry.update(id, { status: 'failed', error: generationError(error) }); throw error }
  }
  const video = async (input: VideoGenInput): Promise<MediaAsset> => {
    assertRefs(input); const id = makeAssetId(); const label = input.label ?? `视频 · ${input.nodeName}`
    await registry.upsert({ id, kind: 'video', productionType: 'video_clip', status: 'generating', label, sceneNodeId: input.sceneNodeId, sourceModule: 'game-video', createdAt: Date.now(), updatedAt: Date.now() })
    try {
      const style = await axes(registry, input.styleAxes)
      const referenceSpecs = [
        ...(input.continuityVideoId ? [{ id: input.continuityVideoId, role: '延长视频', providerRole: 'reference_video' as const, mediaKind: 'video' as const }] : []),
        ...(!input.continuityVideoId && input.continuityFirstFrameId ? [{ id: input.continuityFirstFrameId, role: '续接首帧', providerRole: 'first_frame' as const, mediaKind: 'image' as const }] : []),
        ...input.characterRefIds.map((refId) => ({ id: refId, role: '角色', providerRole: 'character_reference' as const, mediaKind: 'image' as const })),
        ...input.sceneRefIds.map((refId) => ({ id: refId, role: '场景', providerRole: 'scene_reference' as const, mediaKind: 'image' as const })),
      ]
      const refs = await Promise.all(referenceSpecs.map(async (spec) => ({
        ...await registry.mediaReference(spec.id),
        role: spec.providerRole,
        mediaKind: spec.mediaKind,
      })))
      const bindings: VideoRefBinding[] = referenceSpecs.map((spec, index) => ({
        index: index + 1,
        role: spec.role,
        isVideo: spec.mediaKind === 'video',
      }))
      const prompt = buildSeedanceVideoPrompt({ seedancePrompt: input.seedancePrompt, storyText: input.storyText, nodeName: input.nodeName, durationSeconds: input.durationSeconds, artStyle: input.artStyle ?? style.artMedia, styleKeywords: input.styleKeywords ?? style.styleKeywords, refs: bindings, extend: input.extend, transitionHint: input.transitionHint })
      const generatedVideo = await generateVideoThroughHostCapability(context, {
        prompt,
        references: refs,
        durationSeconds: input.durationSeconds,
        generateAudio: input.generateAudio ?? false,
        metadata: { sceneNodeId: input.sceneNodeId, nodeName: input.nodeName },
      })
      return await registry.persistGenerated(generated([generatedVideo], 'video'), { registryId: id, filenamePrefix: 'video', productionType: 'video_clip', sceneNodeId: input.sceneNodeId, label, prompt, durationMs: Math.round(input.durationSeconds * 1000), meta: { characterRefIds: input.characterRefIds, sceneRefIds: input.sceneRefIds }, provenance: { origin: 'generation', recipe: { version: 1, inputs: [...input.characterRefIds.map((assetId) => ({ assetId, role: 'character_reference' })), ...input.sceneRefIds.map((assetId) => ({ assetId, role: 'scene_reference' }))], parameters: { durationSeconds: input.durationSeconds, generateAudio: input.generateAudio ?? false } } } })
    } catch (error) { const failed = await registry.update(id, { status: 'failed', error: generationError(error) }); if (failed) throw Object.assign(error instanceof Error ? error : new Error(generationError(error)), { asset: failed }); throw error }
  }
  return {
    async generateShotScript(input) { const style = await axes(registry, input.styleAxes); const text = await context.models.generateText({ prompt: buildNodeShotScriptPrompt({ ...input, artStyle: input.artStyle ?? style.artMedia, styleKeywords: input.styleKeywords ?? style.styleKeywords }), system: style.directorSystem || undefined, temperature: 0.7, metadata: { responseFormat: 'json' } }); return parseShotScript(text.text, input.durationSeconds) },
    generateKeyframe: keyframe, generateVideo: video,
    async generateNodeVideo(input) {
      assertRefs(input)
      const segments = splitDurationIntoSegments(input.durationSeconds)
      const assets: MediaAsset[] = []
      let previous: MediaAsset | undefined
      for (const [index, durationSeconds] of segments.entries()) {
        try {
          const asset = await video({
            ...input,
            durationSeconds,
            label: `${input.label ?? `视频 · ${input.nodeName}`} · 段${index + 1}/${segments.length}`,
            continuityVideoId: index > 0 ? previous?.id : undefined,
            extend: index > 0,
            transitionHint: index > 0
              ? input.transitionHint ?? `接上一段（第 ${index} 段）尾部，人物、机位、光影、表演节奏无缝延续`
              : undefined,
          })
          assets.push(asset)
          previous = asset
        } catch (error) {
          const asset = (error as { asset?: MediaAsset }).asset
          if (asset) assets.push(asset)
          break
        }
      }
      return assets
    },
  }
}
export { SEEDANCE_POLISH_SYSTEM_PROMPT }
export type { RefCharacter }
