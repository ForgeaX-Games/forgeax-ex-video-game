/**
 * Browser-side video generation contract.
 *
 * 浏览器的生成 transport 是同源 `/api/v1/kino/generations`（见
 * `kino-generation-client.ts`）。这里只保留请求/任务形状，不再持有 Extension
 * Host tool 的提交实现：Host tool `game-video:generate-video-clip` 仍然存在，
 * 但只服务 Agent/MCP 调用方，由 server 侧 handler 承载。
 */

import type { KinoVideoGenerationParams } from '@/runtime/core/schema/kino-schema'

export type {
  KinoPromptContentItem,
  KinoVideoGenerationMode,
  KinoVideoGenerationParams,
  KinoVideoResolution,
  KinoVideoSize,
} from '@/runtime/core/schema/kino-schema'
export type KinoGenerationStatus =
  | 'pending'
  | 'submitting'
  | 'polling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface ClipGenerationRequest extends KinoVideoGenerationParams {
  /** 当前 Extension handshake 提供的 gameId。 */
  gameSlug: string
  /** 编辑器素材库展示名，不传给 Kino 生成接口。 */
  label?: string
}

export type KinoGenerationMediaType = 'image' | 'video'

/** Shared browser representation for Kino image and video generation tasks. */
export interface KinoGenerationTask {
  generationId: string
  status: KinoGenerationStatus
  mediaType?: KinoGenerationMediaType
  prompt?: string
  model?: string
  imageSize?: string
  visualStyleKey?: string
  providerTaskId?: string
  /** Kino 直出的可播放地址，`<video>` 可直接使用。 */
  resultUrl?: string
  resourceId?: string
  errorCode?: string
  errorMessage?: string
  createdAt?: number
  /** Browser-owned request metadata retained for history restoration. */
  params?: Record<string, unknown>
}

/** Kept as a named export for existing video-generation consumers. */
export type VideoGenerationStatus = KinoGenerationStatus
export type VideoGenerationTask = KinoGenerationTask
