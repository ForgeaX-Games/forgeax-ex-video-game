import { describe, it, expect, beforeEach } from 'vitest'
import { useGraphScenario } from '../graphScenarioStore'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'

beforeEach(() => {
  const p = structuredClone(NODIA_DEMO_PROJECT)
  const mainId = p.manifest.mainPackId
  useGraphScenario.setState({
    blueprints: p.manifest.packs,
    mainBlueprintId: mainId,
    activeBlueprintId: mainId,
    graph: p.manifest.packs[mainId]!.graph,
    meta: {
      variables: p.variables,
      entities: p.entities,
      ui: p.ui,
    },
    booted: true,
  } as any)
})

describe('store blueprint actions', () => {
  it('createBlueprint adds + selects', () => {
    const r = useGraphScenario.getState().createBlueprint('T')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const id = r.id!
    const st = useGraphScenario.getState()
    expect(st.blueprints[id]).toBeTruthy()
    expect(st.activeBlueprintId).toBe(id)
  })
  it('createBlueprint rejects duplicate titles (trim + case-insensitive)', () => {
    const first = useGraphScenario.getState().createBlueprint('新蓝图')
    expect(first.ok).toBe(true)
    const before = Object.keys(useGraphScenario.getState().blueprints).length
    const second = useGraphScenario.getState().createBlueprint(' 新蓝图 ')
    expect(second).toEqual({ ok: false, reason: 'duplicate_title' })
    expect(Object.keys(useGraphScenario.getState().blueprints)).toHaveLength(before)
    const third = useGraphScenario.getState().createBlueprint('Other')
    expect(third.ok).toBe(true)
    const fourth = useGraphScenario.getState().createBlueprint('other')
    expect(fourth).toEqual({ ok: false, reason: 'duplicate_title' })
  })
  it('renameBlueprint rejects colliding titles and allows self', () => {
    const a = useGraphScenario.getState().createBlueprint('Alpha')
    const b = useGraphScenario.getState().createBlueprint('Beta')
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(useGraphScenario.getState().renameBlueprint(b.id!, 'alpha')).toEqual({
      ok: false,
      reason: 'duplicate_title',
    })
    expect(useGraphScenario.getState().blueprints[b.id!]!.title).toBe('Beta')
    expect(useGraphScenario.getState().renameBlueprint(a.id!, '  Alpha  ')).toEqual({ ok: true })
    expect(useGraphScenario.getState().blueprints[a.id!]!.title).toBe('Alpha')
  })
  it('deleteBlueprint blocks main', () => {
    const st = useGraphScenario.getState()
    expect(st.deleteBlueprint(st.mainBlueprintId).ok).toBe(false)
  })
  it('deleteBlueprint removes unreferenced sub-blueprint', () => {
    const r = useGraphScenario.getState().createBlueprint('Sub')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(useGraphScenario.getState().deleteBlueprint(r.id!).ok).toBe(true)
    expect(useGraphScenario.getState().blueprints[r.id!]).toBeUndefined()
  })
  it('authoringScenario puts new blueprint in manifest.packs', () => {
    const r = useGraphScenario.getState().createBlueprint('Sub')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const scn = useGraphScenario.getState().authoringScenario()
    expect(scn.manifest.packs[r.id!]).toBeTruthy()
  })
})

describe('derived graph / blueprints invariant', () => {
  it('setGraph keeps graph === blueprints[activeBlueprintId].graph', () => {
    // 传更新器产生新图引用，确认写回活跃蓝图后缓存字段与真相同引用。
    useGraphScenario.getState().setGraph((g) => ({ ...g, nodes: [...g.nodes] }))
    const st = useGraphScenario.getState()
    expect(st.graph).toBe(st.blueprints[st.activeBlueprintId]!.graph)
  })

  it('createBlueprint + selectBlueprint points graph at the new blueprint', () => {
    const r = useGraphScenario.getState().createBlueprint('New')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const id = r.id!
    useGraphScenario.getState().selectBlueprint(id)
    const st = useGraphScenario.getState()
    expect(st.activeBlueprintId).toBe(id)
    expect(st.graph).toBe(st.blueprints[id]!.graph)
  })

  it('applyLayout with a missing active blueprint does not fabricate a desynced graph', () => {
    const before = useGraphScenario.getState().graph
    // 制造过期/无效的活跃 id（Task 8 删蓝图/撤销时可能瞬时出现）。
    useGraphScenario.setState({ activeBlueprintId: 'does-not-exist' } as any)
    useGraphScenario.getState().applyLayout()
    const st = useGraphScenario.getState()
    expect(st.blueprints['does-not-exist']).toBeUndefined()
    // no-op：graph 缓存原样保留（不被凭空排版成一份与 blueprints 脱钩的新图）。
    expect(st.graph).toBe(before)
  })
})
