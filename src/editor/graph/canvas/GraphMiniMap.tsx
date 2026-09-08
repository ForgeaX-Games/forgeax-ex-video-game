import { t as translateUi } from '@/i18n'
/**
 * 蓝图地图导航：始终以「整图节点包围盒」铺满缩略图（不把当前视口并进边界），
 * 底下画节点+连线全貌，橙框标当前视口；拖/点跳转。
 */
import {
  useCallback,
  useMemo,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Panel, useReactFlow, useStore, useViewport, type Edge, type Node } from '@xyflow/react'

const MAP_W = 168
const MAP_H = 118
const FALLBACK_NODE_W = 160
const FALLBACK_NODE_H = 72
const PAD = 48

function nodeSize(n: Node): { w: number; h: number } {
  const w = n.measured?.width ?? (typeof n.width === 'number' ? n.width : FALLBACK_NODE_W)
  const h = n.measured?.height ?? (typeof n.height === 'number' ? n.height : FALLBACK_NODE_H)
  return { w, h }
}

function clientToFlow(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM()
  if (!ctm) return { x: 0, y: 0 }
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const p = pt.matrixTransform(ctm.inverse())
  return { x: p.x, y: p.y }
}

/** 视口与缩略图 viewBox 求交；子蓝图节点少时视口常大于整图，不钳会把橙框裁没。 */
export function clampRect(
  r: { x: number; y: number; width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const x1 = Math.max(r.x, box.x)
  const y1 = Math.max(r.y, box.y)
  const x2 = Math.min(r.x + r.width, box.x + box.width)
  const y2 = Math.min(r.y + r.height, box.y + box.height)
  const width = Math.max(0, x2 - x1)
  const height = Math.max(0, y2 - y1)
  if (width > 0 && height > 0) return { x: x1, y: y1, width, height }
  // 完全不相交时退回 viewBox 内边一圈，仍画出定位框
  const inset = Math.min(box.width, box.height) * 0.04
  return {
    x: box.x + inset,
    y: box.y + inset,
    width: Math.max(1, box.width - inset * 2),
    height: Math.max(1, box.height - inset * 2),
  }
}

export interface GraphMiniMapProps {
  nodeColor: (node: { data: unknown }) => string
}

export function GraphMiniMap({ nodeColor }: GraphMiniMapProps): JSX.Element {
  const nodes = useStore((s) => s.nodes as Node[])
  const edges = useStore((s) => s.edges as Edge[])
  const flowW = useStore((s) => s.width)
  const flowH = useStore((s) => s.height)
  const { x: tx, y: ty, zoom } = useViewport()
  const { setViewport, getViewport } = useReactFlow()

  const drag = useRef<{ lastX: number; lastY: number; moved: boolean } | null>(null)

  const bounds = useMemo(() => {
    if (!nodes.length) return { x: 0, y: 0, width: 400, height: 300 }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      const { w, h } = nodeSize(n)
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    }
    return {
      x: minX - PAD,
      y: minY - PAD,
      width: Math.max(80, maxX - minX + PAD * 2),
      height: Math.max(80, maxY - minY + PAD * 2),
    }
  }, [nodes])

  const scale = Math.max(bounds.width / MAP_W, bounds.height / MAP_H)
  const viewW = scale * MAP_W
  const viewH = scale * MAP_H
  const vbX = bounds.x - (viewW - bounds.width) / 2
  const vbY = bounds.y - (viewH - bounds.height) / 2

  const viewBox = useMemo(
    () => ({ x: vbX, y: vbY, width: viewW, height: viewH }),
    [vbX, vbY, viewW, viewH],
  )

  const vp = useMemo(() => {
    const z = zoom || 1
    const raw = {
      x: -tx / z,
      y: -ty / z,
      // flow 宽高未就绪时勿用 1px，否则小图上会出现离谱小点
      width: Math.max(flowW || MAP_W, 1) / z,
      height: Math.max(flowH || MAP_H, 1) / z,
    }
    return clampRect(raw, viewBox)
  }, [tx, ty, zoom, flowW, flowH, viewBox])

  const jumpTo = useCallback((flowX: number, flowY: number) => {
    const { zoom: z } = getViewport()
    void setViewport(
      {
        x: (flowW || 0) / 2 - flowX * z,
        y: (flowH || 0) / 2 - flowY * z,
        zoom: z,
      },
      { duration: 180 },
    )
  }, [flowW, flowH, getViewport, setViewport])

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = clientToFlow(e.currentTarget, e.clientX, e.clientY)
    drag.current = { lastX: p.x, lastY: p.y, moved: false }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const p = clientToFlow(e.currentTarget, e.clientX, e.clientY)
    const dx = p.x - d.lastX
    const dy = p.y - d.lastY
    if (!d.moved && dx * dx + dy * dy < (2 * scale) ** 2) return
    d.moved = true
    d.lastX = p.x
    d.lastY = p.y
    const vpNow = getViewport()
    // 拖橙框/地图：往哪边拖，视口就往哪边看（与主画布抓取平移同向）
    void setViewport({
      x: vpNow.x - dx * vpNow.zoom,
      y: vpNow.y - dy * vpNow.zoom,
      zoom: vpNow.zoom,
    })
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (!d || d.moved) return
    const p = clientToFlow(e.currentTarget, e.clientX, e.clientY)
    jumpTo(p.x, p.y)
  }

  const nodeById = useMemo(() => {
    const m = new Map<string, Node>()
    for (const n of nodes) m.set(n.id, n)
    return m
  }, [nodes])

  return (
    <Panel
      position="bottom-left"
      className="gv-graph-minimap"
      data-testid="gv-graph-minimap"
      style={{ width: MAP_W, height: MAP_H, padding: 0, margin: 0 }}
      title={translateUi('ui.copy.441e75100bb6')}
    >
      <svg
        width={MAP_W}
        height={MAP_H}
        viewBox={`${vbX} ${vbY} ${viewW} ${viewH}`}
        className="gv-graph-minimap-svg"
        role="img"
        aria-label={translateUi('ui.copy.441e75100bb6')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* 整图底板：始终铺满缩略图，体现蓝图全貌范围 */}
        <rect
          className="gv-graph-minimap-board"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          rx={6 * scale}
        />
        {edges.map((e) => {
          const s = nodeById.get(e.source)
          const t = nodeById.get(e.target)
          if (!s || !t) return null
          const ss = nodeSize(s)
          const ts = nodeSize(t)
          // 缩略尺度下走中心连线：比「右缘→左缘」更稳，避免估值尺寸/多 handle 造成错位粗线
          return (
            <line
              key={e.id}
              className="gv-graph-minimap-edge"
              x1={s.position.x + ss.w / 2}
              y1={s.position.y + ss.h / 2}
              x2={t.position.x + ts.w / 2}
              y2={t.position.y + ts.h / 2}
              vectorEffect="non-scaling-stroke"
              strokeWidth={0.75}
            />
          )
        })}
        {nodes.map((n) => {
          const { w, h } = nodeSize(n)
          const active = (n.data as { active?: unknown } | null)?.active === true
          const rx = Math.min(w, h) * 0.2
          return (
            <g key={n.id}>
              <rect
                className="gv-graph-minimap-node-fill"
                x={n.position.x}
                y={n.position.y}
                width={w}
                height={h}
                rx={rx}
                fill={nodeColor(n)}
              />
              <rect
                className={`gv-graph-minimap-node${active ? ' is-active' : ''}`}
                x={n.position.x}
                y={n.position.y}
                width={w}
                height={h}
                rx={rx}
                fill="none"
                stroke={active ? '#FF9C2A' : nodeColor(n)}
                vectorEffect="non-scaling-stroke"
                strokeWidth={active ? 1.5 : 0.75}
              />
            </g>
          )
        })}
        {/* 视口外压暗（镂空已钳到 viewBox，小图不会整框被裁掉） */}
        <path
          className="gv-graph-minimap-mask"
          fillRule="evenodd"
          pointerEvents="none"
          d={[
            `M${vbX - viewW},${vbY - viewH}h${viewW * 3}v${viewH * 3}h${-viewW * 3}z`,
            `M${vp.x},${vp.y}h${vp.width}v${vp.height}h${-vp.width}z`,
          ].join('')}
        />
        {/* 橙框单独描边：视口≈整图时仍贴在缩略图内可见 */}
        <rect
          className="gv-graph-minimap-viewport"
          x={vp.x}
          y={vp.y}
          width={vp.width}
          height={vp.height}
          fill="none"
          pointerEvents="none"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1.5}
        />
      </svg>
    </Panel>
  )
}
