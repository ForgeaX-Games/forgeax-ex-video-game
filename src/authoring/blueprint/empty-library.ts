/**
 * 出厂空库：主蓝图一张、单 `entry` 演出节点、补齐基础覆盖物。
 *
 * 与 `emptyLibraryDocument()`（零节点、给未落盘草稿用）不同。新游戏 host seed 和编辑器
 * 缺省回填共用这里，避免再维护一份 JSON 模板。
 */
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { ensureBuiltinSchemes } from '@/authoring/overlays/builtin-schemes'
import {
  MAIN_ID,
  documentFromBlueprints,
  emptyBlueprintDoc,
  normalizeDocument,
} from '@/authoring/blueprint/blueprint-project'

// The pure authoring seed cannot import the UI locale catalog; keep the
// Chinese default as data without introducing a user-facing literal here.
const MAIN_BLUEPRINT_TITLE = String.fromCodePoint(0x4e3b, 0x84dd, 0x56fe)

/** 构造出厂空库文档（每次调用按当前组件目录补 `base:*`）。 */
export function createEmptyLibraryDocument(
  options: { mainTitle?: string } = {},
): GraphLibraryDocument {
  const main = emptyBlueprintDoc({
    id: MAIN_ID,
    title: options.mainTitle ?? MAIN_BLUEPRINT_TITLE,
  })
  const entry = main.graph.nodes.find((node) => node.id === main.entry)
  if (entry) entry.data = { ...entry.data, name: '起点' }
  const raw = normalizeDocument(
    documentFromBlueprints({ [MAIN_ID]: main }, MAIN_ID, {
      entities: {},
      variables: {},
    }),
  )
  return normalizeDocument({
    ...raw,
    ui: { ...raw.ui, overlays: ensureBuiltinSchemes(raw.ui?.overlays) },
  })
}

/** 模块加载时的出厂只读快照（勿直接改动；需要副本用 `structuredClone`）。 */
export const EMPTY_LIBRARY_DOCUMENT: GraphLibraryDocument = createEmptyLibraryDocument()
