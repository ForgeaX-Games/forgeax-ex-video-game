/**
 * 覆盖物展示名辅助。挂载候选一律从 live `ui.overlays` 派生（见 builtin-schemes）。
 */
import type { Overlay } from '@/runtime/core/schema/graph-schema'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'

/** 覆盖物展示名：有 title 时只显示标题；没有 title 时回退 id。 */
export function overlayDisplayLabel(
  id: string,
  overlays?: Record<string, Overlay>,
): string {
  const title = overlays?.[id]?.title?.trim()
  return authoringOptionLabel(title, id)
}
