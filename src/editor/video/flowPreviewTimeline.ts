import type { GameNode, GameScenario } from '@/runtime/core/schema/graph-schema'
import { collectMountItemsFromNode } from './graphMaterialOps'
import type {
  MaterialItem,
  TimelineConditionMarker,
  TimelinePointMarker,
  TimelineSegment,
} from './materialTimelineShared'
import { collectNodeTimelineMarkers } from './nodeTimelineMarkers'

const FALLBACK_SEGMENT_MS = 1000

export interface FlowTimelineVisit {
  blueprintId: string
  graphPath: string[]
  nodeId: string
  nodeTitle: string
  durationMs?: number
}

export interface FlowTimelineSegment extends FlowTimelineVisit {
  instanceKey: string
  startMs: number
  endMs: number
  durationMs: number
}

export interface FlowTimelineLedger {
  segments: FlowTimelineSegment[]
  activeIndex: number
}

export interface FlowTimelineNodeSource {
  scenario: GameScenario
  node: GameNode
}

export interface ProjectedFlowTimeline {
  materials: MaterialItem[]
  pointMarkers: TimelinePointMarker[]
  conditionMarkers: TimelineConditionMarker[]
  segments: TimelineSegment[]
  activeIndex: number
  playheadMs: number
  maxMs: number
}

export function emptyFlowTimeline(): FlowTimelineLedger {
  return { segments: [], activeIndex: -1 }
}

export function flowTimelineIdentity(input: Pick<FlowTimelineVisit, 'blueprintId' | 'graphPath' | 'nodeId'>): string {
  return `${input.blueprintId}\u0000${input.graphPath.join('\u0001')}\u0000${input.nodeId}`
}

function normalizedDuration(durationMs: number | undefined): number {
  return Number.isFinite(durationMs) && (durationMs ?? 0) > 0
    ? Math.max(1, Math.round(durationMs!))
    : FALLBACK_SEGMENT_MS
}

function reflow(segments: FlowTimelineSegment[]): FlowTimelineSegment[] {
  let cursor = 0
  return segments.map((segment) => {
    const durationMs = normalizedDuration(segment.durationMs)
    const next = { ...segment, durationMs, startMs: cursor, endMs: cursor + durationMs }
    cursor = next.endMs
    return next
  })
}

/**
 * 记录实际进入的节点。循环回到已存在节点时只移动游标；新分支会截断当前游标后的旧后缀。
 */
export function visitFlowTimeline(current: FlowTimelineLedger, visit: FlowTimelineVisit): FlowTimelineLedger {
  const instanceKey = flowTimelineIdentity(visit)
  const existingIndex = current.segments.findIndex((segment) => segment.instanceKey === instanceKey)
  if (existingIndex >= 0) return { segments: current.segments, activeIndex: existingIndex }

  const prefix = current.activeIndex >= 0
    ? current.segments.slice(0, current.activeIndex + 1)
    : []
  const durationMs = normalizedDuration(visit.durationMs)
  const segments = reflow([...prefix, {
    ...visit,
    graphPath: [...visit.graphPath],
    instanceKey,
    durationMs,
    startMs: 0,
    endMs: durationMs,
  }])
  return { segments, activeIndex: segments.length - 1 }
}

/** 视频 metadata 到达后更新指定片段，并重算其后所有全局偏移。 */
export function updateFlowTimelineDuration(
  current: FlowTimelineLedger,
  instanceKey: string,
  durationMs: number,
): FlowTimelineLedger {
  const normalized = normalizedDuration(durationMs)
  const index = current.segments.findIndex((segment) => segment.instanceKey === instanceKey)
  if (index < 0 || current.segments[index]?.durationMs === normalized) return current
  return {
    ...current,
    segments: reflow(current.segments.map((segment, segmentIndex) => (
      segmentIndex === index ? { ...segment, durationMs: normalized } : segment
    ))),
  }
}

/** 把各节点局部素材/结算时刻投影到本次实际路径的全局时间轴。 */
export function projectFlowTimeline(
  ledger: FlowTimelineLedger,
  localPlayheadMs: number,
  resolveNode: (segment: FlowTimelineSegment) => FlowTimelineNodeSource | null,
  resolveVideoSrc?: (segment: FlowTimelineSegment, source: FlowTimelineNodeSource | null) => string | undefined,
): ProjectedFlowTimeline {
  const materials: MaterialItem[] = []
  const pointMarkers: TimelinePointMarker[] = []
  const conditionMarkers: TimelineConditionMarker[] = []

  ledger.segments.forEach((segment) => {
    const prefix = `${segment.instanceKey}\u0002`
    const source = resolveNode(segment)
    materials.push({
      key: `${prefix}video`,
      id: `${prefix}video`,
      kind: 'video',
      label: segment.nodeTitle,
      startMs: segment.startMs,
      endMs: segment.endMs,
      zIndex: 0,
      locked: true,
      videoSrc: resolveVideoSrc?.(segment, source),
    })
    if (!source) return
    for (const material of collectMountItemsFromNode(source.scenario, source.node, segment.durationMs)) {
      materials.push({
        ...material,
        key: `${prefix}${material.key}`,
        id: `${prefix}${material.id}`,
        startMs: segment.startMs + material.startMs,
        endMs: segment.startMs + material.endMs,
        markerMs: material.markerMs == null ? undefined : segment.startMs + material.markerMs,
        zIndex: material.zIndex + 1,
      })
    }
    const markers = collectNodeTimelineMarkers(source.scenario, source.node)
    pointMarkers.push(...markers.pointMarkers.map((marker) => ({
      ...marker,
      id: `${prefix}${marker.id}`,
      ms: segment.startMs + marker.ms,
      label: `${segment.nodeTitle} · ${marker.label}`,
    })))
    conditionMarkers.push(...markers.conditionMarkers.map((marker) => ({
      ...marker,
      id: `${prefix}${marker.id}`,
      label: `${segment.nodeTitle} · ${marker.label}`,
    })))
  })

  const active = ledger.segments[ledger.activeIndex]
  const playheadMs = active
    ? active.startMs + Math.max(0, Math.min(active.durationMs, Math.round(localPlayheadMs)))
    : 0
  const maxMs = Math.max(FALLBACK_SEGMENT_MS, ledger.segments.at(-1)?.endMs ?? 0)
  return {
    materials,
    pointMarkers,
    conditionMarkers,
    segments: ledger.segments.map((segment, index) => ({
      id: segment.instanceKey,
      label: segment.nodeTitle,
      startMs: segment.startMs,
      endMs: segment.endMs,
      active: index === ledger.activeIndex,
    })),
    activeIndex: ledger.activeIndex,
    playheadMs,
    maxMs,
  }
}
