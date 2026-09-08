import type {
  GeneratedImageAsset,
  GenerationInteractionState,
  GenerationPhase,
} from '../types'
import { ImageLikePreviewBase } from './ImageLikePreviewBase'

export interface ScenePreviewProps {
  asset: GeneratedImageAsset & { assetKind: 'scene' }
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  onInspect?: (asset: ScenePreviewProps['asset']) => void
  onSelect?: (asset: ScenePreviewProps['asset']) => void
  onApply?: (asset: ScenePreviewProps['asset']) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
}

export function ScenePreview(props: ScenePreviewProps): React.JSX.Element {
  return <ImageLikePreviewBase {...props} kind="scene" />
}
