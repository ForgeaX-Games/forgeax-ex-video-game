import { useT } from '../../../../i18n'
import {
  useResolvedGenerationInteraction,
  type GenerationInteractionProps,
} from './interaction'

export interface UploadedAsset {
  readonly id: string
  readonly label: string
  readonly url?: string
  readonly status?: 'uploading' | 'ready' | 'error'
  readonly error?: string
}

export interface UploadedAssetListProps extends GenerationInteractionProps {
  assets: readonly UploadedAsset[]
  onRemove?: (asset: UploadedAsset) => void
  uploading?: boolean
  error?: string | null
  disabled?: boolean
  readOnly?: boolean
}

/** Controlled list for assets returned by a caller-owned upload action. */
export function UploadedAssetList({
  assets,
  onRemove,
  uploading = false,
  error,
  disabled = false,
  readOnly = false,
  interaction,
}: UploadedAssetListProps): JSX.Element {
  const t = useT()
  const { state, can } = useResolvedGenerationInteraction(interaction)
  const removeDisabled = disabled || readOnly || uploading || state.disabled || state.readOnly || state.busy || !onRemove || !can('edit')
  return (
    <div className="uploaded-asset-list" aria-label={t('generation.upload.list')}>
      {error ? <p className="uploaded-asset-list-error" role="alert">{error}</p> : null}
      {uploading ? <p className="uploaded-asset-list-status" role="status">{t('generation.upload.uploading')}</p> : null}
      {assets.length === 0 ? <p className="uploaded-asset-empty">{t('generation.upload.empty')}</p> : null}
      {assets.map((asset) => (
        <article key={asset.id} className={`uploaded-asset uploaded-asset-${asset.status ?? 'ready'}`}>
          {asset.url ? <img src={asset.url} alt={asset.label} /> : <span className="uploaded-asset-placeholder" aria-hidden />}
          <span className="uploaded-asset-label">{asset.label}</span>
          {asset.error ? <span className="uploaded-asset-error" role="alert">{asset.error}</span> : null}
          <button
            type="button"
            aria-label={t('generation.upload.remove').replace('{name}', asset.label)}
            disabled={removeDisabled}
            onClick={() => onRemove?.(asset)}
          >
            ×
          </button>
        </article>
      ))}
    </div>
  )
}
