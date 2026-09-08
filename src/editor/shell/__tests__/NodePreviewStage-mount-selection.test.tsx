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

/** 挂载一张只在 2000–3000ms 可见的血条：播放头停在 0 时它不在窗口内。 */
function seedScenario(): GameScenario {
  const current = node('n1', { durationMs: 4_000, overlayNodes: [{ id: 'hud', overlay: 'hud' }] })
  return scnOf({ nodes: [current], edges: [] }, {
    ui: {
      overlays: {
        hud: {
          id: 'hud',
          title: '我方血条',
          children: [{
            id: 'bar',
            component: 'test.hud',
            trigger: { when: 'at', ms: 2_000 },
            window: { startMs: 2_000, endMs: 3_000 },
            inputs: {},
            layout: { left: 0, top: 0, width: 1, height: 1 },
          }],
        },
      },
    },
  })
}

function renderStage(): { container: HTMLElement } {
  const initial = seedScenario()
  function Harness(): JSX.Element {
    const [scenario, setScenario] = useState(initial)
    const [focusedMountId, setFocusedMountId] = useState<string | null>(null)
    return (
      <NodePreviewStage
        scenario={scenario}
        node={scenario.graph.nodes[0]!}
        game="test"
        muted
        focusedMountId={focusedMountId}
        onFocusMount={setFocusedMountId}
        onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
        onMutedChange={vi.fn()}
      />
    )
  }
  return render(<Harness />)
}

describe('NodePreviewStage · 选中挂载界面', () => {
  it('keeps the playhead where the author left it when a mount bar is picked', async () => {
    const { container } = renderStage()
    const bar = await waitFor(() => container.querySelector<HTMLElement>('.gc-mclip.is-mount')!)

    expect(container.querySelector('.gc-playhead')).toHaveAttribute('data-playhead-ms', '0')
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 10, clientY: 10 })

    await waitFor(() => expect(bar).toHaveClass('is-selected'))
    // 选中不该把播放头拖到该界面窗口的中段（原行为会跳到 2500）。
    expect(container.querySelector('.gc-playhead')).toHaveAttribute('data-playhead-ms', '0')
  })

  it('still renders a picked mount whose window excludes the playhead, so it stays positionable', async () => {
    const { container } = renderStage()
    const bar = await waitFor(() => container.querySelector<HTMLElement>('.gc-mclip.is-mount')!)

    expect(container.querySelector('[data-preview-mount-id="hud"]')).toBeNull()
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 10, clientY: 10 })

    // 不跳播放头就必须靠强制可见兜住，否则画布上没东西可拖。
    await waitFor(() => expect(container.querySelector('[data-preview-mount-id="hud"]')).not.toBeNull())
  })
})
