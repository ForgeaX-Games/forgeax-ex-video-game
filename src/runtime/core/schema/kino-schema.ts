/**
 * Kino 视频生成参数契约。
 *
 * 这里只描述会影响生成结果的参数；`gameId`、任务 id、展示 label 等宿主路由或
 * 编辑器状态不属于生成参数。参考图使用 Kino resource id，不接受宿主 asset id 或 URL。
 */

export const KINO_VIDEO_SIZES = [
  '2560x1440',
  '1440x2560',
  '2496x1664',
  '1664x2496',
] as const

export type KinoVideoSize = (typeof KINO_VIDEO_SIZES)[number]

export const KINO_VIDEO_RESOLUTIONS = ['720p', '1080p'] as const

export type KinoVideoResolution = (typeof KINO_VIDEO_RESOLUTIONS)[number]

/** Seedance 2.0 单次生成的整数秒范围；更长视频由节点编排拆段生成。 */
export const KINO_VIDEO_MIN_DURATION_SECONDS = 4
export const KINO_VIDEO_MAX_DURATION_SECONDS = 15

export const KINO_VIDEO_GENERATION_MODES = [
  'strict',
  'firstref',
  'ref',
  't2v',
] as const

export type KinoVideoGenerationMode = (typeof KINO_VIDEO_GENERATION_MODES)[number]

export type KinoPromptContentItem =
  | { type: 'text'; text: string }
  | { type: 'resource'; resourceId: string }

/**
 * 一次 Kino 视频生成所需的作者参数。
 *
 * mode 对参考资源的约束：
 * - strict：必须提供 firstFrameResourceId 和 lastFrameResourceId；
 * - firstref：必须提供 firstFrameResourceId；
 * - ref：必须提供至少一个 referenceImageResourceIds；
 * - t2v：不使用模式专属参考资源；promptContent 仍可包含行内 @素材。
 *
 * 组合约束由提交边界校验，因为编辑器在切换 mode 时会暂存其他模式的输入。
 */
export interface KinoVideoGenerationParams {
  prompt: string
  /** Prompt 与行内 @素材 的有序内容；未传时沿用纯文本 prompt。 */
  promptContent?: KinoPromptContentItem[]
  durationSeconds: number
  generateAudio: boolean
  mode: KinoVideoGenerationMode
  /** Kino resource id，用作生成视频的首帧。 */
  firstFrameResourceId?: string
  /** Kino resource id，用作生成视频的尾帧；仅 strict 模式使用。 */
  lastFrameResourceId?: string
  /** Kino resource id 列表；仅 ref 模式使用。 */
  referenceImageResourceIds?: string[]
  size?: KinoVideoSize
  resolution?: KinoVideoResolution
  model?: string
  visualStyleKey?: string
}

/** 新视频尚未生成时使用的表单初值。 */
export const KINO_DEFAULT_GENERATION = {
  prompt: '',
  durationSeconds: 8,
  generateAudio: false,
  mode: 't2v',
  size: '2560x1440',
  resolution: '720p',
} satisfies KinoVideoGenerationParams
