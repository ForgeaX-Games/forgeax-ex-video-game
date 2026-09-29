import { describe, expect, test } from 'vitest'
import {
  createBlueprint,
  deleteBlueprint,
  renameBlueprint,
  setMainBlueprint,
  withBlueprintLibrary,
} from '@/authoring/blueprint/blueprint-library-edit'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import { EMPTY_LIBRARY_DOCUMENT } from '@/authoring/blueprint/empty-library'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { applyPatchGraphOps } from './patch-graph-ops'
import { validateServiceInput } from './service-validation'

function baseDocument(): GraphLibraryDocument {
  return normalizeDocument(structuredClone(EMPTY_LIBRARY_DOCUMENT))
}

describe('前端与 Agent 蓝图库编辑语义对齐', () => {
  test('公开 schema 接受蓝图库 CRUD 操作', () => {
    expect(validateServiceInput('patchGraph', {
      ops: [
        { op: 'create-blueprint', id: 'bp-side', title: '支线' },
        { op: 'rename-blueprint', id: 'bp-side', title: '支线二' },
        { op: 'set-main-blueprint', id: 'bp-side' },
      ],
    })).toEqual([])
    expect(validateServiceInput('patchGraph', {
      ops: [{ op: 'delete-blueprint' }],
    })).not.toEqual([])
  })

  test('新建蓝图复用与前端相同的默认入口和标题规则', () => {
    const document = baseDocument()
    const direct = createBlueprint(document.manifest.packs, { id: 'bp-side', title: ' 支线 ' })
    expect(direct.ok).toBe(true)
    if (!direct.ok) return
    const expected = withBlueprintLibrary(document, direct.blueprints)
    const agent = applyPatchGraphOps(document, {
      ops: [{ op: 'create-blueprint', id: 'bp-side', title: ' 支线 ' }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.document).toEqual(expected)
    expect(agent.document.manifest.packs['bp-side']).toMatchObject({
      id: 'bp-side',
      title: '支线',
      entry: 'entry',
    })
  })

  test('重命名蓝图复用相同的 trim 与不区分大小写唯一性规则', () => {
    const created = applyPatchGraphOps(baseDocument(), {
      ops: [{ op: 'create-blueprint', id: 'bp-side', title: 'Side' }],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const direct = renameBlueprint(created.document.manifest.packs, 'bp-side', ' 支线 ')
    expect(direct.ok).toBe(true)
    if (!direct.ok) return
    const agent = applyPatchGraphOps(created.document, {
      ops: [{ op: 'rename-blueprint', id: 'bp-side', title: ' 支线 ' }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.document).toEqual(withBlueprintLibrary(created.document, direct.blueprints))

    const duplicate = applyPatchGraphOps(agent.document, {
      ops: [{ op: 'rename-blueprint', id: 'bp-side', title: agent.document.manifest.packs[agent.document.manifest.mainPackId]!.title.toUpperCase() }],
    })
    expect(duplicate.ok).toBe(false)
  })

  test('设为主蓝图同步根 graph，语义与前端领域方法一致', () => {
    const created = applyPatchGraphOps(baseDocument(), {
      ops: [{ op: 'create-blueprint', id: 'bp-side', title: '支线' }],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const direct = setMainBlueprint(created.document.manifest.packs, 'bp-side')
    expect(direct.ok).toBe(true)
    if (!direct.ok) return
    const expected = withBlueprintLibrary(
      created.document,
      created.document.manifest.packs,
      direct.mainBlueprintId,
    )
    const agent = applyPatchGraphOps(created.document, {
      ops: [{ op: 'set-main-blueprint', id: 'bp-side' }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.document).toEqual(expected)
    expect(agent.document.graph).toEqual(agent.document.manifest.packs['bp-side']!.graph)
  })

  test('删除蓝图复用主蓝图与引用保护规则', () => {
    const created = applyPatchGraphOps(baseDocument(), {
      ops: [{ op: 'create-blueprint', id: 'bp-side', title: '支线' }],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const mainId = created.document.manifest.mainPackId
    const direct = deleteBlueprint(created.document.manifest.packs, mainId, 'bp-side')
    expect(direct.ok).toBe(true)
    if (!direct.ok) return
    const agent = applyPatchGraphOps(created.document, {
      blueprintId: mainId,
      ops: [{ op: 'delete-blueprint', id: 'bp-side' }],
    })
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(agent.document).toEqual(withBlueprintLibrary(created.document, direct.blueprints))

    const deleteMain = applyPatchGraphOps(created.document, {
      blueprintId: 'bp-side',
      ops: [{ op: 'delete-blueprint', id: mainId }],
    })
    expect(deleteMain.ok).toBe(false)

    const entry = created.document.manifest.packs[mainId]!.entry
    const referenced = applyPatchGraphOps(created.document, {
      blueprintId: mainId,
      ops: [{ op: 'set-sub-flow-pack', nodeId: entry, packId: 'bp-side' }],
    })
    expect(referenced.ok).toBe(true)
    if (!referenced.ok) return
    const directBlocked = deleteBlueprint(referenced.document.manifest.packs, mainId, 'bp-side')
    expect(directBlocked).toEqual({ ok: false, reason: 'referenced', blockedBy: [mainId] })
    const agentBlocked = applyPatchGraphOps(referenced.document, {
      blueprintId: mainId,
      ops: [{ op: 'delete-blueprint', id: 'bp-side' }],
    })
    expect(agentBlocked.ok).toBe(false)
    if (agentBlocked.ok) return
    expect(agentBlocked.errors[0]).toContain(`referenced (${mainId})`)
  })
})
