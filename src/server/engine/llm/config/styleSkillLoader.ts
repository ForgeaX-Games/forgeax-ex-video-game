/**
 * styleSkillLoader —— 通用 SKILL.md 解析器，供「美术风格」(art-media) 与
 * 「电影美学调色」(film-looks) 两个风格库共用。
 *
 * 范式对齐 directorSkillLoader：内容源从内联 TS 迁到规范 skill 目录，运行时用
 * Vite 的 `?raw` 读成文本，本模块解析出 frontmatter(单行 key: value) + H2 段落。
 * fail-fast：缺 frontmatter 键 / 缺段 / id 不匹配一律 throw —— 宁可构建期炸，
 * 也不让残缺预设混进出图/提示词。
 */

export interface ParsedStyleSkill {
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

/** 解析一份 SKILL.md 成 {meta, sections}。 */
export function parseStyleSkill(raw: string): ParsedStyleSkill {
  const { meta, body } = parseFrontmatter(raw)
  return { meta, sections: parseSections(body) }
}

/** 取 frontmatter 必填键，空则 throw。 */
export function needMeta(
  p: ParsedStyleSkill,
  key: string,
  where: string,
): string {
  const v = (p.meta[key] ?? '').trim()
  if (!v) throw new Error(`[styleSkillLoader] ${where} 缺 frontmatter:${key}`)
  return v
}

/** 取 H2 段落必填内容，空则 throw。 */
export function needSection(
  p: ParsedStyleSkill,
  key: string,
  where: string,
): string {
  const v = (p.sections[key] ?? '').trim()
  if (!v) throw new Error(`[styleSkillLoader] ${where} 缺 section:${key}`)
  return v
}

/** 校验 frontmatter.name 与目录 id 一致，否则 throw。 */
export function assertId(p: ParsedStyleSkill, expectedId: string): void {
  const id = (p.meta.name ?? '').trim()
  if (id !== expectedId) {
    throw new Error(
      `[styleSkillLoader] id 不匹配: 目录=${expectedId} frontmatter.name=${id}`,
    )
  }
}

/** 把 `"#aabbcc, #112233"` 解析成 [string, string]；不足两色即 throw。 */
export function parseSwatch(raw: string, where: string): [string, string] {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const a = parts[0]
  const b = parts[1]
  if (!a || !b) {
    throw new Error(`[styleSkillLoader] ${where} swatch 需要两个颜色: "${raw}"`)
  }
  return [a, b]
}
