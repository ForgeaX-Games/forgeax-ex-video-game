/**
 * 文字交互（component id: `TextOption`）。
 * 文案/按键由 RuntimeComponentHost 以扁平 props 传入；此处只展示与交互。
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { injectCss, resolveTextAppearance, type TextAppearanceInputs } from './skinRuntime'

export { TextOptionManifest } from '@/runtime/core/component-catalog/TextOption.manifest'

export interface TextOptionProps {
  text?: string
  color?: string
  fontSize?: number
  triggerKey?: string
  emit?: (key: string) => void
  preview?: boolean
}

export function TextOption({
  text = '摁F交互',
  color,
  fontSize,
  triggerKey: triggerKeyInput = 'F',
  emit,
  preview,
}: TextOptionProps): ReactNode {
  injectCss('text-option', TEXT_OPTION_CSS)
  const activatedRef = useRef(false)
  const triggerKey = triggerKeyInput.trim() || 'F'
  const textStyle = resolveTextAppearance({ color, fontSize } as TextAppearanceInputs, { color: '#f0f0f0', fontSize: 2.4 })

  function activate(): void {
    if (preview || activatedRef.current) return
    activatedRef.current = true
    emit?.('activate')
  }

  useEffect(() => {
    if (preview) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.key.localeCompare(triggerKey, undefined, { sensitivity: 'accent' }) !== 0) return
      event.preventDefault()
      activate()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [emit, preview, triggerKey])

  return (
    <div className="gv-text-option">
      <button
        type="button"
        className="gv-text-option-button"
        aria-label={`${triggerKey} ${text}`}
        data-overlay-fit-target
        disabled={preview}
        onClick={activate}
        style={textStyle}
      >
        <span className="gv-text-option-key" aria-hidden="true">{triggerKey}</span>
        <span>{text}</span>
      </button>
    </div>
  )
}

const TEXT_OPTION_CSS = `
.gv-text-option{position:relative;inline-size:100%;block-size:100%;display:flex;align-items:center;justify-content:center;pointer-events:none}
.gv-text-option-button{display:inline-flex;align-items:center;justify-content:center;gap:.35em;border:0;background:transparent;padding:0;cursor:pointer;font:inherit;font-size:var(--gv-text-font-size,2.4cqh);font-weight:700;line-height:1.5;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.7);pointer-events:auto}
.gv-text-option-key{font-family:system-ui,sans-serif;font-size:.86em;font-weight:500;letter-spacing:0}
.gv-text-option-button:hover:not(:disabled){filter:brightness(1.2)}
.gv-text-option-button:focus-visible{outline:1px solid currentColor;outline-offset:4px}
.gv-text-option-button:disabled{cursor:default}
`
