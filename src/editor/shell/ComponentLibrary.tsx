import { t as translateUi, tf as formatUi, useT } from '../../i18n'
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
import { createPortal } from 'react-dom'
import {
  isProjectComponent,
  listComponentCatalogEntries,
  refreshGameComponents,
} from '@/runtime/react/component-host'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { reportRenderError } from '@/lib/diagnostics/error-report'
import { overlayContentAndHitTargets } from './overlay-fit-targets'
import { AiParameterFillButton } from './AiParameterFillButton'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { buildOverlayComponentContextReference } from './overlay-agent-context'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useComponentCatalogRevision } from './useComponentCatalogRevision'
import { placeAdaptivePop } from './useBlueprintNavActions'
import { deleteProjectComponent } from '../assets/project-component-client'
import emptyComponentLibraryUrl from '@/editor/ui-assets/entity-empty.svg'

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
  display:flex; align-items:center; gap:7px; min-width:0; font-size:12px; white-space:nowrap;
}
.ocl-breadcrumb strong { color:#ff9c2a; font-weight:500; }
.ocl-breadcrumb span { color:#777; }
.ocl-search {
  flex:0 1 244px; width:244px; height:31px; box-sizing:border-box; border:0; border-radius:5px;
  padding:0 11px 0 31px; color:#d8d8d8; background:#454545;
  font:inherit; outline:none;
  background-image:radial-gradient(circle at 17px 14px, transparent 4px, #969696 4.5px, #969696 5.5px, transparent 6px),
    linear-gradient(45deg, transparent 47%, #969696 48%, #969696 56%, transparent 57%);
  background-size:auto, 7px 7px; background-position:0 0, 19px 18px; background-repeat:no-repeat;
}
.ocl-search::placeholder { color:#8f8f8f; }
.ocl-search:focus { box-shadow:0 0 0 1px #ff9c2a; }
.ocl-grid {
  display:grid; grid-template-columns:repeat(auto-fill, 134px); grid-auto-rows:139px;
  flex:1; align-content:start; gap:0 12px; min-height:0; padding:8px 14px 16px; overflow:auto;
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
.ocl-card[data-library-kind="folder"] .ocl-preview {
  border-radius:0 6px 6px; clip-path:polygon(0 12%,32% 12%,39% 0,100% 0,100% 100%,0 100%);
}
.ocl-ai-slot {
  position:absolute; z-index:2; top:4px; right:4px; display:block;
  width:18px; height:18px; visibility:hidden;
}
.ocl-preview:hover .ocl-ai-slot { visibility:visible; }
.ocl-delete {
  position:absolute; z-index:3; top:4px; left:4px; display:grid; place-items:center;
  width:20px; height:20px; border:0; border-radius:3px; padding:0;
  background:rgba(32,32,32,.8); color:rgba(255,255,255,.7); cursor:pointer;
  opacity:0; pointer-events:none;
}
.ocl-preview:hover .ocl-delete,.ocl-delete:focus-visible,.ocl-delete.is-open { opacity:1; pointer-events:auto; }
.ocl-delete:hover,.ocl-delete.is-open { color:#ff9b9b; background:rgba(84,38,38,.92); }
.ocl-delete svg { width:13px; height:13px; display:block; }
.ocl-delete-error { color:#ffb4b4; }
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
  font-size:10px; line-height:24px;
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

const TrashIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M12.25 2.916H1.75M2.917 2.916h8.166l-.291 9.917H3.208L2.917 2.916ZM4.958 1.166h4.084v1.75H4.958v-1.75Z" stroke="currentColor" strokeWidth="1.167" />
    <path d="M7 5.25v5.25" stroke="currentColor" strokeWidth="1.167" />
  </svg>
)

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
  projectComponent,
  onDeleted,
}: {
  component: ComponentType<Record<string, unknown>>
  id: string
  label: string
  inputs: readonly { key: string; default?: unknown }[]
  manifest: ComponentManifest
  projectComponent: boolean
  onDeleted: (componentId: string) => Promise<void>
}): JSX.Element {
  const previewRef = useRef<HTMLSpanElement>(null)
  const stageRef = useRef<HTMLSpanElement>(null)
  const dragImageRef = useRef<HTMLElement | null>(null)
  const nativeDragImageRef = useRef<HTMLCanvasElement | null>(null)
  const [box, setBox] = useState<PreviewBox | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const deletePopRef = useRef<HTMLDivElement | null>(null)
  const [deletePlacement, setDeletePlacement] = useState<ReturnType<typeof placeAdaptivePop>>(null)
  const props = useMemo(() => previewProps(id, inputs), [id, inputs])
  const Preview = component
  const game = useGraphScenario((s) => s.game)

  useLayoutEffect(() => {
    if (!deleteOpen) {
      setDeletePlacement(null)
      return
    }
    const place = (): void => {
      setDeletePlacement(placeAdaptivePop(deleteTriggerRef.current, {
        width: 220,
        height: deleteError ? 132 : 112,
      }))
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [deleteError, deleteOpen])

  useEffect(() => {
    if (!deleteOpen) setDeleteError(null)
  }, [deleteOpen])
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
      className="ocl-card"
      draggable
      onDragStart={onDragStart}
      onDrag={(event) => moveDragImage(event.clientX, event.clientY)}
      onDragEnd={clearDragImage}
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
        {projectComponent ? (
          <button
            ref={deleteTriggerRef}
            type="button"
            className={`ocl-delete${deleteOpen ? ' is-open' : ''}`}
            aria-label={formatUi('componentLibrary.delete.aria', { name: label })}
            title={translateUi('componentLibrary.delete.title')}
            aria-expanded={deleteOpen}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setDeleteOpen((open) => !open)
            }}
          >
            {TrashIcon}
          </button>
        ) : null}
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
      {deleteOpen && deletePlacement && typeof document !== 'undefined'
        ? createPortal(
          <div
            ref={deletePopRef}
            className="ns-pop-confirm"
            data-side={deletePlacement.side}
            role="dialog"
            aria-label={formatUi('componentLibrary.delete.aria', { name: label })}
            style={deletePlacement.style}
          >
            <span className="ns-pop-arrow" aria-hidden />
            <div className="ns-pop-confirm-msg">
              {formatUi('componentLibrary.delete.message', { name: label })}
              {deleteError ? <div className="ocl-delete-error">{deleteError}</div> : null}
            </div>
            <div className="ns-pop-confirm-actions">
              <button type="button" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>{translateUi('common.cancel')}</button>
              <button
                type="button"
                className="is-danger"
                disabled={deleteBusy}
                onClick={() => {
                  setDeleteBusy(true)
                  setDeleteError(null)
                  void onDeleted(id).then(() => {
                    setDeleteOpen(false)
                  }).catch((cause) => {
                    setDeleteError(cause instanceof Error ? cause.message : translateUi('componentLibrary.delete.failed'))
                  }).finally(() => setDeleteBusy(false))
                }}
              >
                {deleteBusy ? translateUi('componentLibrary.delete.busy') : translateUi('componentLibrary.delete.confirm')}
              </button>
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}

export function ComponentLibrary(): JSX.Element {
  injectStyleOnce('overlay-component-library', LIB_CSS)
  const t = useT()
  const [query, setQuery] = useState('')
  const catalogRevision = useComponentCatalogRevision()
  const game = useGraphScenario((state) => state.game)
  const removeReferences = useGraphScenario((state) => state.removeProjectComponentReferences)
  const deleteComponent = async (componentId: string): Promise<void> => {
    const saved = await removeReferences(componentId)
    if (!saved) throw new Error(translateUi('componentLibrary.delete.saveFailed'))
    await deleteProjectComponent(componentId)
    await refreshGameComponents(game)
  }
  const components = useMemo(() => {
    const catalog = listComponentCatalogEntries()
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return catalog
    return catalog.filter(({ manifest }) => {
      const id = manifest.id
      const label = manifest.label ?? id
      return `${label} ${id}`.toLocaleLowerCase().includes(needle)
    })
  }, [catalogRevision, query])

  return (
    <div className="ocl-root" data-testid="component-library">
      <div className="ocl-toolbar">
        {/* 面包屑暂时隐藏：第二层本应反映 UI 树里当前方案的层级路径，
            但 ComponentLibrary 目前拿不到该上下文。待接通后再恢复。
        <div className="ocl-breadcrumb" aria-label="组件库路径">
          <strong>控件库</strong>
        </div> */}
        <input
          className="ocl-search"
          type="search"
          aria-label={t('ui.copy.346e069b7cd4')}
          placeholder={t('ui.copy.346e069b7cd4')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className={`ocl-grid${components.length === 0 ? ' is-empty' : ''}`}>
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
              projectComponent={isProjectComponent(id)}
              onDeleted={deleteComponent}
            />
          )
        })}
        {components.length === 0 ? (
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
