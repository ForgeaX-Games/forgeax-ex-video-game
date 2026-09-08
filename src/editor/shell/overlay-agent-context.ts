import type { OverlayChild, ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import type { ContextReference } from '../../platform/context-reference'
import {
  SOURCE_EXTENSION_ID,
  truncatePayloadIfNeeded,
  toolsAction,
} from './reference-payload'

export interface OverlayChildAgentReferenceInput {
  gameId: string
  /** 该 overlay 所属的 overlay 目录 id（`scenario.ui.overlays[overlayId]`）。 */
  overlayId: string
  overlayTitle?: string
  /** 挂载该 overlay 的图节点 id；agent 写回 `patch-overlay-child*` op 需要 nodeId。未挂载时留空。 */
  nodeId?: string
  child: OverlayChild
}

export interface OverlayComponentAgentReferenceInput {
  gameId: string
  /** 组件库里的可复用组件清单（未放置）。 */
  manifest: ComponentManifest
}

/**
 * 把一个已放置的 overlay 子项投影成 Agent 引用负载：child 全量 + overlayId + 可用 nodeId。
 * 写回走 `patch-graph` 的 overlay op：`patch-overlay-child` / `patch-overlay-child-params`
 * （均需 nodeId）；若 child 未挂载到节点，payload 标注 `unmounted: true`，agent 无法直接写回。
 */
function buildOverlayChildPayload(input: OverlayChildAgentReferenceInput): Record<string, unknown> {
  return {
    kind: 'game-video.overlay-child-reference.v1',
    gameId: input.gameId,
    overlay: {
      id: input.overlayId,
      ...(input.overlayTitle === undefined ? {} : { title: input.overlayTitle }),
    },
    ...(input.nodeId === undefined ? { unmounted: true } : { nodeId: input.nodeId }),
    child: input.child,
  }
}

function overlayChildIdentity(payload: Record<string, unknown>): Record<string, unknown> {
  const child = payload.child as { id?: unknown; component?: unknown } | undefined
  return {
    kind: payload.kind,
    gameId: payload.gameId,
    overlay: payload.overlay,
    ...(payload.unmounted === true ? { unmounted: true } : { nodeId: payload.nodeId }),
    child: { id: child?.id, component: child?.component },
  }
}

export function buildOverlayChildContextReference(
  input: OverlayChildAgentReferenceInput,
): ContextReference {
  const payload = buildOverlayChildPayload(input)
  return {
    refKind: 'game-video.overlay-child.v1',
    sourceExtensionId: SOURCE_EXTENSION_ID,
    display: {
      title: input.child.component || input.child.id,
      icon: '🖥',
      subtitle: input.nodeId === undefined
        ? '界面 · 组件（未挂载）'
        : `界面 · 组件${input.overlayTitle ? ` · ${input.overlayTitle}` : ''}`,
    },
    payload: truncatePayloadIfNeeded(payload, overlayChildIdentity(payload)),
    action: toolsAction(['game-video:get-graph', 'game-video:patch-graph']),
  }
}

/**
 * 把一张组件库卡片（未放置的可复用组件清单）投影成 Agent 引用负载。这是信息性引用：
 * agent 可建议放置位置 / 推荐参数，但写回需先把组件挂到某个节点的 overlay（`add-overlay-child`
 * + nodeId），payload 因此标注 `informational: true`。
 */
function buildOverlayComponentPayload(
  input: OverlayComponentAgentReferenceInput,
): Record<string, unknown> {
  return {
    kind: 'game-video.overlay-component-reference.v1',
    gameId: input.gameId,
    informational: true,
    component: {
      id: input.manifest.id,
      ...(input.manifest.label === undefined ? {} : { label: input.manifest.label }),
      ...(input.manifest.inputs === undefined ? {} : { inputs: input.manifest.inputs }),
      ...(input.manifest.events === undefined ? {} : { events: input.manifest.events }),
    },
  }
}

function overlayComponentIdentity(payload: Record<string, unknown>): Record<string, unknown> {
  const component = payload.component as { id?: unknown; label?: unknown } | undefined
  return {
    kind: payload.kind,
    gameId: payload.gameId,
    informational: true,
    component: { id: component?.id, label: component?.label },
  }
}

export function buildOverlayComponentContextReference(
  input: OverlayComponentAgentReferenceInput,
): ContextReference {
  const payload = buildOverlayComponentPayload(input)
  return {
    refKind: 'game-video.overlay-component.v1',
    sourceExtensionId: SOURCE_EXTENSION_ID,
    display: {
      title: input.manifest.label || input.manifest.id,
      icon: '🖥',
      subtitle: '界面 · 组件库',
    },
    payload: truncatePayloadIfNeeded(payload, overlayComponentIdentity(payload)),
    action: toolsAction(['game-video:get-graph', 'game-video:patch-graph']),
  }
}
