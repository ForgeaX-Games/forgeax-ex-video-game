/**
 * 组件注册契约 —— Overlay child 的运行时扩展点。
 *
 * 落盘字段只有 `OverlayChild.component`；注册键与之直接对应。
 * 缺省使用模块级 `defaultComponentRegistry`（与 bootComponents / GraphSession 共用）；
 * 测试或特殊路径可自建 `ComponentRegistry` 注入。
 *
 * 编辑器专用辅助（展示名、新建默认值、拍点/选项结构判定等）不在本文件——见 `editor/shell/editors.tsx`。
 */
import type { ComponentEvent, ComponentInput, ComponentManifest, Overlay } from '../schema/node-config-schema'
import type { GameNode, NodeHandle } from '../schema/graph-schema'
import type { OverlayInstanceChild } from '../schema/node-config-schema'
import { expandNodeOverlays } from '../schema/expand-overlay'
import { eventsFromParams } from '../schema/overlay-events'

export interface ComponentDef<P = Record<string, unknown>> {
  /**
   * 组件会抛出的事件（= 出口 handle 来源）。
   * 静态出口写这里；随实例变化的写在 `inputs.events`；
   * 运行时出口 = `inputs.events`（若有）否则本字段（见 `handlesOf`）。
   */
  events?: ComponentEvent[]
  /** 展示名（缺省 = component id）；编辑器可读，运行时不依赖。 */
  label?: string
  /**
   * 输入契约：语义类型 + `default`（新建初值）。
   * 运行时用默认值折 events；编辑器据此渲染控件。
   */
  inputs?: ComponentInput[]
  /** 面向 AI 的摆放位置与潜规则提示（见 ComponentManifest.prompt）。 */
  prompt?: string
  /** 面向 Agent 与编辑器的机器可读布局约束。 */
  layout?: ComponentManifest['layout']
  /** 跨字段校验（如 floatText 需 text||expr）；校验管线调用。 */
  validate?(inputs: P): string[]
}

/** 从 inputs[].default 组装默认值（manifest 折 events / 编辑器新建实例共用）。 */
export function buildDefaults(inputs: ComponentInput[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const i of inputs ?? []) if (i.default !== undefined) out[i.key] = i.default
  return out
}

/** 可注入的组件注册表（每局 Runtime 一份即可隔离）。 */
export class ComponentRegistry {
  private readonly components = new Map<string, ComponentDef>()

  registerComponent<P>(id: string, def: ComponentDef<P>): void {
    this.components.set(id, def as unknown as ComponentDef)
  }
  unregisterComponent(id: string): void {
    this.components.delete(id)
  }
  getComponent(componentId: string): ComponentDef | undefined {
    return this.components.get(componentId)
  }

  /** Stable registration-order manifest view used by editor catalogs. */
  listManifests(): ComponentManifest[] {
    return [...this.components.keys()]
      .map((componentId) => this.getManifest(componentId))
      .filter((manifest): manifest is ComponentManifest => manifest !== undefined)
  }

  /** 复制当前表（Session 隔离 / createDefault* 用）。 */
  clone(): ComponentRegistry {
    const next = new ComponentRegistry()
    for (const [id, def] of this.components) {
      next.registerComponent(id, def)
    }
    return next
  }

  /** 组件契约视图：inputs + events（无静态 events 时从 inputs 默认值折）。 */
  getManifest(componentId: string): ComponentManifest | undefined {
    const p = this.getComponent(componentId)
    if (!p) return undefined
    const inputs = p.inputs ?? []
    const events = p.events?.length ? p.events : eventsFromParams(buildDefaults(inputs))
    const label = p.label ?? componentId
    return {
      id: componentId,
      label,
      ...(inputs.length ? { inputs } : {}),
      ...(p.prompt ? { prompt: p.prompt } : {}),
      ...(p.layout ? { layout: p.layout } : {}),
      events,
    }
  }

  /**
   * 组件实例出口 handle：实例 `inputs.events`（若有）否则组件静态 `events`。
   */
  handlesOf(componentId: string, inputsBag: Record<string, unknown> | undefined): NodeHandle[] {
    const p = this.getComponent(componentId)
    if (!p) return []
    const fromInputs = eventsFromParams(inputsBag ?? {})
    const events = fromInputs.length ? fromInputs : (p.events ?? [])
    return events.map((e) => ({ id: e.id, label: e.label }))
  }

  /** 节点出口：`default` + 各挂载组件可发事件（边 sourceHandle 对齐）。 */
  deriveOutputs(node: GameNode, overlays?: Record<string, Overlay>): NodeHandle[] {
    const instances = expandNodeOverlays(overlays, node)
    const children: OverlayInstanceChild[] = instances.flatMap((i) => i.children)
    const out: NodeHandle[] = [{ id: 'default' }]
    for (const el of children) out.push(...this.handlesOf(el.component, el.inputs as Record<string, unknown>))
    const seen = new Set<string>()
    return out.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
  }
}

/** 默认表（bootComponents / Session / Runtime 共用；测试可注入自建表）。 */
export const defaultComponentRegistry = new ComponentRegistry()

export function registerComponent<P>(id: string, def: ComponentDef<P>): void {
  defaultComponentRegistry.registerComponent(id, def)
}
export function unregisterComponent(id: string): void {
  defaultComponentRegistry.unregisterComponent(id)
}
export function getComponent(componentId: string): ComponentDef | undefined {
  return defaultComponentRegistry.getComponent(componentId)
}
export function getComponentManifest(componentId: string): ComponentManifest | undefined {
  return defaultComponentRegistry.getManifest(componentId)
}
export function listComponentManifests(): ComponentManifest[] {
  return defaultComponentRegistry.listManifests()
}
export function deriveOutputs(node: GameNode, overlays?: Record<string, Overlay>): NodeHandle[] {
  return defaultComponentRegistry.deriveOutputs(node, overlays)
}
/** 默认表上的 handlesOf（引擎实例请用 `runtime.components.handlesOf`）。 */
export function componentHandles(componentId: string, inputsBag: Record<string, unknown> | undefined): NodeHandle[] {
  return defaultComponentRegistry.handlesOf(componentId, inputsBag)
}
