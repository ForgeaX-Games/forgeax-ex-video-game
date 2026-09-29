import { t as translateUi, useT } from '../../i18n'
/**
 * ComponentLibrary —— 界面 tab 底部的工作区组件库。
 * 直接读取 components 的唯一注册清单，
 * 渲染成可拖拽 chip；拖到画布（OverlayCatalogPreview 的 stage）落地为一个 child。
 * 纯展示：不持有方案数据，落地逻辑在 stage 的 onDrop 里（读 dataTransfer 的组件 id）。
 */
import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type ErrorInfo,
  type JSX,
  type ReactNode,
} from 'react'
import { listComponentCatalogEntries } from '@/runtime/react/component-host'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { reportRenderError } from '@/lib/diagnostics/error-report'
import { overlayContentAndHitTargets } from './overlay-fit-targets'
import { useAdaptiveCatalogGrid } from './useAdaptiveCatalogGrid'
import { AiParameterFillButton } from './AiParameterFillButton'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { buildOverlayComponentContextReference } from './overlay-agent-context'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useComponentCatalogRevision } from './useComponentCatalogRevision'
import emptyComponentLibraryUrl from '@/editor/ui-assets/entity-empty.svg'
import { CatalogSearchInput } from './CatalogSearchInput'
import {
  catalogFolderChildren,
  catalogRootTarget,
  useAssetCatalog,
  type CatalogFolder,
} from '@/editor/assets/asset-catalog'
import componentLibraryFolderIcon from '@/editor/ui-assets/component-library-folder.svg?url'
import { ComponentThumbnail } from './ComponentThumbnail'

/** 拖拽 MIME：库 chip → 画布落地时用它取组件 id。 */
export const OVERLAY_PRESET_MIME = 'application/x-overlay-preset'
const DRAG_POINTER_OFFSET_X_PX = 20
const DRAG_POINTER_OFFSET_Y_PX = 12

const LIB_CSS = `
.ocl-root {
  display:flex; flex-direction:column; min-width:0; height:100%; color:#d5d5d5;
}
.ocl-toolbar {
  display:flex; align-items:center; justify-content:flex-end; gap:16px;
  min-height:42px; padding:0 14px; box-sizing:border-box;
}
.ocl-breadcrumb {
  display:flex; flex:1; align-items:center; gap:6px; min-width:0; padding:0; overflow:hidden; font-size:12px; white-space:nowrap;
}
.ocl-breadcrumb button { border:0; padding:0; color:rgba(255,255,255,.6); background:transparent; font:inherit; cursor:pointer; }
.ocl-breadcrumb button:hover { color:#fff; }
.ocl-breadcrumb strong { color:#fff; font-weight:500; }
.ocl-breadcrumb span { color:rgba(255,255,255,.6); }
.ocl-grid {
  --adaptive-grid-min-column-gap:12px;
  display:grid; grid-template-columns:repeat(var(--adaptive-grid-columns, 1), 134px); grid-auto-rows:139px;
  flex:1; align-content:start; row-gap:0; column-gap:var(--adaptive-grid-column-gap, 12px); min-height:0; padding:8px 14px 16px; overflow:auto;
}
.ocl-grid.is-empty {
  grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); place-items:center;
}
.ocl-card {
  display:flex; flex-direction:column; min-width:0; width:134px; height:139px; padding:7px 0 0; overflow:hidden;
  box-sizing:border-box; border:0; cursor:grab; user-select:none;
  background:transparent; color:#d2d2d2; font:inherit; text-align:center;
  transition:background .12s;
}
.ocl-card:hover { background:transparent; color:#ffc066; }
.ocl-card:active { cursor:grabbing; }
.ocl-preview {
  position:relative; flex:none; width:134px; height:108px; overflow:hidden;
  border-radius:6px; background:rgba(255,255,255,.1);
  transition:background .12s;
}
.ocl-card:hover .ocl-preview { background:rgba(255,255,255,.2); }
.ocl-card.is-dragging .ocl-preview { box-shadow:inset 0 0 0 1px rgba(255,156,42,.6); }
.ocl-card[data-library-kind="folder"] .ocl-preview {
  overflow:visible; border-radius:0; background:transparent;
}
.ocl-folder-card { cursor:pointer; }
.ocl-folder-card .ocl-preview > img { position:absolute; inset:0; width:134px; height:108px; pointer-events:none; }
.ocl-folder-card .ocl-folder-hover-overlay { opacity:0; transition:opacity .12s; }
.ocl-folder-card:hover .ocl-folder-hover-overlay,
.ocl-folder-card:focus-visible .ocl-folder-hover-overlay { opacity:1; }
.ocl-folder-preview {
  position:absolute; z-index:1; top:28px; left:9px; display:grid; width:112px; height:72px;
  grid-template-columns:repeat(3, minmax(0, 1fr)); grid-template-rows:repeat(2, minmax(0, 1fr)); gap:6px;
}
.ocl-folder-preview > span {
  position:relative; display:grid; min-width:0; min-height:0; place-items:center; overflow:hidden;
  border-radius:1.453px; background:rgba(255,255,255,.1);
}
.ocl-folder-preview-folder { width:100%; height:100%; object-fit:fill; }
.ocl-ai-slot {
  position:absolute; z-index:2; top:4px; right:4px; display:block;
  width:18px; height:18px; visibility:hidden;
}
.ocl-preview:hover .ocl-ai-slot { visibility:visible; }
.ocl-ai-quick { pointer-events:auto; }
.ocl-ai-quick img { display:block; width:18px; height:18px; }
.ocl-render-stage {
  position:absolute; left:0; top:0; width:640px; height:360px; container-type:size;
  transform-origin:0 0; pointer-events:none;
}
.ocl-render-stage, .ocl-render-stage * {
  pointer-events:none !important;
}
.ocl-name {
  flex:none; height:24px; padding:0 4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:12px; line-height:24px;
}
.ocl-empty {
  display:flex; flex-direction:column; align-items:center; gap:8px; width:148px; padding:0;
  color:rgba(255,255,255,.4); font-size:16px; line-height:24px; text-align:center;
}
.ocl-empty-mark { display:grid; place-items:center; width:80px; height:80px; }
.ocl-empty-mark img { display:block; width:72px; height:80px; }
.ocl-drag-image {
  position:fixed; left:0; top:0; z-index:2147483647; overflow:hidden;
  background:transparent; pointer-events:none;
}
`

const PREVIEW_INPUT_OVERRIDES: Record<string, Record<string, unknown>> = {
  Dialogue: { speaker: '角色', text: '示例对白' },
}

function previewProps(
  componentId: string,
  inputs: readonly { key: string; default?: unknown }[],
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
    inputs
      .filter((input) => input.default !== undefined)
      .map((input) => [input.key, input.default]),
    ),
    ...PREVIEW_INPUT_OVERRIDES[componentId],
  }
}

type PreviewBox = {
  left: number
  top: number
  width: number
  height: number
  previewWidth: number
  previewHeight: number
}

class ComponentPreviewBoundary extends Component<{
  componentId: string
  resetKey: unknown
  children: ReactNode
}, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidUpdate(previous: Readonly<{ resetKey: unknown }>): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportRenderError({
      error,
      reactStack: info.componentStack,
      region: 'component-library-preview',
      context: { componentId: this.props.componentId },
    })
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

function ComponentCard({
  component,
  id,
  label,
  inputs,
  manifest,
}: {
  component: ComponentType<Record<string, unknown>>
  id: string
  label: string
  inputs: readonly { key: string; default?: unknown }[]
  manifest: ComponentManifest
}): JSX.Element {
  const previewRef = useRef<HTMLSpanElement>(null)
  const stageRef = useRef<HTMLSpanElement>(null)
  const dragImageRef = useRef<HTMLElement | null>(null)
  const nativeDragImageRef = useRef<HTMLCanvasElement | null>(null)
  const [box, setBox] = useState<PreviewBox | null>(null)
  const [dragging, setDragging] = useState(false)
  const props = useMemo(() => previewProps(id, inputs), [id, inputs])
  const Preview = component
  const game = useGraphScenario((s) => s.game)

  function referenceComponent(): void {
    if (!forgeaxHost.available) return
    forgeaxHost.composer.insertReference(buildOverlayComponentContextReference({
      gameId: game,
      manifest,
    }))
  }

  useLayoutEffect(() => {
    const preview = previewRef.current
    const stage = stageRef.current
    if (!preview || !stage) return
    const measure = (): void => {
      const stageRect = stage.getBoundingClientRect()
      const previewRect = preview.getBoundingClientRect()
      const scaleX = stageRect.width / 640 || 1
      const scaleY = stageRect.height / 360 || scaleX
      const targets = overlayContentAndHitTargets(stage)
      const rects = targets.map((target) => target.getBoundingClientRect()).filter((rect) => rect.width && rect.height)
      if (!rects.length) return
      const left = (Math.min(...rects.map((rect) => rect.left)) - stageRect.left) / scaleX
      const top = (Math.min(...rects.map((rect) => rect.top)) - stageRect.top) / scaleY
      const right = (Math.max(...rects.map((rect) => rect.right)) - stageRect.left) / scaleX
      const bottom = (Math.max(...rects.map((rect) => rect.bottom)) - stageRect.top) / scaleY
      const next = {
        left,
        top,
        width: right - left,
        height: bottom - top,
        previewWidth: previewRect.width,
        previewHeight: previewRect.height,
      }
      setBox((current) =>
        current
        && Math.abs(current.left - next.left) < 0.5
        && Math.abs(current.top - next.top) < 0.5
        && Math.abs(current.width - next.width) < 0.5
        && Math.abs(current.height - next.height) < 0.5
        && Math.abs(current.previewWidth - next.previewWidth) < 0.5
        && Math.abs(current.previewHeight - next.previewHeight) < 0.5
          ? current
          : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(preview)
    stage.addEventListener('load', measure, true)
    return () => {
      observer?.disconnect()
      stage.removeEventListener('load', measure, true)
    }
  }, [])

  const scale = box
    ? Math.min((box.previewWidth - 8) / box.width, (box.previewHeight - 6) / box.height)
    : 0.2
  const transform = box
    ? `translate(${box.previewWidth / 2 - (box.left + box.width / 2) * scale}px, ${box.previewHeight / 2 - (box.top + box.height / 2) * scale}px) scale(${scale})`
    : 'translate(-274px, -150px) scale(.2)'

  const clearDragImage = (): void => {
    dragImageRef.current?.remove()
    nativeDragImageRef.current?.remove()
    dragImageRef.current = null
    nativeDragImageRef.current = null
  }

  const moveDragImage = (clientX: number, clientY: number): void => {
    const ghost = dragImageRef.current
    if (!ghost || (clientX === 0 && clientY === 0)) return
    ghost.style.left = `${Math.round(clientX + DRAG_POINTER_OFFSET_X_PX)}px`
    ghost.style.top = `${Math.round(clientY + DRAG_POINTER_OFFSET_Y_PX)}px`
  }

  const onDragStart = (event: DragEvent<HTMLDivElement>): void => {
    setDragging(true)
    event.dataTransfer.setData(OVERLAY_PRESET_MIME, id)
    event.dataTransfer.setData('text/plain', label)
    event.dataTransfer.effectAllowed = 'copy'
    const stage = stageRef.current
    if (!stage || !box) return
    clearDragImage()
    const ghost = document.createElement('div')
    ghost.className = 'ocl-drag-image'
    ghost.style.width = `${Math.max(1, Math.round(box.width))}px`
    ghost.style.height = `${Math.max(1, Math.round(box.height))}px`
    const clone = stage.cloneNode(true) as HTMLElement
    clone.style.transform = `translate(${-box.left}px, ${-box.top}px)`
    ghost.appendChild(clone)
    document.body.appendChild(ghost)
    dragImageRef.current = ghost
    moveDragImage(event.clientX, event.clientY)
    const transparentDragImage = document.createElement('canvas')
    transparentDragImage.width = 1
    transparentDragImage.height = 1
    transparentDragImage.style.position = 'fixed'
    transparentDragImage.style.left = '0'
    transparentDragImage.style.top = '0'
    transparentDragImage.style.pointerEvents = 'none'
    transparentDragImage.getContext('2d')?.fillRect(0, 0, 1, 1)
    document.body.appendChild(transparentDragImage)
    nativeDragImageRef.current = transparentDragImage
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0)
  }

  return (
    <div
      className={`ocl-card${dragging ? ' is-dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDrag={(event) => moveDragImage(event.clientX, event.clientY)}
      onDragEnd={() => { setDragging(false); clearDragImage() }}
      title={`${translateUi('ui.template.fdba810a753a')}${label}（${id}）`}
      data-component-id={id}
    >
      <span ref={previewRef} className="ocl-preview">
        <span
          ref={stageRef}
          className="ocl-render-stage"
          aria-hidden
          style={{ transform, visibility: box ? 'visible' : 'hidden' }}
        >
          <ComponentPreviewBoundary componentId={id} resetKey={Preview}>
            <Preview {...props} preview previewTimeMs={400} />
          </ComponentPreviewBoundary>
        </span>
        <span className="ocl-ai-slot">
          <AiParameterFillButton
            className="ocl-ai-quick"
            ariaLabel="AI 配置该组件"
            title={translateUi('ui.copy.90bfb983192a')}
            onClick={referenceComponent}
          />
        </span>
      </span>
      <span className="ocl-name">{label}</span>
    </div>
  )
}

type CatalogComponentEntry = ReturnType<typeof listComponentCatalogEntries>[number]
type FolderPreviewEntry =
  | { kind: 'folder' }
  | { kind: 'component'; entry: CatalogComponentEntry }

function folderPreviewEntries(
  catalog: ReturnType<typeof useAssetCatalog>['catalog'],
  folderId: string,
  entries: readonly CatalogComponentEntry[],
): FolderPreviewEntry[] {
  return [
    ...catalogFolderChildren(catalog, folderId, 'control').map((): FolderPreviewEntry => ({ kind: 'folder' })),
    ...entries.flatMap((entry): FolderPreviewEntry[] => {
      const placement = catalog.placements[`control:${entry.manifest.id}`]
      const target = placement?.folderId ?? catalogRootTarget('control')
      return target === folderId ? [{ kind: 'component', entry }] : []
    }),
  ].slice(0, 6)
}

function ControlFolderCard({
  folder,
  onOpen,
  previewEntries,
}: {
  folder: CatalogFolder
  onOpen: () => void
  previewEntries: readonly FolderPreviewEntry[]
}): JSX.Element {
  return (
    <div
      className="ocl-card ocl-folder-card"
      data-library-kind="folder"
      data-folder-id={folder.id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="ocl-preview" aria-hidden>
        <img src={componentLibraryFolderIcon} alt="" />
        <img className="ocl-folder-hover-overlay" src={componentLibraryFolderIcon} alt="" />
        <span className="ocl-folder-preview">
          {previewEntries.map((entry, index) => (
            <span key={`${entry.kind}-${entry.kind === 'component' ? entry.entry.manifest.id : index}`}>
              {entry.kind === 'folder'
                ? <img className="ocl-folder-preview-folder" src={componentLibraryFolderIcon} alt="" />
                : <ComponentThumbnail component={entry.entry.component} manifest={entry.entry.manifest} />}
            </span>
          ))}
        </span>
      </span>
      <span className="ocl-name">{folder.name}</span>
    </div>
  )
}

export function ComponentLibrary({
  query: queryProp,
  onQueryChange,
  showSearch = true,
}: {
  query?: string
  onQueryChange?: (query: string) => void
  showSearch?: boolean
} = {}): JSX.Element {
  injectStyleOnce('overlay-component-library', LIB_CSS)
  const t = useT()
  const [localQuery, setLocalQuery] = useState('')
  const query = queryProp ?? localQuery
  const setQuery = onQueryChange ?? setLocalQuery
  const catalogRevision = useComponentCatalogRevision()
  const game = useGraphScenario((state) => state.game)
  const { catalog } = useAssetCatalog(game)
  const rootTarget = catalogRootTarget('control')
  const [target, setTarget] = useState(rootTarget)
  const activeFolder = target === rootTarget
    ? null
    : catalog.folders.find((folder) => folder.id === target && folder.tabKind === 'control') ?? null
  const folders = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return catalogFolderChildren(catalog, target, 'control')
      .filter((folder) => !needle || folder.name.toLocaleLowerCase().includes(needle))
  }, [catalog, query, target])

  useEffect(() => {
    if (target !== rootTarget && !activeFolder) setTarget(rootTarget)
  }, [activeFolder, rootTarget, target])

  const entries = useMemo(() => listComponentCatalogEntries(), [catalogRevision])
  const components = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return entries.filter((entry) => {
      const { manifest } = entry
      const id = manifest.id
      const label = manifest.label ?? id
      const placement = catalog.placements[`control:${id}`]
      const folderId = placement?.folderId ?? rootTarget
      return folderId !== 'hidden:control'
        && folderId === target
        && (!needle || `${label} ${id}`.toLocaleLowerCase().includes(needle))
    })
  }, [catalog, entries, query, rootTarget, target])
  const grid = useAdaptiveCatalogGrid({ itemCount: folders.length + components.length, cardWidth: 134, minColumnGap: 12 })

  return (
    <div className="ocl-root" data-testid="component-library">
      {showSearch ? (
        <div className="ocl-toolbar">
          <CatalogSearchInput
            ariaLabel={t('ui.copy.346e069b7cd4')}
            placeholder={t('ui.copy.346e069b7cd4')}
            value={query}
            onChange={setQuery}
          />
        </div>
      ) : null}
      <div className="ocl-library-head">
        <nav className="ocl-breadcrumb" aria-label={translateUi('ui.copy.af222a3bb664')}>
          {activeFolder ? <><button type="button" onClick={() => setTarget(rootTarget)}>{translateUi('ui.copy.af222a3bb664')}</button><span aria-hidden="true">›</span><strong>{activeFolder.name}</strong></> : <strong>{translateUi('ui.copy.af222a3bb664')}</strong>}
        </nav>
      </div>
      <div ref={grid.ref} style={grid.style} className={`ocl-grid${folders.length === 0 && components.length === 0 ? ' is-empty' : ''}`}>
        {folders.map((folder) => (
          <ControlFolderCard
            key={folder.id}
            folder={folder}
            onOpen={() => setTarget(folder.id)}
            previewEntries={folderPreviewEntries(catalog, folder.id, entries)}
          />
        ))}
        {components.map(({ component, manifest }) => {
          const id = manifest.id
          const label = manifest.label ?? id
          return (
            <ComponentCard
              key={id}
              component={component as ComponentType<Record<string, unknown>>}
              id={id}
              label={label}
              inputs={manifest.inputs ?? []}
              manifest={manifest}
            />
          )
        })}
        {folders.length === 0 && components.length === 0 ? (
          <div className="ocl-empty" role="status">
            <span className="ocl-empty-mark">
              <img src={emptyComponentLibraryUrl} alt="" aria-hidden="true" />
            </span>
            <span>{t('componentLibrary.empty')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
