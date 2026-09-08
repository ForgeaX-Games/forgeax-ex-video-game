/**
 * game-video → Studio/Arrival host 的最小桥接。
 *
 * 两条通道二选一：
 *  - 同窗 in-process 挂载：Host 通过 `setInjectedAcceptReference` 注入 accept 函数，
 *    直接调用即可，无需 iframe。
 *  - iframe 挂载：复用既有 Studio `FORGEAX_COMPOSER_INSERT` 引用通道，把结构化
 *    `ContextReference` 转发给 window.parent。
 *
 * 只把结构化引用插入 Chat 输入区，不自动发送，用户可继续补充指令。
 */
import type { ContextReference } from './context-reference'

export interface ComposerPillPayload {
  kind: 'blueprint-node'
  display: string
  icon?: string
  detail: string
  tooltip: { title: string; lines: string[] }
}

export interface ForgeaxComposerHost {
  /** 是否有 accept 通道可用（注入的 accept 函数，或被 iframe 承载）。 */
  readonly available: boolean
  composer: {
    insertReference(reference: ContextReference): void
    /**
     * @deprecated 旧 pill-only 调用点的兼容层；内部适配为 `protocol: 'none'` 的
     * `ContextReference`。新调用点请直接构造 `ContextReference` 并调用
     * `insertReference`。
     */
    insert(pill: ComposerPillPayload): void
  }
}

type AcceptReference = (reference: ContextReference) => void | Promise<unknown>

let injectedAcceptReference: AcceptReference | null = null

/** Installs (or clears with `null`) the in-process accept channel. */
export function setInjectedAcceptReference(fn: AcceptReference | null): void {
  injectedAcceptReference = fn
}

function isInIframe(): boolean {
  const parent = typeof window === 'undefined' ? null : window.parent
  return !!parent && parent !== window
}

function dispatchReference(reference: ContextReference): void {
  if (injectedAcceptReference) {
    void injectedAcceptReference(reference)
    return
  }
  if (!isInIframe()) return
  window.parent.postMessage({ type: 'FORGEAX_COMPOSER_INSERT', reference }, '*')
}

function adaptPillToReference(pill: ComposerPillPayload): ContextReference {
  return {
    refKind: 'game-video.legacy-pill.v1',
    sourceExtensionId: '@forgeax-extension/game-video',
    display: { title: pill.display, icon: pill.icon },
    payload: { detail: pill.detail, tooltip: pill.tooltip },
    action: { protocol: 'none' },
  }
}

function makeHost(): ForgeaxComposerHost {
  return {
    get available() {
      return injectedAcceptReference != null || isInIframe()
    },
    composer: {
      insertReference: dispatchReference,
      insert(pill) {
        dispatchReference(adaptPillToReference(pill))
      },
    },
  }
}

export const forgeaxHost: ForgeaxComposerHost = makeHost()
