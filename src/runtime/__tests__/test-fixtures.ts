/**
 * 测试夹具：可用 `timeline` 字段书写，scnOf 归一成 Overlay 模型。
 * timeline 项可写旧字段 `kind`（映射为 component）；`role` 忽略。
 */
import type { GameGraph, GameNode, GameScenario, Overlay, OverlayChild } from '../core/schema/graph-schema'
import { getSubProcess } from '../core/schema/graph-schema'

type LegacyEl = Partial<OverlayChild> & {
  id: string
  kind?: string
  role?: string
  component?: string
  trigger?: OverlayChild['trigger']
  inputs?: Record<string, unknown>
  window?: OverlayChild['window']
  layout?: OverlayChild['layout']
  /** @deprecated 写入 layout.zIndex */
  zIndex?: number
  note?: string
}

export function node(id: string, extra: Record<string, unknown> = {}): GameNode {
  const { timeline, hud: _hud, ...rest } = extra
  const n = {
    id,
    type: 'perf' as const,
    position: { x: 0, y: 0 },
    inputs: [] as GameNode['inputs'],
    outputs: [] as GameNode['outputs'],
    data: { name: id, ...rest },
  }
  if (timeline != null) (n as { __timeline?: unknown }).__timeline = timeline
  return n as GameNode
}

/** 测试夹具 timeline → overlay 挂载键 `ov-<nodeId>` 下的运行态 child id。 */
export function rid(nodeId: string, childId: string): string {
  return `ov-${nodeId}/${childId}`
}

export function scnOf(graph: GameGraph, over: Partial<GameScenario> = {}): GameScenario {
  const overlays: Record<string, Overlay> = { ...(over.ui?.overlays ?? {}) }
  const normalizeGraph = (source: GameGraph): GameGraph => ({
    ...source,
    nodes: source.nodes.map((raw) => {
    const stash = (raw as { __timeline?: LegacyEl[] }).__timeline
    const dataRec = raw.data as GameNode['data'] & { timeline?: LegacyEl[] }
    const process = getSubProcess(dataRec)
    const nestedData = process
      ? { ...dataRec, subProcess: { ...process, graph: normalizeGraph(process.graph) } }
      : dataRec
    const tl = stash ?? dataRec.timeline
    if (!tl?.length) {
      const { timeline: _d, hud: _h, ...data } = nestedData as GameNode['data'] & {
        timeline?: unknown
        hud?: unknown
      }
      return { ...raw, data: data as GameNode['data'] }
    }
    const oid = `ov-${raw.id}`
    overlays[oid] = {
      id: oid,
      children: tl.map((el) => {
        const component = el.component ?? el.kind
        if (!component) throw new Error(`timeline element ${el.id} missing component/kind`)
        return {
          id: el.id,
          component,
          layout: {
            ...(el.layout ?? {}),
            ...(el.zIndex != null ? { zIndex: el.zIndex } : {}),
          },
          trigger: el.trigger ?? { when: 'enter' },
          window: el.window,
          inputs: el.inputs ?? {},
          note: el.note,
        } satisfies OverlayChild
      }),
    }
    const { timeline: _d, hud: _h, ...data } = nestedData as GameNode['data'] & {
      timeline?: unknown
      hud?: unknown
    }
    return {
      ...raw,
      data: { ...data, overlayNodes: [{ overlay: oid }] },
    }
    }),
  })
  const normalizedGraph = normalizeGraph(graph)
  return {
    version: 't',
    ...over,
    variables: {
      qi: { id: 'qi', name: '气', initial: 0, min: 0, max: 9 },
      ...(over.variables ?? {}),
    },
    entities: {
      'ent-player': { id: 'ent-player', kind: 'player', attrs: { hp: 300 }, attrMeta: { hp: { max: 300 } } },
      'ent-boss': { id: 'ent-boss', kind: 'boss', attrs: { hp: 700 }, attrMeta: { hp: { max: 700 } } },
      ...(over.entities ?? {}),
    },
    ui: { ...(over.ui ?? {}), overlays: { ...overlays, ...(over.ui?.overlays ?? {}) } },
    graph: normalizedGraph,
  }
}
