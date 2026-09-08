/**
 * Shared contracts for generation UI atoms.
 *
 * These types intentionally describe the editor-facing result rather than the
 * Kino transport task. Image and video surfaces can therefore share the same
 * history/result/interaction primitives without importing one another.
 */

export const GENERATION_ASSET_KINDS = [
  'image',
  'icon',
  'scene',
  'character',
  'video',
  'control',
] as const
export type GenerationAssetKind = (typeof GENERATION_ASSET_KINDS)[number]
export type GeneratedMediaKind = 'image' | 'video'
export type ImageGenerationAssetKind = Exclude<GenerationAssetKind, 'video'>

export const GENERATION_PHASES = [
  'idle',
  'submitting',
  'generating',
  'succeeded',
  'failed',
  'cancelled',
] as const
export type GenerationPhase = (typeof GENERATION_PHASES)[number]
export type TerminalGenerationPhase = Exclude<GenerationPhase, 'idle' | 'submitting' | 'generating'>

interface GeneratedAssetBase {
  readonly id: string
  readonly resourceId?: string
  readonly label?: string
  readonly url?: string
  readonly createdAt?: number
}

type GeneratedImageAssetFor<K extends ImageGenerationAssetKind> = GeneratedAssetBase & {
  readonly assetKind: K
  readonly media: 'image'
  readonly width?: number
  readonly height?: number
}

/** Image media can represent any non-video business asset kind. */
export type GeneratedImageAsset = {
  [K in ImageGenerationAssetKind]: GeneratedImageAssetFor<K>
}[ImageGenerationAssetKind]

export interface GeneratedVideoAsset extends GeneratedAssetBase {
  readonly assetKind: 'video'
  readonly media: 'video'
  readonly durationSeconds?: number
  readonly posterUrl?: string
}

/** Discriminated asset union shared by image and video generation atoms. */
export type GeneratedAsset = GeneratedImageAsset | GeneratedVideoAsset

type ImageGenerationResultFor<K extends ImageGenerationAssetKind> = {
  readonly assetKind: K
  readonly media: 'image'
  readonly generationId: string
  readonly asset: GeneratedImageAssetFor<K>
}

export type ImageGenerationResult = {
  [K in ImageGenerationAssetKind]: ImageGenerationResultFor<K>
}[ImageGenerationAssetKind]

export interface VideoGenerationResult {
  readonly assetKind: 'video'
  readonly media: 'video'
  readonly generationId: string
  readonly asset: GeneratedVideoAsset
}

/** Result narrows its asset to the selected media kind. */
export type GenerationResult = ImageGenerationResult | VideoGenerationResult

export interface GenerationHistoryEntry {
  readonly generationId: string
  readonly assetKind: GenerationAssetKind
  readonly phase: Exclude<GenerationPhase, 'idle'>
  readonly result?: GenerationResult
  readonly prompt?: string
  readonly error?: string
  readonly createdAt?: number
}

export interface GenerationCapabilities {
  /** Business asset kinds the current host/model can generate. */
  readonly supportedKinds: readonly GenerationAssetKind[]
  readonly canGenerate: boolean
  readonly canCancel: boolean
  readonly canRetry: boolean
}

export interface GenerationInteractionState {
  /** Blocks every generation action and keeps the surface inert. */
  readonly disabled: boolean
  /** Allows viewing/history navigation but blocks content mutations. */
  readonly readOnly: boolean
  /** A request is being submitted or observed. */
  readonly busy: boolean
}

export type GenerationInteractionAction = 'generate' | 'cancel' | 'retry' | 'edit'

export interface GenerationViewState {
  readonly phase: GenerationPhase
  readonly history: readonly GenerationHistoryEntry[]
  readonly result?: GenerationResult
  readonly capabilities: GenerationCapabilities
  readonly interaction: GenerationInteractionState
  readonly error?: string
}

export function isGeneratedImageAsset(asset: GeneratedAsset): asset is GeneratedImageAsset {
  return asset.media === 'image'
}

export function isGeneratedVideoAsset(asset: GeneratedAsset): asset is GeneratedVideoAsset {
  return asset.media === 'video'
}

export function isImageGenerationResult(result: GenerationResult): result is ImageGenerationResult {
  return result.media === 'image'
}

export function isVideoGenerationResult(result: GenerationResult): result is VideoGenerationResult {
  return result.media === 'video'
}

export function supportsGenerationKind(
  capabilities: GenerationCapabilities,
  kind: GenerationAssetKind,
): boolean {
  return capabilities.supportedKinds.includes(kind)
}

export function isGenerationBusyPhase(phase: GenerationPhase): boolean {
  return phase === 'submitting' || phase === 'generating'
}

/**
 * Keep interaction semantics in one place so atom components do not grow
 * independent `disabled && !readOnly && !busy` expressions.
 */
export function canPerformGenerationAction(
  interaction: GenerationInteractionState,
  action: GenerationInteractionAction,
): boolean {
  if (interaction.disabled) return false
  if (action === 'cancel') return interaction.busy
  if (interaction.readOnly || interaction.busy) return false
  return true
}

export function interactionStateForPhase(
  phase: GenerationPhase,
  overrides: Partial<Omit<GenerationInteractionState, 'busy'>> = {},
): GenerationInteractionState {
  return {
    disabled: overrides.disabled ?? false,
    readOnly: overrides.readOnly ?? false,
    busy: isGenerationBusyPhase(phase),
  }
}
