/**
 * 组件包本地契约形状 —— 不依赖平台 schema。
 * 宿主注册时再 `as ComponentManifest` / `as ComponentDef`。
 */
import type { ComponentLayoutContract, ComponentTimingContract } from '../schema/node-config-schema'

export type LocalComponentInput = {
  key: string
  label?: string
  valueType: 'string' | 'number' | 'boolean'
  required?: boolean
  default?: unknown
  options?: { value: string; label: string }[]
  min?: number
  step?: number
  component?: string
}

export type LocalComponentEvent = {
  id: string
  label?: string
}

export type LocalComponentManifest = {
  id: string
  label?: string
  inputs?: LocalComponentInput[]
  events: LocalComponentEvent[]
  /** 面向 AI 的摆放位置与潜规则提示（见 ComponentManifest.prompt）。 */
  prompt?: string
  /** 面向 Agent 与编辑器的机器可读布局约束。 */
  layout?: ComponentLayoutContract
  /** 面向 Agent 与编辑器的机器可读生命周期约束。 */
  timing?: ComponentTimingContract
}
