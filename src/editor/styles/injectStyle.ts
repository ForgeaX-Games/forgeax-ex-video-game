/**
 * injectStyleOnce —— 在文档 <head> 注入一份 <style>，全局只注入一次。
 *
 * 背景：
 *   早期为了把组件 CSS 与组件文件就近放置，每个组件用了
 *   `return <div>...<style>{cssString}</style></div>` 的写法。
 *   这种写法看似无害（cssString 是模块顶层常量），但会让 React 在
 *   组件**每次重新挂载**时重新插入一次 <style> 节点，并在每次组件
 *   渲染时把字符串子节点重新带入 reconciler；当全树几十个组件都这样
 *   叠加，且某些组件（Player / StagePane / Timeline）每秒重渲数十次，
 *   开销会被放大到肉眼可见 / CPU 风扇可听。
 *
 * 该工具把 CSS 与 React 树**完全脱钩**：模块加载时一次性写入 <head>，
 * 之后无论组件如何重渲、卸载、再挂载，CSS 都已存在文档中，不再受
 * React 调度影响。
 *
 * 使用：
 *   ```ts
 *   const myCss = `.foo { color: red; }`
 *   injectStyleOnce('my-component', myCss)
 *
 *   export function MyComponent() { return <div className="foo" /> }
 *   ```
 *
 * HMR（v3.9.6 增强）：
 *   同一 id 再次调用时**会**覆盖旧的 <style> 节点。之前的实现是遇到
 *   重复 id 直接跳过，导致开发期改 CSS 字符串后页面上仍是旧样式，
 *   必须硬刷新浏览器才看得到。现在调用方改 CSS、保存，Vite HMR
 *   重新执行模块顶层的 `injectStyleOnce(id, newCss)` → 这里会把
 *   `<style data-reel-style="id">` 的 textContent 原地换掉，立刻
 *   生效。prod 构建里 `id` 只会被调用一次，行为不变。
 *
 * 注意：
 *   - id 全局唯一；
 *   - 在 SSR / 测试 (jsdom) 环境下，`document` 可能不存在，做了空保护；
 */
const injectedNodes = new Map<string, HTMLStyleElement>()

export function injectStyleOnce(id: string, css: string): void {
  if (typeof document === 'undefined') return
  const existing = injectedNodes.get(id)
  if (existing) {
    // v3.9.6：HMR 场景——同 id 覆盖内容，避免老样式残留。
    // prod 下同一个 id 只会被调用一次（模块顶层常量），不走到这里。
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.setAttribute('data-reel-style', id)
  style.textContent = css
  document.head.appendChild(style)
  injectedNodes.set(id, style)
}

/**
 * injectInkFilterOnce —— 向文档注入一次「水墨毛边」SVG 滤镜（#inkRough）。
 *
 * 战斗 HUD 血条 / 技能墨章 / 防反按键都用 `filter:url(#inkRough)` 做仿黑神话的
 * 撕裂毛边。滤镜 def 必须真实存在于 DOM 中，url(#inkRough) 才能引用到。这里用
 * 与 injectStyleOnce 相同的「全局一次」思路：无论多少组件挂载，只注入一个
 * 隐藏容器，避免重复 id。
 *
 * 复刻自「新影游平台交互原型」的 .pvb-ink-defs：
 *   feTurbulence(fractalNoise) + feDisplacementMap，做细密的墨迹抖动边缘。
 */
const INK_FILTER_HOST_ID = 'reel-ink-filter-defs'

export function injectInkFilterOnce(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(INK_FILTER_HOST_ID)) return
  const host = document.createElement('div')
  host.id = INK_FILTER_HOST_ID
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'absolute'
  host.style.width = '0'
  host.style.height = '0'
  host.style.overflow = 'hidden'
  host.innerHTML =
    '<svg width="0" height="0" focusable="false" aria-hidden="true">' +
    '<filter id="inkRough" x="-20%" y="-60%" width="140%" height="220%">' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.018 0.5" numOctaves="2" seed="7" result="n"/>' +
    '<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>' +
    '</filter></svg>'
  document.body.appendChild(host)
}

/**
 * 仅供测试 / HMR 使用，重置内部状态。
 * 业务代码请勿调用。
 */
export function __resetInjectedForTest(): void {
  for (const node of injectedNodes.values()) {
    node.remove()
  }
  injectedNodes.clear()
  if (typeof document !== 'undefined') {
    document.querySelectorAll('style[data-reel-style]').forEach((el) => el.remove())
    document.getElementById(INK_FILTER_HOST_ID)?.remove()
  }
}
