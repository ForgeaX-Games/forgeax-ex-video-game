import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { KinoPromptContentItem } from '@/runtime/core/schema/kino-schema'
import searchIcon from '@/editor/ui-assets/asset-toolbar-search.svg?url'
import closeIcon from '../../shell/rule-dialog-close.svg?url'
import { useT } from '../../../i18n'

export type PromptMentionAssetCategory = 'character' | 'scene' | 'image' | 'video' | 'icon' | 'control' | 'audio' | 'font'

export interface PromptMentionAsset {
  id: string
  resourceId?: string
  label: string
  thumbUrl?: string
  mediaUrl?: string
  prompt?: string
  category?: PromptMentionAssetCategory
}

export interface PromptMentionEditorHandle {
  clear: () => void
  openMentions: (anchor?: HTMLElement) => void
  replacePrompt: (prompt: string) => boolean
}

export interface PromptMentionEditorProps {
  id: string
  assets: readonly PromptMentionAsset[]
  initialValue: string
  resetKey?: string | number
  resetValue?: string
  placeholder: string
  label: string
  invalid: boolean
  mentionLabel: string
  emptyLabel: string
  presentation?: 'menu' | 'dialog'
  disabled?: boolean
  readOnly?: boolean
  onChange: (prompt: string, content: KinoPromptContentItem[]) => void
}

interface MentionQuery {
  text: string
  range: Range | null
}

interface MentionMenuPosition {
  left: number
  top: number
  placement: 'above' | 'below'
}

const MENTION_MENU_WIDTH = 157
const MENTION_MENU_MAX_HEIGHT = 230
const MENTION_MENU_GAP = 8
const MENTION_MENU_VIEWPORT_GUTTER = 8

export const PromptMentionEditor = forwardRef<PromptMentionEditorHandle, PromptMentionEditorProps>(
  function PromptMentionEditor({
    id,
    assets,
    initialValue,
    resetKey,
    resetValue,
    placeholder,
    label,
    invalid,
    mentionLabel,
    emptyLabel,
    presentation = 'menu',
    disabled = false,
    readOnly = false,
    onChange,
  }, forwardedRef) {
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<HTMLDivElement | null>(null)
    const menuRef = useRef<HTMLElement | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuPosition, setMenuPosition] = useState<MentionMenuPosition | null>(null)
    const [query, setQuery] = useState<MentionQuery>({ text: '', range: null })
    const [activeIndex, setActiveIndex] = useState(0)
    const initializedRef = useRef(false)
    const pendingPromptValuesRef = useRef<string[]>([])
    const previousResetKeyRef = useRef(resetKey)
    const normalizedQuery = query.text.trim().toLocaleLowerCase()
    const filteredAssets = useMemo(() => normalizedQuery
      ? assets.filter((asset) => `${asset.label} ${asset.prompt ?? ''}`.toLocaleLowerCase().includes(normalizedQuery))
      : assets, [assets, normalizedQuery])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      if (!initializedRef.current) {
        initializedRef.current = true
        editor.replaceChildren(document.createTextNode(initialValue))
        return
      }
      if (previousResetKeyRef.current !== resetKey) {
        previousResetKeyRef.current = resetKey
        pendingPromptValuesRef.current = []
        editor.replaceChildren(document.createTextNode(resetValue ?? initialValue))
        setMenuOpen(false)
        setQuery({ text: '', range: null })
        return
      }
      const pendingIndex = pendingPromptValuesRef.current.lastIndexOf(initialValue)
      if (pendingIndex >= 0) {
        pendingPromptValuesRef.current.splice(0, pendingIndex + 1)
        return
      }
      if (!editor.textContent && initialValue) editor.textContent = initialValue
    }, [initialValue, resetKey, resetValue])

    const emitEditorChange = useCallback((editor: HTMLDivElement): void => {
      emitChange(editor, (prompt, content) => {
        pendingPromptValuesRef.current.push(prompt)
        onChange(prompt, content)
      })
    }, [onChange])

    useEffect(() => setActiveIndex(0), [query.text])

    useEffect(() => {
      if (!menuOpen) return
      const closeOnOutsidePointer = (event: PointerEvent): void => {
        if (!(event.target instanceof Node)) return
        if (!wrapRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
          setMenuOpen(false)
        }
      }
      document.addEventListener('pointerdown', closeOnOutsidePointer)
      return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }, [menuOpen])

    useImperativeHandle(forwardedRef, () => ({
      clear: () => {
        if (disabled || readOnly) return
        const editor = editorRef.current
        if (!editor) return
        editor.replaceChildren()
        setMenuOpen(false)
        emitEditorChange(editor)
      },
      openMentions: (anchor) => {
        if (disabled || readOnly) return
        const editor = editorRef.current
        if (!editor) return
        editor.focus()
        placeCaretAtEnd(editor)
        setQuery({ text: '', range: currentCaretRange(editor) })
        setMenuPosition(positionMentionMenu(anchor?.getBoundingClientRect() ?? editor.getBoundingClientRect(), true))
        setMenuOpen(true)
      },
      replacePrompt: (prompt) => {
        if (disabled || readOnly) return false
        const editor = editorRef.current
        if (!editor || !replacePromptPreservingMentions(editor, prompt)) return false
        setMenuOpen(false)
        setQuery({ text: '', range: null })
        emitEditorChange(editor)
        return true
      },
    }), [disabled, emitEditorChange, readOnly])

    const handleInput = (event: FormEvent<HTMLDivElement>): void => {
      if (disabled || readOnly) return
      const editor = event.currentTarget
      emitEditorChange(editor)
      const mention = mentionQueryAtCaret(editor)
      if (mention) {
        setQuery(mention)
        setMenuPosition(positionMentionMenu(mentionMenuAnchor(mention.range, editor.getBoundingClientRect())))
        setMenuOpen(true)
      } else {
        setMenuOpen(false)
      }
    }

    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      const assetsByResourceId = new Map(assets.flatMap((asset) => asset.resourceId ? [[asset.resourceId, asset] as const] : []))
      editor.querySelectorAll<HTMLElement>('[data-resource-id]').forEach((chip) => {
        const asset = assetsByResourceId.get(chip.dataset.resourceId ?? '')
        const missing = !asset
        const lacksPreview = missing && !chip.dataset.thumbUrl
        chip.classList.toggle('is-missing', missing)
        chip.classList.toggle('is-orphaned', lacksPreview)
        chip.setAttribute('aria-invalid', missing ? 'true' : 'false')
      })
    }, [assets])

    const selectAsset = (asset: PromptMentionAsset): void => {
      if (!asset.resourceId) return
      const editor = editorRef.current
      if (!editor) return
      const range = query.range ?? currentCaretRange(editor)
      if (!range) return
      range.deleteContents()
      const chip = createMentionChip(asset)
      const spacer = document.createTextNode('\u00a0')
      range.insertNode(spacer)
      range.insertNode(chip)
      range.setStartAfter(spacer)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      setMenuOpen(false)
      setQuery({ text: '', range: null })
      emitEditorChange(editor)
      editor.focus()
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      if (!menuOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((current) => {
          const count = filteredAssets.length
          return count === 0 ? 0 : (current + direction + count) % count
        })
        return
      }
      if (event.key === 'Enter' && filteredAssets[activeIndex]) {
        event.preventDefault()
        selectAsset(filteredAssets[activeIndex])
      }
    }

    return (
      <div ref={wrapRef} className="vgen-mention-editor-wrap">
        <div
          ref={editorRef}
          id={id}
          className="vgen-mention-editor"
          role="textbox"
          aria-label={label}
          aria-invalid={invalid ? 'true' : undefined}
          aria-disabled={disabled ? 'true' : undefined}
          aria-readonly={readOnly ? 'true' : undefined}
          aria-multiline="true"
          contentEditable={!disabled && !readOnly}
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onClick={(event) => {
            if (disabled || readOnly) return
            const remove = (event.target as HTMLElement).closest<HTMLElement>('[data-mention-remove]')
            if (!remove) return
            event.preventDefault()
            remove.closest('[data-resource-id]')?.remove()
            if (editorRef.current) emitEditorChange(editorRef.current)
          }}
        />
        {presentation === 'dialog' ? (
          <AssetMentionDialog
            open={menuOpen}
            assets={assets}
            initialQuery={query.text}
            label={mentionLabel}
            emptyLabel={emptyLabel}
            dialogRef={menuRef}
            onClose={() => setMenuOpen(false)}
            onSelect={selectAsset}
          />
        ) : (
          <AssetMentionMenu
            open={menuOpen}
            assets={filteredAssets}
            activeIndex={activeIndex}
            label={mentionLabel}
            emptyLabel={emptyLabel}
            menuRef={menuRef}
            position={menuPosition}
            onHover={setActiveIndex}
            onSelect={selectAsset}
          />
        )}
      </div>
    )
  },
)

interface AssetMentionMenuProps {
  open: boolean
  assets: readonly PromptMentionAsset[]
  activeIndex: number
  label: string
  emptyLabel: string
  menuRef: React.MutableRefObject<HTMLElement | null>
  position: MentionMenuPosition | null
  onHover: (index: number) => void
  onSelect: (asset: PromptMentionAsset) => void
}

export function AssetMentionMenu({
  open,
  assets,
  activeIndex,
  label,
  emptyLabel,
  menuRef,
  position,
  onHover,
  onSelect,
}: AssetMentionMenuProps): JSX.Element | null {
  if (!open || !position) return null
  return createPortal(
    <div
      ref={(node) => { menuRef.current = node }}
      className={`vgen-mention-menu is-${position.placement}`}
      role="listbox"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
    >
      <div className="vgen-mention-menu-title">{label}</div>
      {assets.length === 0 ? <div className="vgen-mention-empty">{emptyLabel}</div> : assets.map((asset, index) => (
        <button
          key={asset.id}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          disabled={!asset.resourceId}
          className={index === activeIndex ? 'is-active' : ''}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(asset)}
        >
          {asset.thumbUrl ? <img src={asset.thumbUrl} alt="" /> : <span className="vgen-mention-thumb" aria-hidden />}
          <span>{asset.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  )
}

interface AssetMentionDialogProps {
  open: boolean
  assets: readonly PromptMentionAsset[]
  initialQuery: string
  label: string
  emptyLabel: string
  dialogRef: React.MutableRefObject<HTMLElement | null>
  onClose: () => void
  onSelect: (asset: PromptMentionAsset) => void
}

const ASSET_DIALOG_CATEGORIES = ['all', 'character', 'scene'] as const
const ASSET_DIALOG_IMAGE_CATEGORIES: readonly PromptMentionAssetCategory[] = ['image', 'character', 'scene']

function AssetMentionDialog({
  open,
  assets,
  initialQuery,
  label,
  emptyLabel,
  dialogRef,
  onClose,
  onSelect,
}: AssetMentionDialogProps): JSX.Element | null {
  const t = useT()
  const [query, setQuery] = useState(initialQuery)
  const [category, setCategory] = useState<PromptMentionAssetCategory | 'all'>('all')

  useEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    setCategory('all')
  }, [initialQuery, open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredAssets = useMemo(() => assets.filter((asset) => {
    const assetCategory = asset.category ?? 'image'
    if (category === 'all' && !ASSET_DIALOG_IMAGE_CATEGORIES.includes(assetCategory)) return false
    if (category !== 'all' && assetCategory !== category) return false
    return !normalizedQuery
      || `${asset.label} ${asset.prompt ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
  }), [assets, category, normalizedQuery])

  if (!open) return null
  return createPortal(
    <div className="vgen-asset-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={(node) => { dialogRef.current = node }}
        className="vgen-asset-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('videoAssets.generate.assetPicker.title')}
      >
        <header className="vgen-asset-head">
          <h3>{t('videoAssets.generate.assetPicker.title')}</h3>
          <button type="button" aria-label={t('videoAssets.generate.assetPicker.close')} onClick={onClose}>
            <img src={closeIcon} alt="" />
          </button>
        </header>
        <div className="vgen-asset-toolbar">
          <div className="vgen-asset-categories" role="tablist" aria-label={label}>
            {ASSET_DIALOG_CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={category === item}
                className={category === item ? 'is-active' : ''}
                onClick={() => setCategory(item)}
              >
                {t(`videoAssets.generate.assetPicker.category.${item}`)}
              </button>
            ))}
          </div>
          <label className="vgen-asset-search">
            <img src={searchIcon} alt="" />
            <input
              value={query}
              autoFocus
              aria-label={t('videoAssets.generate.assetPicker.search')}
              placeholder={t('videoAssets.generate.assetPicker.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="vgen-asset-grid" role="listbox" aria-label={label}>
          {filteredAssets.length === 0 ? <div className="vgen-asset-empty">{emptyLabel}</div> : filteredAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              role="option"
              aria-selected="false"
              aria-label={asset.label}
              className="vgen-asset-card"
              disabled={!asset.resourceId}
              title={!asset.resourceId ? t('videoAssets.generate.assetPicker.unavailable') : asset.label}
              onClick={() => onSelect(asset)}
            >
              <span className="vgen-asset-preview">
                {asset.category === 'video' && asset.mediaUrl
                  ? <video src={asset.mediaUrl} poster={asset.thumbUrl} muted preload="metadata" />
                  : asset.thumbUrl
                    ? <img src={asset.thumbUrl} alt="" />
                    : <span className={`vgen-asset-placeholder is-${asset.category ?? 'image'}`} aria-hidden />}
              </span>
              <span className="vgen-asset-meta">
                <strong>{asset.label}</strong>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  )
}

function createMentionChip(asset: PromptMentionAsset): HTMLSpanElement {
  if (!asset.resourceId) throw new Error('Kino resource id is required for a prompt mention')
  const chip = document.createElement('span')
  chip.className = 'vgen-mention-chip'
  chip.contentEditable = 'false'
  chip.dataset.resourceId = asset.resourceId
  chip.dataset.assetLabel = asset.label
  if (asset.thumbUrl) chip.dataset.thumbUrl = asset.thumbUrl

  const preview = asset.thumbUrl ? document.createElement('img') : document.createElement('span')
  preview.className = 'vgen-mention-chip-thumb'
  if (preview instanceof HTMLImageElement) {
    preview.src = asset.thumbUrl ?? ''
    preview.alt = ''
  } else {
    preview.classList.add('is-placeholder')
    preview.setAttribute('aria-hidden', 'true')
  }
  const at = document.createElement('span')
  at.className = 'vgen-mention-at'
  at.textContent = '@'
  const name = document.createElement('span')
  name.className = 'vgen-mention-name'
  name.textContent = asset.label
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.tabIndex = -1
  remove.dataset.mentionRemove = 'true'
  remove.setAttribute('aria-label', `Remove ${asset.label}`)
  chip.append(preview, at, name, remove)
  return chip
}

function positionMentionMenu(anchor: DOMRect, preferAbove = false): MentionMenuPosition {
  const maxLeft = Math.max(MENTION_MENU_VIEWPORT_GUTTER, window.innerWidth - MENTION_MENU_WIDTH - MENTION_MENU_VIEWPORT_GUTTER)
  const left = Math.min(Math.max(MENTION_MENU_VIEWPORT_GUTTER, anchor.left), maxLeft)
  const fitsBelow = window.innerHeight - anchor.bottom >= MENTION_MENU_MAX_HEIGHT + MENTION_MENU_GAP
  const fitsAbove = anchor.top >= MENTION_MENU_MAX_HEIGHT + MENTION_MENU_GAP
  const placement = preferAbove || (!fitsBelow && fitsAbove) ? 'above' : 'below'
  return {
    left,
    top: placement === 'above' ? anchor.top - MENTION_MENU_GAP : anchor.bottom + MENTION_MENU_GAP,
    placement,
  }
}

function mentionMenuAnchor(range: Range | null, fallback: DOMRect): DOMRect {
  if (!range) return fallback
  const caret = range.cloneRange()
  caret.collapse(false)
  const caretRect = caret.getBoundingClientRect()
  return caretRect.height || caretRect.width ? caretRect : fallback
}

function emitChange(
  editor: HTMLDivElement,
  onChange: (prompt: string, content: KinoPromptContentItem[]) => void,
): void {
  const content: KinoPromptContentItem[] = []
  let prompt = ''
  const appendText = (text: string): void => {
    const normalized = text.replace(/\u00a0/g, ' ')
    if (!normalized) return
    prompt += normalized
    const previous = content.at(-1)
    if (previous?.type === 'text') previous.text += normalized
    else content.push({ type: 'text', text: normalized })
  }
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? '')
      return
    }
    if (!(node instanceof HTMLElement)) return
    const resourceId = node.dataset.resourceId
    if (resourceId) {
      const assetLabel = node.dataset.assetLabel ?? ''
      prompt += `@${assetLabel}`
      content.push({ type: 'resource', resourceId })
      return
    }
    if (node.tagName === 'BR') {
      appendText('\n')
      return
    }
    node.childNodes.forEach(visit)
    if (node !== editor && (node.tagName === 'DIV' || node.tagName === 'P')) appendText('\n')
  }
  editor.childNodes.forEach(visit)
  onChange(prompt, content)
}

function replacePromptPreservingMentions(
  editor: HTMLDivElement,
  prompt: string,
): boolean {
  const chips = [...editor.querySelectorAll<HTMLElement>('[data-resource-id]')]
  if (chips.length === 0) {
    editor.textContent = prompt
    return true
  }

  let cursor = 0
  const matches: Array<{ chip: HTMLElement; start: number; end: number }> = []
  for (const chip of chips) {
    const token = `@${chip.dataset.assetLabel ?? ''}`
    const start = prompt.indexOf(token, cursor)
    if (start < 0) return false
    matches.push({ chip, start, end: start + token.length })
    cursor = start + token.length
  }

  const fragment = document.createDocumentFragment()
  cursor = 0
  for (const match of matches) {
    if (match.start > cursor) fragment.append(document.createTextNode(prompt.slice(cursor, match.start)))
    fragment.append(match.chip)
    cursor = match.end
  }
  if (cursor < prompt.length) fragment.append(document.createTextNode(prompt.slice(cursor)))
  editor.replaceChildren(fragment)
  return true
}

function mentionQueryAtCaret(editor: HTMLDivElement): MentionQuery | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
  const caret = selection.getRangeAt(0)
  if (!editor.contains(caret.startContainer)) return null
  const node = caret.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  const beforeCaret = (node.textContent ?? '').slice(0, caret.startOffset)
  const match = beforeCaret.match(/@([^@\s]{0,40})$/)
  if (!match) return null
  const range = document.createRange()
  range.setStart(node, caret.startOffset - match[0].length)
  range.setEnd(node, caret.startOffset)
  return { text: match[1] ?? '', range }
}

function currentCaretRange(editor: HTMLDivElement): Range | null {
  const selection = window.getSelection()
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) return selection.getRangeAt(0).cloneRange()
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  return range
}

function placeCaretAtEnd(editor: HTMLDivElement): void {
  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
