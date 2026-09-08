import type {
  GeneratedImageAsset,
  GenerationInteractionState,
  GenerationPhase,
} from '../types'
import { ImageLikePreviewBase } from './ImageLikePreviewBase'

export interface IconPreviewProps {
  asset: GeneratedImageAsset & { assetKind: 'icon' }
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  onInspect?: (asset: IconPreviewProps['asset']) => void
  onSelect?: (asset: IconPreviewProps['asset']) => void
  onApply?: (asset: IconPreviewProps['asset']) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
}

export function IconPreview(props: IconPreviewProps): React.JSX.Element {
  return <ImageLikePreviewBase {...props} kind="icon" />
}
