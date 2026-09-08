/**
 * 视频游戏工坊 —— 宿主在**进程内**嵌入时的挂载入口（graph-only）。
 *
 * 说明：主界面（interface）常规是通过 iframe 加载 `dist/index.html`（见 manifest
 * `entry.frontend` + split panes，URL 带 `?pane=left|center`）。这个 `mount()` 只服务
 * 于「宿主想在自己的 React 树里直接挂载」的备用路径，渲染的就是 `GraphApp`。
 *
 * 典型用法：
 * ```ts
 * import { mount } from '@forgeax-extension/game-video'
 * const handle = mount(document.getElementById('host')!, {
 *   host: extensionClient,
 *   inspectorEl: document.getElementById('inspector')!,
 *   onNodeSelect: (id) => console.log(id),
 * })
 * handle.unmount()
 * ```
 *
 * 进程内没有 parent iframe 可握手，宿主必须经 `options.host` 注入一个已就绪的
 * extension client，否则 GameBootstrap 会卡在 `host.ready()`。
 *
 * 可选 `inspectorEl`：节点配置面板 portal 到该 DOM（画布内不再嵌面板）；
 * `onNodeSelect` 在选中/取消选中时回调。再传 `previewEl` 时视频预览与开关拉片
 * 拆到该 DOM（宿主自己定位、自己控宽），`onPreviewOpenChange` 回报展开态。
 * `unmount()` 同时卸画布根与两个宿主 slot 的内容。
 *
 * 可选 `docActionSlotEl`：文档头动作槽由 DocumentLibraryView 挂到 `.gdx-header`；
 * `openDocument` / `setPendingDocumentTypes` 供宿主驱动文档视图与侧栏角标。
 */
import { createRoot, type Root } from 'react-dom/client'
import { GraphApp } from './GraphApp'
import { ErrorToastHost, RenderErrorBoundary } from './diagnostics'
import { registerEditorDiagnosticContext } from './diagnostics/editor-context'
import { clearErrorReports } from '@/lib/diagnostics/error-report'
import {
  applyHostInit,
  releaseHostInit,
  setInspectorActive,
  type ExtensionInitOptions,
} from './host-init'
import type { DocumentType } from '@/authoring/assets/registry-types'
import { useDocumentNav } from './persist/documentNavStore'
import { topViewOf, useGraphView, type TopView } from './persist/graphViewStore'
import { setPendingDocumentTypes as writePendingDocumentTypes } from './persist/pendingDocumentsStore'
import { setDesignOptionsGate as writeDesignOptionsGate, type DesignOptionsGate } from './documents/design-options-gate'
import { initLocaleSync, setLocale as setExtensionLocale, type Locale } from '../i18n'
import { applyProductionProjection, navigatePage } from './persist/pageNavigation'
import type { ProductionProjection, PageLocation } from '../workflow/contracts'
import './styles/global.css'

export type { ExtensionInitOptions }
export type { Locale }
export { forgeaxHttp, type RewriteRule } from '../lib/forgeax-http'
export { applyHostInit } from './host-init'
export type { ExtensionHostClient } from '../lib/extension-host'

/** 宿主顶栏两档切换器的档位；所有编辑视图共用 `workfile`。 */
export type GameVideoTopView = TopView
export type { ProductionProjection, PageLocation } from '../workflow/contracts'

let activeMountCount = 0

export interface GameVideoMountHandle {
  unmount(): void
  openDocument(type: DocumentType): void
  setPendingDocumentTypes(types: readonly DocumentType[]): void
  setDesignOptionsGate(gate: DesignOptionsGate | null): void
  /**
   * 宿主插槽页签的激活态。宿主把 Agent 页签切到前台时传 false：节点面板不可见，
   * 预览抽屉与挂在画布上的开关拉片一并收起（拉片在扩展 DOM 里，宿主藏不掉）。
   */
  setInspectorActive(active: boolean): void
  getTopView(): GameVideoTopView
  /**
   * 顶栏两档切换。与侧栏「试玩」写的是同一个 view store，所以两处入口天然同步；
   * `'workfile'` 回到进试玩前的那个编辑视图，不硬编码回蓝图。
   */
  setTopView(view: GameVideoTopView): void
  /** 只在档位真的换了时回调——侧栏在编辑视图之间跳不该惊动顶栏。 */
  subscribeTopView(listener: (view: GameVideoTopView) => void): () => void
  /** Update every mounted game-video component to the host locale. */
  setLocale(locale: Locale): void
  /** Host/Agent semantic navigation. This never reaches into DOM selectors. */
  navigate(location: PageLocation): boolean
  /** Apply a versioned server-side projection and follow its focus when enabled. */
  setProductionProjection(projection: ProductionProjection): void
}

export function mount(
  rootEl: HTMLElement,
  options: ExtensionInitOptions = {},
): GameVideoMountHandle {
  if (!rootEl) {
    throw new Error('[game-video] mount() requires a non-null host element')
  }
  applyHostInit(options)
  initLocaleSync(options.locale)
  // Portaled panels live in host-owned slots outside the React root. Give
  // every extension-owned mount surface the same scope so tokens/resets keep
  // working there without leaking back to the host document.
  const scopeElements = Array.from(new Set([
    rootEl,
    options.inspectorEl,
    options.videoGenerationEl,
    options.previewEl,
    options.docActionSlotEl,
  ].filter((element): element is HTMLElement => element !== undefined)))
  const portalSlotElements = Array.from(new Set([
    options.inspectorEl,
    options.videoGenerationEl,
    options.previewEl,
    options.docActionSlotEl,
  ].filter((element): element is HTMLElement => element !== undefined && element !== rootEl)))
  const addedScopeElements = scopeElements.filter((element) => {
    if (element.classList.contains('ks-app-host')) return false
    element.classList.add('ks-app-host')
    return true
  })
  const addedPortalSlotElements = portalSlotElements.filter((element) => {
    // The host owns each portal slot's dimensions and positioning. This marker
    // keeps extension tokens available without applying root layout rules.
    if (element.classList.contains('ks-app-host-slot')) return false
    element.classList.add('ks-app-host-slot')
    return true
  })
  const reactRoot: Root = createRoot(rootEl)
  if (activeMountCount === 0) clearErrorReports()
  activeMountCount += 1
  const releaseDiagnosticContext = registerEditorDiagnosticContext(options.slug ?? undefined)
  let unmounted = false
  reactRoot.render(
    <>
      <RenderErrorBoundary
        region="editor-root"
        variant="root"
        context={{ gameId: options.slug }}
      >
        <GraphApp
          pane={options.pane}
          gameId={options.slug ?? undefined}
          autoInitialize={options.autoInitialize}
        />
      </RenderErrorBoundary>
      <RenderErrorBoundary region="diagnostics-toast" variant="silent">
        <ErrorToastHost />
      </RenderErrorBoundary>
    </>,
  )
  const inspectorEl = options.inspectorEl
  const videoGenerationEl = options.videoGenerationEl
  const previewEl = options.previewEl
  const docActionSlotEl = options.docActionSlotEl
  return {
    openDocument(type: DocumentType): void {
      useDocumentNav.getState().setDocumentType(type)
      useGraphView.getState().setView('documents')
    },
    setPendingDocumentTypes(types: readonly DocumentType[]): void {
      writePendingDocumentTypes(types)
    },
    setDesignOptionsGate(gate: DesignOptionsGate | null): void {
      writeDesignOptionsGate(gate)
    },
    setInspectorActive,
    getTopView(): GameVideoTopView {
      return topViewOf(useGraphView.getState().view)
    },
    setTopView(view: GameVideoTopView): void {
      useGraphView.getState().setTopView(view)
    },
    subscribeTopView(listener: (view: GameVideoTopView) => void): () => void {
      let current = topViewOf(useGraphView.getState().view)
      return useGraphView.subscribe((state) => {
        const next = topViewOf(state.view)
        if (next === current) return
        current = next
        listener(next)
      })
    },
    setLocale(locale: Locale): void {
      setExtensionLocale(locale)
    },
    navigate(location: PageLocation): boolean {
      return navigatePage(location, { source: 'host' })
    },
    setProductionProjection(projection: ProductionProjection): void {
      applyProductionProjection(projection)
    },
    unmount: () => {
      if (unmounted) return
      unmounted = true
      try {
        reactRoot.unmount()
      } finally {
        addedScopeElements.forEach((element) => element.classList.remove('ks-app-host'))
        addedPortalSlotElements.forEach((element) => element.classList.remove('ks-app-host-slot'))
        // Portal content unmounts with the canvas root; clear the host slots for remounts.
        if (inspectorEl) inspectorEl.replaceChildren()
        if (videoGenerationEl) videoGenerationEl.replaceChildren()
        if (previewEl) previewEl.replaceChildren()
        if (docActionSlotEl) docActionSlotEl.replaceChildren()
        releaseDiagnosticContext()
        activeMountCount = Math.max(0, activeMountCount - 1)
        if (activeMountCount === 0) clearErrorReports()
        releaseHostInit()
      }
    },
  }
}
