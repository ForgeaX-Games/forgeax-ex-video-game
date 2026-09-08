import type { Overlay, UiTree, UiTreeFolderNode, UiTreeNode, UiTreeSchemeNode } from '@/runtime/core/schema/graph-schema'

export const MAX_DEPTH = 12
export const BASIC_UI_FOLDER_ID = 'ui-folder:basic'
export const CUSTOM_UI_FOLDER_ID = 'ui-folder:custom'
export const UNGROUPED_UI_FOLDER_ID = 'ui-folder:ungrouped'

export interface UiTreeValidationResult {
  valid: boolean
  errors: string[]
}

function visit(nodes: readonly UiTreeNode[], fn: (node: UiTreeNode, parent: UiTreeFolderNode | undefined, depth: number) => void, parent?: UiTreeFolderNode, depth = 0): void {
  for (const node of nodes) {
    fn(node, parent, depth)
    if (node.kind === 'folder') visit(node.children, fn, node, depth + 1)
  }
}

export function validateUiTree(tree: unknown): UiTreeValidationResult {
  const errors: string[] = []
  if (!tree || typeof tree !== 'object' || !Array.isArray((tree as UiTree).root)) {
    return { valid: false, errors: ['uiTree.root 必须是数组'] }
  }
  const nodeIds = new Set<string>()
  const overlayIds = new Set<string>()
  const validateNodes = (nodes: unknown[], depth: number): void => {
    if (depth > MAX_DEPTH) errors.push(`uiTree 深度不能超过 ${MAX_DEPTH}`)
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') {
        errors.push('uiTree 节点必须是对象')
        continue
      }
      const node = raw as Record<string, unknown>
      if (typeof node.id !== 'string' || !node.id) {
        errors.push('uiTree 节点 id 必须是非空字符串')
      } else if (nodeIds.has(node.id)) {
        errors.push(`uiTree 节点 id 重复：${node.id}`)
      } else {
        nodeIds.add(node.id)
      }
      if (node.kind === 'folder') {
        if (typeof node.name !== 'string') errors.push(`uiTree 文件夹名称无效：${String(node.id)}`)
        if (!Array.isArray(node.children)) errors.push(`uiTree 文件夹 children 无效：${String(node.id)}`)
        else validateNodes(node.children, depth + 1)
      } else if (node.kind === 'scheme') {
        if (typeof node.overlayId !== 'string' || !node.overlayId) {
          errors.push(`uiTree scheme overlayId 无效：${String(node.id)}`)
        } else if (overlayIds.has(node.overlayId)) {
          errors.push(`uiTree scheme overlayId 重复：${node.overlayId}`)
        } else {
          overlayIds.add(node.overlayId)
        }
      } else {
        errors.push(`uiTree 节点 kind 无效：${String(node.id)}`)
      }
    }
  }
  validateNodes((tree as UiTree).root, 0)
  return { valid: errors.length === 0, errors }
}

export function findUiTreeNode(tree: UiTree, id: string): UiTreeNode | undefined {
  let found: UiTreeNode | undefined
  visit(tree.root, (node) => {
    if (!found && node.id === id) found = node
  })
  return found
}

export function findUiTreeParent(tree: UiTree, id: string): UiTreeFolderNode | undefined {
  let found: UiTreeFolderNode | undefined
  visit(tree.root, (node, parent) => {
    if (!found && node.id === id) found = parent
  })
  return found
}

export function collectUiTreeNodeIds(tree: UiTree): Set<string> {
  const ids = new Set<string>()
  visit(tree.root, (node) => ids.add(node.id))
  return ids
}

export function collectUiTreeOverlayIds(tree: UiTree): Set<string> {
  const ids = new Set<string>()
  visit(tree.root, (node) => {
    if (node.kind === 'scheme') ids.add(node.overlayId)
  })
  return ids
}

export function uiTreeDepth(tree: UiTree, id: string): number | undefined {
  let result: number | undefined
  visit(tree.root, (node, _parent, depth) => {
    if (result === undefined && node.id === id) result = depth
  })
  return result
}

export function isUiTreeAncestor(tree: UiTree, ancestorId: string, nodeId: string): boolean {
  let parent = findUiTreeParent(tree, nodeId)
  while (parent) {
    if (parent.id === ancestorId) return true
    parent = findUiTreeParent(tree, parent.id)
  }
  return false
}

function insertNode(tree: UiTree, parentId: string | null, node: UiTreeNode, index?: number): UiTree {
  if (findUiTreeNode(tree, node.id)) return tree
  if (node.kind === 'scheme' && collectUiTreeOverlayIds(tree).has(node.overlayId)) return tree
  const insert = (nodes: readonly UiTreeNode[], depth: number): readonly UiTreeNode[] | undefined => {
    if (parentId === null) {
      if (depth !== 0) return undefined
      const at = index == null ? nodes.length : Math.max(0, Math.min(index, nodes.length))
      return [...nodes.slice(0, at), node, ...nodes.slice(at)]
    }
    for (let i = 0; i < nodes.length; i++) {
      const current = nodes[i]!
      if (current.kind !== 'folder') continue
      if (current.id === parentId) {
        if (depth + 1 > MAX_DEPTH) return undefined
        const at = index == null ? current.children.length : Math.max(0, Math.min(index, current.children.length))
        const next = { ...current, children: [...current.children.slice(0, at), node, ...current.children.slice(at)] }
        return [...nodes.slice(0, i), next, ...nodes.slice(i + 1)]
      }
      const children = insert(current.children, depth + 1)
      if (children) {
        const next = { ...current, children: children as UiTreeNode[] }
        return [...nodes.slice(0, i), next, ...nodes.slice(i + 1)]
      }
    }
    return undefined
  }
  const root = insert(tree.root, 0)
  return root ? { root: root as UiTreeNode[] } : tree
}

export function addUiTreeFolder(tree: UiTree, parentId: string | null, folder: { id: string; name: string }, index?: number): UiTree {
  return insertNode(tree, parentId, { kind: 'folder', id: folder.id, name: folder.name, children: [] }, index)
}

export function addUiTreeScheme(tree: UiTree, parentId: string | null, scheme: { id: string; overlayId: string }, index?: number): UiTree {
  return insertNode(tree, parentId, { kind: 'scheme', id: scheme.id, overlayId: scheme.overlayId }, index)
}

function removeNode(nodes: readonly UiTreeNode[], id: string): { nodes: UiTreeNode[]; removed?: UiTreeNode } {
  const direct = nodes.findIndex((node) => node.id === id)
  if (direct >= 0) {
    return { nodes: [...nodes.slice(0, direct), ...nodes.slice(direct + 1)], removed: nodes[direct] }
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.kind !== 'folder') continue
    const result = removeNode(node.children, id)
    if (result.removed) {
      return {
        nodes: [...nodes.slice(0, i), { ...node, children: result.nodes }, ...nodes.slice(i + 1)],
        removed: result.removed,
      }
    }
  }
  return { nodes: [...nodes] }
}

export function removeUiTreeNode(tree: UiTree, id: string): UiTree {
  const result = removeNode(tree.root, id)
  return result.removed ? { root: result.nodes } : tree
}

function subtreeHeight(node: UiTreeNode): number {
  if (node.kind === 'scheme' || node.children.length === 0) return 0
  return 1 + Math.max(...node.children.map(subtreeHeight))
}

export function moveUiTreeNode(tree: UiTree, id: string, parentId: string | null, index?: number): UiTree {
  const node = findUiTreeNode(tree, id)
  if (!node || id === parentId || (parentId !== null && isUiTreeAncestor(tree, id, parentId))) return tree
  const parentDepth = parentId === null ? -1 : uiTreeDepth(tree, parentId)
  const parent = parentId === null ? undefined : findUiTreeNode(tree, parentId)
  if (parentId !== null && (!parent || parent.kind !== 'folder' || parentDepth === undefined)) return tree
  if ((parentDepth ?? -1) + 1 + subtreeHeight(node) > MAX_DEPTH) return tree
  const removed = removeNode(tree.root, id)
  if (!removed.removed) return tree
  return insertNode({ root: removed.nodes }, parentId, removed.removed, index)
}

export function renameUiTreeFolder(tree: UiTree, id: string, name: string): UiTree {
  const rename = (nodes: readonly UiTreeNode[]): UiTreeNode[] | undefined => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      if (node.kind !== 'folder') continue
      if (node.id === id) return [...nodes.slice(0, i), { ...node, name }, ...nodes.slice(i + 1)]
      const children = rename(node.children)
      if (children) return [...nodes.slice(0, i), { ...node, children }, ...nodes.slice(i + 1)]
    }
    return undefined
  }
  const root = rename(tree.root)
  return root ? { root } : tree
}

function uniqueSchemeId(overlayId: string, used: Set<string>): string {
  const base = `ui-scheme:${overlayId}`
  let id = base
  let suffix = 2
  while (used.has(id)) id = `${base}:${suffix++}`
  used.add(id)
  return id
}

function makeDefaultTree(overlays: Record<string, Overlay>): UiTree {
  const used = new Set<string>([BASIC_UI_FOLDER_ID, CUSTOM_UI_FOLDER_ID])
  const basic: UiTreeSchemeNode[] = []
  const custom: UiTreeSchemeNode[] = []
  for (const overlayId of Object.keys(overlays)) {
    const scheme = { kind: 'scheme' as const, id: uniqueSchemeId(overlayId, used), overlayId }
    if (overlayId.startsWith('base:')) basic.push(scheme)
    else custom.push(scheme)
  }
  return {
    root: [
      { kind: 'folder', id: CUSTOM_UI_FOLDER_ID, name: '模板', children: custom },
      { kind: 'folder', id: BASIC_UI_FOLDER_ID, name: '控件', children: basic },
    ],
  }
}

/**
 * 读时规范化。合法既有树保持顺序与嵌套；悬空 scheme 会删除，遗漏 base 归控件，
 * 遗漏普通 overlay 归未分组。无可用树时按基础/自定义生成默认目录。
 */
export function ensureUiTree(raw: unknown, overlays: Record<string, Overlay> | undefined): UiTree {
  const catalog = overlays ?? {}
  if (!validateUiTree(raw).valid) return makeDefaultTree(catalog)
  const tree = raw as UiTree
  const available = new Set(Object.keys(catalog))
  const prune = (nodes: readonly UiTreeNode[]): { nodes: UiTreeNode[]; changed: boolean } => {
    const kept: UiTreeNode[] = []
    let changed = false
    for (const node of nodes) {
      if (node.kind === 'scheme') {
        if (available.has(node.overlayId)) kept.push(node)
        else changed = true
      } else {
        const children = prune(node.children)
        kept.push(children.changed ? { ...node, children: children.nodes } : node)
        changed ||= children.changed
      }
    }
    return { nodes: changed ? kept : nodes as UiTreeNode[], changed }
  }
  const pruned = prune(tree.root)
  let next: UiTree = pruned.changed ? { root: pruned.nodes } : tree
  const present = collectUiTreeOverlayIds(next)
  const missingBase = Object.keys(catalog).filter((id) => id.startsWith('base:') && !present.has(id))
  // 模板：node:*（节点内容容器）+ 所有非 base: 的自定义 overlay（scheme-* 等）。
  // 两者都属于可复用/作者态的「模板」概念，不再走独立的「未分组」文件夹。
  const missingTemplates = Object.keys(catalog).filter((id) => !id.startsWith('base:') && !present.has(id))
  const used = collectUiTreeNodeIds(next)

  const ungrouped = findUiTreeNode(next, UNGROUPED_UI_FOLDER_ID)
  const templateSchemesInUngrouped = ungrouped?.kind === 'folder'
    ? ungrouped.children.filter((node): node is UiTreeSchemeNode => node.kind === 'scheme' && !node.overlayId.startsWith('base:')).map((node) => node.id)
    : []
  if (missingTemplates.length > 0 || templateSchemesInUngrouped.length > 0) {
    if (!findUiTreeNode(next, CUSTOM_UI_FOLDER_ID)) {
      next = addUiTreeFolder(next, null, { id: CUSTOM_UI_FOLDER_ID, name: '模板' })
      used.add(CUSTOM_UI_FOLDER_ID)
    }
    for (const nodeId of templateSchemesInUngrouped) next = moveUiTreeNode(next, nodeId, CUSTOM_UI_FOLDER_ID)
    for (const overlayId of missingTemplates) {
      next = addUiTreeScheme(next, CUSTOM_UI_FOLDER_ID, { id: uniqueSchemeId(overlayId, used), overlayId })
    }
  }

  if (missingBase.length > 0) {
    if (!findUiTreeNode(next, BASIC_UI_FOLDER_ID)) {
      next = addUiTreeFolder(next, null, { id: BASIC_UI_FOLDER_ID, name: '控件' })
      used.add(BASIC_UI_FOLDER_ID)
    }
    for (const overlayId of missingBase) {
      next = addUiTreeScheme(next, BASIC_UI_FOLDER_ID, { id: uniqueSchemeId(overlayId, used), overlayId })
    }
  }
  // 「控件」是内置参考分组，钉到 root 末尾：用户区（模板 + 新建顶层组）都在它前面，
  // 新建顶层文件夹插末尾时自然落在基础界面前。仅在它不在末尾时才重排，避免无谓新引用。
  const basicIndex = next.root.findIndex((n) => n.id === BASIC_UI_FOLDER_ID)
  if (basicIndex !== -1 && basicIndex !== next.root.length - 1) {
    const basic = next.root[basicIndex]!
    next = { root: [...next.root.slice(0, basicIndex), ...next.root.slice(basicIndex + 1), basic] }
  }
  return next
}
