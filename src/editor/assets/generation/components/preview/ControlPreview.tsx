import type {
  GeneratedImageAsset,
  GenerationInteractionState,
  GenerationPhase,
} from '../types'
import { ImageLikePreviewBase } from './ImageLikePreviewBase'

export interface ControlPreviewProps {
  asset: GeneratedImageAsset & { assetKind: 'control' }
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  onInspect?: (asset: ControlPreviewProps['asset']) => void
  onSelect?: (asset: ControlPreviewProps['asset']) => void
  onApply?: (asset: ControlPreviewProps['asset']) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
}

export function ControlPreview(props: ControlPreviewProps): React.JSX.Element {
  return <ImageLikePreviewBase {...props} kind="control" />
}
