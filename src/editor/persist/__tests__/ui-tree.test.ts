import { describe, expect, it } from 'vitest'
import type { GraphLibraryDocument, Overlay, UiTree } from '@/runtime/core/schema/graph-schema'
import { documentFromBlueprints, metaFromDocument, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import { toRuntimeScenario } from '@/authoring/blueprint/formula-authoring'
import {
  addUiTreeFolder,
  addUiTreeScheme,
  BASIC_UI_FOLDER_ID,
  collectUiTreeNodeIds,
  CUSTOM_UI_FOLDER_ID,
  ensureUiTree,
  findUiTreeNode,
  findUiTreeParent,
  isUiTreeAncestor,
  MAX_DEPTH,
  moveUiTreeNode,
  removeUiTreeNode,
  renameUiTreeFolder,
  uiTreeDepth,
  UNGROUPED_UI_FOLDER_ID,
  validateUiTree,
} from '../ui-tree'

const overlays: Record<string, Overlay> = {
  'base:hp': { id: 'base:hp', title: '血条', children: [] },
  combat: { id: 'combat', title: '战斗', children: [] },
  dialogue: { id: 'dialogue', title: '对白', children: [] },
}

describe('uiTree pure functions', () => {
  it('validates globally unique node ids and scheme overlay ids', () => {
    const tree: UiTree = {
      root: [
        { kind: 'scheme', id: 'same', overlayId: 'combat' },
        {
          kind: 'folder',
          id: 'same',
          name: '重复',
          children: [{ kind: 'scheme', id: 'other', overlayId: 'combat' }],
        },
      ],
    }
    const result = validateUiTree(tree)
    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('节点 id 重复')
    expect(result.errors.join('\n')).toContain('overlayId 重复')
  })

  it('finds relationships and performs immutable edits', () => {
    const initial: UiTree = { root: [] }
    const withFolder = addUiTreeFolder(initial, null, { id: 'folder', name: '目录' })
    const withScheme = addUiTreeScheme(withFolder, 'folder', { id: 'scheme', overlayId: 'combat' })
    expect(initial.root).toEqual([])
    expect(findUiTreeParent(withScheme, 'scheme')?.id).toBe('folder')
    expect(isUiTreeAncestor(withScheme, 'folder', 'scheme')).toBe(true)
    expect(uiTreeDepth(withScheme, 'scheme')).toBe(1)
    expect([...collectUiTreeNodeIds(withScheme)]).toEqual(['folder', 'scheme'])

    const renamed = renameUiTreeFolder(withScheme, 'folder', '新目录')
    expect(findUiTreeNode(renamed, 'folder')).toMatchObject({ name: '新目录' })
    const moved = moveUiTreeNode(renamed, 'scheme', null, 0)
    expect(findUiTreeParent(moved, 'scheme')).toBeUndefined()
    expect(moved.root[0]?.id).toBe('scheme')
    expect(removeUiTreeNode(moved, 'folder').root.map((node) => node.id)).toEqual(['scheme'])
  })

  it('rejects cycles, duplicates, and moves beyond MAX_DEPTH', () => {
    let tree: UiTree = { root: [] }
    for (let depth = 0; depth <= MAX_DEPTH; depth++) {
      tree = addUiTreeFolder(tree, depth === 0 ? null : `f${depth - 1}`, { id: `f${depth}`, name: `${depth}` })
    }
    const unchanged = addUiTreeFolder(tree, `f${MAX_DEPTH}`, { id: 'too-deep', name: '太深' })
    expect(unchanged).toBe(tree)
    expect(moveUiTreeNode(tree, 'f0', 'f1')).toBe(tree)
    expect(addUiTreeScheme(tree, null, { id: 'f0', overlayId: 'combat' })).toBe(tree)
  })
})

describe('uiTree migration and persistence', () => {
  it('creates default basic/custom folders when no tree exists', () => {
    const tree = ensureUiTree(undefined, overlays)
    expect((findUiTreeNode(tree, BASIC_UI_FOLDER_ID) as { children: unknown[] }).children).toHaveLength(1)
    expect((findUiTreeNode(tree, CUSTOM_UI_FOLDER_ID) as { children: unknown[] }).children).toHaveLength(2)
    expect(findUiTreeNode(tree, UNGROUPED_UI_FOLDER_ID)).toBeUndefined()
    expect(validateUiTree(tree).valid).toBe(true)
  })

  it('preserves valid order and nesting, prunes dangling schemes, and adds omissions conservatively', () => {
    const existing: UiTree = {
      root: [{
        kind: 'folder',
        id: 'mine',
        name: '我的顺序',
        children: [
          { kind: 'scheme', id: 'dialogue-node', overlayId: 'dialogue' },
          { kind: 'scheme', id: 'dangling-node', overlayId: 'deleted' },
        ],
      }],
    }
    const migrated = ensureUiTree(existing, overlays)
    expect(migrated.root[0]).toMatchObject({ id: 'mine', name: '我的顺序' })
    expect(findUiTreeNode(migrated, 'dialogue-node')).toEqual(existing.root[0] && (existing.root[0] as { children: unknown[] }).children[0])
    expect(findUiTreeNode(migrated, 'dangling-node')).toBeUndefined()
    expect((findUiTreeNode(migrated, BASIC_UI_FOLDER_ID) as { children: Array<{ overlayId: string }> }).children[0]?.overlayId).toBe('base:hp')
    expect((findUiTreeNode(migrated, CUSTOM_UI_FOLDER_ID) as { children: Array<{ overlayId: string }> }).children[0]?.overlayId).toBe('combat')
    expect(findUiTreeNode(migrated, UNGROUPED_UI_FOLDER_ID)).toBeUndefined()
    expect(ensureUiTree(migrated, overlays)).toBe(migrated)
  })

  it('round-trips as root authoring meta and is stripped before runtime', () => {
    const tree = ensureUiTree(undefined, overlays)
    const main = { id: MAIN_ID, title: '主蓝图', entry: 'entry', graph: { nodes: [], edges: [] } }
    const doc = documentFromBlueprints(
      { [MAIN_ID]: main },
      MAIN_ID,
      { ui: { overlays }, uiTree: tree },
    )
    expect(metaFromDocument(doc).uiTree).toEqual(tree)
    expect(doc.uiTree).toEqual(tree)
    const runtime = toRuntimeScenario(doc)
    expect('uiTree' in runtime).toBe(false)
    expect(runtime.ui?.overlays).toEqual(overlays)
  })

  it('retains uiTree while rebuilding a library document', () => {
    const tree = ensureUiTree(undefined, overlays)
    const doc = {
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
      ui: { overlays },
      uiTree: tree,
      manifest: {
        version: 'game-video.blueprint-manifest.v1',
        mainPackId: MAIN_ID,
        packs: { [MAIN_ID]: { id: MAIN_ID, title: '主蓝图', entry: 'entry', graph: { nodes: [], edges: [] } } },
      },
    } satisfies GraphLibraryDocument
    const rebuilt = documentFromBlueprints(doc.manifest.packs, MAIN_ID, metaFromDocument(doc))
    expect(rebuilt.uiTree).toEqual(tree)
  })

  it('defaults to 模板 before 控件', () => {
    const tree = ensureUiTree(undefined, overlays)
    expect(tree.root.map((n) => n.id)).toEqual([CUSTOM_UI_FOLDER_ID, BASIC_UI_FOLDER_ID])
  })

  it('pins 控件 to the root tail so new top-level folders land before it', () => {
    // 既有树把控件放在前面：规范化应把它挪到末尾，用户区都在它前面。
    const existing: UiTree = {
      root: [
        { kind: 'folder', id: BASIC_UI_FOLDER_ID, name: '控件', children: [{ kind: 'scheme', id: 's-base', overlayId: 'base:hp' }] },
        { kind: 'folder', id: CUSTOM_UI_FOLDER_ID, name: '模板', children: [
          { kind: 'scheme', id: 's-combat', overlayId: 'combat' },
          { kind: 'scheme', id: 's-dialogue', overlayId: 'dialogue' },
        ] },
      ],
    }
    const migrated = ensureUiTree(existing, overlays)
    // 基础界面被钉到末尾，自定义界面在前；无遗漏 overlay 故不补未分组。
    expect(migrated.root.map((n) => n.id)).toEqual([CUSTOM_UI_FOLDER_ID, BASIC_UI_FOLDER_ID])
    // 幂等：再规范一次不产生新引用。
    expect(ensureUiTree(migrated, overlays)).toBe(migrated)

    // 新建顶层文件夹插末尾（insertNode 默认），落在基础界面之前（基础界面已被钉末尾）。
    let withNew = addUiTreeFolder(migrated, null, { id: 'ui-folder:boss', name: '首领战' })
    withNew = ensureUiTree(withNew, overlays)
    const ids = withNew.root.map((n) => n.id)
    expect(ids[ids.length - 1]).toBe(BASIC_UI_FOLDER_ID)
    expect(ids).toContain('ui-folder:boss')
    expect(ids.indexOf('ui-folder:boss')).toBeLessThan(ids.indexOf(BASIC_UI_FOLDER_ID))
  })

  it('puts node-local overlays in 模板 and migrates them out of 未分组', () => {
    const existing: UiTree = {
      root: [
        {
          kind: 'folder',
          id: UNGROUPED_UI_FOLDER_ID,
          name: '未分组',
          children: [
            { kind: 'scheme', id: 's-node', overlayId: 'node:act1' },
            { kind: 'scheme', id: 's-combat', overlayId: 'combat' },
          ],
        },
        { kind: 'folder', id: CUSTOM_UI_FOLDER_ID, name: '模板', children: [] },
      ],
    }
    const tree = ensureUiTree(existing, {
      ...overlays,
      'node:act1': { id: 'node:act1', title: '废墟信号', children: [] },
      'node:act2': { id: 'node:act2', title: '瘸腿孙据点', children: [] },
    })

    expect(findUiTreeParent(tree, 's-node')?.id).toBe(CUSTOM_UI_FOLDER_ID)
    expect(findUiTreeParent(tree, 'ui-scheme:node:act2')?.id).toBe(CUSTOM_UI_FOLDER_ID)
    expect(findUiTreeParent(tree, 's-combat')?.id).toBe(CUSTOM_UI_FOLDER_ID)
  })
})
