import type { BlueprintDoc, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { emptyBlueprintDoc, normalizeDocument } from './blueprint-project'
import { blueprintsReferencing } from '../graph/blueprint-refs'

export type BlueprintLibraryEditError =
  | 'duplicate_id'
  | 'duplicate_title'
  | 'empty_title'
  | 'not_found'
  | 'main_blueprint'
  | 'referenced'

export type BlueprintLibraryEditResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; reason: BlueprintLibraryEditError; blockedBy?: string[] }

/** 蓝图标题唯一性是作者态领域规则，不属于前端表单。 */
export function normalizeBlueprintTitle(title: string): string {
  return title.trim().toLocaleLowerCase('zh-CN')
}

export function isBlueprintTitleTaken(
  blueprints: Record<string, Pick<BlueprintDoc, 'id' | 'title'>>,
  title: string,
  excludeId?: string,
): boolean {
  const key = normalizeBlueprintTitle(title)
  if (!key) return false
  return Object.values(blueprints).some((blueprint) => (
    blueprint.id !== excludeId && normalizeBlueprintTitle(blueprint.title) === key
  ))
}

export function createBlueprint(
  blueprints: Record<string, BlueprintDoc>,
  input: { title: string; id?: string },
): BlueprintLibraryEditResult<{
  blueprints: Record<string, BlueprintDoc>
  blueprint: BlueprintDoc
}> {
  const title = input.title.trim()
  if (!title) return { ok: false, reason: 'empty_title' }
  if (isBlueprintTitleTaken(blueprints, title)) return { ok: false, reason: 'duplicate_title' }
  if (input.id && blueprints[input.id]) return { ok: false, reason: 'duplicate_id' }
  const blueprint = emptyBlueprintDoc({ ...(input.id ? { id: input.id } : {}), title })
  return {
    ok: true,
    blueprints: { ...blueprints, [blueprint.id]: blueprint },
    blueprint,
  }
}

export function renameBlueprint(
  blueprints: Record<string, BlueprintDoc>,
  id: string,
  titleInput: string,
): BlueprintLibraryEditResult<{ blueprints: Record<string, BlueprintDoc> }> {
  const current = blueprints[id]
  if (!current) return { ok: false, reason: 'not_found' }
  const title = titleInput.trim()
  if (!title) return { ok: false, reason: 'empty_title' }
  if (isBlueprintTitleTaken(blueprints, title, id)) return { ok: false, reason: 'duplicate_title' }
  return {
    ok: true,
    blueprints: { ...blueprints, [id]: { ...current, title } },
  }
}

export function deleteBlueprint(
  blueprints: Record<string, BlueprintDoc>,
  mainBlueprintId: string,
  id: string,
): BlueprintLibraryEditResult<{ blueprints: Record<string, BlueprintDoc> }> {
  if (!blueprints[id]) return { ok: false, reason: 'not_found' }
  if (id === mainBlueprintId) {
    return { ok: false, reason: 'main_blueprint', blockedBy: ['__main__'] }
  }
  const blockedBy = blueprintsReferencing(blueprints, id)
  if (blockedBy.length > 0) return { ok: false, reason: 'referenced', blockedBy }
  const next = { ...blueprints }
  delete next[id]
  return { ok: true, blueprints: next }
}

export function setMainBlueprint(
  blueprints: Record<string, BlueprintDoc>,
  id: string,
): BlueprintLibraryEditResult<{ mainBlueprintId: string }> {
  return blueprints[id]
    ? { ok: true, mainBlueprintId: id }
    : { ok: false, reason: 'not_found' }
}

/** Host/Agent 使用的文档级包装；UI store 复用上面的同一组纯方法。 */
export function withBlueprintLibrary(
  document: GraphLibraryDocument,
  blueprints: Record<string, BlueprintDoc>,
  mainBlueprintId = document.manifest.mainPackId,
): GraphLibraryDocument {
  return normalizeDocument({
    ...document,
    manifest: {
      ...document.manifest,
      mainPackId: mainBlueprintId,
      packs: blueprints,
    },
  })
}
