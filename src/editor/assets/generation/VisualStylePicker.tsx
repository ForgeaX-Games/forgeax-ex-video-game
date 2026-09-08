import { useMemo, useState } from 'react'
import searchIcon from '@/editor/ui-assets/asset-toolbar-search.svg?url'
import closeIcon from '../../shell/rule-dialog-close.svg?url'
import type { KinoVisualStylePreset } from './visual-style-api'
import { ensureVisualStylePickerStyles } from './visualStylePickerStyles'

ensureVisualStylePickerStyles()

export interface VisualStylePickerProps {
  open: boolean
  styles: readonly KinoVisualStylePreset[]
  loading: boolean
  error: string | null
  selectedKey?: string
  onSelect: (style: KinoVisualStylePreset) => void
  onClose: () => void
  t: (key: string) => string
}

/** Shared visual-style chooser used by both image and video generation surfaces. */
export function VisualStylePicker({
  open,
  styles,
  loading,
  error,
  selectedKey,
  onSelect,
  onClose,
  t,
}: VisualStylePickerProps): JSX.Element | null {
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const categories = useMemo(
    () => [...new Set(styles.flatMap((style) => style.tags).filter(Boolean))],
    [styles],
  )
  const visibleStyles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return styles.filter((style) => (
      (!category || style.tags.includes(category))
      && (!normalizedQuery || style.label.toLocaleLowerCase().includes(normalizedQuery)
        || style.key.toLocaleLowerCase().includes(normalizedQuery))
    ))
  }, [category, query, styles])

  if (!open) return null
  return (
    <div className="vgen-style-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="vgen-style-dialog" role="dialog" aria-modal="true" aria-label={t('videoAssets.generate.stylePicker.title')}>
        <header className="vgen-style-head">
          <h3>{t('videoAssets.generate.stylePicker.title')}</h3>
          <button type="button" aria-label={t('videoAssets.generate.stylePicker.close')} onClick={onClose}>
            <img src={closeIcon} alt="" />
          </button>
        </header>
        <div className="vgen-style-toolbar">
          <div className="vgen-style-categories" role="tablist" aria-label={t('videoAssets.generate.stylePicker.categories')}>
            <button type="button" role="tab" aria-selected={!category} className={!category ? 'is-on' : ''} onClick={() => setCategory('')}>{t('videoAssets.generate.stylePicker.all')}</button>
            {categories.map((tag) => (
              <button key={tag} type="button" role="tab" aria-selected={category === tag} className={category === tag ? 'is-on' : ''} onClick={() => setCategory(tag)}>{tag}</button>
            ))}
          </div>
          <label className="vgen-style-search">
            <img src={searchIcon} alt="" />
            <input value={query} aria-label={t('videoAssets.generate.stylePicker.search')} placeholder={t('videoAssets.generate.stylePicker.search')} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
        <div className="vgen-style-grid">
          {loading ? <p className="vgen-style-message" role="status">{t('videoAssets.generate.stylePicker.loading')}</p> : null}
          {!loading && error ? <p className="vgen-style-message error" role="alert">{t('videoAssets.generate.stylePicker.loadFailed')}: {error}</p> : null}
          {!loading && !error && visibleStyles.length === 0 ? <p className="vgen-style-message">{t('videoAssets.generate.stylePicker.empty')}</p> : null}
          {!loading && !error ? visibleStyles.map((style) => (
            <button
              key={style.key}
              type="button"
              className={`vgen-style-card${style.key === selectedKey ? ' is-selected' : ''}`}
              aria-pressed={style.key === selectedKey}
              onClick={() => onSelect(style)}
            >
              <img src={style.cdnUrl} alt="" loading="lazy" />
              <span>{style.label}</span>
            </button>
          )) : null}
        </div>
      </section>
    </div>
  )
}
