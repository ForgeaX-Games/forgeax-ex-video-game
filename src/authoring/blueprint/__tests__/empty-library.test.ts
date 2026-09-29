import { describe, expect, it } from 'vitest'
import { EMPTY_LIBRARY_DOCUMENT, createEmptyLibraryDocument } from '@/authoring/blueprint/empty-library'
import { MAIN_ID } from '@/authoring/blueprint/blueprint-project'

describe('EMPTY_LIBRARY_DOCUMENT', () => {
  it('has a main blueprint with a single entry node named 起点', () => {
    expect(EMPTY_LIBRARY_DOCUMENT.manifest.mainPackId).toBe(MAIN_ID)
    const main = EMPTY_LIBRARY_DOCUMENT.manifest.packs[MAIN_ID]!
    expect(main.entry).toBe('entry')
    expect(main.graph.nodes).toHaveLength(1)
    expect(main.graph.nodes[0]).toMatchObject({ id: 'entry', type: 'perf' })
    expect(main.graph.nodes[0]?.data.name).toBe('起点')
    expect(main.graph.edges).toEqual([])
  })

  it('root graph mirrors main pack; rules catalogs are explicit empty objects', () => {
    expect(EMPTY_LIBRARY_DOCUMENT.entities).toEqual({})
    expect(EMPTY_LIBRARY_DOCUMENT.variables).toEqual({})
    expect(EMPTY_LIBRARY_DOCUMENT.graph).toEqual(EMPTY_LIBRARY_DOCUMENT.manifest.packs[MAIN_ID]!.graph)
  })

  it('starts with only builtin/base overlays from ensureBuiltinSchemes', () => {
    const overlays = EMPTY_LIBRARY_DOCUMENT.ui?.overlays ?? {}
    expect(Object.keys(overlays).length).toBeGreaterThan(0)
    expect(Object.keys(overlays).filter((id) => !id.startsWith('base:') && !id.startsWith('node:'))).toEqual([])
  })

  it('createEmptyLibraryDocument matches the factory seed used by host', () => {
    const created = createEmptyLibraryDocument()
    expect(created.manifest.mainPackId).toBe(MAIN_ID)
    expect(created.graph.nodes[0]?.data.name).toBe('起点')
  })

  it('accepts a locale-owned main title without coupling authoring to i18n', () => {
    const created = createEmptyLibraryDocument({ mainTitle: 'Localized main' })
    expect(created.manifest.packs[MAIN_ID]!.title).toBe('Localized main')
  })
})
