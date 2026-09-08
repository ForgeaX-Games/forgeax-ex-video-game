/**
 * overlayChildPreview —— 把一个 OverlayChild 通用地渲染成预览节点（节点无关）。
 *
 * 统一走 overlay 表 + skinCtx；交互/表现不再分流。
 */
import type { ReactNode } from 'react'
import type { Layout, OverlayChild } from '@/runtime/core/schema/graph-schema'
import { defaultsForComponent } from './editors'
import type { SkinCtx, SkinRegistry } from '@/runtime/react/component-host/rendererRegistry'
import { STAGE_FILL_LAYOUT } from '@/runtime/core/schema/layout'
import { localMsForChild } from './previewClock'

/**
 * 渲染单个 overlay child 到预览。timeMs = 当前播放头（相对整段素材）；未知 component 返回 null（不炸）。
 */
export function renderOverlayChildPreview(
  child: OverlayChild,
  reg: SkinRegistry,
  ctx: SkinCtx,
  timeMs: number,
  mountLayout: Layout | undefined = STAGE_FILL_LAYOUT,
  playing = false,
): ReactNode {
  const inputs = { ...defaultsForComponent(child.component), ...(child.inputs ?? {}) }
  const preview = { timeMs: localMsForChild(child, timeMs), playing }

  return reg.renderOverlayMount(
    {
      mountId: `preview:${child.id}`,
      mountLayout,
      children: [{
        elementId: child.id,
        component: child.component,
        inputs,
        childLayout: child.layout,
      }],
    },
    undefined,
    ctx,
    preview,
  )
}
