// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerTestComponents } from '../../../runtime/__tests__/test-components'
import type { GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { NodePreviewStage } from '../NodePreviewStage'

const hostClient = vi.hoisted(() => ({
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => hostClient,
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(),
}))

vi.mock('@/runtime/react/component-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runtime/react/component-host')>()
  const fixtures = await import('../../../runtime/__tests__/test-components')
  return {
    ...actual,
    ['createCore' + 'SkinRegistry']: fixtures.createTestSkinRegistry,
  }
})

beforeAll(registerTestComponents)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NodePreviewStage overlay layout', () => {
  it('keeps mode controls host-owned and exposes a configurable timeline disclosure', () => {
    const current = node('n1', { durationMs: 3_000 })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const renderToggleIcon = vi.fn((expanded: boolean) => (
      <span data-testid="custom-timeline-icon">{expanded ? 'collapse' : 'expand'}</span>
    ))

    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        timelineDisclosure={{ showToggle: true, renderToggleIcon }}
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('group', { name: '节点预览模式' })).toBeNull()
    expect(container.querySelector('.mtl-root')).not.toBeNull()
    const collapse = screen.getByRole('button', { name: '收起时间轴' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse.closest('.nps-video-controls')).not.toBeNull()
    expect(screen.getByTestId('custom-timeline-icon')).toHaveTextContent('collapse')

    fireEvent.click(collapse)
    expect(container.querySelector('.mtl-root')).toBeNull()
    const expand = screen.getByRole('button', { name: '展开时间轴' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('custom-timeline-icon')).toHaveTextContent('expand')

    fireEvent.click(expand)
    expect(container.querySelector('.mtl-root')).not.toBeNull()
    expect(renderToggleIcon).toHaveBeenLastCalledWith(true)
  })

  it('hides the timeline disclosure button by default without hiding the timeline', () => {
    const current = node('n1', { durationMs: 3_000 })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    // 折叠钮（收起/展开时间轴）默认隐藏；时间轴自身的缩放控件（缩小/放大）常驻，不在此断言范围。
    expect(screen.queryByRole('button', { name: /^(收起|展开)时间轴$/ })).toBeNull()
    expect(container.querySelector('.mtl-root')).not.toBeNull()
  })

  it('does not overlay the video id or playback mode on the preview window', () => {
    const current = node('n1', {
      durationMs: 3_000,
      media: { kind: 'video', ref: 'encoded-video.mp4' },
      mediaPlayMode: 'loop',
    })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    expect(container.querySelector('.nps-frame .gc-badge')).toBeNull()
    expect(screen.queryByText('encoded-video.mp4')).toBeNull()
    expect(screen.queryByText('循环')).toBeNull()
  })

  it('renders a locked video track whose local pointer loops without rewinding the node playhead', async () => {
    const current = node('n1', {
      durationMs: 1_000,
      media: { kind: 'video', ref: 'data:video/mp4;base64,loop-preview' },
      mediaPlayMode: 'loop',
    })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    const videoTrack = container.querySelector<HTMLElement>('.gc-mclip.is-video')
    expect(videoTrack).toHaveClass('is-locked')
    expect(videoTrack).toHaveAttribute('aria-label', expect.stringContaining('视频'))
    expect(videoTrack?.querySelector('.gc-mhandle')).toBeNull()

    const video = container.querySelector('video')!
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    video.currentTime = 0.9
    fireEvent.play(video)
    await waitFor(() => {
      expect(container.querySelector('.gc-media-playhead')).toHaveAttribute('data-media-playhead-ms', '900')
      expect(container.querySelector('.gc-playhead')).toHaveAttribute('data-playhead-ms', '900')
    })

    video.currentTime = 0.1
    await waitFor(() => {
      expect(container.querySelector('.gc-media-playhead')).toHaveAttribute('data-media-playhead-ms', '100')
      expect(container.querySelector('.gc-playhead')).toHaveAttribute('data-playhead-ms', '1000')
    })
    fireEvent.pause(video)
  })

  it('uses only the node playhead for a play-once video track', () => {
    const current = node('n1', {
      durationMs: 1_000,
      media: { kind: 'video', ref: 'data:video/mp4;base64,once-preview' },
      mediaPlayMode: 'once',
    })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    expect(container.querySelector('.gc-mclip.is-video.is-locked')).not.toBeNull()
    expect(container.querySelector('.gc-playhead')).not.toBeNull()
    expect(container.querySelector('.gc-media-playhead')).toBeNull()
  })

  it('shows the real video duration as the HUD total for a node without durationMs', async () => {
    const current = node('n1', {
      media: { kind: 'video', ref: 'data:video/mp4;base64,no-cap-preview' },
      mediaPlayMode: 'once',
    })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    const hud = () => container.querySelector('.nps-hud-time')!
    // metadata 就绪前：总时长先退到 1s 下限。
    expect(hud()).toHaveTextContent('00:00 / 00:01')

    const video = container.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 15 })
    fireEvent.loadedMetadata(video)
    await waitFor(() => {
      expect(hud()).toHaveTextContent('/ 00:15')
    })
  })

  it('picks up the real duration via durationchange when loadedmetadata reports a non-finite duration', async () => {
    const current = node('n1', {
      media: { kind: 'video', ref: 'data:video/mp4;base64,streaming-preview' },
      mediaPlayMode: 'once',
    })
    const scenario = scnOf({ nodes: [current], edges: [] })
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    const video = container.querySelector('video')!
    // 流式 MP4：loadedmetadata 时 duration 仍为 Infinity → 不采信。
    Object.defineProperty(video, 'duration', { configurable: true, value: Infinity })
    fireEvent.loadedMetadata(video)
    expect(container.querySelector('.nps-hud-time')!).toHaveTextContent('/ 00:01')

    // 真实时长在随后的 durationchange 才就绪 → 总时长更新为真实值。
    Object.defineProperty(video, 'duration', { configurable: true, value: 15 })
    fireEvent.durationChange(video)
    await waitFor(() => {
      expect(container.querySelector('.nps-hud-time')!).toHaveTextContent('/ 00:15')
    })
  })

  it('shows state condition settlements in the timeline condition lane', () => {
    const current = node('n1', {
      reactions: [{
        when: { type: 'state', condition: { all: [{ type: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'eq', value: 50 }] } },
        do: [],
      }],
    })
    const scenario = scnOf({ nodes: [current], edges: [] })

    render(
      <NodePreviewStage
        scenario={scenario}
        node={scenario.graph.nodes[0]!}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    expect(screen.getByTitle('满足 1 项条件 → 未配置动作')).toBeTruthy()
  })

  it('frames every condition settlement interface but selects only the active one, and drags its spawn layout', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      durationMs: 1_000,
      reactions: [{
        when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'inc' },
        do: [
          {
            kind: 'spawn',
            from: 'rage/value',
            ttlMs: 1200,
            layout: { left: 0.1, top: 0.2, width: 0.2, height: 0.2 },
          },
          {
            kind: 'spawn',
            from: 'rage/value',
            ttlMs: 1200,
            layout: { left: 0.6, top: 0.5, width: 0.2, height: 0.2 },
          },
        ],
      }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: { bull: { id: 'bull', attrs: { rage: 10 } } },
        ui: {
          overlays: {
            rage: {
              id: 'rage',
              title: '怒气值界面',
              children: [{
                id: 'value',
                component: 'test.float',
                inputs: { parameter: 42 },
              }],
            },
          },
        },
      },
    )
    let latestScenario: GameScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      const [focusedLifecycleIndex, setFocusedLifecycleIndex] = useState<number | null>(null)
      latestScenario = scenario
      return (
        <NodePreviewStage
          scenario={scenario}
          node={scenario.graph.nodes[0]!}
          game="test"
          muted
          focusedLifecycleIndex={focusedLifecycleIndex}
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onMutedChange={vi.fn()}
          onFocusLifecycle={setFocusedLifecycleIndex}
        />
      )
    }

    const { container } = render(<Harness />)
    const conditionMarker = screen.getByRole('button', { name: /rage 增加/ })
    fireEvent.pointerDown(conditionMarker)

    await waitFor(() => {
      expect(container.querySelector('[data-preview-settlement-spawn-id="settlement-spawn:0:0"]')).not.toBeNull()
      expect(container.querySelector('[data-preview-settlement-spawn-id="settlement-spawn:0:1"]')).not.toBeNull()
      // 同结算的界面都画陪衬虚框（看得见才点得中），但只有活动的那个是选中态。
      expect(container.querySelector('[data-canvas-item="settlement-spawn:0:0"]')).toHaveClass('is-selected')
      expect(container.querySelector('[data-canvas-item="settlement-spawn:0:1"]')).toHaveClass('is-highlighted')
      expect(container.querySelector('[data-canvas-item="settlement-spawn:0:1"]')).not.toHaveClass('is-selected')
    })
    expect(container.querySelectorAll('[data-overlay-fit-target]')).toHaveLength(2)

    const canvas = screen.getByRole('application', { name: '节点视频覆盖物画布' })
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 30, clientY: 30 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 50, clientY: 40 })
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 50, clientY: 40 })
    await waitFor(() => {
      const action = latestScenario.graph.nodes[0]?.data.reactions?.[0]?.do[0]
      expect(action?.kind).toBe('spawn')
      if (action?.kind !== 'spawn') return
      expect(action.layout?.left).toBeCloseTo(0.2)
      expect(action.layout?.top).toBeCloseTo(0.3)
      expect(action.layout).toMatchObject({ width: 0.2, height: 0.2 })
    })
  })

  it('renders a condition settlement spawn in the editable node preview', async () => {
    const current = node('n1', {
      reactions: [
        {
          when: { type: 'at', ms: 0 },
          do: [{
            kind: 'effect',
            effects: [{ kind: 'attr', entityId: 'ent-0', attr: 'nuqi', op: 'add', value: 80 }],
          }],
        },
        {
          when: { type: 'watch', of: 'entity.ent-0.attr.nuqi', on: 'inc' },
          do: [{
            kind: 'spawn',
            from: 'float/rage',
            ttlMs: 1200,
            inputs: { parameter: { expr: 'delta' } },
          }],
        },
      ],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: {
          'ent-0': { id: 'ent-0', kind: 'enemy', attrs: { nuqi: 10 } },
        },
        ui: {
          overlays: {
            float: {
              id: 'float',
              children: [{
                id: 'rage',
                component: 'test.float',
                inputs: { parameter: 0 },
              }],
            },
          },
        },
      },
    )

    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-preview-spawn-id="spawn:1"]')).not.toBeNull()
      expect(container.querySelector('[data-preview-spawn-id="spawn:1"] [data-overlay-fit-target]')).not.toBeNull()
    })
  })

  it('hides an existing interface when its condition is met while the node video preview plays', async () => {
    const current = node('n1', {
      durationMs: 1_000,
      media: { ref: 'data:video/mp4;base64,preview' },
      overlayNodes: [{ id: 'rage-mount', overlay: 'rage' }],
      reactions: [
        { when: { type: 'at', ms: 600 }, do: [{ kind: 'effect', effects: [{ kind: 'attr', entityId: 'bull', attr: 'rage', op: 'add', value: -10 }] }] },
        { when: { type: 'watch', of: 'entity.bull.attr.rage', on: 'dec' }, do: [{ kind: 'hideOverlay', mountId: 'rage-mount' }] },
      ],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        entities: { bull: { id: 'bull', attrs: { rage: 10 } } },
        ui: { overlays: { rage: { id: 'rage', children: [{ id: 'value', component: 'test.float', trigger: { when: 'enter' } }] } } },
      },
    )
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    video.currentTime = 0.5
    fireEvent.play(video)

    await waitFor(() => expect(container.querySelector('[data-preview-mount-id="rage-mount"]')).not.toBeNull())

    video.currentTime = 0.7
    await waitFor(() => expect(container.querySelector('[data-preview-mount-id="rage-mount"]')).toBeNull())
    fireEvent.pause(video)
  })

  it('renders repeated mounts of the same overlay as separate instances', async () => {
    const current = node('n1', {
      overlayNodes: [
        { overlay: 'float', layout: { left: 0, top: 0, width: 1, height: 1 } },
        { id: 'float__2', overlay: 'float', layout: { left: 0.2, top: 0.1, width: 1, height: 1 } },
      ],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            float: {
              id: 'float',
              children: [{
                id: 'damage',
                component: 'test.float',
                trigger: { when: 'enter' },
                inputs: { parameter: '+10' },
              }],
            },
          },
        },
      },
    )

    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(container.querySelectorAll('[data-preview-mount-id]')).toHaveLength(2)
    })
    expect(container.querySelector('[data-preview-mount-id="float"]')).not.toBeNull()
    expect(container.querySelector('[data-preview-mount-id="float__2"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-overlay-fit-target]')).toHaveLength(2)
  })

  it('never falls back to a ring and label when the real interface skin is not visible', () => {
    const current = node('n1', {
      overlayNodes: [{ overlay: 'qte-overlay' }],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            'qte-overlay': {
              id: 'qte-overlay',
              children: [{
                id: 'qte-child',
                component: 'qte',
                window: { startMs: 1000, endMs: 2000 },
                trigger: { when: 'enter' },
                inputs: {
                  cues: [{ id: 'cue-1', appearAt: 0, targetAt: 200, endAt: 400 }],
                },
              }],
            },
          },
        },
      },
    )

    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
      />,
    )

    expect(container.querySelector('.gc-preview-ring')).toBeNull()
    expect(container.querySelector('.gc-preview-label')).toBeNull()
    expect(container.querySelector('[data-node-preview-overlay-scale="none"]')).not.toBeNull()
    expect(container.querySelector('[data-overlay-scale-root]')).toBeNull()
    expect(container.querySelector('[data-overlay-logical-stage]')).toBeNull()
  })

  it('moves a mounted overlay without writing or changing width/height', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 40,
          y: 50,
          left: 40,
          top: 50,
          right: 120,
          bottom: 80,
          width: 80,
          height: 30,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      overlayNodes: [{ overlay: 'hud', layout: { left: 0, top: 0, width: 1, height: 1 } }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            hud: {
              id: 'hud',
              title: 'HUD',
              children: [{
                id: 'damage',
                component: 'test.float',
                trigger: { when: 'enter' },
                inputs: {},
              }],
            },
          },
        },
      },
    )
    let latestScenario: GameScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      const currentNode = scenario.graph.nodes[0]!
      return (
        <NodePreviewStage
          scenario={scenario}
          node={currentNode}
          game="test"
          muted
          focusedMountId="hud"
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onMutedChange={vi.fn()}
          onFocusMount={vi.fn()}
        />
      )
    }
    const { container } = render(
      <Harness />,
    )

    expect(screen.queryByRole('button', { name: /调整HUD大小/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整覆盖物画布大小/ })).toBeNull()
    expect(container.querySelector('[data-canvas-item="__overlay-canvas__"]')).toBeNull()
    const canvas = await waitFor(() =>
      screen.getByRole('application', { name: '节点视频覆盖物画布' }))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    await waitFor(() => {
      const nudgedLayout = latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout
      expect(nudgedLayout?.left).toBe(0)
      expect(nudgedLayout?.top).toBeCloseTo(0.01)
      expect(nudgedLayout?.width).toBe(1)
      expect(nudgedLayout?.height).toBe(1)
    })
    expect((container.querySelector('[data-canvas-item="hud"]') as HTMLElement).style.width).toBe('40%')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 70 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 80 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 100, clientY: 80 })

    await waitFor(() => {
      const layout = latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout
      expect(layout?.left).toBeCloseTo(0.1)
      expect(layout?.top).toBeCloseTo(0.11)
      expect(layout?.width).toBe(1)
      expect(layout?.height).toBe(1)
    })
    expect((container.querySelector('[data-canvas-item="hud"]') as HTMLElement).style.width).toBe('40%')
  })

  it('keeps duplicate mounts independently selectable and movable', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 100,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    })
    const overlayId = 'base:TEST_FLOAT'
    const secondMountId = `${overlayId}__2`
    const current = node('n1', {
      overlayNodes: [
        { overlay: overlayId, layout: { left: 0.1, top: 0.1, width: 0.2, height: 0.2 } },
        { id: secondMountId, overlay: overlayId, layout: { left: 0.6, top: 0.6, width: 0.2, height: 0.2 } },
      ],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            [overlayId]: {
              id: overlayId,
              title: '伤害飘字',
              children: [{
                id: 'damage',
                component: 'test.float',
                trigger: { when: 'enter' },
                inputs: { parameter: '-25' },
              }],
            },
          },
        },
      },
    )
    let latestScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      return (
        <NodePreviewStage
          scenario={scenario}
          node={scenario.graph.nodes[0]!}
          game="test"
          muted
          focusedMountId={secondMountId}
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onMutedChange={vi.fn()}
          onFocusMount={vi.fn()}
        />
      )
    }
    const { container } = render(<Harness />)

    await waitFor(() => {
      expect(container.querySelectorAll('.gc-preview-skin-layer > div')).toHaveLength(2)
      expect(container.querySelector(`[data-canvas-item="${overlayId}"]`)).not.toBeNull()
      expect(container.querySelector(`[data-canvas-item="${secondMountId}"]`)).toHaveClass('is-selected')
    })

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    await waitFor(() => {
      const mounts = latestScenario.graph.nodes[0]?.data.overlayNodes ?? []
      expect(mounts[0]?.layout?.left).toBe(0.1)
      expect(mounts[1]?.layout?.left).toBeCloseTo(0.605)
    })
  })

  it('promotes a position-only stage overlay to a full-size mount on first move', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 40,
          y: 70,
          left: 40,
          top: 70,
          right: 120,
          bottom: 100,
          width: 80,
          height: 30,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      overlayNodes: [{ overlay: 'dialogues' }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            dialogues: {
              id: 'dialogues',
              children: [{
                id: 'line',
                component: 'test.dialogue',
                layout: { left: 0.15, top: -0.02, width: 1, height: 1 },
                trigger: { when: 'enter' },
                inputs: { text: '这是一句字幕示例。' },
              }],
            },
          },
        },
      },
    )
    let latestScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      return (
        <NodePreviewStage
          scenario={scenario}
          node={scenario.graph.nodes[0]!}
          game="test"
          muted
          focusedMountId="dialogues"
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onMutedChange={vi.fn()}
          onFocusMount={vi.fn()}
        />
      )
    }
    render(<Harness />)

    await waitFor(() => screen.getByRole('application', { name: '节点视频覆盖物画布' }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout).toEqual({
        left: 0.005,
        top: 0,
        width: 1,
        height: 1,
      })
    })
  })

  it('keeps an initially auto-sized mount auto-sized through the first drag', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 40,
          y: 30,
          left: 40,
          top: 30,
          right: 100,
          bottom: 50,
          width: 60,
          height: 20,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      overlayNodes: [{ overlay: 'float' }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            float: {
              id: 'float',
              children: [{
                id: 'damage',
                component: 'test.float',
                layout: { left: 0.2, top: 0.3 },
                trigger: { when: 'enter' },
                inputs: { parameter: '-10' },
              }],
            },
          },
        },
      },
    )
    let latestScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      return (
        <NodePreviewStage
          scenario={scenario}
          node={scenario.graph.nodes[0]!}
          game="test"
          muted
          focusedMountId="float"
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onMutedChange={vi.fn()}
          onFocusMount={vi.fn()}
        />
      )
    }
    const { container } = render(<Harness />)
    const canvas = await waitFor(() =>
      screen.getByRole('application', { name: '节点视频覆盖物画布' }))
    await waitFor(() => {
      const element = container.querySelector('[data-overlay-fit-target]')
      expect(element).not.toBeNull()
    })

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 60, clientY: 40 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 80, clientY: 50 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 80, clientY: 50 })

    await waitFor(() => {
      expect(latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout).toEqual({
        left: 0.1,
        top: 0.1,
      })
    })
  })

  it('keeps a focused short damage float visible in the paused node canvas', async () => {
    const current = node('n1', {
      durationMs: 3_000,
      overlayNodes: [{ overlay: 'float' }],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            float: {
              id: 'float',
              children: [{
                id: 'damage',
                component: 'test.float',
                window: { startMs: 1_000 },
                inputs: { parameter: '-10', durationMs: 7 },
              }],
            },
          },
        },
      },
    )
    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        muted
        focusedMountId="float"
        onEditScenario={vi.fn()}
        onMutedChange={vi.fn()}
        onFocusMount={vi.fn()}
      />,
    )

    const stub = await waitFor(() => {
      const element = container.querySelector('[data-overlay-fit-target]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(stub).toHaveStyle({ '--preview-t': '800ms' })
  })
})
