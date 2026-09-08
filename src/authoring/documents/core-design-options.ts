export type DesignOptionId = 'A' | 'B' | 'C'

export interface DesignOption {
  id: DesignOptionId
  title: string
  recommended: boolean
  tags: [string, string, string, string]
  markdown: string
  genre: string
  visualStyle: string
  scale: string
  projectIntroduction: string
  themeExpression: string
  mainLoop: string
  deliveryPromise: string
  pillarStance: Record<string, string>
}

const OPTION_IDS: readonly DesignOptionId[] = ['A', 'B', 'C']

/** A core is finalized only after the Host materializes one selected option. */
export function hasSelectedDesignOption(content: string): boolean {
  return /^\s*selected_option:\s*[ABC]\s*$/m.test(content)
}

function record(
  value: unknown,
  errorMessage = 'design-options must be a JSON array of objects',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(errorMessage)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`design option ${field} must be a non-empty string`)
  }
  return value.trim()
}

function parseOption(value: unknown, index: number): DesignOption {
  const candidate = record(value)
  const id = text(candidate.id, `#${index + 1}.id`) as DesignOptionId
  if (!OPTION_IDS.includes(id)) throw new TypeError(`design option id must be A, B, or C (got ${id})`)
  if (typeof candidate.recommended !== 'boolean') throw new TypeError(`design option ${id}.recommended must be boolean`)
  if (!Array.isArray(candidate.tags) || candidate.tags.length !== 4 || candidate.tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    throw new TypeError(`design option ${id}.tags must contain exactly four non-empty strings`)
  }
  const pillarStance = candidate.pillarStance === undefined
    ? {}
    : record(candidate.pillarStance, `design option ${id}.pillarStance must be an object`)
  for (const [key, value] of Object.entries(pillarStance)) text(value, `${id}.pillarStance.${key}`)
  return {
    id,
    title: text(candidate.title, `${id}.title`),
    recommended: candidate.recommended,
    tags: candidate.tags.map((tag) => (tag as string).trim()) as [string, string, string, string],
    markdown: text(candidate.markdown, `${id}.markdown`),
    genre: text(candidate.genre, `${id}.genre`),
    visualStyle: text(candidate.visualStyle, `${id}.visualStyle`),
    scale: text(candidate.scale, `${id}.scale`),
    projectIntroduction: text(candidate.projectIntroduction, `${id}.projectIntroduction`),
    themeExpression: text(candidate.themeExpression, `${id}.themeExpression`),
    mainLoop: text(candidate.mainLoop, `${id}.mainLoop`),
    deliveryPromise: text(candidate.deliveryPromise, `${id}.deliveryPromise`),
    pillarStance: Object.fromEntries(Object.entries(pillarStance).map(([key, item]) => [key, text(item, `${id}.pillarStance.${key}`)])),
  }
}

function extractJsonArray(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(content)?.[1]
  const source = fenced ?? content.trim()
  try {
    return JSON.parse(source)
  } catch {
    const start = source.indexOf('[')
    const end = source.lastIndexOf(']')
    if (start < 0 || end <= start) throw new TypeError('design-options must contain a JSON array')
    try {
      return JSON.parse(source.slice(start, end + 1))
    } catch (error) {
      throw new TypeError(`design-options JSON is invalid: ${(error as Error).message}`)
    }
  }
}

export function parseDesignOptions(content: string): DesignOption[] {
  if (typeof content !== 'string' || content.trim() === '') throw new TypeError('design-options content is empty')
  const parsed = extractJsonArray(content)
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new TypeError('design-options must contain exactly three options')
  const options = parsed.map(parseOption)
  if (new Set(options.map((item) => item.id)).size !== 3) throw new TypeError('design option ids must be unique A/B/C')
  if (options.filter((item) => item.recommended).length !== 1) throw new TypeError('design-options must have exactly one recommended option')
  return options
}

export function materializeCoreMarkdown(options: readonly DesignOption[], selectedOptionId: DesignOptionId): string {
  const selected = options.find((option) => option.id === selectedOptionId)
  if (!selected) throw new TypeError(`selected design option ${selectedOptionId} was not found`)
  const body = selected.markdown.replace(
    new RegExp(`^#{1,6}\\s+方案\\s+${selected.id}[^\\r\\n]*(?:\\r?\\n)+`),
    '',
  )
  const stance = Object.entries(selected.pillarStance)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ')
  return [
    `# ${selected.title} · 核心设计`,
    '',
    '    schema_version: 1',
    `    selected_option: ${selected.id}`,
    '    option_count: 3',
    `    pillar_stance: {${stance}}`,
    '',
    body,
    '',
    '## 下游备忘',
    '',
    `- 主循环：${selected.mainLoop}`,
    `- 交付承诺：${selected.deliveryPromise}`,
    `- 类型：${selected.genre}`,
    `- 视觉风格：${selected.visualStyle}`,
    `- 篇幅大小：${selected.scale}`,
    '',
  ].join('\n')
}
