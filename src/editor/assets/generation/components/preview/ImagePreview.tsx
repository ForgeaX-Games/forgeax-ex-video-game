import type {
  GeneratedImageAsset,
  GenerationInteractionState,
  GenerationPhase,
} from '../types'
import { ImageLikePreviewBase } from './ImageLikePreviewBase'

export interface ImagePreviewProps {
  asset: GeneratedImageAsset & { assetKind: 'image' }
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  onInspect?: (asset: ImagePreviewProps['asset']) => void
  onSelect?: (asset: ImagePreviewProps['asset']) => void
  onApply?: (asset: ImagePreviewProps['asset']) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
}

export function ImagePreview(props: ImagePreviewProps): React.JSX.Element {
  return <ImageLikePreviewBase {...props} kind="image" />
}
