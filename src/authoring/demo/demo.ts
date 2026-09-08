/**
 * 出厂默认蓝图 —— 数据在 `demo/blueprint.json`（空主蓝图 + 单入口节点）。
 *
 * 运行时/编辑进入优先级：localStorage 草稿 > 磁盘最新 > 空库。本文件仅供「重置 / 缺省」。
 * 游戏仓根 `blueprint.json` 是保存后的权威文档；本 demo 不自动落盘。
 */
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import demoJson from './blueprint.json'
import { ensureBuiltinSchemes } from '@/authoring/demo/builtin-schemes'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'

const raw = demoJson as unknown as GraphLibraryDocument

/** 出厂只读库文档（勿直接改动；需要副本用 `structuredClone`）。含基础覆盖物。 */
export const NODIA_DEMO_PROJECT: GraphLibraryDocument = normalizeDocument({
  ...raw,
  ui: { ...raw.ui, overlays: ensureBuiltinSchemes(raw.ui?.overlays) },
})
