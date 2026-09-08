import type { ClipGenState } from './useClipGeneration'
import type { ClipGenerationRequest } from './generation-api'
import {
  VideoGenerationSurface,
  type RecentGeneratedClip,
  type VideoGenerationInitialValues,
} from './VideoGenerationSurface'
import type { KinoVisualStylePreset } from './visual-style-api'
import type { VgenImageAsset } from './VgenImagePicker'
import type { PromptMentionAsset } from './PromptMentionEditor'
import type { GenerationInteractionState } from './components'

export type { RecentGeneratedClip, VideoGenerationInitialValues }

export interface VideoGenSheetProps {
  open: boolean
  variant?: 'sheet' | 'page'
  gameSlug: string
  imageAssets: readonly VgenImageAsset[]
  recentClips: readonly RecentGeneratedClip[]
  mentionAssets?: readonly PromptMentionAsset[]
  genState: ClipGenState
  availableModels?: readonly string[]
  initialValues?: VideoGenerationInitialValues
  initialResultAssetId?: string
  resetKey?: string | number
  interaction?: Partial<Pick<GenerationInteractionState, 'disabled' | 'readOnly'>>
  submissionError?: string | null
  appliedAssetId?: string
  onApplyResult?: (assetId: string) => Promise<void>
  onSubmit: (request: ClipGenerationRequest) => void
  onCancel: () => void
  onTrack: (generationId: string) => void
  onClose: () => void
  onLocateAsset: (assetId: string) => void
  loadVisualStyles?: () => Promise<readonly KinoVisualStylePreset[]>
  polishPrompt?: (prompt: string) => Promise<string>
}

/** @deprecated Use VideoGenerationSurface with GenerationPageLayout/GenerationDialog. */
export function VideoGenSheet({
  variant = 'sheet',
  onLocateAsset: _onLocateAsset,
  ...props
}: VideoGenSheetProps): React.JSX.Element | null {
  return <VideoGenerationSurface {...props} layout={variant === 'sheet' ? 'dialog' : 'page'} />
}
