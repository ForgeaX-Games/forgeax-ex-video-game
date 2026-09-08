import { t as translateUi } from '@/i18n'
/**
 * Shared notice when a bound video resource cannot be loaded for playback.
 */
export function MissingVideoNotice({
  resourceId,
  className,
}: {
  resourceId: string
  className?: string
}): JSX.Element {
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      data-testid="missing-video-notice"
    >
      <p>{translateUi('ui.copy.898b5d5e8362')}</p>
      <p>
        {translateUi('ui.copy.85484ede9b61')}<code>{resourceId}</code>
      </p>
      <p>{translateUi('ui.copy.830cb6f95c2f')}</p>
    </div>
  )
}
