import {
  acquireHostInit,
  releaseHostInit as releaseRewrite,
  type RewriteRule,
} from '../lib/forgeax-http'
import {
  clearExtensionHost,
  setExtensionHost,
  type ExtensionHostClient,
} from '../lib/extension-host'
import { setInjectedAcceptReference } from '../platform/HostSdkBridge'
import type { ContextReference } from '../platform/context-reference'
import type { DocumentType } from '@/authoring/assets/registry-types'
import {
  resetPendingDocumentTypes,
  setPendingDocumentTypes,
} from './persist/pendingDocumentsStore'
import { setHostGameSlug } from './persist/gameScope'
import type { Locale } from '../i18n'
import {
  setDesignOptionsGate,
  type DesignOptionsGate,
} from './documents/design-options-gate'

export type ExtensionInitOptions = {
  rewrite?: RewriteRule[]
  pane?: 'left' | 'center' | null
  slug?: string | null
  /**
   * A ready extension client for in-process mounts. Without it the extension
   * falls back to the iframe handshake, which has no parent to answer it.
   */
  host?: ExtensionHostClient
  /**
   * In-process `chat.reference.accept@1` channel. When provided, "引用到 Chat"
   * calls this directly instead of falling back to the iframe
   * `FORGEAX_COMPOSER_INSERT` postMessage handshake.
   */
  acceptReference?: (reference: ContextReference) => void | Promise<unknown>
  /**
   * Host-owned DOM slot for the node inspector panel. When set, GraphStudio
   * portals the panel here and skips the canvas-embedded inspector.
   */
  inspectorEl?: HTMLElement
  /** Host-owned DOM slot for video generation inside the node preview column. */
  videoGenerationEl?: HTMLElement
  /**
   * Host-owned DOM slot for the node preview surface (video + timeline) and its
   * toggle pill. Only honoured together with `inspectorEl`: it splits the node
   * panel's two columns into two host-positioned surfaces, so the form can track
   * a resizable host sidebar while the preview stays a sibling beside it.
   */
  previewEl?: HTMLElement
  /**
   * Fired when the preview drawer opens or closes, so a host owning `previewEl`
   * can size its column. Errors thrown by the callback are swallowed.
   */
  onPreviewOpenChange?: (open: boolean) => void
  /**
   * Fired when canvas node selection changes. Pass `null` when selection clears.
   * Errors thrown by the callback are swallowed so selection still updates.
   */
  onNodeSelect?: (nodeId: string | null) => void
  /**
   * Declares what the host's inspector tab shows. Every view that fills
   * `inspectorEl` owns its own label, so the tab beside Agent is a generic slot
   * rather than a blueprint-only "节点编辑".
   *
   * `selected` drives the host's auto-switch: true focuses the slot tab, false
   * returns to Agent. Errors thrown by the callback are swallowed.
   */
  onInspectorTabChange?: (tab: { label: string, selected: boolean }) => void
  /** Fired when the node preview column's video generation tab opens/closes. */
  onVideoGenerationTabChange?: (tab: { label: string, selected: boolean, available: boolean }) => void
  /**
   * Host-owned DOM slot for document header actions (e.g. author gate bar).
   * DocumentLibraryView hosts this element under `.gdx-header`; the host keeps
   * React ownership of the slot's children.
   */
  docActionSlotEl?: HTMLElement
  /**
   * Initial pending document types for sidebar badges. Live updates go through
   * `GameVideoMountHandle.setPendingDocumentTypes` without remounting.
   */
  pendingDocumentTypes?: DocumentType[]
  /** Live actions for the design-options Slide (apply and regenerate). */
  designOptionsGate?: DesignOptionsGate | null
  /**
   * When true, an `uninitialized` package is seeded silently (via the extension
   * `createSeed` empty library) instead of showing the "从模板新建" guide. Hosts
   * opt in per mount; the default preserves the manual confirmation.
   */
  autoInitialize?: boolean
  /**
   * Host-controlled UI locale for in-process mounts. The mount handle can
   * update it without remounting when the host language changes.
   */
  locale?: Locale
}

/**
 * 宿主插槽当前是否是激活页签。宿主的 Agent 页签在前时节点面板整个不可见，
 * 预览抽屉与它的开关拉片也就没有意义（拉片挂在画布上，宿主藏不掉）。
 * 没有宿主插槽的形态（standalone / dev host）恒为 true。
 */
let inspectorActive = true
const inspectorActiveListeners = new Set<() => void>()

export function setInspectorActive(active: boolean): void {
  if (inspectorActive === active) return
  inspectorActive = active
  inspectorActiveListeners.forEach((listener) => listener())
}

export function getInspectorActive(): boolean {
  return inspectorActive
}

export function subscribeInspectorActive(cb: () => void): () => void {
  inspectorActiveListeners.add(cb)
  return () => {
    inspectorActiveListeners.delete(cb)
  }
}

/** Refcount so nested in-process mounts do not tear each other's host down. */
let hostCount = 0
/** Matches every applyHostInit (with or without host) for inspector option lifetime. */
let initDepth = 0

let activeInspectorEl: HTMLElement | undefined
let activeVideoGenerationEl: HTMLElement | undefined
let activePreviewEl: HTMLElement | undefined
let activeOnNodeSelect: ((nodeId: string | null) => void) | undefined
let activeOnPreviewOpenChange: ((open: boolean) => void) | undefined
let activeOnInspectorTabChange:
  | ((tab: { label: string, selected: boolean }) => void)
  | undefined
let activeOnVideoGenerationTabChange:
  | ((tab: { label: string, selected: boolean, available: boolean }) => void)
  | undefined
let activeDocActionSlotEl: HTMLElement | undefined

export function getInspectorMountOptions(): {
  inspectorEl: HTMLElement | undefined
  videoGenerationEl: HTMLElement | undefined
  previewEl: HTMLElement | undefined
  onNodeSelect: ((nodeId: string | null) => void) | undefined
  onPreviewOpenChange: ((open: boolean) => void) | undefined
  onInspectorTabChange:
    | ((tab: { label: string, selected: boolean }) => void)
    | undefined
  onVideoGenerationTabChange:
    | ((tab: { label: string, selected: boolean, available: boolean }) => void)
    | undefined
} {
  return {
    inspectorEl: activeInspectorEl,
    videoGenerationEl: activeVideoGenerationEl,
    previewEl: activePreviewEl,
    onNodeSelect: activeOnNodeSelect,
    onPreviewOpenChange: activeOnPreviewOpenChange,
    onInspectorTabChange: activeOnInspectorTabChange,
    onVideoGenerationTabChange: activeOnVideoGenerationTabChange,
  }
}

export function getDocumentMountOptions(): {
  docActionSlotEl: HTMLElement | undefined
} {
  return { docActionSlotEl: activeDocActionSlotEl }
}

export function applyHostInit(options: ExtensionInitOptions = {}): void {
  acquireHostInit(options.rewrite)
  initDepth += 1
  // 进程内挂载没有 URL slug，跨 tab 同步频道要靠这里拿到 game 标识才能隔离。
  if (options.slug !== undefined) setHostGameSlug(options.slug)
  activeInspectorEl = options.inspectorEl
  activeVideoGenerationEl = options.videoGenerationEl
  activePreviewEl = options.previewEl
  activeOnNodeSelect = options.onNodeSelect
  activeOnPreviewOpenChange = options.onPreviewOpenChange
  activeOnInspectorTabChange = options.onInspectorTabChange
  activeOnVideoGenerationTabChange = options.onVideoGenerationTabChange
  // A dual-pane host mounts the left pane without a slot; keeping the previous
  // element avoids erasing the center pane's document header actions.
  if (options.docActionSlotEl) activeDocActionSlotEl = options.docActionSlotEl
  if (options.pendingDocumentTypes !== undefined) {
    setPendingDocumentTypes(options.pendingDocumentTypes)
  }
  if (options.designOptionsGate !== undefined) setDesignOptionsGate(options.designOptionsGate)
  if (options.acceptReference) setInjectedAcceptReference(options.acceptReference)
  if (!options.host) return
  setExtensionHost(options.host)
  hostCount += 1
}

export function releaseHostInit(): void {
  releaseRewrite()
  initDepth = Math.max(0, initDepth - 1)
  if (initDepth === 0) {
    activeInspectorEl = undefined
    activeVideoGenerationEl = undefined
    activePreviewEl = undefined
    activeOnNodeSelect = undefined
    activeOnPreviewOpenChange = undefined
    activeOnInspectorTabChange = undefined
    activeOnVideoGenerationTabChange = undefined
    activeDocActionSlotEl = undefined
    resetPendingDocumentTypes()
    setDesignOptionsGate(null)
    setInspectorActive(true)
  }
  if (hostCount <= 0) return
  hostCount -= 1
  if (hostCount === 0) {
    clearExtensionHost()
    setInjectedAcceptReference(null)
  }
}

export function resetHostInjectionForTests(): void {
  hostCount = 0
  initDepth = 0
  activeInspectorEl = undefined
  activeVideoGenerationEl = undefined
  activePreviewEl = undefined
  activeOnNodeSelect = undefined
  activeOnPreviewOpenChange = undefined
  activeOnInspectorTabChange = undefined
  activeOnVideoGenerationTabChange = undefined
  activeDocActionSlotEl = undefined
  resetPendingDocumentTypes()
  setDesignOptionsGate(null)
  setInspectorActive(true)
  clearExtensionHost()
  setInjectedAcceptReference(null)
}
