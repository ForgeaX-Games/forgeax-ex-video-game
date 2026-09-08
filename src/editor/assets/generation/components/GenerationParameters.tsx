import { useId, type ReactNode } from 'react'
import {
  useResolvedGenerationInteraction,
  type GenerationInteractionProps,
} from './interaction'

export interface GenerationParameterOption<T extends string | number = string> {
  readonly value: T
  readonly label: string
  readonly description?: string
}

export interface GenerationParametersLayoutProps extends GenerationInteractionProps {
  title: string
  children: ReactNode
  className?: string
}

/** Shared, provider-aware layout used by every generation parameter atom. */
export function GenerationParametersLayout({
  title,
  children,
  className,
  interaction,
}: GenerationParametersLayoutProps): JSX.Element {
  const { state } = useResolvedGenerationInteraction(interaction)
  return (
    <section
      className={`generation-parameters${className ? ` ${className}` : ''}`}
      aria-label={title}
      data-disabled={state.disabled ? 'true' : undefined}
      data-read-only={state.readOnly ? 'true' : undefined}
      data-busy={state.busy ? 'true' : undefined}
    >
      <h3 className="generation-parameters-title">{title}</h3>
      <div className="generation-parameters-fields">{children}</div>
    </section>
  )
}

export interface GenerationParameterFieldProps extends GenerationInteractionProps {
  label: string
  description?: string
  children: ReactNode
  className?: string
}

export function GenerationParameterField({
  label,
  description,
  children,
  className,
  interaction,
}: GenerationParameterFieldProps): JSX.Element {
  const { state } = useResolvedGenerationInteraction(interaction)
  return (
    <div className={`generation-parameter-field${className ? ` ${className}` : ''}`}>
      <div className="generation-parameter-label">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </div>
      <div className="generation-parameter-control" data-disabled={state.disabled || state.readOnly || state.busy ? 'true' : undefined}>
        {children}
      </div>
    </div>
  )
}

export interface GenerationSelectFieldProps<T extends string | number = string> extends GenerationInteractionProps {
  label: string
  value: T | undefined
  options: readonly GenerationParameterOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  id?: string
  className?: string
  disabled?: boolean
}

export function GenerationSelectField<T extends string | number = string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  id,
  className,
  disabled: explicitlyDisabled = false,
  interaction,
}: GenerationSelectFieldProps<T>): JSX.Element {
  const generatedId = useId()
  const { state } = useResolvedGenerationInteraction(interaction)
  const disabled = explicitlyDisabled || state.disabled || state.readOnly || state.busy
  return (
    <label className={`generation-select-field${className ? ` ${className}` : ''}`} htmlFor={id ?? generatedId}>
      <span className="generation-visually-hidden">{label}</span>
      <select
        id={id ?? generatedId}
        aria-label={label}
        value={value === undefined ? '' : String(value)}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find((option) => String(option.value) === event.target.value)
          if (next) onChange(next.value)
        }}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export interface GenerationOptionGroupProps<T extends string | number = string> extends GenerationInteractionProps {
  label: string
  value: T | undefined
  options: readonly GenerationParameterOption<T>[]
  onChange: (value: T) => void
  className?: string
}

export function GenerationOptionGroup<T extends string | number = string>({
  label,
  value,
  options,
  onChange,
  className,
  interaction,
}: GenerationOptionGroupProps<T>): JSX.Element {
  const { state } = useResolvedGenerationInteraction(interaction)
  const disabled = state.disabled || state.readOnly || state.busy
  return (
    <div className={`generation-option-group${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            className={selected ? 'is-selected' : undefined}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {option.description ? <small>{option.description}</small> : null}
          </button>
        )
      })}
    </div>
  )
}

export interface GenerationRangeFieldProps extends GenerationInteractionProps {
  label: string
  value: number | undefined
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  className?: string
}

export function GenerationRangeField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  interaction,
}: GenerationRangeFieldProps): JSX.Element {
  const generatedId = useId()
  const { state } = useResolvedGenerationInteraction(interaction)
  const disabled = state.disabled || state.readOnly || state.busy
  const resolved = value ?? min
  return (
    <div className={`generation-range-field${className ? ` ${className}` : ''}`}>
      <label htmlFor={generatedId}>{label}</label>
      <output htmlFor={generatedId}>{resolved}</output>
      <input
        id={generatedId}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={resolved}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export interface GenerationToggleFieldProps extends GenerationInteractionProps {
  label: string
  checked: boolean | undefined
  onChange: (checked: boolean) => void
  description?: string
  className?: string
}

export function GenerationToggleField({
  label,
  checked = false,
  onChange,
  description,
  className,
  interaction,
}: GenerationToggleFieldProps): JSX.Element {
  const generatedId = useId()
  const { state } = useResolvedGenerationInteraction(interaction)
  const disabled = state.disabled || state.readOnly || state.busy
  return (
    <label className={`generation-toggle-field${className ? ` ${className}` : ''}`} htmlFor={generatedId}>
      <input
        id={generatedId}
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
      {description ? <small>{description}</small> : null}
    </label>
  )
}
