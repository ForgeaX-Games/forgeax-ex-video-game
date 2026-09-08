/**
 * Player 渲染器 registry —— 按 `component`（顶层组件 id）派发**独立 React 组件**。
 *
 * 一律经 RuntimeComponentHost 解析 numberExpr / bind+attr 后，以扁平 props 交给叶子。
 * 事件经 `emit` → session.emitEvent。
 */
import { Component, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import type { OverlaySnap, OverlayMountSnap, HudSnap } from '@/runtime/core/engine/session'
import type { ConditionTarget } from '@/runtime/core/engine/condition'
import { childWrapStyle, layoutHasExplicitSize, mountWrapStyle } from '@/runtime/core/schema/layout'
import {
  RuntimeComponentHost,
  type OverlayRendererRegistration,
} from './RuntimeComponentHost'
import { reportRenderError } from '@/lib/diagnostics/error-report'

export type { OverlayRendererRegistration } from './RuntimeComponentHost'
export { PlayerRootContext, usePlayerKeyGate } from '../input/playerFocus'

/** 皮肤组件渲染时可读的游戏态上下文（vars/entities/score/flags）。 */
export interface SkinCtx {
  hud: HudSnap
  /**
   * 选项门控求值目标（与引擎 condition 同源）。
   * 试玩面应注入 `runtime.state`；缺省时皮肤可自行用 hud 拼弱化态。
   */
  condition?: ConditionTarget
}

/** @deprecated 叶子已改扁平 props；保留类型仅供少数仍引用 OverlayProps 的旧测试/工具。 */
export interface OverlayProps {
  overlay: OverlaySnap
  emit?: (key: string) => void
  ctx?: SkinCtx
  preview?: boolean
  previewTimeMs?: number
  previewPlaying?: boolean
}
export type OverlayComponent = ComponentType<OverlayProps>

class SkinErrorBoundary extends Component<{
  name: string
  resetKey: unknown
  fallback?: ReactNode
  children: ReactNode
}, { err: Error | null }> {
  override state: { err: Error | null } = { err: null }
  static getDerivedStateFromError(err: Error): { err: Error } {
    return { err }
  }
  override componentDidUpdate(previous: Readonly<{ resetKey: unknown }>): void {
    if (this.state.err && previous.resetKey !== this.props.resetKey) {
      this.setState({ err: null })
    }
  }
  override componentDidCatch(err: Error, info: ErrorInfo): void {
    reportRenderError({
      error: err,
      reactStack: info.componentStack,
      region: 'project-component',
      context: { componentId: this.props.name },
    })
    // eslint-disable-next-line no-console
    console.error(`[skin:${this.props.name}] 渲染出错，已隔离：`, err, info?.componentStack)
  }
  override render(): ReactNode {
    if (this.state.err) return this.props.fallback ?? null
    return this.props.children
  }
}

/** Overlay 渲染表（缺省进程内共享一份；测试/特殊路径可自建注入）。 */
export class SkinRegistry {
  private readonly overlay = new Map<string, OverlayRendererRegistration>()

  registerOverlayRenderer(
    kind: string,
    c: ComponentType<Record<string, unknown>>,
    manifest?: ComponentManifest,
  ): void {
    this.overlay.set(kind, { component: c, manifest })
  }
  unregisterOverlayRenderer(id: string): void {
    this.overlay.delete(id)
  }
  /** 是否已注册 overlay 渲染器。 */
  hasOverlayRenderer(id: string): boolean {
    return this.overlay.has(id)
  }

  /** Read-only registration lookup used by editor catalogs. */
  getOverlayRenderer(id: string): OverlayRendererRegistration | undefined {
    return this.overlay.get(id)
  }

  /** 复制当前表（测试或需要快照副本时用）。 */
  clone(): SkinRegistry {
    const next = new SkinRegistry()
    for (const [id, registration] of this.overlay) {
      next.registerOverlayRenderer(id, registration.component, registration.manifest)
    }
    return next
  }

  /**
   * 渲染一份挂载的全部 children。
   * 舞台尺寸由 OverlayNode.layout / OverlayChild.layout 配置（如 `STAGE_FILL_LAYOUT`）。
   */
  renderOverlayMount(
    mount: OverlayMountSnap,
    emit?: (elementId: string, key: string) => void,
    ctx?: SkinCtx,
    preview?: { timeMs?: number; playing?: boolean },
  ): ReactNode {
    const mountHasSize = layoutHasExplicitSize(mount.mountLayout)
    const wrapStyle: CSSProperties = mountWrapStyle(mount.mountLayout)
    return (
      <div key={mount.mountId} style={wrapStyle}>
        {mount.children.map((child) => {
          const registration = this.overlay.get(child.component)
          if (!registration) return null
          const snap: OverlaySnap = {
            elementId: child.elementId,
            component: child.component,
            inputs: child.inputs,
          }
          const childWrap: CSSProperties = childWrapStyle(child.childLayout, mountHasSize)
          return (
            <div key={child.elementId} style={childWrap}>
              <SkinErrorBoundary name={child.component} resetKey={registration.component}>
                <RuntimeComponentHost
                  registration={registration}
                  overlay={snap}
                  emit={(key) => emit?.(child.elementId, key)}
                  ctx={ctx}
                  preview={!!preview}
                  previewTimeMs={preview?.timeMs}
                  previewPlaying={preview?.playing ?? false}
                />
              </SkinErrorBoundary>
            </div>
          )
        })}
      </div>
    )
  }
}

export const defaultSkinRegistry = new SkinRegistry()

export function registerOverlayRenderer(
  kind: string,
  c: OverlayRendererRegistration['component'],
  manifest?: ComponentManifest,
): void {
  defaultSkinRegistry.registerOverlayRenderer(kind, c, manifest)
}
export function unregisterOverlayRenderer(id: string): void {
  defaultSkinRegistry.unregisterOverlayRenderer(id)
}
export function renderOverlayMount(
  mount: OverlayMountSnap,
  emit?: (elementId: string, key: string) => void,
  ctx?: SkinCtx,
  preview?: { timeMs?: number; playing?: boolean },
): ReactNode {
  return defaultSkinRegistry.renderOverlayMount(mount, emit, ctx, preview)
}
