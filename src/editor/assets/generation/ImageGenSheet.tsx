import type { KinoGenerationTask } from './generation-api'
import {
  ImageGenerationSurface,
  type ImageGenerationAsset,
  type ImageGenerationInitialValues,
} from './ImageGenerationSurface'
import type { ImageGenerationState, ImageGenerationSubmitInput } from './useImageGeneration'
import type { KinoVisualStylePreset } from './visual-style-api'
import type { ImageGenerationAssetKind } from './components/types'
import type { PromptMentionAsset } from './PromptMentionEditor'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { VGEN_CSS } from './vgenStyles'

export type { ImageGenerationAsset, ImageGenerationInitialValues }

export interface ImageGenSheetProps {
  open: boolean
  variant?: 'sheet' | 'page'
  targetRoot?: ImageGenerationAssetKind
  imageAssets: readonly ImageGenerationAsset[]
  historyAssets?: readonly ImageGenerationAsset[]
  mentionAssets?: readonly PromptMentionAsset[]
  visualStyles: readonly KinoVisualStylePreset[]
  visualStylesLoading?: boolean
  visualStylesError?: string | null
  onRequestVisualStyles?: () => void
  state: ImageGenerationState
  initialValues?: ImageGenerationInitialValues
  initialHistoryAssetId?: string
  resetKey?: string | number
  onSubmit: (input: ImageGenerationSubmitInput) => void
  onStopWaiting: () => void
  appliedAssetId?: string
  onApplyResult?: (assetId: string) => Promise<void>
  onTrack: (task: KinoGenerationTask) => void
  onClose: () => void
  onLocateAsset: (resourceId: string) => void
  polishPrompt?: (prompt: string) => Promise<string>
}

/** @deprecated Use ImageGenerationSurface with GenerationPageLayout/GenerationDialog. */
export function ImageGenSheet({
  variant = 'sheet',
  targetRoot = 'image',
  onTrack: _onTrack,
  onLocateAsset: _onLocateAsset,
  ...props
}: ImageGenSheetProps): JSX.Element | null {
  return <ImageGenerationSurface
    {...props}
    layout={variant === 'sheet' ? 'dialog' : 'page'}
    targetRoot={targetRoot}
  />
}

// Keep the established extension styles available while the compatibility
// wrapper is mounted. The component implementation itself lives in the atoms.
injectStyleOnce('game-video-vgen', VGEN_CSS)
