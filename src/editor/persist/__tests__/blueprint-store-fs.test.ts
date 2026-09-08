import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { writeProject, readProject } from '../blueprint-store-fs'
import { NODIA_DEMO_PROJECT } from '@/authoring/demo/demo'
import { MAIN_ID } from '@/authoring/blueprint/blueprint-project'
import { setLocale } from '@/i18n'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
  setLocale('en')
})

describe('blueprint-store-fs (game-host layout: blueprint.json + project.json)', () => {
  it('writeProject writes blueprint.json (bare doc) + project.json, no scenarios/versions dir', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    writeProject(dir, NODIA_DEMO_PROJECT, 'demo')
    expect(existsSync(resolve(dir, 'blueprint.json'))).toBe(true)
    expect(existsSync(resolve(dir, 'project.json'))).toBe(true)
    expect(existsSync(resolve(dir, 'scenarios.graph.json'))).toBe(false)
    expect(existsSync(resolve(dir, 'scenarios.graph.versions'))).toBe(false)
    // blueprint.json is a BARE GraphLibraryDocument (not a CanonFile wrapper).
    const doc = JSON.parse(readFileSync(resolve(dir, 'blueprint.json'), 'utf-8'))
    expect(doc.manifest.mainPackId).toBe(MAIN_ID)
    expect(doc.manifest.packs[MAIN_ID]).toBeTruthy()
    expect(doc.graph).toBeTruthy()
    // project.json points entry.blueprint at blueprint.json.
    const project = JSON.parse(readFileSync(resolve(dir, 'project.json'), 'utf-8'))
    expect(project.entry.blueprint).toBe('blueprint.json')
  })

  it('readProject round-trips', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    writeProject(dir, NODIA_DEMO_PROJECT, 'demo')
    const { project } = readProject(dir)
    expect(project?.manifest.mainPackId).toBe(MAIN_ID)
    expect(Object.keys(project!.manifest.packs)).toContain(MAIN_ID)
    expect(project?.entities).toEqual(NODIA_DEMO_PROJECT.entities)
    expect(project?.variables).toEqual(NODIA_DEMO_PROJECT.variables)
  })

  it('readProject returns null when empty', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    expect(readProject(dir).project).toBeNull()
  })

  it('localizes the generated main title when reading a legacy document', () => {
    setLocale('zh')
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    writeFileSync(resolve(dir, 'blueprint.json'), JSON.stringify({
      version: 'game-video.graph.v1',
      graph: { nodes: [], edges: [] },
    }))

    const { project } = readProject(dir)

    expect(project?.manifest.packs[MAIN_ID]?.title).toBe('主蓝图')
  })

  it('does not clobber an existing project.json on re-save', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    writeProject(dir, NODIA_DEMO_PROJECT, 'demo')
    const before = readFileSync(resolve(dir, 'project.json'), 'utf-8')
    writeProject(dir, NODIA_DEMO_PROJECT, 'demo2')
    const after = readFileSync(resolve(dir, 'project.json'), 'utf-8')
    expect(after).toBe(before)
  })
})
