/**
 * 素材时间线 / 预览解析仍用到的旧 overlay 入参形状。
 * 旧组件实现已删除；这些类型只服务 editor 侧读写落盘字段。
 */
import type { GraphCondition, GraphTextStyle } from '@/runtime/core/schema/graph-schema'
import type { ComponentEvent } from '@/runtime/core/schema/node-config-schema'

/** choice/skill 系选项 = 共享事件 + 可选门控。 */
export type ChoiceOption = ComponentEvent & { condition?: GraphCondition }

/** 花字/飘字入参（素材轨预览与编辑）。 */
export interface FloatTextParams {
  text?: string
  expr?: string
  x?: number
  y?: number
  style?: GraphTextStyle
  color?: string
  durationMs?: number
  enter?: string
  exit?: string
}

/** QTE 单拍几何/判定形态。 */
export type QteCueShape = 'tap' | 'hold' | 'sweep'

/** QTE 拍点（素材轨 cues[]）。 */
export interface QteCue {
  id: string
  shape?: QteCueShape
  x?: number
  y?: number
  appearAt?: number
  targetAt?: number
  endAt?: number
  durationMs?: number
  sweepDir?: 'left' | 'right' | 'up' | 'down'
  label?: string
  triggerKey?: string
  slowMo?: number
  zIndex?: number
}
