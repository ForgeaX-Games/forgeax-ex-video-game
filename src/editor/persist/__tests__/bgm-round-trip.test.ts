/**
 * 文档默认床轨（`GameScenario.bgm`）的持久化往返。
 *
 * 落盘文档由 `blueprints + meta` 拼出（`documentFromBlueprints`），载入时再由
 * `metaFromDocument` 收回 meta —— 只要这两处漏了 `bgm`，作者在场景面板配的床轨会在
 * 保存/重开后**静默消失**（无报错、runtime 只是不响）。这里把往返钉死。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { documentFromBlueprints, metaFromDocument, normalizeDocument, MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import { useGraphScenario } from '../graphScenarioStore'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'
import type { BlueprintDoc, DocumentBgm, GraphLibraryDocument } from '@/runtime/core/schema/graph-schema'

const BED: DocumentBgm = { ref: 'bgm-story', loop: true }

const mainDoc = (): BlueprintDoc => ({
  id: MAIN_ID,
  title: '主蓝图',
  entry: 'n1',
  graph: {
    nodes: [{ id: 'n1', type: 'perf', position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: 'A' } }],
    edges: [],
  },
})

describe('document bgm survives the persist round-trip', () => {
  it('metaFromDocument keeps scenario.bgm', () => {
    const doc = documentFromBlueprints({ [MAIN_ID]: mainDoc() }, MAIN_ID, { bgm: BED })
    expect(metaFromDocument(doc).bgm).toEqual(BED)
  })

  it('documentFromBlueprints puts meta.bgm on the document root', () => {
    const doc = documentFromBlueprints({ [MAIN_ID]: mainDoc() }, MAIN_ID, { bgm: BED })
    expect(doc.bgm).toEqual(BED)
  })

  it('save → load → save keeps the same bed (no silent drop)', () => {
    const saved = documentFromBlueprints({ [MAIN_ID]: mainDoc() }, MAIN_ID, { bgm: BED })
    const loaded = normalizeDocument(JSON.parse(JSON.stringify(saved)) as GraphLibraryDocument)
    expect(loaded.bgm).toEqual(BED)
    const resaved = documentFromBlueprints(loaded.manifest.packs, loaded.manifest.mainPackId, metaFromDocument(loaded))
    expect(resaved.bgm).toEqual(BED)
  })

  it('absent bgm stays absent (旧图零行为变化)', () => {
    const doc = documentFromBlueprints({ [MAIN_ID]: mainDoc() }, MAIN_ID, {})
    expect('bgm' in doc).toBe(false)
    expect('bgm' in metaFromDocument(doc)).toBe(false)
  })
})

describe('store meta.bgm reaches the persisted + runtime scenario', () => {
  beforeEach(() => {
    const p = structuredClone(NODIA_DEMO_PROJECT)
    const mainId = p.manifest.mainPackId
    useGraphScenario.setState({
      blueprints: p.manifest.packs,
      mainBlueprintId: mainId,
      activeBlueprintId: mainId,
      graph: p.manifest.packs[mainId]!.graph,
      meta: { variables: p.variables, entities: p.entities, ui: p.ui },
      booted: true,
    } as never)
  })

  it('setMeta({ bgm }) shows up in authoringProject() and scn()', () => {
    useGraphScenario.getState().setMeta((m) => ({ ...m, bgm: BED }))
    expect(useGraphScenario.getState().authoringProject().bgm).toEqual(BED)
    // runtime 场景（engine 读 `scenario.bgm` 压文档床）必须也带上它。
    expect(useGraphScenario.getState().scn().bgm).toEqual(BED)
  })

  it('clearing the bed drops the field instead of persisting an empty ref', () => {
    useGraphScenario.getState().setMeta((m) => ({ ...m, bgm: BED }))
    useGraphScenario.getState().setMeta((m) => ({ ...m, bgm: undefined }))
    expect(useGraphScenario.getState().authoringProject().bgm).toBeUndefined()
  })
})
