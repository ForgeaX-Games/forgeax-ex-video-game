/**
 * directorSkillLoader —— 把 `skills/directors/<id>/SKILL.md` 解析成 DirectorPersona。
 *
 * 为什么存在：导演 persona 的**内容源**从"内联 TS 字符串"迁到规范 skill 目录
 *（对齐 Anthropic/Cursor Agent Skill 结构），便于深度调研、人读、扩充。运行时用
 * Vite 的 `?raw` 把 SKILL.md 读成文本，本模块解析出结构化 persona 供
 * directorPersonas.ts 消费——`resolveDirectorPersona` / `serializePersonaToPrompt`
 * 的对外 API 不变，下游 6 个 forge 调用点零改动。
 *
 * SKILL.md 约定（loader 依赖，改格式先改这里）：
 *   frontmatter: name(=id) / displayName / tagline / order
 *   正文 H2 段（标题字面量固定）:
 *     ## 身份 / ## 剪辑语法 / ## 镜头语言 / ## 节奏 / ## 下游绑定 / ## 海报样张
 *
 * fail-fast：缺段 / id 不匹配直接 throw —— 宁可构建期炸，也不让残缺 persona 混进提示词。
 */

import type { DirectorStyleId } from '../../scenario/types'

import { readRaw } from '../_raw'
const principleRaw = readRaw(import.meta.url, '../skills/directors/_shared/directing-principle.md')
const minimalEpicRaw = readRaw(import.meta.url, '../skills/directors/minimal-epic/SKILL.md')
const precisionNoirRaw = readRaw(import.meta.url, '../skills/directors/precision-noir/SKILL.md')
const foreknowledgeSuspenseRaw = readRaw(import.meta.url, '../skills/directors/foreknowledge-suspense/SKILL.md')
const moodNeonRaw = readRaw(import.meta.url, '../skills/directors/mood-neon/SKILL.md')
const luminousAnimeRaw = readRaw(import.meta.url, '../skills/directors/luminous-anime/SKILL.md')
const kineticClarityRaw = readRaw(import.meta.url, '../skills/directors/kinetic-clarity/SKILL.md')
const cyberpunkRaw = readRaw(import.meta.url, '../skills/directors/cyberpunk-neonoir/SKILL.md')
const unseenHorrorRaw = readRaw(import.meta.url, '../skills/directors/unseen-horror/SKILL.md')
const nonlinearScifiRaw = readRaw(import.meta.url, '../skills/directors/nonlinear-scifi/SKILL.md')
const pulpDialogueRaw = readRaw(import.meta.url, '../skills/directors/pulp-dialogue/SKILL.md')

/** 一位导演流派的结构化 persona —— 会被序列化进 LLM system prompt。 */
export interface DirectorPersona {
  id: DirectorStyleId
  /** UI 展示名（中文短标题） */
  displayName: string
  /** UI 展示简介（中文一句话） */
  tagline: string
  /** 身份：向 LLM 说明"你现在是谁"，只写职业惯性 */
  identity: string
  /** 剪辑语法：节拍、切点、转场、分镜结构偏好 */
  editingGrammar: string
  /** 镜头语言：景别、运镜、焦段、光影、色彩 */
  cameraLanguage: string
  /** 节奏偏好：整场戏的呼吸曲线 */
  pacing: string
  /**
   * 下游绑定：给逐镜出片/剪辑的**情境化调度矩阵**（当前 beat 情境 → 该导演怎么处理，
   * 含反招牌 + 底色vs点睛 + 4–15s 时长窗口）。本次新增，用于把 persona 更硬地传导到运镜。
   */
  downstreamBinding: string
  /** 电影海报样张英文提示词（竖版 2:3，no text）。gen-posters / 选择器海报用。 */
  posterPrompt: string
}

/** 通用镜头调度元规则（所有导演共用），从 _shared/directing-principle.md 读入。 */
export const DIRECTING_PRINCIPLE: string = principleRaw.replace(/^\uFEFF/, '').trim()

// ─────────────────────────────────────────────────────────────────────────────
// 解析
// ─────────────────────────────────────────────────────────────────────────────

interface Parsed {
  meta: Record<string, string>
  sections: Record<string, string>
}

/** 剥 frontmatter，解析简单 `key: value`（单行值，去引号）。 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const s = raw.replace(/^\uFEFF/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(s)
  if (!m) return { meta: {}, body: s }
  const meta: Record<string, string> = {}
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    const key = kv?.[1]
    if (!kv || !key) continue
    let v = (kv[2] ?? '').trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    meta[key] = v
  }
  return { meta, body: s.slice(m[0].length) }
}

/** 按 `## <标题>` 切正文成段落映射。 */
function parseSections(body: string): Record<string, string> {
  const heads: Array<{ title: string; contentStart: number; headStart: number }> = []
  const re = /^##[ \t]+(.+?)[ \t]*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    heads.push({ title: (m[1] ?? '').trim(), contentStart: re.lastIndex, headStart: m.index })
  }
  const out: Record<string, string> = {}
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]
    if (!h) continue
    const next = heads[i + 1]
    const end = next ? next.headStart : body.length
    out[h.title] = body.slice(h.contentStart, end).trim()
  }
  return out
}

function parse(raw: string): Parsed {
  const { meta, body } = parseFrontmatter(raw)
  return { meta, sections: parseSections(body) }
}

/** 从解析结果组装 persona，缺字段即 throw（fail-fast）。 */
function toPersona(expectedId: DirectorStyleId, raw: string): DirectorPersona {
  const { meta, sections } = parse(raw)
  const need = (obj: Record<string, string>, key: string, where: string): string => {
    const v = (obj[key] ?? '').trim()
    if (!v) throw new Error(`[directorSkillLoader] ${expectedId} 缺 ${where}:${key}`)
    return v
  }
  const id = need(meta, 'name', 'frontmatter')
  if (id !== expectedId) {
    throw new Error(`[directorSkillLoader] id 不匹配: 目录=${expectedId} frontmatter.name=${id}`)
  }
  return {
    id: expectedId,
    displayName: need(meta, 'displayName', 'frontmatter'),
    tagline: need(meta, 'tagline', 'frontmatter'),
    identity: need(sections, '身份', 'section'),
    editingGrammar: need(sections, '剪辑语法', 'section'),
    cameraLanguage: need(sections, '镜头语言', 'section'),
    pacing: need(sections, '节奏', 'section'),
    downstreamBinding: need(sections, '下游绑定', 'section'),
    posterPrompt: need(sections, '海报样张', 'section'),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 注册表 —— id → raw。新增导演在这里登记一行即可。
// 顺序即 UI/海报展示顺序（villeneuve 默认放首、custom 由 directorPersonas 追加末尾）。
// ─────────────────────────────────────────────────────────────────────────────
const REGISTRY: Array<[Exclude<DirectorStyleId, 'custom'>, string]> = [
  ['minimal-epic', minimalEpicRaw],
  ['precision-noir', precisionNoirRaw],
  ['foreknowledge-suspense', foreknowledgeSuspenseRaw],
  ['mood-neon', moodNeonRaw],
  ['luminous-anime', luminousAnimeRaw],
  ['kinetic-clarity', kineticClarityRaw],
  ['cyberpunk-neonoir', cyberpunkRaw],
  ['unseen-horror', unseenHorrorRaw],
  ['nonlinear-scifi', nonlinearScifiRaw],
  ['pulp-dialogue', pulpDialogueRaw],
]

/** 解析出的全部导演 persona（不含 custom）。 */
export const DIRECTOR_PERSONAS: Record<
  Exclude<DirectorStyleId, 'custom'>,
  DirectorPersona
> = Object.fromEntries(REGISTRY.map(([id, raw]) => [id, toPersona(id, raw)])) as Record<
  Exclude<DirectorStyleId, 'custom'>,
  DirectorPersona
>

/** 展示/选择顺序（不含 custom）。 */
export const DIRECTOR_ORDER: Array<Exclude<DirectorStyleId, 'custom'>> = REGISTRY.map(
  ([id]) => id,
)
