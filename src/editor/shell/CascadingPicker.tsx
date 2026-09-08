import { t as translateUi } from '../../i18n'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
} from 'react'
import { createPortal } from 'react-dom'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import formulaToolbarAddIcon from '../ui-assets/formula-toolbar-add.svg'

export type CascadingPickerVariant = 'field' | 'toolbar'
export type CascadingPickerOpenChangeReason = 'trigger' | 'select' | 'escape' | 'outside-pointer'

export interface CascadingPickerOpenChangeDetail {
  reason: CascadingPickerOpenChangeReason
  target: EventTarget | null
}

export interface CascadingPickerOption {
  key: string
  label: string
  /** 选项右侧的辅助信息；限制在当前列内显示，悬浮选项可查看完整内容。 */
  secondaryText?: string
  /** 创建入口的短文案；省略时从“配置「…」实体/属性/变量/公式”末尾推导。 */
  createLabel?: string
  value?: string
  children?: CascadingPickerOption[]
  disabled?: boolean
  /** 父级展开时自动继续展开此分支；同级最多设置一个。 */
  defaultOpen?: boolean
  presentation?: 'detail' | 'create' | 'agent' | 'confirm'
  editor?: {
    value: string
    ariaLabel: string
    onChange: (value: string) => void
    inputMode?: 'text' | 'decimal'
    placeholder?: string
    pattern?: string
    invalid?: boolean
    multiline?: boolean
    error?: string
  }
}

const HIDDEN_PANEL_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  visibility: 'hidden',
}

const CASCADING_PICKER_CSS = `
.gc-cascade-root { position: relative; display: flex; flex: 1; min-width: 0; }
.gc-cascade-root.is-toolbar { display:inline-flex; flex:0 0 auto; width:auto; }
.gc-cascade-trigger {
  box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; min-width: 180px; min-height: 28px; padding: 4px 8px;
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-background-base, #191919);
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.gc-cascade-root.is-narrow-safe .gc-cascade-trigger { min-width: 0; }
.gc-cascade-root.is-toolbar .gc-cascade-trigger {
  width:auto; min-width:0; min-height:28px; height:28px; padding:2px 8px;
  gap:6px; border:0; border-radius:6px;
  background:rgba(26,26,26,.4); color:#fff; font:400 16px/24px "PingFang SC",sans-serif;
  white-space:nowrap;
}
.gc-cascade-trigger-add {
  display:inline-flex; align-items:center; justify-content:center;
  flex:0 0 18px; width:18px; height:18px;
}
.gc-cascade-trigger-add > img { display:block; width:13.5px; height:13.5px; }
.gc-cascade-root.is-toolbar .gc-cascade-trigger-arrow {
  display:none;
}
.gc-cascade-root.is-toolbar .gc-cascade-trigger-label {
  display:inline-flex; align-items:center; height:24px; line-height:24px; transform:translateY(-1px);
}
.gc-cascade-root.is-toolbar .gc-cascade-trigger-label.is-placeholder { opacity:1; }
.gc-cascade-trigger:disabled { opacity:.42; cursor:default; }
.gc-cascade-trigger:hover:not(:disabled), .gc-cascade-trigger[aria-expanded="true"] {
  border-color: rgb(255, 156, 42);
}
.gc-cascade-trigger-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gc-cascade-trigger-label.is-placeholder { opacity: .45; }
.gc-cascade-trigger-arrow {
  display: block;
  flex: none;
  width: 12px;
  height: 8px;
  margin: 0 2px 0 4px;
  color: inherit;
  opacity: .65;
  transform-origin: 50% 50%;
  transition: transform 140ms ease;
}
.gc-cascade-trigger[aria-expanded="true"] .gc-cascade-trigger-arrow { transform: rotateX(180deg); }
.gc-cascade-panel {
  z-index: var(--z-top, 9999); box-sizing: border-box; display: block;
  width: max-content; max-width: calc(100vw - 16px);
  overflow-x: auto; overflow-y: hidden;
  border: 1px solid var(--color-border-default, #404040);
  border-radius: var(--radius-md, 8px);
  background: rgba(20, 20, 20, 1);
  color: var(--color-text-primary, #f3f3f3);
  box-shadow: var(--ks-shadow-lift, 0 10px 28px rgba(0,0,0,.55));
  font-size: 12px;
}
.gc-cascade-content {
  box-sizing: border-box; display: flex; align-items: stretch;
  width: max-content;
}
.gc-cascade-column {
  box-sizing: border-box; width: 210px; min-width: 210px;
  height: min(280px, calc(100vh - 16px));
  overflow-y: auto; scrollbar-gutter: auto; padding: 5px;
  border-right: 1px solid var(--color-border-default, #404040);
}
/* 通用单列下拉：高度随选项收缩，选项多时才滚动到 max-height。 */
.gc-cascade-panel.is-fit-content .gc-cascade-column {
  height: auto;
  max-height: min(280px, calc(100vh - 16px));
  scrollbar-gutter: auto;
}
.gc-cascade-column.has-editor { width: 240px; min-width: 240px; }
.gc-cascade-column:last-child { border-right: 0; }
.gc-cascade-item {
  all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 30px; padding: 5px 8px;
  border-radius: var(--radius-sm, 4px); color: inherit; cursor: pointer;
}
.gc-cascade-item:hover, .gc-cascade-item:focus-visible, .gc-cascade-item.is-active {
  background: var(--color-background-hover, rgba(255,255,255,.08));
}
.gc-cascade-item.is-selected { color: rgb(255, 156, 42); }
.gc-cascade-item:disabled { opacity: .45; cursor: default; }
.gc-cascade-item.is-detail:disabled { opacity: .78; }
.gc-cascade-item.is-create {
  width: calc(100% - 16px); min-height: 28px; margin: 0 8px;
  justify-content: flex-start; padding: 3px 8px;
  border: 1px dashed var(--color-border-strong, #707070);
  color: var(--color-text-secondary, #a8a8a8);
}
.gc-cascade-create-block {
  box-sizing: border-box; margin-top: 5px; padding-top: 6px;
  border-top: 1px solid var(--color-border-default, #404040);
}
.gc-cascade-item.is-create:hover, .gc-cascade-item.is-create:focus-visible, .gc-cascade-item.is-create.is-active {
  border-color: var(--color-text-secondary, #a8a8a8);
  background: var(--color-background-hover, rgba(255,255,255,.08));
}
.gc-cascade-item-create-icon { flex: none; font-size: 17px; line-height: 1; }
.gc-cascade-item-create-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gc-cascade-item.is-confirm {
  justify-content: center; text-align: center;
  color: rgb(255, 156, 42);
  background: color-mix(in srgb, rgb(255, 156, 42) 10%, transparent);
}
.gc-cascade-item.is-agent {
  justify-content: center; text-align: center;
  color: #111; background: #fff;
}
.gc-cascade-item.is-agent:disabled { opacity: 1; cursor: not-allowed; }
.gc-cascade-item.is-confirm .gc-cascade-item-label { flex: 0 1 auto; text-align: center; }
.gc-cascade-item.is-agent .gc-cascade-item-label { flex: 0 1 auto; text-align: center; }
.gc-cascade-item-label {
  min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gc-cascade-item-secondary {
  min-width: 0; max-width: 45%; flex: 0 1 auto;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--color-text-secondary, #a8a8a8);
  font-size: 10px; line-height: 1.2; text-align: right;
}
.gc-cascade-item-mark,
.gc-cascade-item-arrow { width: 14px; flex: none; text-align: center; }
.gc-cascade-item-mark { margin-left: auto; }
.gc-cascade-item-arrow {
  display: inline-flex; align-items: center; justify-content: center;
  color: inherit; opacity: .55; font-size: 18px; line-height: 1;
}
.gc-cascade-editor {
  box-sizing: border-box; display: grid; gap: 4px; width: 100%; padding: 5px 8px;
  color: inherit; font-size: 11px;
}
.gc-cascade-editor-label { opacity: .72; }
.gc-cascade-editor input, .gc-cascade-editor textarea {
  box-sizing: border-box; width: 100%; min-width: 0; height: 28px; padding: 4px 7px;
  border: 1px solid var(--color-border-default, #505050);
  border-radius: var(--radius-sm, 4px);
  background: var(--color-background-base, #191919); color: inherit; font: inherit;
}
.gc-cascade-editor textarea { height: 68px; min-height: 68px; resize: vertical; line-height: 1.4; }
.gc-cascade-editor input:focus, .gc-cascade-editor textarea:focus {
  outline: none; box-shadow: none; border-color: rgba(255, 255, 255, 0.08);
}
.gc-cascade-editor input[aria-invalid="true"], .gc-cascade-editor textarea[aria-invalid="true"] { border-color: var(--color-status-danger, #ef6a6a); }
.gc-cascade-editor-error { color: var(--color-status-danger, #ef6a6a); line-height: 1.35; overflow-wrap: anywhere; }
.gc-cascade-create-dialog {
  z-index: calc(var(--z-top, 9999) + 1); box-sizing: border-box;
  width: min(260px, calc(100vw - 16px)); padding: 8px;
  border: 1px solid var(--color-border-default, #505050);
  border-radius: var(--radius-md, 8px);
  background: rgba(20, 20, 20, 1); color: var(--color-text-primary, #f3f3f3);
  box-shadow: var(--ks-shadow-lift, 0 12px 30px rgba(0,0,0,.62));
}
.gc-cascade-create-dialog-header {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  margin-bottom: 5px; padding: 0 2px 6px;
  border-bottom: 1px solid var(--color-border-default, #404040);
}
.gc-cascade-create-dialog-title { min-width: 0; font-size: 12px; font-weight: 600; }
.gc-cascade-create-dialog-close {
  all: unset; box-sizing: border-box; width: 24px; height: 24px;
  display: grid; place-items: center; border-radius: var(--radius-sm, 4px);
  color: var(--color-text-secondary, #a8a8a8); cursor: pointer;
}
.gc-cascade-create-dialog-close:hover, .gc-cascade-create-dialog-close:focus-visible {
  background: var(--color-background-hover, rgba(255,255,255,.08)); color: inherit;
}
.gc-cascade-create-dialog .gc-cascade-editor { padding: 4px 2px; }
.gc-cascade-create-dialog-actions { display:flex; gap:8px; margin-top:5px; }
.gc-cascade-create-dialog-actions .gc-cascade-item {
  flex:1; width:auto; height:28px; min-height:28px; margin:0; padding:3px 8px; border-radius:6px;
  font-size: 12px;
}
`

function findOptionPath(
  options: readonly CascadingPickerOption[],
  value: string,
  path: string[] = [],
): string[] | null {
  for (const option of options) {
    const nextPath = [...path, option.key]
    if (option.value === value) return nextPath
    const nested = option.children ? findOptionPath(option.children, value, nextPath) : null
    if (nested) return nested
  }
  return null
}

function optionForKey(
  options: readonly CascadingPickerOption[],
  key: string,
): CascadingPickerOption | undefined {
  return options.find((option) => option.key === key)
}

function optionAtPath(
  options: readonly CascadingPickerOption[],
  path: readonly string[],
): CascadingPickerOption | undefined {
  let current = options
  let found: CascadingPickerOption | undefined
  for (const key of path) {
    found = optionForKey(current, key)
    if (!found) return undefined
    current = found.children ?? []
  }
  return found
}

function createActionLabel(option: CascadingPickerOption): string {
  if (option.createLabel?.trim()) return option.createLabel.trim()
  const key = option.key.toLowerCase()
  if (/create-(?:effect-|formula-)?entity:/.test(key)) return translateUi('cascade.action.entity')
  if (/create-(?:effect-|formula-|text-)?attr(?:ibute)?:/.test(key)) return translateUi('cascade.action.attribute')
  if (/create-(?:formula-)?variable:/.test(key)) return translateUi('cascade.action.variable')
  if (key.includes('create-formula:')) return translateUi('cascade.action.formula')
  const semanticLabel = option.label.toLowerCase()
  if (/公式|formula/.test(semanticLabel)) return translateUi('cascade.action.formula')
  if (/属性|attribute|properties/.test(semanticLabel)) return translateUi('cascade.action.attribute')
  if (/变量|variable/.test(semanticLabel)) return translateUi('cascade.action.variable')
  if (/实体|entity/.test(semanticLabel)) return translateUi('cascade.action.entity')
  return translateUi('cascade.action.generic')
}

function menuColumns(
  options: readonly CascadingPickerOption[],
  activePath: readonly string[],
): CascadingPickerOption[][] {
  const columns: CascadingPickerOption[][] = [[...options]]
  let current = options
  for (const key of activePath) {
    const active = optionForKey(current, key)
    if (!active?.children?.length) break
    columns.push(active.children)
    current = active.children
  }
  return columns
}

function withDefaultOpenPath(
  options: readonly CascadingPickerOption[],
  path: readonly string[],
): string[] {
  const nextPath = [...path]
  let current = options
  for (const key of nextPath) {
    const active = optionForKey(current, key)
    if (!active?.children?.length) return nextPath
    current = active.children
  }
  for (;;) {
    const next = current.find((option) => option.defaultOpen && option.children?.length)
    if (!next?.children?.length) return nextPath
    nextPath.push(next.key)
    current = next.children
  }
}

export function CascadingPicker({
  ariaLabel,
  value,
  displayValue,
  placeholder,
  options,
  onSelect,
  narrowSafe = false,
  fitContent = false,
  variant = 'field',
  disabled = false,
  onOpenChange,
}: {
  ariaLabel: string
  value: string
  displayValue: string
  placeholder?: string
  options: readonly CascadingPickerOption[]
  onSelect: (value: string) => void
  narrowSafe?: boolean
  /** 面板高度随选项收缩（max-height 上限），用于扁平单列下拉。 */
  fitContent?: boolean
  variant?: CascadingPickerVariant
  disabled?: boolean
  onOpenChange?: (open: boolean, detail: CascadingPickerOpenChangeDetail) => void
}): JSX.Element {
  injectStyleOnce('gc-cascading-picker', CASCADING_PICKER_CSS)
  const [open, setOpen] = useState(false)
  const [activePath, setActivePath] = useState<string[]>([])
  const [createPath, setCreatePath] = useState<string[] | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const createAnchorRef = useRef<HTMLButtonElement | null>(null)
  const createDialogRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)
  const [createDialogStyle, setCreateDialogStyle] = useState<CSSProperties | null>(null)

  const columns = open ? menuColumns(options, activePath) : []
  const renderedColumns = open
    ? columns.map((column, depth) => ({ column, depth })).reverse()
    : []
  const panelPathKey = activePath.join('/')
  const createPathKey = createPath?.join('/') ?? ''
  const createOption = createPath ? optionAtPath(options, createPath) : undefined
  const createLabel = createOption ? createActionLabel(createOption) : ''
  const createDialogLabel = createOption?.label ?? ''

  function activateBranch(option: CascadingPickerOption, depth: number): void {
    setActivePath((current) => withDefaultOpenPath(
      options,
      [...current.slice(0, depth), option.key],
    ))
  }

  function closePicker(reason: CascadingPickerOpenChangeReason, target: EventTarget | null = null): void {
    setCreatePath(null)
    setCreateDialogStyle(null)
    setOpen(false)
    onOpenChange?.(false, { reason, target })
  }

  function openPicker(): void {
    if (disabled) return
    setPanelStyle(null)
    setCreatePath(null)
    setCreateDialogStyle(null)
    setActivePath(withDefaultOpenPath(
      options,
      findOptionPath(options, value) ?? [],
    ))
    setOpen(true)
    onOpenChange?.(true, { reason: 'trigger', target: triggerRef.current })
  }

  function closeCreateDialog(): void {
    setCreatePath(null)
    setCreateDialogStyle(null)
    createAnchorRef.current?.focus()
  }

  function choose(
    option: CascadingPickerOption,
    depth: number,
    anchor?: HTMLButtonElement,
  ): void {
    if (option.disabled) return
    if (option.presentation === 'create' && option.children?.length) {
      createAnchorRef.current = anchor ?? null
      setCreateDialogStyle(null)
      setCreatePath([...activePath.slice(0, depth), option.key])
      return
    }
    setCreatePath(null)
    setCreateDialogStyle(null)
    if (option.children?.length) {
      activateBranch(option, depth)
      return
    }
    if (option.value == null) return
    onSelect(option.value)
    closePicker('select', anchor ?? null)
  }

  function chooseCreateOption(option: CascadingPickerOption): void {
    if (option.disabled || option.value == null) return
    onSelect(option.value)
    closePicker('select', createAnchorRef.current)
  }

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null)
      return
    }
    const frameRef = { current: null as number | null }
    const place = () => {
      const trigger = triggerRef.current
      const panel = panelRef.current
      if (!trigger || !panel || typeof window === 'undefined') return
      const rect = trigger.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const panelWidth = Math.min(panelRect.width, window.innerWidth - 16)
      const panelHeight = Math.min(panelRect.height, window.innerHeight - 16)
      const gap = 5
      const below = window.innerHeight - rect.bottom
      const placeAbove = below < panelHeight + gap && rect.top > below
      const top = placeAbove
        ? Math.max(8, rect.top - panelHeight - gap)
        : Math.min(window.innerHeight - 8, rect.bottom + gap)
      // 根列固定贴近触发器右边缘；子列按视觉顺序向左扩展。
      const left = Math.min(
        Math.max(8, rect.right - panelWidth),
        Math.max(8, window.innerWidth - panelWidth - 8),
      )
      setPanelStyle({
        position: 'fixed',
        top,
        left,
        visibility: 'visible',
      })
    }
    const schedulePlace = (event?: Event) => {
      const target = event?.target as Node | null
      if (target && (panelRef.current?.contains(target) || createDialogRef.current?.contains(target))) return
      if (frameRef.current != null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        place()
      })
    }
    place()
    const frame = requestAnimationFrame(place)
    window.addEventListener('resize', schedulePlace)
    window.addEventListener('scroll', schedulePlace, true)
    return () => {
      cancelAnimationFrame(frame)
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', schedulePlace)
      window.removeEventListener('scroll', schedulePlace, true)
    }
  }, [open, panelPathKey])

  useLayoutEffect(() => {
    if (!open || !createOption) {
      setCreateDialogStyle(null)
      return
    }
    const place = () => {
      const anchor = createAnchorRef.current
      const dialog = createDialogRef.current
      if (!anchor || !dialog || typeof window === 'undefined') return
      const anchorRect = anchor.getBoundingClientRect()
      const dialogRect = dialog.getBoundingClientRect()
      const dialogWidth = Math.min(dialogRect.width, window.innerWidth - 16)
      const dialogHeight = Math.min(dialogRect.height, window.innerHeight - 16)
      const gap = 5
      const roomLeft = anchorRect.left - 8
      const roomRight = window.innerWidth - anchorRect.right - 8
      const canPlaceLeft = roomLeft >= dialogWidth + gap
      const canPlaceRight = roomRight >= dialogWidth + gap
      const placeHorizontally = canPlaceLeft || canPlaceRight
      const placeLeft = canPlaceLeft || (!canPlaceRight && roomLeft >= roomRight)
      const below = window.innerHeight - anchorRect.bottom
      const placeAbove = below < dialogHeight + gap && anchorRect.top > below
      const top = placeHorizontally
        ? Math.min(
          Math.max(8, anchorRect.top),
          Math.max(8, window.innerHeight - dialogHeight - 8),
        )
        : placeAbove
          ? Math.max(8, anchorRect.top - dialogHeight - gap)
          : Math.min(window.innerHeight - dialogHeight - 8, anchorRect.bottom + gap)
      const left = placeHorizontally
        ? placeLeft
          ? anchorRect.left - dialogWidth - gap
          : anchorRect.right + gap
        : Math.min(
          Math.max(8, anchorRect.left),
          Math.max(8, window.innerWidth - dialogWidth - 8),
        )
      setCreateDialogStyle({
        position: 'fixed',
        top,
        left,
        visibility: 'visible',
      })
    }
    place()
    const frame = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, createPathKey, createOption])

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    panel.scrollLeft = panel.scrollWidth
  }, [open, panelPathKey])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        rootRef.current?.contains(target)
        || panelRef.current?.contains(target)
        || createDialogRef.current?.contains(target)
      ) return
      closePicker('outside-pointer', event.target)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (createPath) {
        closeCreateDialog()
        return
      }
      closePicker('escape', event.target)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, createPathKey])

  const panel = open ? (
    <div
      ref={panelRef}
      className={`gc-cascade-panel${fitContent ? ' is-fit-content' : ''}`}
      role="menu"
      aria-label={`${ariaLabel}${translateUi('ui.template.bb7486f4410f')}`}
      style={panelStyle ?? HIDDEN_PANEL_STYLE}
    >
      <div className="gc-cascade-content">
        {renderedColumns.map(({ column, depth }) => (
          <div
            className={`gc-cascade-column${column.some((option) => option.editor) ? ' has-editor' : ''}`}
            role="group"
            key={`${depth}:${activePath[depth - 1] ?? 'root'}`}
          >
            {column.map((option) => {
              const active = activePath[depth] === option.key
              const selected = option.value === value
              const createItem = option.presentation === 'create'
              const confirmItem = option.presentation === 'confirm'
              if (option.editor) {
                const editor = option.editor
                return (
                  <label className="gc-cascade-editor" role="none" key={option.key}>
                    <span className="gc-cascade-editor-label">{option.label}</span>
                    {editor.multiline ? (
                      <textarea
                        value={editor.value}
                        aria-label={editor.ariaLabel}
                        aria-invalid={editor.invalid || undefined}
                        inputMode={editor.inputMode}
                        placeholder={editor.placeholder}
                        onChange={(event) => editor.onChange(event.target.value)}
                      />
                    ) : (
                      <input
                        value={editor.value}
                        aria-label={editor.ariaLabel}
                        aria-invalid={editor.invalid || undefined}
                        inputMode={editor.inputMode}
                        placeholder={editor.placeholder}
                        pattern={editor.pattern}
                        onChange={(event) => editor.onChange(event.target.value)}
                      />
                    )}
                    {editor.error ? (
                      <span className="gc-cascade-editor-error" role="alert">{editor.error}</span>
                    ) : null}
                  </label>
                )
              }
              const itemLabel = createItem ? createActionLabel(option) : option.label
              const item = (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={itemLabel}
                  title={createItem
                    ? option.label
                    : option.secondaryText != null
                      ? `${option.label}：${option.secondaryText}`
                      : undefined}
                  className={[
                    'gc-cascade-item',
                    active ? 'is-active' : '',
                    selected ? 'is-selected' : '',
                    option.presentation === 'detail' ? 'is-detail' : '',
                    createItem ? 'is-create' : '',
                    confirmItem ? 'is-confirm' : '',
                  ].filter(Boolean).join(' ')}
                  aria-haspopup={createItem ? 'dialog' : option.children?.length ? 'menu' : undefined}
                  aria-expanded={createItem ? createPathKey === [
                    ...activePath.slice(0, depth),
                    option.key,
                  ].join('/') : option.children?.length ? active : undefined}
                  disabled={option.disabled}
                  onPointerEnter={() => {
                    if (!createItem && !option.disabled && option.children?.length) {
                      activateBranch(option, depth)
                    }
                  }}
                  onClick={(event) => choose(option, depth, event.currentTarget)}
                >
                  {createItem ? (
                    <>
                      <span className="gc-cascade-item-create-icon" aria-hidden="true">+</span>
                      <span className="gc-cascade-item-create-label">{itemLabel}</span>
                    </>
                  ) : (
                    <>
                      {!confirmItem && option.children?.length ? (
                        <span className="gc-cascade-item-arrow" aria-hidden="true">‹</span>
                      ) : null}
                      <span className="gc-cascade-item-label">{option.label}</span>
                      {option.secondaryText != null ? (
                        <span className="gc-cascade-item-secondary" aria-hidden="true">
                          {option.secondaryText}
                        </span>
                      ) : null}
                      {!confirmItem && !option.children?.length && selected ? (
                        <span className="gc-cascade-item-mark" aria-hidden="true">✓</span>
                      ) : null}
                    </>
                  )}
                </button>
              )
              return createItem ? (
                <div className="gc-cascade-create-block" role="none" key={option.key}>
                  {item}
                </div>
              ) : (
                <Fragment key={option.key}>{item}</Fragment>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  ) : null

  const createDialog = open && createOption ? (
    <div
      ref={createDialogRef}
      className="gc-cascade-create-dialog"
      role="dialog"
      aria-label={createDialogLabel}
      aria-modal="false"
      style={createDialogStyle ?? HIDDEN_PANEL_STYLE}
    >
      <div className="gc-cascade-create-dialog-header">
        <span className="gc-cascade-create-dialog-title">{createDialogLabel}</span>
        <button
          type="button"
          className="gc-cascade-create-dialog-close"
          aria-label={`${translateUi('ui.template.3fd47edce45b')}${createDialogLabel}`}
          title={translateUi('ui.copy.6c14bd7f6f9e')}
          onClick={closeCreateDialog}
        >
          ×
        </button>
      </div>
      {createOption.children?.filter(
        (option) => option.presentation !== 'agent' && option.presentation !== 'confirm',
      ).map((option) => {
        if (option.editor) {
          const editor = option.editor
          return (
            <label className="gc-cascade-editor" key={option.key}>
              <span className="gc-cascade-editor-label">{option.label}</span>
              {editor.multiline ? (
                <textarea
                  value={editor.value}
                  aria-label={editor.ariaLabel}
                  aria-invalid={editor.invalid || undefined}
                  inputMode={editor.inputMode}
                  placeholder={editor.placeholder}
                  onChange={(event) => editor.onChange(event.target.value)}
                />
              ) : (
                <input
                  value={editor.value}
                  aria-label={editor.ariaLabel}
                  aria-invalid={editor.invalid || undefined}
                  inputMode={editor.inputMode}
                  placeholder={editor.placeholder}
                  pattern={editor.pattern}
                  onChange={(event) => editor.onChange(event.target.value)}
                />
              )}
              {editor.error ? (
                <span className="gc-cascade-editor-error" role="alert">{editor.error}</span>
              ) : null}
            </label>
          )
        }
        return (
          <button
            type="button"
            className={[
              'gc-cascade-item',
              option.presentation === 'detail' ? 'is-detail' : '',
            ].filter(Boolean).join(' ')}
            disabled={option.disabled}
            onClick={() => chooseCreateOption(option)}
            key={option.key}
          >
            <span className="gc-cascade-item-label">{option.label}</span>
          </button>
        )
      })}
      <div className="gc-cascade-create-dialog-actions">
        {createOption.children?.filter(
          (option) => option.presentation === 'agent' || option.presentation === 'confirm',
        ).map((option) => (
          <button
            type="button"
            className={[
              'gc-cascade-item',
              option.presentation === 'agent' ? 'is-agent' : 'is-confirm',
            ].join(' ')}
            disabled={option.disabled}
            onClick={() => chooseCreateOption(option)}
            key={option.key}
          >
            <span className="gc-cascade-item-label">
              {option.presentation === 'confirm' ? translateUi('cascade.create.confirm') : option.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div
      className={[
        'gc-cascade-root',
        narrowSafe ? 'is-narrow-safe' : '',
        variant === 'toolbar' ? 'is-toolbar' : '',
      ].filter(Boolean).join(' ')}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="gc-cascade-trigger"
        value={value}
        disabled={disabled}
        onClick={(event) => open
          ? closePicker('trigger', event.currentTarget)
          : openPicker()}
        onChange={(event) => onSelect((event.target as HTMLButtonElement).value)}
      >
        {variant === 'toolbar' ? (
          <span className="gc-cascade-trigger-add" aria-hidden="true">
            <img src={formulaToolbarAddIcon} alt="" />
          </span>
        ) : null}
        <span className={`gc-cascade-trigger-label${displayValue ? '' : ' is-placeholder'}`}>
          {displayValue || placeholder || ''}
        </span>
        <svg
          className="gc-cascade-trigger-arrow"
          viewBox="0 0 12 9"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1.5 2.25 6 6.75l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
      {typeof document !== 'undefined' && createDialog ? createPortal(createDialog, document.body) : null}
    </div>
  )
}
