import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __resetInjectedForTest, injectStyleOnce } from '../injectStyle'

describe('injectStyleOnce', () => {
  beforeEach(() => {
    __resetInjectedForTest()
  })
  afterEach(() => {
    __resetInjectedForTest()
  })

  it('在文档 head 注入一次 <style> 节点', () => {
    injectStyleOnce('feature-a', '.foo { color: red; }')
    const nodes = document.querySelectorAll('style[data-reel-style="feature-a"]')
    expect(nodes.length).toBe(1)
    expect(nodes[0]?.textContent).toBe('.foo { color: red; }')
  })

  it('同 id 重复调用不会重复插入 <style> 节点（覆盖 textContent）', () => {
    // v3.9.6 语义变更：
    //   之前是"第二次调用整个跳过，保留旧 CSS"—— 但这让 HMR 改 CSS 后
    //   页面上还是老样式，作者必须硬刷新才看得到（他反馈"为什么总是
    //   没法在当前历史中实时看到？"）。
    //   现在第二次调用会原地覆盖 textContent，节点仍然只有一个。
    injectStyleOnce('feature-b', '.bar { color: blue; }')
    injectStyleOnce('feature-b', '.bar { color: green; }')
    const nodes = document.querySelectorAll('style[data-reel-style="feature-b"]')
    expect(nodes.length).toBe(1)
    expect(nodes[0]?.textContent).toBe('.bar { color: green; }')
  })

  it('同 id 相同 css 二次调用 —— 不改动 DOM（避免触发多余 repaint）', () => {
    injectStyleOnce('feature-b2', '.bar { color: blue; }')
    const before = document.querySelector('style[data-reel-style="feature-b2"]')
    const beforeText = before?.textContent
    injectStyleOnce('feature-b2', '.bar { color: blue; }')
    const after = document.querySelector('style[data-reel-style="feature-b2"]')
    expect(after).toBe(before) // 同一个节点引用
    expect(after?.textContent).toBe(beforeText)
  })

  it('不同 id 互不干扰', () => {
    injectStyleOnce('feature-c', '.c { color: red; }')
    injectStyleOnce('feature-d', '.d { color: blue; }')
    expect(document.querySelectorAll('style[data-reel-style]').length).toBe(2)
  })
})
