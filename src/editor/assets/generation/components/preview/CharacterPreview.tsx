import type {
  GeneratedImageAsset,
  GenerationInteractionState,
  GenerationPhase,
} from '../types'
import { ImageLikePreviewBase } from './ImageLikePreviewBase'

export interface CharacterPreviewProps {
  asset: GeneratedImageAsset & { assetKind: 'character' }
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  onInspect?: (asset: CharacterPreviewProps['asset']) => void
  onSelect?: (asset: CharacterPreviewProps['asset']) => void
  onApply?: (asset: CharacterPreviewProps['asset']) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
}

export function CharacterPreview(props: CharacterPreviewProps): React.JSX.Element {
  return <ImageLikePreviewBase {...props} kind="character" />
}
