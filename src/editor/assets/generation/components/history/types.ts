import type {
  KinoGenerationStatus,
  KinoGenerationTask,
  KinoPromptContentItem,
  KinoVideoGenerationMode,
  KinoVideoResolution,
  KinoVideoSize,
  VideoGenerationTask,
} from '../../generation-api'
import type { KinoImageSize } from '@/runtime/core/schema/kino-image-schema'
import type {
  GeneratedAsset,
  GeneratedMediaKind,
  GenerationAssetKind,
  GenerationInteractionState,
} from '../types'

export type { KinoGenerationTask, VideoGenerationTask }

/** Values accepted by ImageGenSheet/VideoGenSheet when reusing a history entry. */
export interface GenerationHistoryRestorePayload {
  /** Prompt is required whenever a restore action is available. */
  readonly prompt: string
  readonly promptContent?: KinoPromptContentItem[]
  readonly model?: string
  readonly size?: KinoImageSize | KinoVideoSize
  readonly visualStyleKey?: string
  readonly durationSeconds?: number
  readonly resolution?: KinoVideoResolution
  readonly generateAudio?: boolean
  readonly mode?: KinoVideoGenerationMode
  readonly firstFrameResourceId?: string
  readonly lastFrameResourceId?: string
  readonly referenceImageResourceIds?: string[]
}

export type GenerationHistorySource = 'image-task' | 'image-asset' | 'video-task' | 'video-asset'

/** Normalized, UI-owned history shape. It contains no generated defaults. */
export interface GenerationHistoryItemData {
  readonly generationId: string
  /**
   * Host registry asset identity, when this entry is backed by a registered
   * asset.  This is deliberately separate from `resourceId`: Kino provider
   * ids cannot be passed to host asset-location APIs.
   */
  readonly id?: string
  readonly source: GenerationHistorySource
  readonly media: GeneratedMediaKind
  readonly assetKind: GenerationAssetKind
  readonly status: KinoGenerationStatus
  readonly prompt?: string
  readonly model?: string
  readonly resultUrl?: string
  readonly resourceId?: string
  readonly posterUrl?: string
  readonly label?: string
  readonly createdAt?: number
  readonly result?: GeneratedAsset
  readonly restorePayload?: GenerationHistoryRestorePayload
}

export interface GenerationHistoryInteractionProps {
  interaction?: GenerationInteractionState
  selected?: boolean
  disabled?: boolean
  readOnly?: boolean
}

export interface GenerationHistoryItemProps extends GenerationHistoryInteractionProps {
  item: GenerationHistoryItemData
  presentation?: 'details' | 'cover'
  onActivate?: (item: GenerationHistoryItemData) => void
  onInspect?: (item: GenerationHistoryItemData) => void
  onSelectResult?: (item: GenerationHistoryItemData) => void
  onRestoreSettings?: (
    payload: GenerationHistoryRestorePayload,
    item: GenerationHistoryItemData,
  ) => void
  onReuseSettings?: (
    payload: GenerationHistoryRestorePayload,
    item: GenerationHistoryItemData,
  ) => void
}

export interface GenerationHistoryListProps extends GenerationHistoryInteractionProps {
  items: readonly GenerationHistoryItemData[]
  ariaLabel?: string
  loading?: boolean
  emptyLabel?: string
  selectedGenerationId?: string
  presentation?: 'details' | 'cover'
  onActivate?: (item: GenerationHistoryItemData) => void
  onInspect?: (item: GenerationHistoryItemData) => void
  onSelectResult?: (item: GenerationHistoryItemData) => void
  onRestoreSettings?: (
    payload: GenerationHistoryRestorePayload,
    item: GenerationHistoryItemData,
  ) => void
  onReuseSettings?: (
    payload: GenerationHistoryRestorePayload,
    item: GenerationHistoryItemData,
  ) => void
  className?: string
}

/** A task may carry full params in a newer Kino response without changing this UI contract. */
export interface GenerationTaskParamsCarrier {
  readonly params?: unknown
  readonly generation?: unknown
  readonly generationParams?: unknown
  readonly durationSeconds?: unknown
  readonly duration_sec?: unknown
  readonly generateAudio?: unknown
  readonly generate_audio?: unknown
  readonly mode?: unknown
  readonly resolution?: unknown
  readonly firstFrameResourceId?: unknown
  readonly lastFrameResourceId?: unknown
  readonly referenceImageResourceIds?: unknown
}

export type ImageKinoHistoryTask = KinoGenerationTask & GenerationTaskParamsCarrier
export type VideoKinoHistoryTask = VideoGenerationTask & GenerationTaskParamsCarrier

export interface ImageGenerationAssetLike extends GenerationTaskParamsCarrier {
  readonly id: string
  readonly resourceId?: string
  readonly generationId?: string
  readonly url?: string
  readonly label?: string
  readonly name?: string
  readonly prompt?: string
  readonly model?: string
  readonly imageSize?: string
  readonly visualStyleKey?: string
  readonly createdAt?: number
  readonly updatedAt?: number
  readonly status?: KinoGenerationStatus
}

export interface VideoGenerationAssetLike extends GenerationTaskParamsCarrier {
  readonly id: string
  readonly resourceId?: string
  readonly generationId?: string
  readonly media?: 'video'
  readonly url?: string
  readonly playbackUrl?: string
  readonly posterUrl?: string
  readonly label?: string
  readonly name?: string
  readonly prompt?: string
  readonly model?: string
  readonly imageSize?: string
  readonly visualStyleKey?: string
  readonly size?: unknown
  readonly createdAt?: number
  readonly updatedAt?: number
  readonly durMs?: number
  readonly durationSeconds?: number
  readonly status?: KinoGenerationStatus
}
