import { useId, type ChangeEvent, type ReactNode } from 'react'
import { useT } from '../../../../i18n'
import {
  useResolvedGenerationInteraction,
  type GenerationInteractionProps,
} from './interaction'

export type GenerationUploadAction = (files: readonly File[]) => void | Promise<void>

export interface GenerationUploadProps extends GenerationInteractionProps {
  onUpload?: GenerationUploadAction
  /** Alias for hosts that expose an existing upload action under `upload`. */
  upload?: GenerationUploadAction
  accept?: string
  multiple?: boolean
  uploading?: boolean
  error?: string | null
  disabled?: boolean
  readOnly?: boolean
  label?: string
  children?: ReactNode
}

/**
 * File-selection atom. It deliberately has no transport or registry import:
 * callers provide the already-authorized upload action.
 */
export function GenerationUpload({
  onUpload,
  upload,
  accept,
  multiple = false,
  uploading = false,
  error,
  disabled = false,
  readOnly = false,
  label,
  children,
  interaction,
}: GenerationUploadProps): JSX.Element {
  const t = useT()
  const id = useId()
  const { state } = useResolvedGenerationInteraction(interaction)
  const action = onUpload ?? upload
  const inert = disabled || readOnly || state.disabled || state.readOnly || state.busy || uploading || !action

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.currentTarget.files ?? [])]
    event.currentTarget.value = ''
    if (!files.length || inert || !action) return
    void action(files)
  }

  return (
    <div
      className="generation-upload"
      data-disabled={inert ? 'true' : undefined}
      data-uploading={uploading ? 'true' : undefined}
      data-error={error ? 'true' : undefined}
    >
      <label htmlFor={id} className="generation-upload-trigger">
        <span>{children ?? (uploading ? t('generation.upload.uploading') : t('generation.upload.select'))}</span>
        <input
          id={id}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={inert}
          aria-label={label ?? t('generation.upload.select')}
          onChange={onFileChange}
        />
      </label>
      {error ? <p className="generation-upload-error" role="alert">{error}</p> : null}
    </div>
  )
}

