import { useEffect, useId, useRef, useState } from 'react'
import { tf, useT } from '../../i18n'

/** Where a card menu was opened from, in viewport coordinates. */
export interface AssetCardAnchor {
  x: number
  y: number
}

export interface AssetCardActionsMenuProps {
  name: string
  anchor: AssetCardAnchor
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}

export function AssetCardActionsMenu({ name, anchor, onRename, onDelete, onClose }: AssetCardActionsMenuProps): JSX.Element {
  const t = useT()
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="acp-card-menu"
      role="menu"
      aria-label={tf('assetCatalog.openAssetActions', { name })}
      style={{ left: anchor.x, top: anchor.y }}
      data-testid="asset-card-menu"
    >
      <button type="button" role="menuitem" onClick={onRename}>{t('assetCatalog.cardActions.rename')}</button>
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}>{t('assetCatalog.cardActions.delete')}</button>
    </div>
  )
}

export interface AssetCardDialogProps {
  mode: 'rename' | 'delete'
  /** Folders and assets share the dialog but not their copy. */
  folder: boolean
  /** Entity-backed items are deleted without deleting their media assets. */
  preserveMedia: boolean
  name: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

export function AssetCardDialog({ mode, folder, preserveMedia, name, onSubmit, onClose }: AssetCardDialogProps): JSX.Element {
  const t = useT()
  const titleId = useId()
  const nameId = useId()
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) previousFocusRef.current = activeElement
    if (mode === 'rename') queueMicrotask(() => inputRef.current?.select())
    return () => previousFocusRef.current?.focus()
  }, [mode])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  const trimmed = draft.trim()
  const submit = async (): Promise<void> => {
    if (mode === 'rename' && !trimmed) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('assetCatalog.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'rename'
    ? t('assetCatalog.cardActions.renameTitle')
    : folder ? t('assetCatalog.cardActions.deleteFolderTitle') : t('assetCatalog.cardActions.deleteAssetTitle')
  const deleteMessageKey = folder
    ? preserveMedia ? 'assetCatalog.cardActions.deleteEntityFolderMessage' : 'assetCatalog.cardActions.deleteFolderMessage'
    : preserveMedia ? 'assetCatalog.cardActions.deleteEntityMessage' : 'assetCatalog.cardActions.deleteAssetMessage'
  // Split on the placeholder so the name keeps its own highlight instead of being interpolated flat.
  const [messageBefore, messageAfter] = t(deleteMessageKey).split('{name}')

  return (
    <div className="acp-dialog-backdrop" role="presentation">
      <section className="acp-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} data-testid="asset-card-dialog">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="acp-dialog-close" aria-label={t('assetCatalog.cardActions.close')} disabled={busy} onClick={onClose}>×</button>
        {mode === 'rename' ? (
          <>
            <label htmlFor={nameId}>{folder ? t('assetCatalog.cardActions.folderNameLabel') : t('assetCatalog.cardActions.assetNameLabel')}</label>
            <input
              ref={inputRef}
              id={nameId}
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }}
            />
          </>
        ) : (
          <p className="acp-dialog-message">{messageBefore}<strong>[{name}]</strong>{messageAfter}</p>
        )}
        {error ? <p className="acp-dialog-error" role="alert">{error}</p> : null}
        <div className="acp-dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="button"
            className={mode === 'rename' ? 'acp-primary' : 'acp-primary is-danger'}
            disabled={busy || (mode === 'rename' && !trimmed)}
            onClick={() => void submit()}
          >
            {busy ? t('common.processing') : mode === 'rename' ? t('assetCatalog.cardActions.confirm') : t('assetCatalog.cardActions.confirmDelete')}
          </button>
        </div>
      </section>
    </div>
  )
}
