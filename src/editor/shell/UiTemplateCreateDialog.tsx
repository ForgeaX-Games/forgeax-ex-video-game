import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { t as translateUi } from '../../i18n'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import ruleDialogCloseIcon from './rule-dialog-close.svg?url'

const UI_TEMPLATE_CREATE_DIALOG_CSS = `
.uit-create-dialog-backdrop {
  position:fixed; z-index:1100; inset:0; display:grid; place-items:center;
  padding:16px; background:rgba(0,0,0,.55);
}
.uit-create-dialog {
  position:relative; box-sizing:border-box; display:flex; flex-direction:column;
  justify-content:space-between; width:min(450px,100%); min-height:300px;
  padding:40px; border:1px solid rgba(255,255,255,.2); border-radius:16px;
  background:#141414; color:#fff;
}
.uit-create-dialog h2 {
  margin:0; text-align:center; font:400 24px/36px "PingFang SC",sans-serif;
}
.uit-create-dialog-field {
  display:grid; gap:8px; margin-top:16px;
  color:#fff; font:400 16px/24px "PingFang SC",sans-serif;
}
.uit-create-dialog-field input {
  box-sizing:border-box; width:100%; height:40px; padding:0 16px;
  border:1px solid rgba(255,255,255,.6); border-radius:8px; outline:0;
  background:transparent; color:#fff; font:400 14px/21px "PingFang SC",sans-serif;
}
.uit-create-dialog-field input::placeholder { color:rgba(255,255,255,.4); }
.uit-create-dialog-close {
  position:absolute; top:23px; right:25px; display:grid; width:24px; height:24px;
  place-items:center; padding:0; border:0; background:transparent; cursor:pointer;
}
.uit-create-dialog-close img {
  display:block; width:20px; height:20px; transform:rotate(-45deg);
}
.uit-create-dialog-actions {
  display:flex; justify-content:center; gap:16px; margin-top:32px;
}
.uit-create-dialog-actions button {
  display:flex; box-sizing:border-box; width:120px; height:32px;
  align-items:center; justify-content:center; padding:1px 28px; border:0;
  border-radius:8px; background:#fff; color:#000;
  font:400 16px/24px "PingFang SC",sans-serif; cursor:pointer;
}
.uit-create-dialog-actions button.is-primary {
  background:linear-gradient(90deg,#ff7001,#ff9c2a);
}
.uit-create-dialog-actions button[aria-disabled="true"] {
  cursor:not-allowed; opacity:.4;
}
`

export function UiTemplateCreateDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (name: string) => void
}): JSX.Element {
  injectStyleOnce('ui-template-create-dialog', UI_TEMPLATE_CREATE_DIALOG_CSS)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const submit = (): void => {
    const next = name.trim()
    if (next) onConfirm(next)
  }

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return createPortal(
    <div className="uit-create-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="uit-create-dialog" role="dialog" aria-modal="true" aria-labelledby="uit-create-dialog-title">
        <button type="button" className="uit-create-dialog-close" aria-label={translateUi('ui.copy.6c14bd7f6f9e')} onClick={onClose}>
          <img src={ruleDialogCloseIcon} alt="" />
        </button>
        <h2 id="uit-create-dialog-title">{translateUi('componentLibrary.templates.dialogTitle')}</h2>
        <label className="uit-create-dialog-field">
          <span>{translateUi('componentLibrary.templates.name')}</span>
          <input
            ref={inputRef}
            aria-label={translateUi('componentLibrary.templates.name')}
            placeholder={translateUi('componentLibrary.templates.placeholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>
        <div className="uit-create-dialog-actions">
          <button type="button" onClick={onClose}>{translateUi('ui.copy.4d0b4688c787')}</button>
          <button type="button" className="is-primary" aria-disabled={!name.trim()} onClick={submit}>{translateUi('ui.copy.b56d9ac6c5a0')}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
