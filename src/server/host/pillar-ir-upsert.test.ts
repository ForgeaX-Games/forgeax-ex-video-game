import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { createGameVideoService } from './extension-service'
import { createInitialWorkflowState, VIDEO_GAME_WORKFLOW_FILE } from './workflow-state'
import { extractAuthorVisible } from '../../editor/documents/extractAuthorVisible'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * IR 是创作面：peer 分批交 contract，Host 按 beat.id 合并并渲染作者文档。
 * 骨架没写齐时落盘但标 incomplete，写齐才编译。
 */

function passBeat(id: string) {
  return {
    id,
    narrativeIntent: `${id} 过场推进`,
    staging: `${id} 江面夜雾里船队缓行，火把映在水上，主角在船头抬手示意继续。`,
    actions: [{
      id: `${id}-act`,
      intent: '继续推进剧情',
      stateMutationOwner: 'none',
      requiredRole: 'player-choice',
    }],
  }
}

function branchBeat(id: string, toA: string, toB: string) {
  return {
    id,
    narrativeIntent: `${id} 分叉`,
    staging: `${id} 舱内灯火摇曳，两人相对而坐，玩家必须在应承与沉默之间作选择。`,
    actions: [
      {
        id: `${id}-a`,
        intent: '应承',
        stateMutationOwner: 'none',
        requiredRole: 'player-choice',
        exit: { kind: 'beat', toBeatId: toA },
      },
      {
        id: `${id}-b`,
        intent: '沉默',
        stateMutationOwner: 'none',
        requiredRole: 'player-choice',
        exit: { kind: 'beat', toBeatId: toB },
      },
    ],
  }
}

function combatBeat(id: string) {
  return {
    id,
    narrativeIntent: `${id} 战斗`,
    staging: `${id} 甲板上箭雨斜飞，敌船火把压近，玩家在船舷发出战斗指令。`,
    actions: [{
      id: `${id}-strike`,
      intent: '挥剑',
      stateMutationOwner: 'none',
      requiredRole: 'combat-command',
    }],
  }
}

function endingBeat(id: string) {
  return {
    id,
    narrativeIntent: `${id} 终局`,
    staging: `${id} 雾散天明，草船靠岸，满舱箭矢在晨光里堆到镜头前。`,
    actions: [{
      id: `${id}-end`,
      intent: '交差',
      stateMutationOwner: 'none',
      requiredRole: 'player-choice',
      exit: { kind: 'ending', endingId: 'ending-main' },
    }],
  }
}

function context(): { context: ExtensionContext; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify({
      revision: 1,
      manifest: { mainPackId: 'main', packs: {} },
      graph: { nodes: [], edges: [] },
    }))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  const state = createInitialWorkflowState('wusong')
  state.productPhase = 'planning-design'
  state.activity = 'document.pillar'
  state.activityRevision = 1
  state.activityStatus = 'working'
  state.requirementContract = {
    schemaVersion: 1,
    rawIntent: '做一个草船借箭互动影游',
    dimensions: { work_scale: { value: '短篇（10个章节）', source: 'author' } },
    locale: 'zh-CN',
    collectedAt: new Date().toISOString(),
  }
  for (const settled of ['brief.collecting', 'document.inquiry', 'document.core'] as const) {
    state.activities[settled] = { revision: 1, status: 'complete', artifactRefs: [], evidence: [] }
  }
  state.activities['document.pillar'] = {
    revision: 1,
    status: 'working',
    artifactRefs: [],
    evidence: [],
  }
  state.activeGroup = { id: 'design', activities: ['document.pillar'], status: 'working', revision: 1 }
  state.gates.core = {
    status: 'approved',
    revision: 1,
    evidenceRef: 'doc-core',
    approvedAt: new Date().toISOString(),
  }
  files.set(VIDEO_GAME_WORKFLOW_FILE, encoder.encode(JSON.stringify(state)))

  return {
    files,
    context: {
      gameId: 'wusong',
      files: {
        async read(path: string) {
          const bytes = files.get(path)
          return bytes ? new Uint8Array(bytes) : null
        },
        async write(path: string, bytes: Uint8Array) { files.set(path, new Uint8Array(bytes)) },
        async list(path: string) {
          const prefix = `${path.replace(/\/+$/, '')}/`
          return [...new Set([...files.keys()]
            .filter((entry) => entry.startsWith(prefix))
            .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!))].sort()
        },
        async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) {
          return operation()
        },
      },
      media: { async list() { return [] }, async read() { return null } },
    } as unknown as ExtensionContext,
  }
}

function schema(name: string): object {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, '..', '..', '..', 'schemas', name), 'utf8'))
}

describe('pillar IR upsert is the creative surface', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false })

  it('persists a pass-beat batch as incomplete and merges the rest by beat.id', async () => {
    const { context: ctx, files } = context()
    const service = createGameVideoService(ctx)
    const validate = ajv.compile(schema('upsert-document.returns.json'))

    const first = await service.upsertDocument({
      documentType: 'pillar',
      slug: 'wusong',
      activityRevision: 1,
      contract: {
        schemaVersion: 4,
        title: '草船借箭',
        cast: [{ name: '诸葛亮', summary: '羽扇纶巾，青衣布履，面容清癯从容，手持羽毛扇调度水军。' }],
        settings: [{ name: '长江江面', summary: '冬夜长江大雾锁江，草船隐没在水气里，远处偶见敌营火把。' }],
        mainLoop: '看片后抉择，状态累积到借箭成败。',
        endings: [{ id: 'ending-main', title: '草船万箭', summary: '满载而归' }],
        beats: [
          {
            ...passBeat('B01'),
            actions: [{
              ...passBeat('B01').actions[0]!,
              exit: { kind: 'beat' as const, toBeatId: 'B02' },
            }],
          },
          ...['B03', 'B04', 'B05', 'B06'].map(passBeat),
          {
            ...passBeat('B09'),
            actions: [{
              ...passBeat('B09').actions[0]!,
              exit: { kind: 'beat' as const, toBeatId: 'B07' },
            }],
          },
        ],
      },
    }) as {
      document: { id?: string } | null
      incomplete?: boolean
      missingBeatIds?: string[]
      nextBeatIds?: string[]
      error?: string
    }

    expect(validate(first), JSON.stringify(validate.errors)).toBe(true)
    expect(first.document, JSON.stringify(first)).toBeTruthy()
    expect(first.incomplete).toBe(true)
    expect(first.missingBeatIds).toEqual(expect.arrayContaining(['B02', 'B07', 'B08', 'B10']))
    expect(first.nextBeatIds).toEqual(['B02'])
    expect(files.has('docs/wusong_pillar.md')).toBe(true)

    const stored = decoder.decode(files.get('docs/wusong_pillar.md')!)
    expect(stored).toContain('## 角色')
    expect(stored).toContain('```pillar-interaction-contract')
    const visible = extractAuthorVisible(stored)
    expect(visible).toContain('诸葛亮')
    expect(visible).not.toContain('schemaVersion')

    const remaining = [
      branchBeat('B02', 'B03', 'B04'),
      branchBeat('B07', 'B08', 'B09'),
      combatBeat('B08'),
      endingBeat('B10'),
    ]
    let last: { document: { id?: string } | null; incomplete?: boolean; nextBeatIds?: string[] } | undefined
    for (const [index, beat] of remaining.entries()) {
      last = await service.upsertDocument({
        documentType: 'pillar',
        slug: 'wusong',
        activityRevision: 1,
        contract: { schemaVersion: 4, beats: [beat] },
      }) as { document: { id?: string } | null; incomplete?: boolean; nextBeatIds?: string[] }
      expect(validate(last), JSON.stringify(validate.errors)).toBe(true)
      expect(last.document, JSON.stringify(last)).toBeTruthy()
      if (index < remaining.length - 1) {
        expect(last.incomplete).toBe(true)
        expect(last.nextBeatIds).toEqual([remaining[index + 1]!.id])
      }
    }

    expect(last?.incomplete, JSON.stringify(last)).toBeUndefined()
    expect(last?.nextBeatIds).toBeUndefined()

    const merged = decoder.decode(files.get('docs/wusong_pillar.md')!)
    expect(merged).toContain('"id":"B01"')
    expect(merged).toContain('"id":"B08"')
    expect(merged).toContain('"id":"B10"')
    expect(merged).toContain('诸葛亮')
  })

  it('compiles a complete short-form pillar from one atomic authoring submission', async () => {
    const { context: ctx } = context()
    const service = createGameVideoService(ctx)
    const validate = ajv.compile(schema('upsert-document.returns.json'))

    const result = await service.upsertDocument({
      documentType: 'pillar',
      slug: 'wusong',
      activityRevision: 1,
      contract: {
        schemaVersion: 4,
        title: '草船借箭',
        cast: [{ name: '诸葛亮', summary: '羽扇纶巾，青衣布履，面容清癯从容，手持羽毛扇调度水军。' }],
        settings: [{ name: '长江江面', summary: '冬夜长江大雾锁江，草船隐没在水气里，远处偶见敌营火把。' }],
        mainLoop: '看片后抉择，状态累积到借箭成败。',
        endings: [{ id: 'ending-main', title: '草船万箭', summary: '满舱箭矢在晨光中靠岸，诸葛亮从容复命。' }],
        beats: [
          passBeat('B01'),
          branchBeat('B02', 'B03', 'B04'),
          ...['B03', 'B04', 'B05', 'B06'].map(passBeat),
          branchBeat('B07', 'B08', 'B09'),
          combatBeat('B08'),
          passBeat('B09'),
          endingBeat('B10'),
        ],
      },
    }) as { document: unknown; incomplete?: boolean; error?: string; nextBeatIds?: string[] }

    expect(validate(result), JSON.stringify(validate.errors)).toBe(true)
    expect(result.document, result.error).toBeTruthy()
    expect(result.incomplete).toBeUndefined()
    expect(result.nextBeatIds).toBeUndefined()
  })

  it('persists the last skeleton beat even when compile fails', async () => {
    const { context: ctx, files } = context()
    const service = createGameVideoService(ctx)
    await service.upsertDocument({
      documentType: 'pillar',
      slug: 'wusong',
      activityRevision: 1,
      contract: {
        schemaVersion: 4,
        title: '草船借箭',
        cast: [{ name: '诸葛亮', summary: '羽扇纶巾，青衣布履，面容清癯从容，手持羽毛扇调度水军。' }],
        settings: [{ name: '长江江面', summary: '冬夜长江大雾锁江，草船隐没在水气里，远处偶见敌营火把。' }],
        mainLoop: '看片后抉择，状态累积到借箭成败。',
        endings: [{ id: 'ending-main', title: '草船万箭', summary: '满载而归' }],
        beats: ['B01', 'B03', 'B04', 'B05', 'B06', 'B09'].map(passBeat),
      },
    })
    for (const beat of [
      branchBeat('B02', 'B03', 'B04'),
      branchBeat('B07', 'B08', 'B09'),
      combatBeat('B08'),
    ]) {
      await service.upsertDocument({
        documentType: 'pillar',
        slug: 'wusong',
        activityRevision: 1,
        contract: { schemaVersion: 4, beats: [beat] },
      })
    }

    const result = await service.upsertDocument({
      documentType: 'pillar',
      slug: 'wusong',
      activityRevision: 1,
      contract: {
        schemaVersion: 4,
        beats: [{
          ...endingBeat('B10'),
          actions: [{
            ...endingBeat('B10').actions[0]!,
            requiredRole: undefined,
            capabilityGap: { need: '拖动排序输入', why: '目录没有拖拽控件' },
          }],
        }],
      },
    }) as { document: { id?: string } | null; error?: string }

    expect(result.document, JSON.stringify(result)).toBeTruthy()
    expect(result.error).toMatch(/capability-gap|role-unsupported|not-buildable/u)
    expect(decoder.decode(files.get('docs/wusong_pillar.md')!)).toContain('"id":"B10"')
  })
})
