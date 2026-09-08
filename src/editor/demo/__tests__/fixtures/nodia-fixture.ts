/**
 * 历史 nodia 富内容样例 —— 仅供契约/公式/画布回归测试。
 * 出厂默认数据已切到 `demo/blueprint.json`，勿再当作产品 seed。
 */
import type { GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'
import { normalizeDocument } from '@/authoring/blueprint/blueprint-project'
import { ensureBuiltinSchemes } from '@/authoring/demo/builtin-schemes'
import raw from './nodia.graph.json'

const doc = raw as unknown as GraphLibraryDocument

export const NODIA_FIXTURE: GraphLibraryDocument = normalizeDocument({
  ...doc,
  ui: { ...doc.ui, overlays: ensureBuiltinSchemes(doc.ui?.overlays) },
})

export function makeNodiaFixture(over: { bossHp?: number; playerHp?: number } = {}): GraphLibraryDocument {
  const s = structuredClone(NODIA_FIXTURE)
  const player = s.entities?.['ent-player']
  const boss = s.entities?.['ent-boss']
  if (over.playerHp != null && player?.attrs) player.attrs.hp = over.playerHp
  if (over.bossHp != null && boss?.attrs) boss.attrs.hp = over.bossHp
  return s
}
