import type { VisualStyle } from '../../scenario/types'
export type { VisualStyle } from '../../scenario/types'
import {
  parseStyleSkill,
  needMeta,
  needSection,
  assertId,
  parseSwatch,
} from './styleSkillLoader'

import type { FilmLook } from '../../scenario/types'
import {
  filmLookColorPrefix,
  filmLookAuthoringHint,
} from './filmLookPresets'

import { readRaw } from '../_raw'
const photorealRaw = readRaw(import.meta.url, '../skills/art-media/photoreal/SKILL.md')
const animeRaw = readRaw(import.meta.url, '../skills/art-media/anime/SKILL.md')
const cartoonRaw = readRaw(import.meta.url, '../skills/art-media/cartoon/SKILL.md')
const pixelartRaw = readRaw(import.meta.url, '../skills/art-media/pixelart/SKILL.md')
const watercolorRaw = readRaw(import.meta.url, '../skills/art-media/watercolor/SKILL.md')
const inkRaw = readRaw(import.meta.url, '../skills/art-media/ink/SKILL.md')
const render3d2dRaw = readRaw(import.meta.url, '../skills/art-media/render3d2d/SKILL.md')

/**
 * 全局视觉风格预设 —— 「渲染媒介」维度（写实/二次元/卡通/像素/水彩/水墨/三渲二）。
 * 作者在 Forge「风格」模块选一次，影响**所有**素材生成。
 *
 * 内容源（v8·2026-07）：从内联 TS 迁到规范 skill 目录
 * `skills/art-media/<id>/SKILL.md`，由 styleSkillLoader 用 Vite `?raw` 解析。
 * 本文件对外 API（VISUAL_STYLE_PRESETS/LIST/DEFAULT/composeVisualPrompt/
 * getAuthoringHint）保持不变，下游零改动。
 *
 * 影响对象：场景图 / 角色立绘 / 参考图流水线 / 批量生图 / 视频。
 *
 * 设计原则：
 *   1. **Prompt 前缀**：每个风格一段英文风格引导，附加在 raw prompt 前面，
 *      让 GPT-Image-2 / Gemini / SDXL 系列都能理解。
 *   2. **不追溯**：作者改风格只影响"今后"生成的图，现有图不重绘。
 *   3. **可选**：字段缺失时 composeVisualPrompt 原样返回，保证向后兼容。
 */

export interface VisualStylePreset {
  id: VisualStyle
  label: string
  /** 一句话作者描述（UI 下拉里显示的副标题） */
  hint: string
  /** 迷你色盘（UI 段式选择器的色标） */
  swatch: [string, string]
  /**
   * 注入 prompt 的风格前缀 —— 会放在 raw prompt 之前，中间用双换行分隔。
   * 刻意使用英文 + 画面关键词，命中大多数文生图模型的训练语料习惯。
   */
  promptPrefix: string
  /**
   * 用于 LLM 文生文（锻造场景描述 / 锻造提示词）的"风格指令"，
   * 中文化一句，放进 system prompt，让措辞本身就带风格色彩。
   */
  authoringHint: string
  /**
   * 电影海报专用英文提示词 —— 竖版 one-sheet，强调海报构图 / 标题留白 / 光影氛围。
   * 「风格」模块的电影海报式选择器用它生成各风格的海报缩略图。
   */
  posterPrompt: string
  /** 中文一句宣传语 —— 海报式选择器上展示的标语 */
  tagline: string
}

/** 注册表 —— id → raw。顺序即 UI/海报展示顺序（photoreal 默认放首）。 */
const REGISTRY: Array<[VisualStyle, string]> = [
  ['photoreal', photorealRaw],
  ['anime', animeRaw],
  ['cartoon', cartoonRaw],
  ['pixelart', pixelartRaw],
  ['watercolor', watercolorRaw],
  ['ink', inkRaw],
  ['render3d2d', render3d2dRaw],
]

/** 从 SKILL.md 组装 preset，缺字段即 throw（fail-fast）。 */
function toPreset(id: VisualStyle, raw: string): VisualStylePreset {
  const p = parseStyleSkill(raw)
  assertId(p, id)
  return {
    id,
    label: needMeta(p, 'label', id),
    hint: needMeta(p, 'hint', id),
    swatch: parseSwatch(needMeta(p, 'swatch', id), id),
    tagline: needMeta(p, 'tagline', id),
    promptPrefix: needSection(p, '出图前缀', id),
    authoringHint: needSection(p, '作者文风', id),
    posterPrompt: needSection(p, '海报样张', id),
  }
}

export const VISUAL_STYLE_PRESETS: Record<VisualStyle, VisualStylePreset> =
  Object.fromEntries(
    REGISTRY.map(([id, raw]) => [id, toPreset(id, raw)]),
  ) as Record<VisualStyle, VisualStylePreset>

export const VISUAL_STYLE_LIST: VisualStylePreset[] = REGISTRY.map(
  ([id]) => VISUAL_STYLE_PRESETS[id],
)

/** 默认视觉风格 —— 没选过时用 photoreal，向后兼容 */
export const DEFAULT_VISUAL_STYLE: VisualStyle = 'photoreal'

/**
 * 把视觉风格前缀注入到 raw prompt 前面。
 *
 * 契约：
 *   - style 为 undefined / null / 未知值 → 原样返回 rawPrompt（向后兼容）
 *   - rawPrompt 为空串 → 直接返回前缀，避免尾巴
 *   - 前缀与原文之间用 "\n\n" 双换行连接（v6.4 前是 "—— "）
 *     · 让模型自然把两段识别为"风格引导 + 具体画面"，而不是强行拼接
 *     · Azure safety classifier 对连续破折号 "—— " 后接大段文本有额外警惕
 *       （属于 prompt-injection 常见写法），改成段落分隔降低误判概率
 *   - 幂等：**注意**本函数不是幂等的 —— 调用方保证只在最终写 ImageRequest.prompt
 *     时调用一次，不要在已经有前缀的 prompt 上再套一次
 */
export function composeVisualPrompt(
  rawPrompt: string,
  style?: VisualStyle | null,
  look?: FilmLook | null,
): string {
  const colorPrefix = filmLookColorPrefix(look)
  const mediumPrefix = style ? VISUAL_STYLE_PRESETS[style]?.promptPrefix ?? '' : ''
  // 叠加顺序：[电影美学调色锚点] + [渲染媒介出图前缀] + [raw]。
  const prefix = [colorPrefix, mediumPrefix].filter(Boolean).join('\n\n')
  if (!prefix) return rawPrompt
  if (!rawPrompt) return prefix
  return `${prefix}\n\n${rawPrompt}`
}

/**
 * 取出风格对应的"作者 LLM 指令"片段。
 *
 * 用于锻造场景描述 / 剧本 / 提示词等文生文任务：
 * 把这句话塞进 system prompt，让 LLM 输出的措辞天然带着风格色彩。
 * 不存在 / 未知 → 返回空串，由调用方决定是否回退到默认值。
 */
export function getAuthoringHint(
  style?: VisualStyle | null,
  look?: FilmLook | null,
): string {
  const mediumHint = style ? VISUAL_STYLE_PRESETS[style]?.authoringHint ?? '' : ''
  const lookHint = filmLookAuthoringHint(look)
  return [mediumHint, lookHint].filter(Boolean).join('\n')
}
