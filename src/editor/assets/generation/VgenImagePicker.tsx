import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useT } from '../../../i18n'
import {
  gvaImageUrl,
  uploadReferenceImage,
} from '../image-assets'
import type { MediaAsset } from '@/authoring/assets/registry-types'

export type VgenImageKind = 'character_ref' | 'scene_ref' | 'keyframe'

export interface VgenImageAsset {
  /** Shared-registry identity used by Extension Host tools. */
  id: string
  /** Provider-native Kino identity retained for asset CRUD compatibility. */
  resourceId?: string
  label: string
  kind: VgenImageKind
  thumbUrl?: string
}

export interface VgenImagePickerProps {
  open: boolean
  gameSlug: string
  imageAssets: readonly VgenImageAsset[]
  requireResourceId?: boolean
  onPick: (asset: VgenImageAsset) => void
  onClose: () => void
  /** Keeps the parent dialog's dismissal guard in sync with an in-flight upload. */
  onUploadingChange?: (uploading: boolean) => void
  uploadRegistryImage?: (gameSlug: string, file: File) => Promise<MediaAsset>
}

type PickerTab = 'all' | VgenImageKind

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'
const ALLOWED_IMAGE_MIMES = new Set(IMAGE_ACCEPT.split(','))

function uploadSceneReference(gameSlug: string, file: File): Promise<MediaAsset> {
  return uploadReferenceImage(gameSlug, file, 'scene')
}

export function VgenImagePicker({
  open,
  gameSlug,
  imageAssets,
  requireResourceId = true,
  onPick,
  onClose,
  onUploadingChange,
  uploadRegistryImage = uploadSceneReference,
}: VgenImagePickerProps): JSX.Element | null {
  const t = useT()
  const titleId = useId()
  const [tab, setTab] = useState<PickerTab>('all')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement
      && !dialogRef.current?.contains(activeElement)
    ) {
      previousFocusRef.current = activeElement
    }
    setTab('all')
    setError(null)
    onUploadingChange?.(false)
    closeRef.current?.focus()
    return () => {
      const previousFocus = previousFocusRef.current
      queueMicrotask(() => {
        if (closeRef.current?.isConnected || !previousFocus?.isConnected) return
        previousFocus.focus()
        if (previousFocusRef.current === previousFocus) previousFocusRef.current = null
      })
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (!uploading) onClose()
    }
    // Capture before the parent surface/window listeners.  Escape must never
    // bubble to the dialog while this child owns dismissal (especially while
    // an upload is still in flight).
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, open, uploading])

  const filteredAssets = useMemo(
    () => tab === 'all' ? imageAssets : imageAssets.filter((asset) => asset.kind === tab),
    [imageAssets, tab],
  )
  const hasUnavailableAssets = requireResourceId
    && filteredAssets.some((asset) => !asset.resourceId)

  if (!open) return null

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
      setError(t('videoAssets.generate.picker.invalidFormat'))
      return
    }
    setUploading(true)
    onUploadingChange?.(true)
    try {
      const registered = await uploadRegistryImage(gameSlug, file)
      const pickerAsset = toVgenImageAsset(registered, gameSlug)
      if (requireResourceId && !pickerAsset.resourceId) {
        throw new Error(t('videoAssets.generate.uploadReferenceFailed'))
      }
      onPick(pickerAsset)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('videoAssets.generate.picker.uploadFailed'))
    } finally {
      setUploading(false)
      onUploadingChange?.(false)
    }
  }

  return (
    <div
      className="vgen-picker-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !uploading) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="vgen-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => trapFocus(event, event.currentTarget)}
      >
        <div className="vgen-picker-head">
          <h3 id={titleId} className="vgen-picker-title">{t('videoAssets.generate.picker.title')}</h3>
          <button
            ref={closeRef}
            type="button"
            className="vgen-picker-close"
            aria-label={t('videoAssets.generate.picker.close')}
            disabled={uploading}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="vgen-picker-tabs" role="tablist" aria-label={t('videoAssets.generate.picker.categories')}>
          {([
            ['all', 'videoAssets.generate.picker.all'],
            ['character_ref', 'videoAssets.generate.picker.character'],
            ['scene_ref', 'videoAssets.generate.picker.scene'],
            ['keyframe', 'videoAssets.generate.picker.keyframe'],
          ] as const).map(([value, key]) => (
            <button
              key={value}
              type="button"
              className="vgen-picker-tab"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <div className="vgen-picker-grid" role="tabpanel">
          {filteredAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="vgen-picker-item"
              style={asset.thumbUrl ? { backgroundImage: `url(${JSON.stringify(asset.thumbUrl)})` } : undefined}
              aria-label={asset.label}
              disabled={requireResourceId && !asset.resourceId}
              title={requireResourceId && !asset.resourceId
                ? t('videoAssets.generate.referenceUnavailable')
                : undefined}
              onClick={() => onPick(asset)}
            >
              <span>{asset.label}</span>
            </button>
          ))}
          {filteredAssets.length === 0 ? (
            <div className="vgen-picker-empty">{t('videoAssets.generate.picker.empty')}</div>
          ) : null}
        </div>
        {hasUnavailableAssets ? (
          <div className="vgen-import-error vgen-error" role="status">
            {t('videoAssets.generate.referenceUnavailable')}
          </div>
        ) : null}
        <div className="vgen-picker-foot">
          <label className="vgen-import" aria-disabled={uploading}>
            <span>{uploading ? t('videoAssets.generate.uploadingReference') : `＋ ${t('videoAssets.generate.picker.import')}`}</span>
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              aria-label={t('videoAssets.generate.picker.import')}
              disabled={uploading}
              onChange={(event) => void onFileChange(event)}
            />
          </label>
          {error ? <div className="vgen-import-error vgen-error" role="alert">{error}</div> : null}
        </div>
      </section>
    </div>
  )
}

export function toVgenImageAsset(asset: MediaAsset, gameSlug: string): VgenImageAsset {
  if (asset.kind !== 'image' || asset.status !== 'ready') {
    throw new Error('Imported image was not registered as a ready shared asset')
  }
  const kind = asset.productionType === 'character_ref'
    ? 'character_ref'
    : asset.productionType === 'scene_ref'
      ? 'scene_ref'
      : asset.productionType === 'shot_image'
        ? 'keyframe'
        : null
  if (!kind) {
    throw new Error('Imported image is missing a supported shared-registry production type')
  }
  const resourceId = asset.provider?.kind === 'kino'
    ? nonEmptyString(asset.provider.upstreamResourceId)
    : nonEmptyString(asset.meta?.kinoResourceId)
  return {
    id: asset.id,
    resourceId,
    label: asset.label ?? asset.name ?? asset.id,
    kind,
    thumbUrl: asset.url ?? (resourceId
      ? gvaImageUrl(resourceId, gameSlug, asset.updatedAt)
      : undefined),
  }
}

function nonEmptyString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function trapFocus(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement): void {
  if (event.key !== 'Tab') return
  const focusable = [...container.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
