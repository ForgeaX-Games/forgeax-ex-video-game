import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { KinoPromptContentItem } from '@/runtime/core/schema/kino-schema'
import { useT } from '../../../../i18n'
import {
  PromptMentionEditor,
  type PromptMentionAsset,
  type PromptMentionEditorHandle,
} from '../PromptMentionEditor'
import {
  useResolvedGenerationInteraction,
  type GenerationInteractionProps,
} from './interaction'

export interface GenerationPromptPolishResult {
  readonly prompt: string
  readonly content: readonly KinoPromptContentItem[]
}

export type GenerationPromptPolish = (
  prompt: string,
) => Promise<string | void> | string | void

const EMPTY_ASSETS: readonly PromptMentionAsset[] = []
const EMPTY_CONTENT: readonly KinoPromptContentItem[] = []

export interface GenerationPromptComposerProps extends GenerationInteractionProps {
  value: string
  assets?: readonly PromptMentionAsset[]
  content?: readonly KinoPromptContentItem[]
  onChange: (prompt: string, content: KinoPromptContentItem[]) => void
  onSubmit?: (prompt: string, content: KinoPromptContentItem[]) => void
  onCancel?: () => void
  /** Keep local observation cancellable while a prior durable task runs. */
  cancelWhileEditing?: boolean
  onClear?: () => void
  /** The host-owned prompt polishing action; no transport is created here. */
  polishPrompt?: GenerationPromptPolish
  onOpenStylePicker?: () => void
  selectedStyle?: { key: string, label: string } | null
  styleLabel?: string
  styleIcon?: ReactNode
  clearIcon?: ReactNode
  cancelIcon?: ReactNode
  submitIcon?: ReactNode
  polishSuffix?: ReactNode
  top?: ReactNode
  prefix?: ReactNode
  children?: ReactNode
  resetKey?: string | number
  id?: string
  placeholder?: string
  label?: string
  mentionLabel?: string
  mentionEmptyLabel?: string
  mentionPresentation?: 'menu' | 'dialog'
  mentionButtonLabel?: string
  submitLabel?: string
  cancelLabel?: string
  clearLabel?: string
  polishLabel?: string
  polishingLabel?: string
  submitDisabledReason?: string
}

/**
 * Controlled prompt editor shared by all generation surfaces.
 *
 * The prompt editor owns only the DOM selection/chips.  Prompt text and
 * structured content remain controlled by the caller, while top/children are
 * composition slots for surface-specific assets and actions.
 */
export function GenerationPromptComposer({
  value,
  assets = EMPTY_ASSETS,
  content = EMPTY_CONTENT,
  onChange,
  onSubmit,
  onCancel,
  cancelWhileEditing = false,
  onClear,
  polishPrompt,
  onOpenStylePicker,
  selectedStyle,
  styleLabel: explicitStyleLabel,
  styleIcon,
  clearIcon,
  cancelIcon,
  submitIcon,
  polishSuffix,
  top,
  prefix,
  children,
  resetKey,
  id,
  placeholder,
  label,
  mentionLabel,
  mentionEmptyLabel,
  mentionPresentation = 'menu',
  mentionButtonLabel,
  submitLabel,
  cancelLabel,
  clearLabel,
  polishLabel,
  polishingLabel,
  submitDisabledReason,
  interaction,
}: GenerationPromptComposerProps): JSX.Element {
  const t = useT()
  const editorRef = useRef<PromptMentionEditorHandle | null>(null)
  const lastEmittedValueRef = useRef(value)
  const valueRef = useRef(value)
  valueRef.current = value
  const [controlledResetKey, setControlledResetKey] = useState(0)
  const [isPolishing, setIsPolishing] = useState(false)
  const [polishError, setPolishError] = useState<string | null>(null)
  const polishRequestIdRef = useRef(0)
  const promptRevisionRef = useRef(0)
  const previousResetKeyRef = useRef(resetKey)
  const generatedEditorId = useId()
  const editorId = id ?? generatedEditorId
  const { state, can } = useResolvedGenerationInteraction(interaction)
  const editorDisabled = state.disabled || state.readOnly || state.busy
  const submitDisabled = !can('generate') || isPolishing || !value.trim()
  const cancelEnabled = can('cancel') || (cancelWhileEditing && !state.disabled && !state.readOnly)

  useEffect(() => {
    if (value === lastEmittedValueRef.current) return
    lastEmittedValueRef.current = value
    valueRef.current = value
    promptRevisionRef.current += 1
    setControlledResetKey((current) => current + 1)
  }, [value])

  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return
    previousResetKeyRef.current = resetKey
    promptRevisionRef.current += 1
    polishRequestIdRef.current += 1
    setIsPolishing(false)
  }, [resetKey])

  const handleChange = (prompt: string, content: KinoPromptContentItem[]): void => {
    lastEmittedValueRef.current = prompt
    valueRef.current = prompt
    promptRevisionRef.current += 1
    setPolishError(null)
    onChange(prompt, content)
  }

  const clear = (): void => {
    if (!can('edit')) return
    editorRef.current?.clear()
    onClear?.()
  }

  const submit = (): void => {
    if (!can('generate') || isPolishing || !value.trim()) return
    onSubmit?.(value, [...(content ?? [])])
  }

  const cancel = (): void => {
    if (!cancelEnabled) return
    onCancel?.()
  }

  const polish = async (): Promise<void> => {
    if (!polishPrompt || !can('edit') || isPolishing || !value.trim()) return
    const requestId = ++polishRequestIdRef.current
    const sourceRevision = promptRevisionRef.current
    const sourceValue = value
    setIsPolishing(true)
    setPolishError(null)
    try {
      const polished = await polishPrompt(sourceValue)
      if (
        polishRequestIdRef.current !== requestId
        || promptRevisionRef.current !== sourceRevision
        || valueRef.current !== sourceValue
      ) return
      if (typeof polished !== 'string' || polished === sourceValue) return
      if (!editorRef.current?.replacePrompt(polished)) {
        setPolishError(t('generation.prompt.polishFailed'))
      }
    } catch {
      if (
        polishRequestIdRef.current !== requestId
        || promptRevisionRef.current !== sourceRevision
        || valueRef.current !== sourceValue
      ) return
      setPolishError(t('generation.prompt.polishFailed'))
    } finally {
      if (polishRequestIdRef.current === requestId) setIsPolishing(false)
    }
  }

  const editorResetKey = `${typeof resetKey}:${String(resetKey)}:${controlledResetKey}`

  const defaultStyleLabel = explicitStyleLabel ?? t('generation.prompt.style')
  const styleLabel = selectedStyle
    ? `${defaultStyleLabel}: ${selectedStyle.label}`
    : defaultStyleLabel

  return (
    <section className="generation-prompt-composer" aria-label={label ?? t('generation.prompt.label')}>
      {top ? <div className="generation-prompt-top">{top}</div> : null}
      <div className="generation-prompt-body">
        {prefix ? <div className="generation-prompt-prefix">{prefix}</div> : null}
        <PromptMentionEditor
          ref={editorRef}
          id={editorId}
          assets={assets}
          initialValue={value}
          resetKey={editorResetKey}
          resetValue={value}
          placeholder={placeholder ?? t('generation.prompt.placeholder')}
          label={label ?? t('generation.prompt.label')}
          invalid={false}
          mentionLabel={mentionLabel ?? t('generation.prompt.mentionAssets')}
          emptyLabel={mentionEmptyLabel ?? t('generation.prompt.mentionEmpty')}
          presentation={mentionPresentation}
          disabled={editorDisabled}
          readOnly={state.readOnly}
          onChange={handleChange}
        />
        {polishError ? <p className="generation-prompt-error" role="alert">{polishError}</p> : null}
        <div className="generation-prompt-actions">
          <div className="generation-prompt-tools">
            <button
              type="button"
              className="generation-prompt-mention"
              aria-label={mentionButtonLabel ?? t('generation.prompt.mention')}
              disabled={!can('edit')}
              onClick={(event) => editorRef.current?.openMentions(event.currentTarget)}
            >
              @
            </button>
            <button
              type="button"
              className={`generation-prompt-style${selectedStyle ? ' has-style' : ''}`}
              aria-label={styleLabel}
              disabled={!onOpenStylePicker || !can('edit')}
              onClick={onOpenStylePicker}
            >
              <span>{styleLabel}</span>{styleIcon}
            </button>
            {children}
          </div>
          <div className="generation-prompt-submit-actions">
            {!state.busy && !cancelWhileEditing ? (
              <button type="button" className="generation-prompt-clear" disabled={!can('edit') || !value} aria-label={clearLabel ?? t('generation.prompt.clear')} onClick={clear}>
                {clearIcon ?? clearLabel ?? t('generation.prompt.clear')}
              </button>
            ) : null}
            {state.busy || cancelWhileEditing ? (
              <button type="button" className="generation-prompt-cancel" disabled={!cancelEnabled} aria-label={cancelLabel ?? t('generation.prompt.cancel')} onClick={cancel}>
                {cancelIcon ?? cancelLabel ?? t('generation.prompt.cancel')}
              </button>
            ) : null}
            {polishPrompt ? (
              <button type="button" className="generation-prompt-polish" disabled={!can('edit') || isPolishing || !value.trim()} onClick={() => { void polish() }}>
                <span>{isPolishing ? polishingLabel ?? t('generation.prompt.polishing') : polishLabel ?? t('generation.prompt.polish')}</span>{polishSuffix}
              </button>
            ) : null}
            {submitDisabled && submitDisabledReason ? (
              <span title={submitDisabledReason}>
                <button type="button" className="generation-prompt-submit" disabled aria-label={submitLabel ?? t('generation.prompt.submit')} onClick={submit}>
                  {submitIcon ?? submitLabel ?? t('generation.prompt.submit')}
                </button>
              </span>
            ) : (
              <button type="button" className="generation-prompt-submit" disabled={submitDisabled} aria-label={submitLabel ?? t('generation.prompt.submit')} onClick={submit}>
                {submitIcon ?? submitLabel ?? t('generation.prompt.submit')}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
