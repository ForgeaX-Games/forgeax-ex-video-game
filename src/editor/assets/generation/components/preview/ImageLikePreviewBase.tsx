import { tf, useT } from '../../../../../i18n'
import {
  canPerformGenerationAction,
  type GeneratedImageAsset,
  type GenerationAssetKind,
  type GenerationInteractionState,
  type GenerationPhase,
} from '../types'
import { GenerationPreviewFrame } from './GenerationPreviewFrame'

export interface ImageLikePreviewBaseProps<TAsset extends GeneratedImageAsset = GeneratedImageAsset> {
  asset: TAsset
  kind: Exclude<GenerationAssetKind, 'video'>
  phase?: GenerationPhase
  interaction?: GenerationInteractionState
  ariaLabel?: string
  className?: string
  showFooter?: boolean
  onInspect?: (asset: TAsset) => void
  onSelect?: (asset: TAsset) => void
  onApply?: (asset: TAsset) => void
  onLocate?: (resourceId: string) => void
  onLocateAsset?: (resourceId: string) => void
}

const DEFAULT_INTERACTION: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

/** Shared rendering for image-like atoms; wrappers keep their public contracts explicit. */
export function ImageLikePreviewBase<TAsset extends GeneratedImageAsset>({
  asset,
  kind,
  phase = 'succeeded',
  interaction = DEFAULT_INTERACTION,
  ariaLabel,
  className,
  showFooter = true,
  onInspect,
  onSelect,
  onApply,
  onLocate,
  onLocateAsset,
}: ImageLikePreviewBaseProps<TAsset>): React.JSX.Element {
  const t = useT()
  const name = asset.label?.trim() || t(`assetComponents.kind.${kind}`)
  const canRead = !interaction.disabled
  const canMutate = canPerformGenerationAction(interaction, 'edit')
  const locate = onLocateAsset ?? onLocate
  const hasLocate = Boolean(asset.resourceId && locate)
  const hasActions = Boolean(onInspect || onSelect || onApply || hasLocate)

  return (
    <GenerationPreviewFrame
      phase={phase}
      interaction={interaction}
      ariaLabel={ariaLabel ?? tf('generation.preview.inspect', { name })}
      className={className}
      showFooter={showFooter}
    >
      <div className="generation-preview-image-like" data-asset-kind={kind}>
        {asset.url ? (
          <img src={asset.url} alt={name} className="generation-preview-image-like__media" />
        ) : (
          <span
            className="generation-preview-image-like__placeholder"
            role="img"
            aria-label={tf('generation.preview.empty', { name })}
          >
            ◇
          </span>
        )}
        {hasActions ? <div className="generation-preview-image-like__actions">
          {onInspect ? (
            <button
              type="button"
              data-action="inspect"
              disabled={!canRead}
              aria-label={tf('generation.preview.inspect', { name })}
              onClick={() => onInspect(asset)}
            >
              {t('generation.history.inspect')}
            </button>
          ) : null}
          {onSelect ? (
            <button
              type="button"
              data-action="select"
              disabled={!canRead}
              aria-label={tf('generation.preview.select', { name })}
              onClick={() => onSelect(asset)}
            >
              {t('generation.history.selectResult')}
            </button>
          ) : null}
          {onApply ? (
            <button
              type="button"
              data-action="apply"
              disabled={!canMutate}
              aria-label={tf('generation.preview.apply', { name })}
              onClick={() => onApply(asset)}
            >
              {t('generation.preview.apply')}
            </button>
          ) : null}
          {hasLocate ? (
            <button
              type="button"
              data-action="locate"
              disabled={!canRead}
              aria-label={tf('generation.preview.locate', { name })}
              onClick={() => locate?.(asset.resourceId as string)}
            >
              {tf('generation.preview.locate', { name })}
            </button>
          ) : null}
        </div> : null}
      </div>
    </GenerationPreviewFrame>
  )
}
