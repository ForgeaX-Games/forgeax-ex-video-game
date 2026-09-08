/**
 * 通用单列下拉：外观与 CascadingPicker 一致，选项为扁平列表（无多级分支）。
 */
import { useMemo, type JSX } from 'react'
import {
  CascadingPicker,
  type CascadingPickerOpenChangeDetail,
  type CascadingPickerOption,
  type CascadingPickerVariant,
} from './CascadingPicker'

export interface SelectDropdownOption {
  value: string
  label: string
  disabled?: boolean
}

export function SelectDropdown({
  ariaLabel,
  value,
  options,
  placeholder = '请选择…',
  onChange,
  narrowSafe = true,
  variant = 'field',
  disabled = false,
  onOpenChange,
}: {
  ariaLabel: string
  value: string
  options: readonly SelectDropdownOption[]
  placeholder?: string
  onChange: (value: string) => void
  narrowSafe?: boolean
  variant?: CascadingPickerVariant
  disabled?: boolean
  onOpenChange?: (open: boolean, detail: CascadingPickerOpenChangeDetail) => void
}): JSX.Element {
  const selected = options.find((option) => option.value === value)
  const pickerOptions = useMemo<CascadingPickerOption[]>(() => options.map((option) => ({
    key: option.value || `__empty:${option.label}`,
    label: option.label,
    value: option.value,
    disabled: option.disabled,
  })), [options])
  return (
    <CascadingPicker
      ariaLabel={ariaLabel}
      value={value}
      displayValue={selected?.label ?? ''}
      placeholder={placeholder}
      options={pickerOptions}
      onSelect={onChange}
      narrowSafe={narrowSafe}
      fitContent
      variant={variant}
      disabled={disabled}
      onOpenChange={onOpenChange}
    />
  )
}
