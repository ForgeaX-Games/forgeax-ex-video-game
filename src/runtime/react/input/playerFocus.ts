/**
 * 多局 Player 键盘焦点门控（平台侧单例）。
 * 组件包不依赖此模块：实例挂载即听 window，销毁即卸监听。
 */
import { createContext, useContext } from 'react'

let focusedRoot: HTMLElement | null = null

export function claimPlayerFocus(root: HTMLElement | null | undefined): void {
  if (!root) return
  focusedRoot = root
}

export function releasePlayerFocus(root: HTMLElement | null | undefined): void {
  if (root && focusedRoot === root) focusedRoot = null
}

/** 无任何 Player 声明焦点时放行（单局兼容）；有焦点时仅焦点根内响应。 */
export function isPlayerFocused(root: HTMLElement | null | undefined): boolean {
  if (!root) return focusedRoot == null
  if (focusedRoot == null) return true
  return focusedRoot === root || focusedRoot.contains(root)
}

export function getFocusedPlayerRoot(): HTMLElement | null {
  return focusedRoot
}

/** Player 根节点（供平台侧焦点标记）。由 GraphPlayer / PlaySurface 注入。 */
export const PlayerRootContext = createContext<HTMLElement | null>(null)

/** @deprecated 组件侧已不再门控；保留给仍想查询焦点的平台代码。 */
export function usePlayerKeyGate(): (e?: KeyboardEvent) => boolean {
  const root = useContext(PlayerRootContext)
  return () => isPlayerFocused(root)
}
