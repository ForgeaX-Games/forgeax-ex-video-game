import type { KinoImageSize } from './kino-image-schema'

export const CHARACTER_PREVIEW_MODES = ['turnaround', 'portrait'] as const
export type CharacterPreviewMode = (typeof CHARACTER_PREVIEW_MODES)[number]
export const CHARACTER_PREVIEW_DEFAULT_MODE = 'turnaround' satisfies CharacterPreviewMode

export const CHARACTER_PREVIEW_PRESETS = {
  turnaround: { aspectRatio: '16:9', size: '2560x1440' },
  portrait: { aspectRatio: '2:3', size: '1664x2496' },
} as const satisfies Record<CharacterPreviewMode, {
  aspectRatio: '16:9' | '2:3'
  size: KinoImageSize
}>

export interface CharacterPreviewPromptSource {
  name: string
  description: string
  sourcePrompt: string
}

/** SSOT shared by the Agent workflow and the character image-generation page. */
export function buildCharacterPreviewPrompt(
  target: CharacterPreviewPromptSource,
  mode: CharacterPreviewMode,
): string {
  if (mode === 'turnaround') {
    return [
      '生成一张专业角色设定三视图，单张横向角色模型表。',
      `角色：${target.name}。`,
      `角色设定：${target.description}。`,
      `视觉要求：${target.sourcePrompt}。`,
      '同一个角色依次展示正面、侧面、背面三个全身视图，身份、面部、发型、服装、体型、配饰和色彩完全一致。',
      '中性站姿，比例清楚，无遮挡，均匀柔光，简洁纯色背景，角色之间留出清晰间距。',
      '不要场景叙事，不要重复人物，不要文字、标签、边框、签名或水印。',
    ].join(' ')
  }
  return [
    '生成一张专业角色定稿参考图，单角色全身立绘。',
    `角色：${target.name}。`,
    `角色设定：${target.description}。`,
    `视觉要求：${target.sourcePrompt}。`,
    '中性站姿，人物完整无遮挡，服装、面部、发型、体型和配饰清晰，简洁纯色背景。',
    '不要场景叙事，不要其他人物，不要文字、标签、边框、签名或水印。',
  ].join(' ')
}

export function characterPreviewSize(mode: CharacterPreviewMode): '2560x1440' | '1664x2496' {
  return CHARACTER_PREVIEW_PRESETS[mode].size
}
