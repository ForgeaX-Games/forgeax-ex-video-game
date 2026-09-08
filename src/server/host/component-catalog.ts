/**
 * 平台内置界面元件的契约清单（只读）。
 *
 * 为什么需要它：整装 Agent 能从 `base:*` overlay 方案里发现元件**存在**，但看不到每个
 * 元件接受哪些输入、抛出哪些事件。实测它给 `BattleSkill` 写了 `actions` / `entityId`
 * 两个根本不存在的输入键，真实输入（`lightResource`、`heavyCost`…）全空，
 * 也没有任何 reaction 监听它真实抛出的 `light` / `heavy` 事件——按钮挂上去点了没反应。
 *
 * 元件本体是前端 React 组件，清单是它旁边的 `LocalComponentManifest`，
 * 这里只做投影，不复制一份定义，避免两处漂移。
 */
import { localComponentManifests } from '@/runtime/core/component-catalog'
import type { ComponentLayoutContract, ComponentTimingContract } from '@/runtime/core/schema/node-config-schema'

export interface ComponentContract {
  id: string
  label?: string
  /** 元件抛出的事件 id：写节点 reaction 的 `when: { type: 'event', id }` 用这些。 */
  events: Array<{ id: string, label?: string }>
  /** 元件接受的输入键；`numberExpr` 类型可以绑变量、实体属性或公式表达式。 */
  inputs: Array<{
    key: string
    label?: string
    valueType?: string
    /** `numberExpr` 表示这个输入可以写表达式（例如实体属性或公式），而不只是常量。 */
    component?: string
    default?: unknown
  }>
  /** 面向 AI 的摆放位置与潜规则提示；配界面时据此决定元件放在哪。 */
  prompt?: string
  /** 机器可读的锚点、推荐区域、安全边距与避让约束。 */
  layout?: ComponentLayoutContract
  /** 机器可读的显示/交互生命周期约束。 */
  timing?: ComponentTimingContract
}

export function componentContracts(): ComponentContract[] {
  return localComponentManifests
    .map((manifest) => ({
      id: manifest.id,
      ...(manifest.label ? { label: manifest.label } : {}),
      ...(manifest.prompt ? { prompt: manifest.prompt } : {}),
      ...(manifest.layout ? { layout: manifest.layout } : {}),
      ...(manifest.timing ? { timing: manifest.timing } : {}),
      events: (manifest.events ?? []).map((event) => ({
        id: event.id,
        ...(event.label ? { label: event.label } : {}),
      })),
      inputs: (manifest.inputs ?? []).map((input) => ({
        key: input.key,
        ...(input.label ? { label: input.label } : {}),
        ...(input.valueType ? { valueType: input.valueType } : {}),
        ...(input.component ? { component: input.component } : {}),
        ...(input.default === undefined ? {} : { default: input.default }),
      })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** 游戏已 authored 组件的契约（manifest 与 ComponentContract 同形）。 */
export function authoredComponentContracts(
  manifests: ReadonlyArray<{
    id: string
    label?: string
    prompt?: string
    inputs?: Array<{
      key: string
      label?: string
      valueType?: string
      component?: string
      default?: unknown
    }>
    events: Array<{ id: string; label?: string }>
  }>,
): ComponentContract[] {
  return manifests
    .map((manifest) => ({
      id: manifest.id,
      ...(manifest.label ? { label: manifest.label } : {}),
      ...(manifest.prompt ? { prompt: manifest.prompt } : {}),
      events: manifest.events.map((event) => ({
        id: event.id,
        ...(event.label ? { label: event.label } : {}),
      })),
      inputs: (manifest.inputs ?? []).map((input) => ({
        key: input.key,
        ...(input.label ? { label: input.label } : {}),
        ...(input.valueType ? { valueType: input.valueType } : {}),
        ...(input.component ? { component: input.component } : {}),
        ...(input.default === undefined ? {} : { default: input.default }),
      })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

/** 按 id 取契约，供校验「挂载写的输入键存不存在」使用。 */
export function componentContractMap(): Map<string, ComponentContract> {
  return new Map(componentContracts().map((contract) => [contract.id, contract]))
}
