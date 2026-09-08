/**
 * Manifest 场景资产实体的作者态写入，与 `rules/rule-authoring.ts`、角色写入同构。
 *
 * 场景是「总脉络声明 → 本线补全」的产物：`blueprint.outline` 分配稳定 sceneId
 * 并写入声明，场景线只能填内容，不能新增未声明的场景、也不能改 ID。
 * 这条约束是并发安全的一部分——场景线的写域只有 manifest 场景资产实体。
 */

import type { SceneDefinition } from '@/authoring/assets/registry-types'
import { isValidNewRuleId, RULE_ID_RULE_TEXT } from '@/runtime/core/engine/formula-registry'

export type SceneOp =
  | {
    op: 'upsert-scene'
    sceneId: string
    name?: string
    summary?: string
    description?: string
    previewPrompt?: string
  }
  | { op: 'remove-scene'; sceneId: string }

export interface SceneAuthoringError {
  code: string
  message: string
  opIndex: number
}

export type SceneAuthoringResult =
  | { ok: true; scenes: Record<string, SceneDefinition>; results: Array<{ op: string; id: string }> }
  | { ok: false; errors: SceneAuthoringError[]; failedOpIndex?: number }

export interface SceneAuthoringOptions {
  /**
   * 总脉络声明的场景 id。给定时，`upsert-scene` 只能命中其中之一——
   * 这样场景线无法自行扩大范围。未给定（例如旧项目或直接编辑）时不限制。
   */
  declaredSceneIds?: readonly string[]
  /**
   * 允许新建未声明场景，并标记 `source: 'catalog'`（仅资产库，不计入规模）。
   * 仅应由 `assets.scene` 或交付后维护路径打开；`scenes.modeling` 必须保持 false。
   */
  allowCatalogAdHoc?: boolean
}

export function applySceneOps(
  current: Readonly<Record<string, SceneDefinition>> | undefined,
  ops: readonly SceneOp[],
  options: SceneAuthoringOptions = {},
): SceneAuthoringResult {
  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, errors: [{ code: 'scenes.ops.empty', message: 'ops 必须是非空数组', opIndex: 0 }] }
  }
  const draft: Record<string, SceneDefinition> = { ...(current ?? {}) }
  const results: Array<{ op: string; id: string }> = []
  const declared = options.declaredSceneIds ? new Set(options.declaredSceneIds) : undefined

  const fail = (opIndex: number, code: string, message: string): SceneAuthoringResult => ({
    ok: false,
    errors: [{ code, message, opIndex }],
    failedOpIndex: opIndex,
  })

  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]!
    switch (op.op) {
      case 'upsert-scene': {
        const sceneId = op.sceneId?.trim()
        if (!sceneId) return fail(index, 'scenes.scene.invalid-id', 'sceneId 不能为空')
        const existing = draft[sceneId]
        if (!existing && !isValidNewRuleId(sceneId)) {
          return fail(index, 'scenes.scene.invalid-id', `场景 ID ${sceneId} 不合法：${RULE_ID_RULE_TEXT}`)
        }
        const isAdHocCreate = !existing && declared && !declared.has(sceneId)
        if (isAdHocCreate && !options.allowCatalogAdHoc) {
          return fail(
            index,
            'scenes.scene.not-declared',
            `场景 ${sceneId} 不在总脉络声明中；场景线不得自行新增场景`,
          )
        }
        const name = op.name?.trim() ?? existing?.name
        if (!name) return fail(index, 'scenes.scene.name-required', `场景 ${sceneId} 缺少名称`)
        // 声明期只给 id 与 name，画面与 Prompt 留空由场景线补。
        // 完成门 `scenes.catalog.valid` 会要求两者非空，所以空值不会蒙混过关。
        const description = op.description?.trim() ?? existing?.visual.description ?? ''
        const previewPrompt = op.previewPrompt?.trim() ?? existing?.visual.previewPrompt ?? ''
        draft[sceneId] = {
          ...existing,
          id: sceneId,
          name,
          ...(op.summary !== undefined ? { summary: op.summary } : {}),
          visual: { description, previewPrompt },
          // 新建 ad-hoc → catalog；已有条目保留原 source（含 undefined=outline）。
          ...(isAdHocCreate
            ? { source: 'catalog' as const }
            : existing?.source !== undefined
              ? { source: existing.source }
              : {}),
        }
        results.push({ op: op.op, id: sceneId })
        break
      }
      case 'remove-scene': {
        const sceneId = op.sceneId?.trim()
        if (!sceneId || !draft[sceneId]) {
          return fail(index, 'scenes.scene.not-found', `场景不存在：${op.sceneId}`)
        }
        delete draft[sceneId]
        results.push({ op: op.op, id: sceneId })
        break
      }
      default:
        return fail(index, 'scenes.op.unknown', `未知 op：${String((op as { op: string }).op)}`)
    }
  }

  return { ok: true, scenes: draft, results }
}

/** 节点引用了但目录里没有定义的场景——`declared-not-defined` 到整装阶段必须清零。 */
export function unresolvedSceneReferences(
  scenes: Readonly<Record<string, SceneDefinition>> | undefined,
  referencedSceneIds: Iterable<string>,
): string[] {
  const defined = new Set(Object.keys(scenes ?? {}))
  return [...new Set([...referencedSceneIds])].filter((id) => !defined.has(id)).sort()
}

/** 已定义但还没有主预览图的场景。 */
export function scenesMissingPreview(
  scenes: Readonly<Record<string, SceneDefinition>> | undefined,
  referencedSceneIds: Iterable<string>,
): string[] {
  const referenced = new Set([...referencedSceneIds])
  return Object.values(scenes ?? {})
    .filter((scene) => referenced.has(scene.id) && !scene.currentAssetId)
    .map((scene) => scene.id)
    .sort()
}
