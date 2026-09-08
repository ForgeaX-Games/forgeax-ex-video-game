/**
 * 把 `watch.of` 技术路径翻成作者可读的中文路径。
 *
 * 落盘仍是 `entity.ent-player.attr.hp`；时间轴条件行只展示
 * `实体.空藏.属性.生命`。名称取自实体 `name` / `attrMeta.label` / 变量 `name`，
 * 没有中文名时回退到技术 id（与下拉候选同一套 `authoringOptionLabel`）。
 */
import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'

export function formatWatchPathLabel(
  path: string,
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
): string {
  const trimmed = path.trim()
  if (!trimmed) return '未选数值'
  const segs = trimmed.split('.')
  const root = segs[0]
  if (root !== 'entity' && root !== 'var' && root !== 'score') return trimmed

  const out: string[] = []
  let i = 0
  if (root === 'entity') {
    out.push('实体')
    i = 1
    const entityId = segs[i]
    if (entityId) {
      const entity = entities?.[entityId]
      out.push(authoringOptionLabel(entity?.name, entityId))
      i++
      if (segs[i] === 'attr') {
        out.push('属性')
        i++
        const attrId = segs[i]
        if (attrId) {
          out.push(authoringOptionLabel(entity?.attrMeta?.[attrId]?.label, attrId))
          i++
        }
      }
    }
  } else if (root === 'var') {
    out.push('变量')
    i = 1
    const varId = segs[i]
    if (varId) {
      out.push(authoringOptionLabel(variables?.[varId]?.name, varId))
      i++
    }
  } else {
    out.push('分数')
    i = 1
  }
  while (i < segs.length) out.push(segs[i++]!)
  return out.join('.')
}
