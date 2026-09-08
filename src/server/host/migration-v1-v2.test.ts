import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { readWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * v1（单游标）→ v2（活动组）迁移（设计 §12）。
 *
 * 迁移只重定位生产平面的游标与组归属，内容平面一律不动。三件事必须成立：
 * 停在退役活动的项目不能卡死、已完成的进度不能被判成未做、重复读取结果一致。
 */

interface V1State {
  schemaVersion: 1
  gameId: string
  revision: number
  productPhase: string
  activity: string
  activityRevision: number
  activityStatus: string
  phaseRevision: number
  phaseStatus: string
  noticeRevision: number
  phases: Record<string, { revision: number, status: string }>
  activities: Record<string, { revision: number, status: string, artifactRefs: unknown[], evidence: unknown[] }>
  artifactRefs: unknown[]
  validationEvidence: unknown[]
  blockers: unknown[]
  gates: Record<string, unknown>
}

function v1(overrides: Partial<V1State> = {}): V1State {
  return {
    schemaVersion: 1,
    gameId: 'legacy',
    revision: 7,
    productPhase: 'requirements-collection',
    activity: 'document.intake',
    activityRevision: 2,
    activityStatus: 'working',
    phaseRevision: 1,
    phaseStatus: 'working',
    noticeRevision: 3,
    phases: {
      'requirements-collection': { revision: 1, status: 'working' },
      'planning-design': { revision: 0, status: 'not-started' },
      'feature-development': { revision: 0, status: 'not-started' },
      'asset-generation': { revision: 0, status: 'not-started' },
    },
    activities: {
      'brief.collecting': { revision: 1, status: 'complete', artifactRefs: [], evidence: [] },
      'document.intake': { revision: 2, status: 'working', artifactRefs: [], evidence: [] },
    },
    artifactRefs: [],
    validationEvidence: [],
    blockers: [],
    gates: {},
    ...overrides,
  }
}

function createContext(
  state: V1State,
  documents: Array<{ documentType: string, content: string }> = [],
): { context: ExtensionContext, files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>([
    [VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(state))],
  ])
  const assets = documents.map((document, index) => {
    const ref = `docs/legacy_${document.documentType}.md`
    files.set(ref, encoder.encode(document.content))
    return {
      id: `doc-${document.documentType}`,
      kind: 'document',
      name: document.documentType,
      status: 'ready',
      mimeType: 'text/markdown',
      provider: { kind: 'local', ref },
      createdAt: index + 1,
      updatedAt: index + 1,
      meta: { documentType: document.documentType },
    }
  })
  files.set('assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets })))
  const context = {
    gameId: 'legacy',
    files: {
      async read(path: string) {
        const bytes = files.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path: string, contents: Uint8Array) { files.set(path, new Uint8Array(contents)) },
      async list() { return [...files.keys()] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
    media: { async list() { return [] }, async read() { return null } },
  } as unknown as ExtensionContext
  return { context, files }
}

function stored(files: Map<string, Uint8Array>): Record<string, unknown> {
  return JSON.parse(decoder.decode(files.get(VIDEO_GAME_WORKFLOW_FILE)!))
}

describe('v1 → v2 迁移', () => {
  it('停在退役 document.intake 的项目前移到 document.core', async () => {
    const { context } = createContext(v1())

    const state = (await readWorkflowState(context))!

    expect(state.schemaVersion).toBe(2)
    expect(state.activity).toBe('document.core')
    expect(state.activeGroup.id).toBe('design')
    expect(state.activeGroup.activities).toContain('document.core')
  })

  it('已完成的进度不丢：brief 仍是完成态', async () => {
    const { context } = createContext(v1())

    const state = (await readWorkflowState(context))!

    expect(state.activities['brief.collecting']?.status).toBe('complete')
  })

  it('退役的 blueprint.graph 映射到 blueprint.outline，回去补声明清单', async () => {
    const { context } = createContext(v1({
      productPhase: 'feature-development',
      activity: 'blueprint.graph',
      activities: {
        'brief.collecting': { revision: 1, status: 'complete', artifactRefs: [], evidence: [] },
        'document.pillar': { revision: 2, status: 'complete', artifactRefs: [], evidence: [] },
        'blueprint.graph': { revision: 3, status: 'working', artifactRefs: [], evidence: [] },
      },
    }))

    const state = (await readWorkflowState(context))!

    expect(state.activity).toBe('blueprint.outline')
    expect(state.activeGroup.id).toBe('outline')
    expect(state.activities['blueprint.outline']?.revision).toBe(3)
  })

  it('不兼容已经停在退役用户视频活动的旧游标', async () => {
    const { context } = createContext(v1({
      productPhase: 'asset-generation',
      activity: 'video.awaiting-user',
      activities: {
        'video.awaiting-user': { revision: 5, status: 'working', artifactRefs: [], evidence: [] },
      },
    }))

    expect(await readWorkflowState(context)).toBeNull()
  })

  it('从旧 intake 文档回填需求契约，来源标记为推断', async () => {
    const { context } = createContext(v1(), [
      { documentType: 'intake', content: '# 需求\n做一个武松打虎的互动短片，偏战斗操作。' },
    ])

    const state = (await readWorkflowState(context))!

    expect(state.requirementContract?.rawIntent).toBe('做一个武松打虎的互动短片，偏战斗操作。')
    expect(state.requirementContract?.dimensions.legacy_intake?.source).toBe('inferred')
  })

  it('没有 intake 文档时不编造契约', async () => {
    const { context } = createContext(v1())

    expect((await readWorkflowState(context))!.requirementContract).toBeUndefined()
  })

  it('迁移幂等：重复读取不改变结果，也不重复推进修订号', async () => {
    const { context, files } = createContext(v1(), [
      { documentType: 'intake', content: '# 需求\n做一个武松打虎的互动短片。' },
    ])

    const first = (await readWorkflowState(context))!
    const afterFirstWrite = stored(files)
    const second = (await readWorkflowState(context))!

    expect(second).toEqual(first)
    expect(stored(files)).toEqual(afterFirstWrite)
  })

  it('旧 intake 文档保留可读，不再作为任何门的依据', async () => {
    const { context, files } = createContext(v1(), [
      { documentType: 'intake', content: '# 需求\n做一个武松打虎的互动短片。' },
    ])

    await readWorkflowState(context)

    // 用户数据不删：文件仍在原处。
    expect(files.has('docs/legacy_intake.md')).toBe(true)
  })
})
