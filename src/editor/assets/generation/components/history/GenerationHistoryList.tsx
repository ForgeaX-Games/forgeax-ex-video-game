import { useT } from '../../../../../i18n'
import type { GenerationInteractionState } from '../types'
import { GenerationHistoryItem } from './GenerationHistoryItem'
import type {
  GenerationHistoryListProps,
} from './types'

const DEFAULT_INTERACTION: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

/** Controlled history list: selection and restoration remain parent-owned. */
export function GenerationHistoryList({
  items,
  ariaLabel,
  loading = false,
  emptyLabel,
  selectedGenerationId,
  presentation,
  onActivate,
  interaction,
  disabled = false,
  readOnly = false,
  onInspect,
  onSelectResult,
  onRestoreSettings,
  onReuseSettings,
  className,
}: GenerationHistoryListProps): React.JSX.Element {
  const t = useT()
  const resolvedInteraction: GenerationInteractionState = {
    ...DEFAULT_INTERACTION,
    ...interaction,
    disabled: Boolean(interaction?.disabled || disabled),
    readOnly: Boolean(interaction?.readOnly || readOnly),
  }

  return (
    <section
      className={`generation-history-list${className ? ` ${className}` : ''}${resolvedInteraction.disabled ? ' is-disabled' : ''}${resolvedInteraction.readOnly ? ' is-read-only' : ''}`}
      aria-label={ariaLabel ?? t('imageGeneration.history')}
      aria-busy={loading}
      data-disabled={resolvedInteraction.disabled || undefined}
      data-read-only={resolvedInteraction.readOnly || undefined}
    >
      {loading ? <p className="generation-history-list__loading">{t('imageGeneration.loadingHistory')}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="generation-history-list__empty">{emptyLabel ?? t('generation.history.empty')}</p>
      ) : null}
      {!loading && items.length > 0 ? (
        <div className="generation-history-list__items" role="list">
          {items.map((item) => (
            <GenerationHistoryItem
              key={item.generationId}
              item={item}
              selected={item.generationId === selectedGenerationId}
              presentation={presentation}
              onActivate={onActivate}
              interaction={resolvedInteraction}
              onInspect={onInspect}
              onSelectResult={onSelectResult}
              onRestoreSettings={onRestoreSettings}
              onReuseSettings={onReuseSettings}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
