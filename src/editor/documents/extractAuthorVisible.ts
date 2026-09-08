const AUTHOR_LAYER_KEYWORD = '作者可见层'
const CONTRACT_LAYER_KEYWORDS = ['契约层', '下游备忘', '默认折叠', '不展示']
const CONTRACT_BLOCK_MARKER = 'schema_version:'

const STANDALONE_COMMENT = /^<!--([\s\S]*?)-->$/
const INLINE_COMMENT = /<!--[\s\S]*?-->/g
const FENCE_OPEN = /^(`{3,}|~{3,})/
const MARKDOWN_HEADING = /^#{1,6}\s+/
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const PILLAR_FRONTMATTER_MARKERS = ['character_preview_estimate:', 'pillar_stance:']
const PILLAR_SUMMARY_MARKERS = ['支柱档位', 'selected_option:']

const isIndented = (line: string): boolean => /^(\t| {4})/.test(line) && line.trim() !== ''

const isBlank = (line: string): boolean => line.trim() === ''

function stripPillarMetadata(lines: string[]): string[] {
  let visible = lines
  const firstContent = visible.findIndex((line) => !isBlank(line))
  const firstHeading = visible.findIndex((line, index) => (
    index > firstContent && MARKDOWN_HEADING.test(line.trimStart())
  ))

  if (firstContent >= 0 && visible[firstContent]?.trim() === '---' && firstHeading > firstContent) {
    const leadingBlock = visible.slice(firstContent, firstHeading)
    if (PILLAR_FRONTMATTER_MARKERS.some((marker) => leadingBlock.some((line) => line.includes(marker)))) {
      visible = visible.slice(firstHeading)
    }
  }

  let summaryStart = -1
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    if (visible[index]?.includes(PILLAR_SUMMARY_MARKERS[0] ?? '')) {
      summaryStart = index
      break
    }
  }
  if (summaryStart < 0) return visible
  const summary = visible.slice(summaryStart).join('\n')
  if (!PILLAR_SUMMARY_MARKERS.every((marker) => summary.includes(marker))) return visible

  let cut = summaryStart
  while (cut > 0 && isBlank(visible[cut - 1] ?? '')) cut -= 1
  if (cut > 0 && THEMATIC_BREAK.test(visible[cut - 1] ?? '')) cut -= 1
  while (cut > 0 && isBlank(visible[cut - 1] ?? '')) cut -= 1
  return visible.slice(0, cut)
}

/**
 * Keep only the lines inside author-visible regions. Standalone divider
 * comments switch the region; inline comments are stripped in place so a
 * heading that trails one (`### 内容卡 <!-- ... -->`) keeps its text.
 */
function selectAuthorRegions(lines: string[]): string[] {
  const kept: string[] = []
  let visible = true

  for (const line of lines) {
    const standalone = line.trim().match(STANDALONE_COMMENT)
    if (standalone) {
      const inner = standalone[1] ?? ''
      if (inner.includes(AUTHOR_LAYER_KEYWORD)) visible = true
      else if (CONTRACT_LAYER_KEYWORDS.some((keyword) => inner.includes(keyword))) visible = false
      continue
    }
    if (visible) kept.push(line.replace(INLINE_COMMENT, '').trimEnd())
  }

  return kept
}

/**
 * Drop code blocks that carry the contract payload. `schema_version:` only
 * ever appears in the machine-facing block, so it is a safe discriminator
 * against narrative code samples the author layer may legitimately contain.
 */
function stripContractBlocks(lines: string[]): string[] {
  const kept: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fence = line.trim().match(FENCE_OPEN)
    if (fence) {
      const closing = fence[1] ?? '```'
      let end = index + 1
      while (end < lines.length && !(lines[end] ?? '').trim().startsWith(closing)) end += 1
      const block = lines.slice(index, Math.min(end + 1, lines.length))
      if (!block.some((entry) => entry.includes(CONTRACT_BLOCK_MARKER))) kept.push(...block)
      index = end + 1
      continue
    }

    if (isIndented(line)) {
      let end = index
      while (end < lines.length) {
        const candidate = lines[end] ?? ''
        if (!isIndented(candidate) && !isBlank(candidate)) break
        end += 1
      }
      while (end > index && isBlank(lines[end - 1] ?? '')) end -= 1
      const block = lines.slice(index, end)
      if (!block.some((entry) => entry.includes(CONTRACT_BLOCK_MARKER))) kept.push(...block)
      index = end
      continue
    }

    kept.push(line)
    index += 1
  }

  return kept
}

/**
 * Reduce a project document to the layer the author is meant to read:
 * contract yaml, divider comments, and contract-layer sections are removed.
 */
export function extractAuthorVisible(markdown: string): string {
  const authorRegions = selectAuthorRegions(stripPillarMetadata(markdown.split('\n')))
  return stripContractBlocks(authorRegions).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
