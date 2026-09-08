/**
 * component-host —— 「组件基建」SSOT（注册表宿主 + 每游戏组件加载器 + 宿主 API）。
 * 归属 runtime：来源/依赖/使用都在 runtime 层（只消费 registry / skins；被 editor+runtime 消费）。
 *
 * 启动入口（唯一）：`bootComponents(slug?)`
 *   · 同步注册平台内建集（必成）→ 进程内共享默认表
 *   · 有 slug 时再尽力加载游戏专属组件（可失败，fail-soft）
 *
 * Session / 预览 / 引擎一律读同一份默认表（`defaultComponentRegistry` + `defaultSkinRegistry`）；
 * `createDefaultComponentRegistry` / `createCoreSkinRegistry` 只是「确保已 boot 后返回该共享表」。
 *
 * 组件包契约（内建与游戏远程包同一形状）：
 *   `export default [{ component, manifest }, ...]`
 *   宿主统一遍历注册；游戏产物不自带注册表逻辑。
 */
import * as ReactRuntime from 'react'
import type { ComponentType } from 'react'
import {
  defaultComponentRegistry,
  registerComponent,
  unregisterComponent,
  type ComponentDef,
  type ComponentRegistry,
} from '@/runtime/core/registry/component-registry'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import {
  defaultSkinRegistry,
  registerOverlayRenderer,
  unregisterOverlayRenderer,
  type OverlayRendererRegistration,
  type SkinRegistry,
} from './rendererRegistry'
import components from './components'
import { getExtensionHost } from '@/lib/extension-host'

const REACT_RUNTIME_SYMBOL = Symbol.for('forgeax.game-video.react')
const runtimeGlobal = globalThis as unknown as Record<symbol, unknown>
runtimeGlobal[REACT_RUNTIME_SYMBOL] = ReactRuntime

/** 组件包 catalog 条目（与 `components/index.ts` / 游戏仓 dist 同源）。 */
export type ComponentCatalogEntry = {
  component: ComponentType<Record<string, unknown>>
  manifest: ComponentManifest
}

/** 从 ESM 模块取出 catalog 数组（`export default [...]`）。 */
export function pickComponentCatalog(mod: unknown): readonly ComponentCatalogEntry[] | null {
  if (!mod || typeof mod !== 'object') return null
  const candidate = 'default' in mod ? (mod as { default: unknown }).default : mod
  if (!Array.isArray(candidate)) return null
  for (const entry of candidate) {
    if (!entry || typeof entry !== 'object') return null
    const { component, manifest } = entry as Partial<ComponentCatalogEntry>
    if (typeof component !== 'function' && (typeof component !== 'object' || component == null)) return null
    if (!manifest || typeof manifest !== 'object' || typeof manifest.id !== 'string') return null
  }
  return candidate as unknown as ComponentCatalogEntry[]
}

function registerCatalog(entries: readonly ComponentCatalogEntry[]): void {
  for (const { component, manifest } of entries) {
    registerComponent(manifest.id, manifest as unknown as ComponentDef)
    registerOverlayRenderer(manifest.id, component, manifest as unknown as ComponentManifest)
  }
}

let builtinsBooted = false
/** 同步、幂等：把内建 catalog 装进默认契约表与渲染表。 */
function ensureBuiltins(): void {
  if (builtinsBooted) return
  builtinsBooted = true
  registerCatalog(components as readonly ComponentCatalogEntry[])
}

/**
 * 返回进程内共享契约表（与 `bootComponents` 同一份）。
 * 首次调用会同步装入内建集；之后与其它调用方共享同一实例。
 */
export function createDefaultComponentRegistry(): ComponentRegistry {
  ensureBuiltins()
  return defaultComponentRegistry
}

/**
 * 返回进程内共享渲染表（与 `bootComponents` 同一份）。
 * 首次调用会同步装入内建集；之后与其它调用方共享同一实例。
 */
export function createCoreSkinRegistry(): SkinRegistry {
  ensureBuiltins()
  return defaultSkinRegistry
}

/** Live editor catalog: built-ins plus renderable components loaded from the game project. */
export function listComponentCatalogEntries(): ComponentCatalogEntry[] {
  ensureBuiltins()
  return defaultComponentRegistry.listManifests().flatMap((manifest) => {
    const registration: OverlayRendererRegistration | undefined = defaultSkinRegistry
      .getOverlayRenderer(manifest.id)
    return registration
      ? [{ component: registration.component, manifest }]
      : []
  })
}

let activeGameCatalog: { gameId: string; revision: string; componentIds: Set<string> } | null = null
const catalogListeners = new Set<(gameId: string) => void>()

function sourceRevision(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function revisionModuleUrl(moduleUrl: string, revision: string): string {
  if (moduleUrl.startsWith('data:')) return `${moduleUrl}#${revision}`
  const url = new URL(moduleUrl, typeof location === 'undefined' ? 'http://extension.invalid' : location.href)
  url.searchParams.set('wbComponentRevision', revision)
  return url.href
}

export function subscribeGameComponents(listener: (gameId: string) => void): () => void {
  catalogListeners.add(listener)
  return () => catalogListeners.delete(listener)
}

export function isProjectComponent(componentId: string): boolean {
  return activeGameCatalog?.componentIds.has(componentId) ?? false
}

function replaceGameCatalog(
  gameId: string,
  revision: string,
  entries: readonly ComponentCatalogEntry[],
): void {
  for (const id of activeGameCatalog?.componentIds ?? []) {
    unregisterComponent(id)
    unregisterOverlayRenderer(id)
  }
  // A project component may shadow a built-in id. Restore the built-in before
  // applying the next project catalog so deleting that project source is safe.
  registerCatalog(components as readonly ComponentCatalogEntry[])
  registerCatalog(entries)
  activeGameCatalog = {
    gameId,
    revision,
    componentIds: new Set(entries.map(({ manifest }) => manifest.id)),
  }
}

function clearCatalogFromAnotherGame(gameId: string): boolean {
  if (!activeGameCatalog || activeGameCatalog.gameId === gameId) return false
  replaceGameCatalog(gameId, '', [])
  for (const listener of catalogListeners) listener(gameId)
  return true
}

/**
 * 尽力加载并注册某游戏仓的专属组件（幂等 per slug）。
 * 模块须 `export default [{ component, manifest }, ...]`；失败则静默回落内建集。
 */
export async function refreshGameComponents(slug: string | undefined): Promise<boolean> {
  if (!slug) return false
  const url = (() => {
    try {
      return getExtensionHost().gameComponents.moduleUrl('index.js')
    } catch {
      return null
    }
  })()
  return refreshGameComponentsFromUrl(slug, url)
}

/**
 * Loads project components from a host-supplied module URL.
 * Standalone SDK hosts use this entry so the accepted handshake remains the
 * only source of component endpoints.
 */
export async function refreshGameComponentsFromUrl(
  slug: string,
  url: string | null,
): Promise<boolean> {
  ensureBuiltins()
  const clearedPreviousGame = clearCatalogFromAnotherGame(slug)
  if (url) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) return false
      const source = await response.text()
      const revision = sourceRevision(source)
      if (activeGameCatalog?.gameId === slug && activeGameCatalog.revision === revision) return false
      const mod = await import(/* @vite-ignore */ revisionModuleUrl(url, revision))
      const catalog = pickComponentCatalog(mod)
      if (catalog) {
        replaceGameCatalog(slug, revision, catalog)
        for (const listener of catalogListeners) listener(slug)
        return true
      }
    } catch {
      /* 模块不可用 → 回落内建集 */
    }
  }
  return clearedPreviousGame
}

/**
 * 组件启动唯一入口（幂等）。
 * 同步注册平台内建集；有 `slug` 时再异步加载游戏专属组件。
 * 全部写入共享默认表，供 Session / 预览 / 引擎共用。
 */
export async function bootComponents(slug?: string): Promise<void> {
  ensureBuiltins()
  await refreshGameComponents(slug)
}
