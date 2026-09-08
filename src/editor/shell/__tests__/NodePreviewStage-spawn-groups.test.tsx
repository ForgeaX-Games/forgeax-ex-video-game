// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { JSX } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import type { GameScenario } from '@/runtime/core/schema/graph-schema'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { NodePreviewStage } from '../NodePreviewStage'

beforeAll(registerTestComponents)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 3000ms 结算：boss 掉 40 血，并绑定一个 500ms 的飘字（`second` 时再绑一个台词）。 */
function seedScenario(second = false): GameScenario {
  const current = node('n1', {
    durationMs: 4_000,
    reactions: [{
      when: { type: 'at', ms: 3_000 },
      do: [
        { kind: 'effect', effects: [{ id: 'd', kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -40 }] },
        { kind: 'spawn', from: 'rage/value', ttlMs: 500, inputs: { parameter: { expr: 'abs(delta)' } } },
        ...(second ? [{ kind: 'spawn' as const, from: 'toast/line', ttlMs: 900 }] : []),
      ],
    }],
  })
  return scnOf({ nodes: [current], edges: [] }, {
    ui: {
      overlays: {
        rage: {
          id: 'rage',
          title: '伤害飘字',
          children: [{
            id: 'value',
            component: 'test.float',
            trigger: { when: 'enter' },
            inputs: {},
            layout: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 },
          }],
        },
        toast: {
          id: 'toast',
          title: '状态提示',
          children: [{
            id: 'line',
            component: 'test.float',
            trigger: { when: 'enter' },
            inputs: {},
            layout: { left: 0.6, top: 0.6, width: 0.2, height: 0.2 },
          }],
        },
      },
    },
  })
}

function renderStage(second = false): { container: HTMLElement; latest: () => GameScenario } {
  const initial = seedScenario(second)
  let latest: GameScenario = initial
  function Harness(): JSX.Element {
    const [scenario, setScenario] = useState(initial)
    // 宿主（GraphStudio）持有结算焦点；这里照搬，好让预览画布拿到被选中结算的界面。
    const [focusedLifecycleIndex, setFocusedLifecycleIndex] = useState<number | null>(null)
    latest = scenario
    return (
      <NodePreviewStage
        scenario={scenario}
        node={scenario.graph.nodes[0]!}
        game="test"
        muted
        focusedLifecycleIndex={focusedLifecycleIndex}
        onFocusLifecycle={setFocusedLifecycleIndex}
        onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
        onMutedChange={vi.fn()}
      />
    )
  }
  const { container } = render(<Harness />)
  return { container, latest: () => latest }
}

describe('NodePreviewStage · 结算绑定界面组', () => {
  it('renders a bound interface bar under the settlement it belongs to', async () => {
    const { container } = renderStage()

    await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(1))
    const bar = container.querySelector<HTMLElement>('.gc-spawn-bar')!
    expect(bar.dataset.spawnBar).toBe('settlement-spawn:0:1')
    expect(container.querySelector<HTMLElement>('.gc-spawn-group')!.dataset.spawnGroup).toBe('life:0')
    // 条窄到放不下文字时标签仍在可访问名与 title 里（与材料条同一规则）。
    expect(bar.getAttribute('aria-label')).toBe('绑定界面 · 伤害飘字')
  })

  it('writes the display duration back when the bar end is dragged', async () => {
    const { container, latest } = renderStage()
    await waitFor(() => expect(container.querySelector('.gc-spawn-bar')).not.toBeNull())

    const canvas = container.querySelector<HTMLElement>('.gc-mtimeline-canvas')!
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1_000, bottom: 400,
      width: 1_000, height: 400, toJSON: () => ({}),
    })
    vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})

    const handle = container.querySelector<HTMLElement>('.gc-spawn-bar .gc-mhandle.is-right')!
    // 画布 1000px 对应 4000ms：右移 100px = +400ms → 结束 3500 → 3900，ttl 500 → 900。
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 875 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 975 })

    await waitFor(() => {
      const action = latest().graph.nodes[0]?.data.reactions?.[0]?.do[1]
      expect(action?.kind).toBe('spawn')
      if (action?.kind !== 'spawn') return
      expect(action.ttlMs).toBe(900)
      // 起点仍归菱形所有，拖结束不得改结算时刻。
      expect(latest().graph.nodes[0]?.data.reactions?.[0]?.when).toEqual({ type: 'at', ms: 3_000 })
    })
  })

  it('frames only the picked interface on the preview canvas, not its siblings', async () => {
    const { container } = renderStage(true)
    await waitFor(() => expect(container.querySelectorAll('.gc-spawn-bar')).toHaveLength(2))

    const bars = [...container.querySelectorAll<HTMLElement>('.gc-spawn-bar')]
    const second = bars.find((bar) => bar.dataset.spawnBar === 'settlement-spawn:0:2')!
    fireEvent.pointerDown(second)

    await waitFor(() => {
      expect(container.querySelector('[data-canvas-item="settlement-spawn:0:2"]')).toHaveClass('is-selected')
    })
    const sibling = container.querySelector('[data-canvas-item="settlement-spawn:0:1"]')!
    // 同结算的另一个界面画陪衬虚框（看得见才点得中），但不得读成"被选中"。
    expect(sibling).toHaveClass('is-highlighted')
    expect(sibling).not.toHaveClass('is-selected')
    expect(getComputedStyle(sibling).borderStyle).not.toBe(
      getComputedStyle(container.querySelector('[data-canvas-item="settlement-spawn:0:2"]')!).borderStyle,
    )
  })

  it('unbinds the interface without removing the settlement', async () => {
    const { container, latest } = renderStage()
    await waitFor(() => expect(container.querySelector('.gc-spawn-bar')).not.toBeNull())

    fireEvent.pointerDown(container.querySelector<HTMLElement>('.gc-spawn-bar')!)
    await waitFor(() => expect(container.querySelector('.gc-spawn-bar.is-selected')).not.toBeNull())
    fireEvent.click(container.querySelector<HTMLElement>('.gc-spawn-bar .gc-mdelete')!)

    await waitFor(() => {
      const reaction = latest().graph.nodes[0]?.data.reactions?.[0]
      expect(reaction?.when).toEqual({ type: 'at', ms: 3_000 })
      expect(reaction?.do.map((action) => action.kind)).toEqual(['effect'])
    })
    expect(container.querySelector('.gc-spawn-bar')).toBeNull()
  })
})
