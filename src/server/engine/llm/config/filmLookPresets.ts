import type { FilmLook } from '../../scenario/types'
export type { FilmLook } from '../../scenario/types'
import {
  parseStyleSkill,
  needMeta,
  needSection,
  assertId,
  parseSwatch,
} from './styleSkillLoader'

import { readRaw } from '../_raw'
const retroFutureRaw = readRaw(import.meta.url, '../skills/film-looks/retro-future/SKILL.md')
const baroqueRaw = readRaw(import.meta.url, '../skills/film-looks/baroque-chiaroscuro/SKILL.md')
const tealOrangeRaw = readRaw(import.meta.url, '../skills/film-looks/teal-orange/SKILL.md')
const bleachBypassRaw = readRaw(import.meta.url, '../skills/film-looks/bleach-bypass/SKILL.md')
const pastelRaw = readRaw(import.meta.url, '../skills/film-looks/pastel-symmetry/SKILL.md')
const noirRaw = readRaw(import.meta.url, '../skills/film-looks/noir-lowkey/SKILL.md')
const warmNostalgiaRaw = readRaw(import.meta.url, '../skills/film-looks/warm-nostalgia/SKILL.md')
const clinicalRaw = readRaw(import.meta.url, '../skills/film-looks/clinical-scifi/SKILL.md')
const morandiRaw = readRaw(import.meta.url, '../skills/film-looks/morandi-muted/SKILL.md')
const bronzeRaw = readRaw(import.meta.url, '../skills/film-looks/bronze-epic/SKILL.md')

/**
 * 电影美学调色滤镜预设 —— 「电影美学/调色」维度，与 VisualStyle(渲染媒介) 正交叠加。
 *
 * 内容源（v8·2026-07）：规范 skill 目录 `skills/film-looks/<id>/SKILL.md`，
 * 由 styleSkillLoader 用 Vite `?raw` 解析。每个 look 恒定全片色板/对比/颗粒/染色
 * (## 调色锚点)，昼夜/情绪自适应写在 ## 场景自适应，供文生文遵守。
 *
 * 版权安全：产品可见面(label/tagline/调色锚点)只用原创描述性命名，无片名/品牌。
 * 真实影片仅作内部调研，写在各 look 的 references/research.md，不进入模型提示词。
 */
export interface FilmLookPreset {
  id: FilmLook
  label: string
  /** 一句话作者描述（UI 副标题） */
  hint: string
  /** 迷你色盘（UI 段式选择器色标） */
  swatch: [string, string]
  /** 中文一句宣传语 */
  tagline: string
  /** 注入 prompt 的英文调色前缀（全片恒定色板/对比/颗粒/高光阴影染色） */
  colorPrefix: string
  /** 中文·场景自适应说明（昼夜/内外景如何变化但保持统一），给文生文遵守 */
  sceneAdapt: string
  /** 中文·文生文风格指令 */
  authoringHint: string
  /** 电影海报英文提示词（竖版 one-sheet） */
  posterPrompt: string
}

/** 注册表 —— id → raw。顺序即 UI/海报展示顺序。 */
const REGISTRY: Array<[FilmLook, string]> = [
  ['retro-future', retroFutureRaw],
  ['baroque-chiaroscuro', baroqueRaw],
  ['teal-orange', tealOrangeRaw],
  ['bleach-bypass', bleachBypassRaw],
  ['pastel-symmetry', pastelRaw],
  ['noir-lowkey', noirRaw],
  ['warm-nostalgia', warmNostalgiaRaw],
  ['clinical-scifi', clinicalRaw],
  ['morandi-muted', morandiRaw],
  ['bronze-epic', bronzeRaw],
]

/** 从 SKILL.md 组装 preset，缺字段即 throw（fail-fast）。 */
function toPreset(id: FilmLook, raw: string): FilmLookPreset {
  const p = parseStyleSkill(raw)
  assertId(p, id)
  return {
    id,
    label: needMeta(p, 'label', id),
    hint: needMeta(p, 'hint', id),
    swatch: parseSwatch(needMeta(p, 'swatch', id), id),
    tagline: needMeta(p, 'tagline', id),
    colorPrefix: needSection(p, '调色锚点', id),
    sceneAdapt: needSection(p, '场景自适应', id),
    authoringHint: needSection(p, '作者文风', id),
    posterPrompt: needSection(p, '海报样张', id),
  }
}

export const FILM_LOOK_PRESETS: Record<FilmLook, FilmLookPreset> =
  Object.fromEntries(
    REGISTRY.map(([id, raw]) => [id, toPreset(id, raw)]),
  ) as Record<FilmLook, FilmLookPreset>

export const FILM_LOOK_LIST: FilmLookPreset[] = REGISTRY.map(
  ([id]) => FILM_LOOK_PRESETS[id],
)

/** UI 查看时的居中默认（非自动应用；scenario.filmLook 为空=不加调色）。 */
export const DEFAULT_FILM_LOOK: FilmLook = 'teal-orange'

/** 取某调色的英文前缀；未知/空 → 空串。 */
export function filmLookColorPrefix(look?: FilmLook | null): string {
  if (!look) return ''
  return FILM_LOOK_PRESETS[look]?.colorPrefix ?? ''
}

/**
 * 把任意输入收敛成合法 FilmLook id；非法/空 → undefined。
 * 供 style-curator 的 AI 输出校验用（LLM 乱填就回落到"不加调色"）。
 */
export function coerceFilmLookId(v: unknown): FilmLook | undefined {
  if (typeof v !== 'string') return undefined
  const id = v.trim()
  return (id in FILM_LOOK_PRESETS ? (id as FilmLook) : undefined)
}

/** 取某调色的中文文风(含场景自适应)；未知/空 → 空串。 */
export function filmLookAuthoringHint(look?: FilmLook | null): string {
  if (!look) return ''
  const p = FILM_LOOK_PRESETS[look]
  if (!p) return ''
  return `${p.authoringHint}\n场景自适应：${p.sceneAdapt}`
}
