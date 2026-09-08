/**
 * 运行时「泛型指令」—— 引擎(GraphRuntime, 纯 TS) 对外只产出这组渲染无关指令，由 Player
 * 侧的**渲染器 registry**按 `component` 派发成实际 UI。
 *
 * 全部组件统一 `renderOverlay`（含原 interaction）；玩家结果经 session.emitEvent，无 openInteraction。
 */

import type { Layout } from '../schema/node-config-schema'
import type { BgmPlaybackCommand } from './bgm-stack'

/** 播放某节点的演出（视频/占位 + loop）。 */
export interface PlayClipDirective {
  type: 'playClip'
  nodeId: string
  name: string
  mediaId?: string
  loop: boolean
  durationMs?: number
}

/** 叠层元素 → 由 renderer registry 按 component 渲染。 */
export interface RenderOverlayDirective {
  type: 'renderOverlay'
  nodeId: string
  /** 挂载键（节点 overlayNodes 或 spawn 瞬态 id）；可省略，由引擎补齐。 */
  mountId?: string
  /** 挂载级排版：相对视频舞台；无显式尺寸 → 自适应内容。 */
  mountLayout?: Layout
  elementId: string
  component: string
  inputs: Record<string, unknown>
  /** 子组件级排版：相对挂载盒；有则映射为 CSS，无且挂载有尺寸 → 铺满挂载盒。 */
  childLayout?: Layout
}

/** 移除某个已渲染的叠层（window.endMs 到点）。 */
export interface RemoveOverlayDirective {
  type: 'removeOverlay'
  nodeId: string
  elementId: string
}

/** HUD 需要刷新（读全局态重绘）。 */
export interface HudUpdateDirective {
  type: 'hudUpdate'
  nodeId: string
}

/** 全局态发生变化（血量/数值/flag），视图据此刷新。 */
export interface StateChangedDirective {
  type: 'stateChanged'
}

/** 走了哪条边进入下一节点 + 命中的条件（含实时值）——用于日志「进入原因」。 */
export interface RouteInfoDirective {
  type: 'routeInfo'
  via: string
  target: string
  reason: string
}

/** 日志（调试 / 可视化事件流）。 */
export interface LogDirective {
  type: 'log'
  message: string
}

/**
 * 床轨该怎么响 —— BGM 作用域栈每变一次发一条（引擎在生命周期检查点上产出，壳层拿去驱动音频元素）。
 *
 * 载荷**就是** `BgmPlaybackCommand` 加个 tag，不另抄一份字段：语义（`fadeOutMs` 说的是**离场**
 * 那条、`ref`/`volume`/`fadeInMs`/`loop` 说的是**将响**那条、`ref: null` = 停播、`restart: false`
 * = 同曲续播别动播放头）全钉在 `bgm-stack.ts` 那份注释上。抄成独立 interface 则两边可以各自
 * 加减字段而编译器不吭声——交叉类型让「栈产出什么」与「传输什么」只能同生共死。
 */
export type BgmDirective = { type: 'bgm' } & BgmPlaybackCommand

export type RuntimeDirective =
  | PlayClipDirective
  | RenderOverlayDirective
  | RemoveOverlayDirective
  | HudUpdateDirective
  | StateChangedDirective
  | RouteInfoDirective
  | LogDirective
  | BgmDirective

export function isRenderOverlay(d: RuntimeDirective): d is RenderOverlayDirective {
  return d.type === 'renderOverlay'
}
export function isPlayClip(d: RuntimeDirective): d is PlayClipDirective {
  return d.type === 'playClip'
}
export function isBgm(d: RuntimeDirective): d is BgmDirective {
  return d.type === 'bgm'
}
