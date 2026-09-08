import { describe, it, expect } from 'vitest'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'
import { MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import demoJson from '@/authoring/demo/blueprint.json'

describe('NODIA_DEMO_PROJECT (empty blueprint template)', () => {
  it('disk json is GraphLibraryDocument (manifest.packs + mainPackId, no legacy fields)', () => {
    const raw = demoJson as Record<string, unknown>
    expect(raw.version).toBe('game-video.graph.v1')
    expect(raw.rng).toBeUndefined()
    expect(raw.reactions).toBeUndefined()
    expect(raw.packs).toBeUndefined()
    expect(raw.schemaVersion).toBeUndefined()
    expect(raw.entities).toBeUndefined()
    expect(raw.variables).toBeUndefined()
    const manifest = raw.manifest as { mainPackId: string; packs: Record<string, unknown>; version: string }
    expect(manifest.version).toBe('game-video.blueprint-manifest.v1')
    expect(manifest.mainPackId).toBe(MAIN_ID)
    expect(manifest.packs[MAIN_ID]).toBeTruthy()
  })

  it('has a main blueprint with a single entry node', () => {
    expect(NODIA_DEMO_PROJECT.manifest.mainPackId).toBe(MAIN_ID)
    const main = NODIA_DEMO_PROJECT.manifest.packs[MAIN_ID]!
    expect(main.entry).toBe('entry')
    expect(main.graph.nodes).toHaveLength(1)
    expect(main.graph.nodes[0]?.id).toBe('entry')
    expect(main.graph.edges).toEqual([])
  })

  it('root graph mirrors main pack; no rules meta on the template', () => {
    expect(NODIA_DEMO_PROJECT.entities).toBeUndefined()
    expect(NODIA_DEMO_PROJECT.variables).toBeUndefined()
    expect(NODIA_DEMO_PROJECT.graph).toEqual(NODIA_DEMO_PROJECT.manifest.packs[MAIN_ID]!.graph)
  })

  it('starts with only builtin/base overlays from ensureBuiltinSchemes', () => {
    const overlays = NODIA_DEMO_PROJECT.ui?.overlays ?? {}
    expect(Object.keys(overlays).filter((id) => !id.startsWith('base:') && !id.startsWith('node:'))).toEqual([])
  })
})
