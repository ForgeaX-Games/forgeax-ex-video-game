import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'
import { useT } from '../../../../../i18n'

type SurfaceSlotProps = HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  ariaLabel?: string
}

function slotClassName(base: string, className?: string): string {
  return [base, className].filter(Boolean).join(' ')
}

function SurfaceSlot({
  className,
  children,
  ariaLabel,
  as,
  ...props
}: SurfaceSlotProps & { as?: 'section' | 'aside' | 'div' }): React.JSX.Element {
  const Tag = as ?? 'section'
  return <Tag className={className} aria-label={ariaLabel} {...props}>{children}</Tag>
}

export type GenerationSurfaceSlotProps = SurfaceSlotProps

export interface GenerationSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

export interface GenerationSurfaceComponent {
  (props: GenerationSurfaceProps): React.JSX.Element
  Parameters: typeof GenerationSurfaceParameters
  Preview: typeof GenerationSurfacePreview
  Composer: typeof GenerationSurfaceComposer
  History: typeof GenerationSurfaceHistory
  Upload: typeof GenerationSurfaceUpload
}

/**
 * A deliberately small compound surface.  It owns no generation state; the
 * parent decides which slots are present and how they interact.
 */
export const GenerationSurface = forwardRef<HTMLDivElement, GenerationSurfaceProps>(function GenerationSurface(
  { className, children, ...props },
  ref,
): React.JSX.Element {
  return <div ref={ref} className={slotClassName('generation-surface', className)} {...props}>{children}</div>
}) as unknown as GenerationSurfaceComponent

export function GenerationSurfaceParameters(props: GenerationSurfaceSlotProps): React.JSX.Element {
  return <SurfaceSlot {...props} className={slotClassName('generation-surface__parameters', props.className)} as="aside" />
}

export function GenerationSurfacePreview(props: GenerationSurfaceSlotProps): React.JSX.Element {
  return <SurfaceSlot {...props} className={slotClassName('generation-surface__preview', props.className)} />
}

export function GenerationSurfaceComposer(props: GenerationSurfaceSlotProps): React.JSX.Element {
  return <SurfaceSlot {...props} className={slotClassName('generation-surface__composer', props.className)} />
}

export function GenerationSurfaceHistory(props: GenerationSurfaceSlotProps): React.JSX.Element {
  return <SurfaceSlot {...props} className={slotClassName('generation-surface__history', props.className)} />
}

export function GenerationSurfaceUpload(props: GenerationSurfaceSlotProps): React.JSX.Element {
  return <SurfaceSlot {...props} className={slotClassName('generation-surface__upload', props.className)} />
}

GenerationSurface.Parameters = GenerationSurfaceParameters
GenerationSurface.Preview = GenerationSurfacePreview
GenerationSurface.Composer = GenerationSurfaceComposer
GenerationSurface.History = GenerationSurfaceHistory
GenerationSurface.Upload = GenerationSurfaceUpload

export interface GenerationPageLayoutProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode
  header?: ReactNode
  parameters?: ReactNode
  preview?: ReactNode
  composer?: ReactNode
  history?: ReactNode
  upload?: ReactNode
}

/** Explicit page layout; callers choose slots instead of a boolean variant. */
export function GenerationPageLayout({
  className,
  children,
  header,
  parameters,
  preview,
  composer,
  history,
  upload,
  ...props
}: GenerationPageLayoutProps): React.JSX.Element {
  const content = children ?? (
    <>
      {header ? <header className="generation-page-layout__header">{header}</header> : null}
      <GenerationSurface>
        {parameters ? <GenerationSurface.Parameters>{parameters}</GenerationSurface.Parameters> : null}
        {preview ? <GenerationSurface.Preview>{preview}</GenerationSurface.Preview> : null}
        {history ? <GenerationSurface.History>{history}</GenerationSurface.History> : null}
        {composer ? <GenerationSurface.Composer>{composer}</GenerationSurface.Composer> : null}
        {upload ? <GenerationSurface.Upload>{upload}</GenerationSurface.Upload> : null}
      </GenerationSurface>
    </>
  )
  return <main className={slotClassName('generation-page-layout', className)} {...props}>{content}</main>
}

export interface GenerationDialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  title: ReactNode
  children?: ReactNode
  loading?: boolean
  onClose: () => void
  closeLabel?: string
  labelledBy?: string
  initialFocusRef?: RefObject<HTMLElement | null>
  panelClassName?: string
  /** Child layers (pickers/style sheets) own dismissal while this is true. */
  dismissBlocked?: boolean
}

/** Accessible dialog shell used by independently mounted generation surfaces. */
export function GenerationDialog({
  open,
  title,
  children,
  loading = false,
  onClose,
  closeLabel,
  labelledBy,
  initialFocusRef,
  panelClassName,
  dismissBlocked = false,
  className,
  ...props
}: GenerationDialogProps): React.JSX.Element | null {
  const t = useT()
  const generatedTitleId = useId()
  const titleId = labelledBy ?? generatedTitleId
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dismissBlockedRef = useRef(dismissBlocked)
  dismissBlockedRef.current = dismissBlocked

  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusTarget = initialFocusRef?.current
      ?? dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    focusTarget?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !dismissBlockedRef.current) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus()
      restoreFocusRef.current = null
    }
  }, [initialFocusRef, onClose, open])

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hasAttribute('hidden'))
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!open) return null
  return (
    <div className={slotClassName('generation-dialog', className)} {...props}>
      <div className="generation-dialog__backdrop" role="presentation" onClick={() => { if (!dismissBlocked) onClose() }} />
      <div ref={dialogRef} className={slotClassName('generation-dialog__panel', panelClassName)} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={loading} onKeyDown={trapFocus}>
        <header className="generation-dialog__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label={closeLabel ?? t('generation.surface.close')} aria-disabled={dismissBlocked || undefined} onClick={() => { if (!dismissBlocked) onClose() }}>×</button>
        </header>
        {loading ? <p className="generation-dialog__loading" role="status">{t('generation.surface.loading')}</p> : children}
      </div>
    </div>
  )
}
