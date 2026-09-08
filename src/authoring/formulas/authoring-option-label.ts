function stripKnownIdSuffix(label: string, id: string): string {
  for (const suffix of [` (${id})`, `（${id}）`]) {
    if (label.endsWith(suffix)) return label.slice(0, -suffix.length).trim()
  }
  return label
}

/** 作者态展示项：有名称时只显示名称；没有名称时才回退到技术 id。 */
export function authoringOptionLabel(name: string | undefined, id: string): string {
  const fallback = id.trim()
  const readable = stripKnownIdSuffix(name?.trim() ?? '', fallback)
  if (!readable || readable === fallback) return fallback
  return readable
}
