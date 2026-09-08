/**
 * 蓝图侧栏 / 库列表的纯派生：主蓝图置顶（isEntry 标记），其余子蓝图按标题排序。
 * 不依赖 store/React——供单测与 NewSidebar 共用。
 */
import type { BlueprintDoc } from '@/runtime/core/schema/graph-schema'

/** 侧栏「蓝图」根行；画布面包屑与侧栏共用同一份 id/标签。 */
export const BLUEPRINT_NAV_ROOT = { id: 'graph', label: '蓝图' } as const

export interface BlueprintNavCrumb {
  id: string
  label: string
}

/**
 * 某蓝图在侧栏里的位置（外→内：蓝图根 → …文件夹 → 该蓝图），供画布面包屑复用。
 * 蓝图库目前平铺在根下，故只有根 + 自身；将来加分组文件夹时只改这里。
 */
export function blueprintSidebarPath(
  blueprints: Record<string, BlueprintDoc>,
  blueprintId: string,
): BlueprintNavCrumb[] {
  const doc = blueprints[blueprintId]
  const root: BlueprintNavCrumb = { id: BLUEPRINT_NAV_ROOT.id, label: BLUEPRINT_NAV_ROOT.label }
  return doc ? [root, { id: doc.id, label: doc.title }] : [root]
}

export function blueprintListItems(
  blueprints: Record<string, BlueprintDoc>,
  mainId: string,
): { id: string; label: string; isEntry: boolean }[] {
  const main = blueprints[mainId]
  const subs = Object.values(blueprints)
    .filter((d) => d.id !== mainId)
    .sort((a, b) => a.title.localeCompare(b.title))
  const items: { id: string; label: string; isEntry: boolean }[] = []
  if (main) items.push({ id: main.id, label: main.title, isEntry: true })
  for (const d of subs) items.push({ id: d.id, label: d.title, isEntry: false })
  return items
}
