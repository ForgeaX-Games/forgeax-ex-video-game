import { tf, useT } from '../../../../../i18n'
import { canPerformGenerationAction, type GenerationInteractionState } from '../types'
import type {
  GenerationHistoryItemData,
  GenerationHistoryItemProps,
} from './types'
import { revealFirstVideoFrame } from '@/editor/video/revealFirstVideoFrame'

const DEFAULT_INTERACTION: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

export function GenerationHistoryItem({
  item,
  selected = false,
  presentation = 'details',
  onActivate,
  interaction,
  disabled = false,
  readOnly = false,
  onInspect,
  onSelectResult,
  onRestoreSettings,
  onReuseSettings,
}: GenerationHistoryItemProps): React.JSX.Element {
  const t = useT()
  const state: GenerationInteractionState = {
    ...DEFAULT_INTERACTION,
    ...interaction,
    disabled: Boolean(interaction?.disabled || disabled),
    readOnly: Boolean(interaction?.readOnly || readOnly),
  }
  const canRead = !state.disabled
  const canRestore = canPerformGenerationAction(state, 'edit')
  const name = item.label?.trim() || item.prompt?.trim() || t(
    item.media === 'video' ? 'assetComponents.kind.video' : 'imageGeneration.generatedImage',
  )
  // Selecting a history result navigates the host registry, so a provider
  // result without a registry identity must remain non-actionable.  In
  // particular, `resourceId` is a Kino id and is never a valid fallback.
  const hasResult = Boolean(item.result && item.id)
  const restoreTitle = state.readOnly ? t('generation.history.readOnly') : undefined

  if (presentation === 'cover') {
    return (
      <article
        className={`generation-history-item is-cover${selected ? ' is-selected' : ''}${state.disabled ? ' is-disabled' : ''}`}
        role="listitem"
        aria-selected={selected}
        data-generation-id={item.generationId}
        data-source={item.source}
        data-media={item.media}
      >
        <button
          type="button"
          className="generation-history-item__cover"
          aria-label={tf('generation.preview.inspect', { name })}
          disabled={!canRead}
          onClick={() => onActivate?.(item)}
        >
          <span className="generation-history-item__preview">
            {item.resultUrl ? (
              item.media === 'video'
                ? <video src={item.resultUrl} preload="metadata" aria-hidden onLoadedMetadata={(event) => revealFirstVideoFrame(event.currentTarget)} />
                : <img src={item.resultUrl} alt="" />
            ) : (
              <span role="img" aria-label={tf('generation.preview.empty', { name })}>◇</span>
            )}
          </span>
        </button>
      </article>
    )
  }

  return (
    <article
      className={`generation-history-item${selected ? ' is-selected' : ''}${state.disabled ? ' is-disabled' : ''}${state.readOnly ? ' is-read-only' : ''}`}
      role="listitem"
      aria-selected={selected}
      data-generation-id={item.generationId}
      data-source={item.source}
      data-media={item.media}
    >
      <div className="generation-history-item__preview">
        {item.resultUrl ? (
          item.media === 'video'
            ? <video src={item.resultUrl} preload="metadata" aria-label={name} onLoadedMetadata={(event) => revealFirstVideoFrame(event.currentTarget)} />
            : <img src={item.resultUrl} alt={name} />
        ) : (
          <span role="img" aria-label={tf('generation.preview.empty', { name })}>◇</span>
        )}
      </div>
      <div className="generation-history-item__content">
        <strong>{name}</strong>
        {item.prompt && item.prompt !== name ? <p>{item.prompt}</p> : null}
        <span className="generation-history-item__status">{statusLabel(item, t)}</span>
      </div>
      <div className="generation-history-item__actions">
        {onInspect ? (
          <button
            type="button"
            data-action="inspect"
            disabled={!canRead}
            aria-label={tf('generation.preview.inspect', { name })}
            onClick={() => onInspect(item)}
          >
            {t('generation.history.inspect')}
          </button>
        ) : null}
        {onSelectResult ? (
          <button
            type="button"
            data-action="select-result"
            disabled={!canRead || !hasResult}
            aria-label={t('generation.history.selectResult')}
            onClick={() => onSelectResult(item)}
          >
            {t('generation.history.selectResult')}
          </button>
        ) : null}
        {item.restorePayload && onRestoreSettings ? (
          <button
            type="button"
            data-action="restore-settings"
            disabled={!canRestore}
            title={restoreTitle}
            aria-label={t('generation.history.restoreSettings')}
            onClick={() => onRestoreSettings(item.restorePayload as NonNullable<GenerationHistoryItemData['restorePayload']>, item)}
          >
            {t('generation.history.restoreSettings')}
          </button>
        ) : null}
        {item.restorePayload && onReuseSettings ? (
          <button
            type="button"
            data-action="reuse-settings"
            disabled={!canRestore}
            title={restoreTitle}
            aria-label={t('generation.history.reuseSettings')}
            onClick={() => onReuseSettings(item.restorePayload as NonNullable<GenerationHistoryItemData['restorePayload']>, item)}
          >
            {t('generation.history.reuseSettings')}
          </button>
        ) : null}
      </div>
    </article>
  )
}

function statusLabel(item: GenerationHistoryItemData, t: (key: string) => string): string {
  if (item.media === 'image') {
    return t(`imageGeneration.status.${item.status}`)
  }
  switch (item.status) {
    case 'pending':
    case 'submitting':
    case 'polling':
      return t('videoAssets.generate.statusRunning')
    case 'succeeded':
      return t('videoAssets.generate.statusDone')
    case 'failed':
    case 'cancelled':
      return t('videoAssets.generate.statusFailed')
  }
}
