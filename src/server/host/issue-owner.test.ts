import { describe, expect, it } from 'vitest'
import { ownerForIssueCode } from './issue-owner'

/**
 * 编译阶段没有工具面，审查阶段也已收回写域。蓝图缺口的 owner 收口到
 * `document.pillar`：编译产物只能靠改编译输入再整份重编译来修。
 */
describe('问题归属', () => {
  it('结构类问题归支柱（编译产物只能重编译）', () => {
    expect(ownerForIssueCode('playtest.dead-loop')).toBe('document.pillar')
    expect(ownerForIssueCode('playtest.edge.dangling')).toBe('document.pillar')
    expect(ownerForIssueCode('playtest.edge.duplicate-handle')).toBe('document.pillar')
    expect(ownerForIssueCode('graph.node.orphan')).toBe('document.pillar')
  })

  it('数值类问题也归支柱，不回规则编译活动', () => {
    expect(ownerForIssueCode('playtest.variable.range-inverted')).toBe('document.pillar')
    expect(ownerForIssueCode('playtest.variable.initial-out-of-range')).toBe('document.pillar')
    expect(ownerForIssueCode('playtest.attr.range-inverted')).toBe('document.pillar')
    expect(ownerForIssueCode('rules.plan.formula-missing')).toBe('document.pillar')
    expect(ownerForIssueCode('rules.formula.invalid-call')).toBe('document.pillar')
    expect(ownerForIssueCode('finalization.formula.empty')).toBe('document.pillar')
  })

  it('结算引用与界面缺口同样回到支柱重编译', () => {
    expect(ownerForIssueCode('rules.binding.unknown-entity')).toBe('document.pillar')
    expect(ownerForIssueCode('finalization.plan.effect-unwired')).toBe('document.pillar')
    expect(ownerForIssueCode('finalization.binding.unknown-variable')).toBe('document.pillar')
    expect(ownerForIssueCode('ui.overlay.non-base')).toBe('document.pillar')
    expect(ownerForIssueCode('ui.component.unknown-input')).toBe('document.pillar')
    expect(ownerForIssueCode('ui.component.event-unbound')).toBe('document.pillar')
    expect(ownerForIssueCode('ui.exit.no-source')).toBe('document.pillar')
    expect(ownerForIssueCode('finalization.plan.component-unmounted')).toBe('document.pillar')
    expect(ownerForIssueCode('finalization.interaction.unreachable')).toBe('document.pillar')
  })

  it('角色与场景类问题各归自己那条线', () => {
    expect(ownerForIssueCode('characters.catalog.invalid')).toBe('characters.modeling')
    expect(ownerForIssueCode('scenes.preview.missing')).toBe('scenes.previewing')
    expect(ownerForIssueCode('character.preview.missing')).toBe('characters.previewing')
    expect(ownerForIssueCode('character.preview.stale')).toBe('characters.previewing')
    expect(ownerForIssueCode('scene.preview.missing')).toBe('scenes.previewing')
    expect(ownerForIssueCode('scene.preview.stale')).toBe('scenes.previewing')
  })

  it('总脉络执行问题归支柱', () => {
    expect(ownerForIssueCode('outline.interaction.effect-settlement-missing')).toBe('document.pillar')
    expect(ownerForIssueCode('outline.cross-beat-effect-resolution')).toBe('document.pillar')
    expect(ownerForIssueCode('outline.resolves-actions-cross-beat')).toBe('document.pillar')
  })

  it('认不出的码不硬猜 owner', () => {
    // 猜错比不猜更糟：会把 peer 引向一条错误的返工路径。
    expect(ownerForIssueCode('something.unexpected')).toBeUndefined()
  })
})

describe('owner 随校验结果回到 Agent 手上', () => {
  it('蓝图审查失败的 issue 带 owner，且指向支柱而不是审查活动', async () => {
    const { validateProjectForActivity } = await import('./project-inspection')
    const { WRITE_SCOPES } = await import('../../workflow/contracts')
    const encoder = new TextEncoder()
    // 死循环：图里有结局（end），但 n2 与 n3 互指、回不到它。
    const graph = {
      nodes: [
        { id: 'n1', type: 'scene', position: { x: 0, y: 0 }, data: { name: 'A', chapterSummary: 'A', storyText: 'A' } },
        { id: 'n2', type: 'scene', position: { x: 1, y: 0 }, data: { name: 'B', chapterSummary: 'B', storyText: 'B' } },
        { id: 'n3', type: 'scene', position: { x: 2, y: 0 }, data: { name: 'C', chapterSummary: 'C', storyText: 'C' } },
        { id: 'end', type: 'scene', position: { x: 3, y: 0 }, data: { name: '结局', chapterSummary: 'E', storyText: 'E' } },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'A', data: {} },
        { id: 'e2', source: 'n1', target: 'end', sourceHandle: 'B', data: {} },
        // n2 / n3 之间是默认出边：自动来回，观众停不下来也到不了 end。
        { id: 'e3', source: 'n2', target: 'n3', sourceHandle: 'default', data: {} },
        { id: 'e4', source: 'n3', target: 'n2', sourceHandle: 'default', data: {} },
      ],
    }
    const project = {
      revision: 1,
      graph,
      manifest: { mainPackId: 'main', packs: { main: { id: 'main', title: '主蓝图', entry: 'n1', graph } } },
      variables: {},
      entities: {},
      formulas: {},
    }
    const files = new Map<string, Uint8Array>([
      ['blueprint.json', encoder.encode(JSON.stringify(project))],
      ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
    ])
    const context = {
      gameId: 'g',
      files: {
        async read(path: string) { return files.get(path) ?? null },
        async write() {},
        async list() { return [...files.keys()] },
        async withLocks<T>(_k: readonly string[], op: () => Promise<T>) { return op() },
      },
      media: { async list() { return [] } },
    } as never

    const result = await validateProjectForActivity(context, 'playtest.validating', 1, ['playtest.no-dead-loop'])

    const issues = result.evidence[0]!.issues ?? []
    expect(issues.map((entry) => entry.code)).toContain('playtest.dead-loop')
    const owner = issues.find((entry) => entry.code === 'playtest.dead-loop')!.owner!
    expect(owner).toBe('document.pillar')
    // 审查自己没有写域：它只能报告，修复必须回到支柱再整份重编译。
    expect(WRITE_SCOPES['playtest.validating']).toEqual([])
    expect(WRITE_SCOPES[owner]).toContain('documents')
  })
})
