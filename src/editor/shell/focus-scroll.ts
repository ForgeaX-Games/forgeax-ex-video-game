/**
 * 把聚焦目标滚进它自己的滚动容器。
 *
 * 不能直接用原生 `scrollIntoView`：它会把**每一层**可滚动祖先都滚一遍，而
 * `overflow: hidden` 的容器同样能被程序滚动。配置面板外面正好套着这样一层，于是从
 * 时间轴选中一个结算时，画布与节点面板会被整体顶上去（页面看着「上移」了几十像素）。
 * 这里只认 `overflow-y: auto | scroll` 的那一层，把目标居中，其余祖先一律不动。
 */
function nearestScrollContainer(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    // jsdom 不把 `overflow` 简写展开成 `overflowY`，所以简写要一起认。
    const overflowY = style?.overflowY || style?.overflow
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

export function scrollIntoViewWithin(el: HTMLElement | null | undefined): void {
  if (!el) return
  const container = nearestScrollContainer(el)
  if (!container?.scrollTo) return
  const elRect = el.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  // 目标在容器可视区里的居中位移；scrollTo 自己会把越界值夹到 [0, max]。
  const centerOffset = (container.clientHeight - elRect.height) / 2
  const top = container.scrollTop + (elRect.top - containerRect.top) - centerOffset
  container.scrollTo({ top, behavior: 'smooth' })
}
