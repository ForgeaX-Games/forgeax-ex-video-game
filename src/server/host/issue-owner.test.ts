import { describe, expect, it } from 'vitest'
import { ownerForIssueCode } from './issue-owner'

/**
 * 只读阶段的失败必须自带「该返工哪一步」。
 *
 * `playtest.validating` 写域是空的：它能看见问题却改不了，只能 `report_blocker` 交回。
 * 此前「交回哪一步」全靠模型判断，第二局它判错了——把界面缺口当成整装的活，
 * 于是同样的四条边改了三遍还是过不去（问题 18 的死循环）。
 * 现在每条 issue 带 owner，失败即指路。
 */
describe('问题归属', () => {
  it('结构类问题归整装（它有 graph 写域）', () => {
    expect(ownerForIssueCode('playtest.dead-loop')).toBe('game.finalizing')
    expect(ownerForIssueCode('playtest.edge.dangling')).toBe('game.finalizing')
    expect(ownerForIssueCode('playtest.edge.duplicate-handle')).toBe('game.finalizing')
    expect(ownerForIssueCode('graph.node.orphan')).toBe('game.finalizing')
  })

  it('数值类问题归数值线（区间与公式都在规则目录里）', () => {
    expect(ownerForIssueCode('playtest.variable.range-inverted')).toBe('rules.catalog')
    expect(ownerForIssueCode('playtest.variable.initial-out-of-range')).toBe('rules.catalog')
    expect(ownerForIssueCode('playtest.attr.range-inverted')).toBe('rules.catalog')
    expect(ownerForIssueCode('rules.plan.formula-missing')).toBe('rules.catalog')
    expect(ownerForIssueCode('rules.formula.invalid-call')).toBe('rules.catalog')
    expect(ownerForIssueCode('finalization.formula.empty')).toBe('rules.catalog')
  })

  it('结算引用类问题归 rules.binding（它把规则接到边与 reaction 上）', () => {
    expect(ownerForIssueCode('rules.binding.unknown-entity')).toBe('rules.binding')
    expect(ownerForIssueCode('finalization.plan.effect-unwired')).toBe('rules.binding')
    expect(ownerForIssueCode('finalization.binding.unknown-variable')).toBe('rules.binding')
  })

  it('界面类问题归 ui.authoring（挂载与输入键都在界面写域）', () => {
    expect(ownerForIssueCode('ui.overlay.non-base')).toBe('ui.authoring')
    expect(ownerForIssueCode('ui.component.unknown-input')).toBe('ui.authoring')
    expect(ownerForIssueCode('ui.component.event-unbound')).toBe('ui.authoring')
    expect(ownerForIssueCode('ui.exit.no-source')).toBe('ui.authoring')
    expect(ownerForIssueCode('finalization.plan.component-unmounted')).toBe('ui.authoring')
    expect(ownerForIssueCode('finalization.interaction.unreachable')).toBe('ui.authoring')
  })

  it('角色与场景类问题各归自己那条线', () => {
    expect(ownerForIssueCode('characters.catalog.invalid')).toBe('characters.modeling')
    expect(ownerForIssueCode('scenes.preview.missing')).toBe('scenes.previewing')
    expect(ownerForIssueCode('character.preview.missing')).toBe('characters.previewing')
    expect(ownerForIssueCode('character.preview.stale')).toBe('characters.previewing')
    expect(ownerForIssueCode('scene.preview.missing')).toBe('scenes.previewing')
    expect(ownerForIssueCode('scene.preview.stale')).toBe('scenes.previewing')
  })

  it('认不出的码不硬猜 owner', () => {
    // 猜错比不猜更糟：会把 peer 引向一条错误的返工路径。
    expect(ownerForIssueCode('something.unexpected')).toBeUndefined()
  })
})

describe('owner 随校验结果回到 Agent 手上', () => {
  it('蓝图审查失败的 issue 带 owner，且指向有对应写域的活动', async () => {
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
    expect(owner).toBe('game.finalizing')
    // 指路必须指向真的能改的活动：审查活动写域为空，返工目标必须有 graph 写域。
    expect(WRITE_SCOPES['playtest.validating']).toEqual([])
    expect(WRITE_SCOPES[owner]).toContain('graph')
  })
})
