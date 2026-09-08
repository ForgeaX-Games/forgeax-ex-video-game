import type { ReactNode } from 'react'
import { useT } from '../../../../../i18n'
import {
  isGenerationBusyPhase,
  type GenerationInteractionState,
  type GenerationPhase,
} from '../types'

export interface GenerationPreviewFrameProps {
  /** The generation lifecycle state shown by the frame. */
  phase?: GenerationPhase
  /** Interaction state is owned by the parent surface, never inferred from children. */
  interaction?: GenerationInteractionState
  /** Optional semantic label for the preview region. */
  ariaLabel?: string
  /** Optional title displayed above the preview content. */
  title?: ReactNode
  /** A translated status label supplied by the caller when a product-specific label is needed. */
  statusLabel?: ReactNode
  /** Rendered generation error. The frame only lays it out; it does not interpret errors. */
  error?: ReactNode
  /** Result surfaces can hide status chrome when the media itself is already visible. */
  showFooter?: boolean
  /** Empty-state content supplied by the concrete preview. */
  empty?: ReactNode
  className?: string
  children?: ReactNode
}

const DEFAULT_INTERACTION: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

/**
 * Shared preview chrome. It deliberately owns state attributes, status and layout only;
 * media controls and result actions belong to the concrete preview atoms.
 */
export function GenerationPreviewFrame({
  phase = 'idle',
  interaction = DEFAULT_INTERACTION,
  ariaLabel,
  title,
  statusLabel,
  error,
  showFooter = true,
  empty,
  className,
  children,
}: GenerationPreviewFrameProps): React.JSX.Element {
  const t = useT()
  const busy = interaction.busy || isGenerationBusyPhase(phase)
  const resolvedStatus = statusLabel ?? t(statusKey(phase))
  const showStatusFooter = showFooter
    && (error !== undefined || (phase !== 'submitting' && phase !== 'generating' && phase !== 'succeeded'))
  const resolvedClassName = [
    'generation-preview-frame',
    `is-${phase}`,
    interaction.disabled ? 'is-disabled' : '',
    interaction.readOnly ? 'is-read-only' : '',
    busy ? 'is-busy' : '',
    className ?? '',
  ].filter(Boolean).join(' ')

  return (
    <section
      className={resolvedClassName}
      aria-label={ariaLabel}
      aria-busy={busy}
      aria-disabled={interaction.disabled || undefined}
      data-phase={phase}
      data-disabled={interaction.disabled || undefined}
      data-read-only={interaction.readOnly || undefined}
    >
      {title !== undefined ? <header className="generation-preview-frame__header">{title}</header> : null}
      <div className="generation-preview-frame__stage">
        {children ?? <div className="generation-preview-frame__empty">{empty}</div>}
      </div>
      {showStatusFooter ? <footer className="generation-preview-frame__footer">
          <span className="generation-preview-frame__status" role="status">{resolvedStatus}</span>
          {error !== undefined ? <div className="generation-preview-frame__error" role="alert">{error}</div> : null}
        </footer> : null}
    </section>
  )
}

function statusKey(phase: GenerationPhase): string {
  switch (phase) {
    case 'submitting': return 'imageGeneration.status.submitting'
    case 'generating': return 'imageGeneration.status.polling'
    case 'succeeded': return 'imageGeneration.status.succeeded'
    case 'failed': return 'imageGeneration.status.failed'
    case 'cancelled': return 'imageGeneration.status.cancelled'
    case 'idle': return 'imageGeneration.status.idle'
  }
}
