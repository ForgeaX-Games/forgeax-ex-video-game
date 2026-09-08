/**
 * 回归：点选切换不得把整张图打回「未度量」。
 *
 * xyflow 用引用相等判断「还是不是同一个用户节点」。受控用法下我们每次点选都重建整份
 * nodes 数组，如果新对象上没有 measured，`adoptUserNodes` 会把全图的 measured 与
 * handleBounds 一起清空——节点被渲染成 visibility:hidden、边暂时找不到锚点，等
 * ResizeObserver 重量回来才恢复，肉眼就是「蓝图闪一下」。
 */
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GameGraph } from '@/runtime/core/schema/graph-schema'
import { GraphCanvas } from '../GraphCanvas'

/** 选项节点 = 多出口卡片（default + 两条分支），正是闪动最明显的形状。 */
const graph: GameGraph = {
  nodes: [
    { id: 'choice', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: '选项' } },
    { id: 'next', type: 'perf', position: { x: 260, y: 0 }, inputs: [], outputs: [], data: { name: '下一场' } },
  ],
  edges: [
    { id: 'e-a', source: 'choice', target: 'next', sourceHandle: 'optionA', targetHandle: 'in' },
    { id: 'e-b', source: 'choice', target: 'next', sourceHandle: 'optionB', targetHandle: 'in' },
  ],
}

const NODE_W = 180
const NODE_H = 120

/**
 * 真实浏览器里 ResizeObserver 的回调不在提交那一帧同步跑完，「重新量回来」永远晚一步——
 * 闪的就是这中间的一帧。所以这里把回调攒起来，由测试显式 flush，才能断言那一帧的样子。
 */
type Observed = { target: Element }
const pending: Array<() => void> = []
class DeferredResizeObserver {
  private readonly targets = new Set<Element>()
  constructor(private readonly cb: (entries: Observed[]) => void) { }
  observe(target: Element): void {
    this.targets.add(target)
    pending.push(() => this.cb([{ target }]))
  }
  unobserve(target: Element): void { this.targets.delete(target) }
  disconnect(): void { this.targets.clear() }
}

function flushResizeObservers(): void {
  const queued = pending.splice(0, pending.length)
  act(() => { for (const run of queued) run() })
}

const originals: { ro?: unknown } = {}

beforeEach(() => {
  pending.length = 0
  originals.ro = globalThis.ResizeObserver
  globalThis.ResizeObserver = DeferredResizeObserver as unknown as typeof ResizeObserver
  // happy-dom 不做布局：给节点元素一个确定尺寸，xyflow 才会认为「量到了」。
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('react-flow__node')) return prop === 'offsetWidth' ? 800 : 600
        return prop === 'offsetWidth' ? NODE_W : NODE_H
      },
    })
  }
})

afterEach(() => {
  globalThis.ResizeObserver = originals.ro as typeof ResizeObserver
  for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
    Reflect.deleteProperty(HTMLElement.prototype, prop)
  }
})

function nodeVisibility(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('.react-flow__node')].map((el) => el.style.visibility)
}

describe('GraphCanvas measurement reuse', () => {
  it('keeps every node measured when selection moves to another node', () => {
    const { container } = render(<GraphCanvas graph={graph} onChange={() => { }} />)

    flushResizeObservers()
    expect(nodeVisibility(container)).toEqual(['visible', 'visible'])

    // 从选项节点切到别的节点：只有选中态变了，卡片布局没变。此刻重新度量还没回来，
    // 全图必须仍然带着上一次量到的尺寸——否则这一帧就是用户看到的那下闪。
    fireEvent.click(container.querySelector('[data-id="choice"]')!)
    fireEvent.click(container.querySelector('[data-id="next"]')!)

    expect(nodeVisibility(container)).toEqual(['visible', 'visible'])
  })

  it('still re-measures the card whose layout actually changed', () => {
    const { container, rerender } = render(<GraphCanvas graph={graph} onChange={() => { }} />)
    flushResizeObservers()

    // 多一个选项分支 = 选项节点多一行出口：旧高度和旧 handleBounds 都过期了，
    // 这个节点必须重量（此刻 hidden），没被牵连的节点则保持原样。
    const grown: GameGraph = {
      nodes: graph.nodes,
      edges: [...graph.edges, { id: 'e-c', source: 'choice', target: 'next', sourceHandle: 'optionC', targetHandle: 'in' }],
    }
    rerender(<GraphCanvas graph={grown} onChange={() => { }} />)

    expect(nodeVisibility(container)).toEqual(['hidden', 'visible'])

    flushResizeObservers()
    expect(nodeVisibility(container)).toEqual(['visible', 'visible'])
  })
})
