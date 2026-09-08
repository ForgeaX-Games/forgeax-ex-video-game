/**
 * 蓝图库 node 侧序列化（AI tool-handlers 用）。
 *
 * 新布局（对齐 game-host / game-package SPEC，2026-07-22）：
 *   游戏仓根 `.forgeax/games/<slug>/`
 *     ├── blueprint.json   —— 玩法 SSOT（裸 GraphLibraryDocument）
 *     └── project.json     —— 项目元信息
 *
 * 与 ForgeaX 宿主游戏包写盘**同格式**（AI 与 UI 单写者不分叉）：
 *   UI 走 HTTP PUT package；AI（game-video:*）经本模块直写同样的 blueprint.json / project.json。
 * 版本 = 游戏仓 git annotated tag（由 game-host 打）；本模块只保存当前文档。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import { t as translateUi } from '../../i18n'

/** 保留类型以兼容既有 import；版本走 git tag，本模块返回空列表。 */
export interface VersionEntry { id: string; savedAt: number }

const BLUEPRINT_FILE = 'blueprint.json'
const PROJECT_FILE = 'project.json'

function normalizeEditorDocument(document: GraphLibraryDocument): GraphLibraryDocument {
  return normalizeDocument(document, {
    legacyMainTitle: translateUi('ui.object.ecd1fd7c870b'),
  })
}

function readJson<T>(p: string): T | null {
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}

/** 最小 project.json（首次写入且盘上无时补齐）。 */
function defaultProject(dir: string): Record<string, unknown> {
  const id = dir.split(/[/\\]/).filter(Boolean).pop() ?? 'game'
  return {
    id,
    title: id,
    platform: 'game-video',
    platformVersion: '1',
    entry: { blueprint: 'blueprint.json', components: 'dist/components' },
  }
}

/** 读权威文档：游戏仓根 `blueprint.json`（裸 GraphLibraryDocument）。 */
export function readDocument(dir: string): { document: GraphLibraryDocument | null; versions: VersionEntry[] } {
  const raw = readJson<GraphLibraryDocument>(resolve(dir, BLUEPRINT_FILE))
  if (!raw) return { document: null, versions: [] }
  try {
    return { document: normalizeEditorDocument(raw), versions: [] }
  } catch (e) {
    console.warn(`[blueprint-store-fs] blueprint.json 规范化失败：`, e)
    return { document: null, versions: [] }
  }
}

/** @deprecated 用 readDocument */
export function readProject(dir: string): { project: GraphLibraryDocument | null; versions: VersionEntry[] } {
  const { document, versions } = readDocument(dir)
  return { project: document, versions }
}

/** 覆盖写游戏仓根 `blueprint.json`（+ 首次补 `project.json`）。 */
export function writeDocument(dir: string, document: GraphLibraryDocument, _title = 'graph'): VersionEntry[] {
  const normalized = normalizeEditorDocument(document)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, BLUEPRINT_FILE), JSON.stringify(normalized, null, 2))
  const projectPath = resolve(dir, PROJECT_FILE)
  if (!existsSync(projectPath)) {
    writeFileSync(projectPath, JSON.stringify(defaultProject(dir), null, 2))
  }
  return []
}

/** @deprecated 用 writeDocument */
export function writeProject(dir: string, project: GraphLibraryDocument, title = 'graph'): VersionEntry[] {
  return writeDocument(dir, project, title)
}
