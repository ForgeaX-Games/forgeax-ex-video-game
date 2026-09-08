import { describe, expect, it } from 'vitest'
import type { ExtensionContext } from '@forgeax/extension-host/node'
import { ACTIVITY_FOCUS, activityContract } from '../../workflow/activity-contracts'
import { expandCheckIds } from '../../workflow/validation-check-groups'
import type { CompletionReport, ValidationEvidence, VideoGameWorkflowState } from '../../workflow/contracts'
import {
  assertSceneCatalogMutationAllowed,
  assertWorkflowMutationAllowed,
  awaitWorkflowUser,
  beginWorkflowActivity,
  canCreateCatalogAdHocScenes,
  completeWorkflowActivity,
  confirmPillarAuthorGate,
  createInitialWorkflowState,
  EMPTY_CONTENT_INVENTORY,
  isPostDeliveryCatalogMaintenance,
  projectWorkflowState,
  reconcileProductionFailure,
  readWorkflowState,
  reportWorkflowBlocker,
  setWorkflowFocus,
  VIDEO_GAME_WORKFLOW_FILE,
  WorkflowStateError,
} from './workflow-state'
import { countAuthoredUi, countConfiguredUi } from './project-inspection'

function context(): ExtensionContext {
  const entries = new Map<string, Uint8Array>()
  return {
    gameId: 'workflow-test-game',
    files: {
      async read(path: string) { return entries.get(path) ?? null },
      async write(path: string, bytes: Uint8Array) { entries.set(path, new Uint8Array(bytes)) },
      async delete(path: string) { entries.delete(path) },
      async list() { return [] },
      async withLocks<T>(_keys: readonly string[], operation: () => Promise<T>) { return operation() },
    },
  } as unknown as ExtensionContext
}

function evidence(state: VideoGameWorkflowState): ValidationEvidence[] {
  return expandCheckIds(activityContract(state.activity).hardChecks).map((checkId) => ({
    schemaVersion: 1,
    activity: state.activity,
    activityRevision: state.activityRevision,
    checkId,
    status: 'pass',
    observedAt: new Date().toISOString(),
  }))
}

function report(state: VideoGameWorkflowState): CompletionReport {
  return {
    schemaVersion: 1,
    activity: state.activity,
    activityRevision: state.activityRevision,
    artifactRefs: [],
    checkIds: activityContract(state.activity).hardChecks,
  }
}

async function complete(contextValue: ExtensionContext, state: VideoGameWorkflowState) {
  const completed = await completeWorkflowActivity(
    contextValue,
    report(state),
    evidence(state),
    state.activity === 'brief.collecting'
      ? {
        requirementContract: {
          rawIntent: '武松打虎互动影游',
          locale: 'zh-CN',
          dimensions: {},
        },
      }
      : state.activity === 'document.inquiry'
        ? {
          inquiryContract: {
            answers: Array.from({ length: 5 }, (_, index) => ({
              question: `关键取舍 ${index + 1}`,
              answer: '选择 B',
            })),
          },
        }
        : {},
  )
  if (state.activity !== 'brief.collecting') return completed
  const inquiry = await beginWorkflowActivity(contextValue, {
    activity: 'document.inquiry',
    expectedWorkflowRevision: completed.revision,
  })
  return complete(contextValue, inquiry)
}

describe('video-game workflow state', () => {
  it('补充问询必须恰好提交五组非空问答', async () => {
    const ctx = context()
    let state = (await readWorkflowState(ctx, { create: true }))!
    state = await completeWorkflowActivity(ctx, report(state), evidence(state), {
      requirementContract: {
        rawIntent: '武松打虎互动影游',
        locale: 'zh-CN',
        dimensions: {},
      },
    })
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.inquiry',
      expectedWorkflowRevision: state.revision,
    })

    await expect(completeWorkflowActivity(ctx, report(state), evidence(state), {
      inquiryContract: {
        answers: [{ question: '智取还是力战？', answer: '先智取再力战' }],
      },
    })).rejects.toMatchObject({ code: 'workflow.inquiry.invalid' })
  })

  it('蓝图可玩性审查聚焦蓝图且不能导航到试玩页', () => {
    const contract = activityContract('playtest.validating')
    expect(ACTIVITY_FOCUS['playtest.validating']).toEqual({ kind: 'blueprint' })
    expect(contract.allowedToolNames).not.toContain(
      'mcp__as-mate-tools__extension__game_video__focus_page',
    )
    // 生成终点的权威可玩性硬门：数据合法性 + 玩法合理性，complete_activity 展开为叶子 evidence。
    expect(contract.hardChecks).toEqual([
      'blueprint.data.valid',
      'playtest.playability.valid',
    ])
  })

  it('persists four author phases while projecting only the active fine module', async () => {
    const ctx = context()
    const initial = (await readWorkflowState(ctx, { create: true }))!
    expect(initial.activity).toBe('brief.collecting')
    expect(Object.keys(initial.phases)).toEqual([
      'requirements-collection', 'planning-design', 'feature-development', 'asset-generation',
    ])
    const projection = projectWorkflowState(initial)
    expect(projection.modules.documents!.availability).toBe('ready')
    expect(projection.modules.blueprint!.availability).toBe('hidden')
    expect(projection.modules.rules!.availability).toBe('hidden')
  })

  it('does not count seeded platform UI as authored work', () => {
    expect(countAuthoredUi({
      'base:Dialogue': {},
      'base:TextOption': {},
    })).toBe(0)
    expect(countAuthoredUi({
      'base:Dialogue': {},
      'custom:MainHud': {},
    })).toBe(1)
  })

  it('counts base UI only after a node mounts it', () => {
    const graph = {
      nodes: [{ id: 'entry', type: 'scene', position: { x: 0, y: 0 }, data: { name: '入口' } }],
      edges: [],
    }
    const project = {
      manifest: { mainPackId: 'main', packs: { main: { entry: 'entry', graph } } },
      graph,
      ui: { overlays: { 'base:TextOption': { id: 'base:TextOption', children: [] } } },
    }
    expect(countConfiguredUi(project as never)).toBe(0)
    graph.nodes[0]!.data = {
      ...graph.nodes[0]!.data,
      overlayNodes: [{ overlay: 'base:TextOption' }],
    } as never
    expect(countConfiguredUi(project as never)).toBe(1)
  })

  it('keeps custom-control tools out of game.finalizing but allows them in ui.authoring', () => {
    // ui.authoring 放开：可造控件 + 组装模板（agent 制作界面的默认路径）。
    expect(activityContract('ui.authoring').allowedToolNames).toContain(
      'mcp__as-mate-tools__extension__game_video__upsert_component',
    )
    // game.finalizing 保持保守：收尾集成阶段仍只挂已有方案，不造控件。
    expect(activityContract('game.finalizing').allowedToolNames).not.toContain(
      'mcp__as-mate-tools__extension__game_video__upsert_component',
    )
    expect(activityContract('ui.authoring').hardChecks).toContain('ui.reuses-existing-overlays')
    expect(activityContract('game.finalizing').hardChecks).not.toContain('ui.reuses-existing-overlays')
    expect(activityContract('ui.authoring').domainGuide).toContain(
      '{ left:0, top:0, width:1, height:1 }',
    )
    expect(activityContract('ui.authoring').domainGuide).toContain('不得写 children')
  })

  it('requires real external gate evidence before pillar and feature development', async () => {
    const ctx = context()
    let state = (await readWorkflowState(ctx, { create: true }))!
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, { activity: 'document.core', expectedWorkflowRevision: state.revision })
    state = await complete(ctx, state)

    await expect(beginWorkflowActivity(ctx, {
      activity: 'document.pillar', expectedWorkflowRevision: state.revision,
    })).rejects.toMatchObject({ code: 'workflow.gate.required' })

    state = await beginWorkflowActivity(ctx, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      gateApproval: { gate: 'core', evidenceRef: 'production:core-choice:7', revision: 7 },
    })
    expect(state.gates.core).toMatchObject({
      status: 'approved', evidenceRef: 'production:core-choice:7', revision: 7,
    })
  })

  it('records pillar approval without creating a character-preview confirmation gate', async () => {
    const ctx = context()
    let state = (await readWorkflowState(ctx, { create: true }))!
    for (const activity of ['document.core'] as const) {
      state = await complete(ctx, state)
      state = await beginWorkflowActivity(ctx, { activity, expectedWorkflowRevision: state.revision })
    }
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      gateApproval: { gate: 'core', evidenceRef: 'production:core:3', revision: 3 },
    })
    state = await complete(ctx, state)
    state = await confirmPillarAuthorGate(ctx, {
      expectedWorkflowRevision: state.revision,
      productionId: 'production:pillar:9',
    })
    const evidenceRef = state.gates.pillar?.evidenceRef
    state = await beginWorkflowActivity(ctx, {
      activity: 'blueprint.outline',
      expectedWorkflowRevision: state.revision,
    })

    expect(state.gates.pillar).toMatchObject({
      status: 'approved', evidenceRef,
    })
    expect(state.gates['character-cost']).toBeUndefined()
    expect(evidenceRef).toMatch(/^author:pillar:/)

    const repeated = await confirmPillarAuthorGate(ctx, {
      expectedWorkflowRevision: 1,
      productionId: 'production:pillar:9',
    })
    expect(repeated.revision).toBe(state.revision)
    expect(repeated.gates.pillar?.evidenceRef).toBe(evidenceRef)
  })

  it('支柱返工会重开作者门并使下游失效，允许重新生成后再次确认', async () => {
    const ctx = context()
    let state = (await readWorkflowState(ctx, { create: true }))!
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.core',
      expectedWorkflowRevision: state.revision,
    })
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      gateApproval: { gate: 'core', evidenceRef: 'production:core:3', revision: 3 },
    })
    state = await complete(ctx, state)
    state = await confirmPillarAuthorGate(ctx, { productionId: 'prod-first' })
    state = await beginWorkflowActivity(ctx, {
      activity: 'blueprint.outline',
      expectedWorkflowRevision: state.revision,
    })
    state = await complete(ctx, state)

    const reworking = await beginWorkflowActivity(ctx, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      rework: true,
      reason: 'author requested pillar regeneration',
    })

    expect(reworking.activities['document.pillar']?.status).toBe('working')
    expect(reworking.activities['blueprint.outline']?.status).toBe('not-started')
    expect(reworking.gates.pillar).toMatchObject({ status: 'pending' })
    expect(reworking.gates.pillar?.evidenceRef).toBeUndefined()
  })

  it('ignores the obsolete character-cost gate when reading a legacy workflow', async () => {
    const ctx = context()
    const legacy = createInitialWorkflowState('workflow-test-game')
    legacy.gates['character-cost'] = {
      status: 'pending',
      revision: 0,
    }
    await ctx.files.write(VIDEO_GAME_WORKFLOW_FILE, new TextEncoder().encode(JSON.stringify(legacy)))

    const state = await readWorkflowState(ctx)

    expect(state?.gates['character-cost']).toBeUndefined()
    expect(state?.gates.pillar).toMatchObject({ status: 'pending' })
  })

  it('refuses Agent-signed pillar evidence while requiring no character-preview gate', async () => {
    const ctx = context()
    let state = (await readWorkflowState(ctx, { create: true }))!
    for (const activity of ['document.core'] as const) {
      state = await complete(ctx, state)
      state = await beginWorkflowActivity(ctx, { activity, expectedWorkflowRevision: state.revision })
    }
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      gateApproval: { gate: 'core', evidenceRef: 'production:core:3', revision: 3 },
    })
    state = await complete(ctx, state)

    await expect(beginWorkflowActivity(ctx, {
      activity: 'blueprint.outline',
      expectedWorkflowRevision: state.revision,
      gateApprovals: [
        { gate: 'pillar', evidenceRef: 'production:pillar:9', revision: 9 },
      ],
    })).rejects.toMatchObject({ code: 'workflow.gate.external-only' })

    await expect(beginWorkflowActivity(ctx, {
      activity: 'blueprint.outline',
      expectedWorkflowRevision: state.revision,
    })).rejects.toMatchObject({ code: 'workflow.gate.required' })
  })

  it('rejects stale transitions and skipping mandatory activities', async () => {
    const ctx = context()
    const state = (await readWorkflowState(ctx, { create: true }))!
    await expect(beginWorkflowActivity(ctx, {
      activity: 'document.core', expectedWorkflowRevision: state.revision - 1,
    })).rejects.toBeInstanceOf(WorkflowStateError)
    await expect(completeWorkflowActivity(ctx, { ...report(state), notRequired: true }, []))
      .rejects.toMatchObject({ code: 'workflow.not-required.denied' })
  })
})

describe('新项目在作者提交需求前不应显示生产进度', () => {
  it('初始状态是 not-started 且不产生 notice', async () => {
    const ctx = context()
    const state = await readWorkflowState(ctx, { create: true })

    expect(state?.activityStatus).toBe('not-started')
    expect(projectWorkflowState(state!).notice).toBeUndefined()
  })

  it('作者提交后开启 brief.collecting，此时才出现进度 notice', async () => {
    const ctx = context()
    const initial = await readWorkflowState(ctx, { create: true })
    const started = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial!.revision,
    })

    expect(started.activityStatus).toBe('working')
    expect(projectWorkflowState(started).notice?.kind).toBe('progress')
  })
})

describe('作者门的提示条策略', () => {
  async function advanceTo(
    ctx: ExtensionContext,
    target: 'document.core' | 'document.pillar',
  ): Promise<VideoGameWorkflowState> {
    let state = (await readWorkflowState(ctx, { create: true }))!
    state = await beginWorkflowActivity(ctx, { activity: 'brief.collecting', expectedWorkflowRevision: state.revision })
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, { activity: 'document.core', expectedWorkflowRevision: state.revision })
    state = await complete(ctx, state)
    if (target === 'document.core') return state
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.pillar',
      expectedWorkflowRevision: state.revision,
      gateApproval: { gate: 'core', evidenceRef: 'author:core:test', revision: 1, approvedAt: new Date().toISOString() },
    })
    return complete(ctx, state)
  }

  it('三方案写完后由中间区轮播承接选择，不重复弹等待确认提示', async () => {
    const ctx = context()
    const state = await advanceTo(ctx, 'document.core')

    expect(state.activities['document.core']?.status).toBe('complete')
    expect(state.activity).toBe('document.pillar')
    expect(projectWorkflowState(state).notice).toBeUndefined()
  })

  it('支柱写完但作者还没确认时，等的是作者而不是 AI', async () => {
    const ctx = context()
    const state = await advanceTo(ctx, 'document.pillar')

    expect(state.gates.pillar?.status).toBe('pending')
    expect(projectWorkflowState(state).notice).toBeUndefined()
  })

  // 防漂移:投影说「等作者确认支柱」时，begin 必须确实拒绝推进。
  // 两侧规则各写一遍很容易走散——今天的几个 bug 都是这么来的。
  it('投影说在等支柱门时，begin blueprint.outline 必须被拒', async () => {
    const ctx = context()
    const state = await advanceTo(ctx, 'document.pillar')
    expect(state.gates.pillar?.status).toBe('pending')
    expect(projectWorkflowState(state).notice).toBeUndefined()

    await expect(beginWorkflowActivity(ctx, {
      activity: 'blueprint.outline',
      expectedWorkflowRevision: state.revision,
    })).rejects.toMatchObject({ code: 'workflow.gate.required' })
  })

  it('作者确认支柱后提示条报下一步，而不是停在「正在建立游戏支柱」', async () => {
    const ctx = context()
    const state = await advanceTo(ctx, 'document.pillar')
    const confirmed = await confirmPillarAuthorGate(ctx, {
      expectedWorkflowRevision: state.revision,
      productionId: 'prod-test',
    })
    const notice = projectWorkflowState(confirmed).notice
    const modules = projectWorkflowState(confirmed).modules

    // 支柱已经确认过了，作者会觉得流程卡住；这段间隙要说「即将生成游戏蓝图」。
    expect(notice?.kind).toBe('upcoming')
    expect(notice?.activity).toBe('blueprint.outline')
    expect(modules.blueprint?.availability, '功能开发尚未开始时蓝图入口不应提前出现').toBe('hidden')
  })
})

describe('awaiting-user workflow transition', () => {
  it('narrows the projection while waiting and can resume the same activity', async () => {
    const ctx = context()
    expect(activityContract('brief.collecting').allowedToolNames).toContain(
      'mcp__as-mate-tools__extension__game_video__await_user',
    )
    const initial = (await readWorkflowState(ctx, { create: true }))!
    const working = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.revision,
    })

    const awaiting = await awaitWorkflowUser(ctx, {
      activityRevision: working.activityRevision,
      reason: 'requirement-questionnaire',
    })
    const projection = projectWorkflowState(awaiting)

    expect(awaiting.activityStatus).toBe('awaiting-user')
    expect(awaiting.phaseStatus).toBe('awaiting-user')
    expect(awaiting.activities['brief.collecting']?.status).toBe('awaiting-user')
    expect(awaiting.history.at(-1)?.reason).toBe('requirement-questionnaire')
    expect(projection.notice).toBeUndefined()
    expect(projection.modules.documents?.availability).toBe('working')
    expect(projection.modules.character?.availability).toBe('hidden')

    const resumed = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: awaiting.revision,
    })
    expect(resumed.activityStatus).toBe('working')
  })

  it('rejects stale activity revisions and non-working activities', async () => {
    const ctx = context()
    const initial = (await readWorkflowState(ctx, { create: true }))!

    await expect(awaitWorkflowUser(ctx, {
      activityRevision: initial.activityRevision,
      reason: 'requirement-questionnaire',
    })).rejects.toMatchObject({ code: 'workflow.transition.invalid' })

    const working = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.revision,
    })
    await expect(awaitWorkflowUser(ctx, {
      activityRevision: working.activityRevision + 1,
      reason: 'requirement-questionnaire',
    })).rejects.toMatchObject({ code: 'workflow.activity.stale' })
  })
})

describe('侧边栏按 workflow 活动历史单调解锁', () => {
  const BROWSABLE = ['assets', 'character', 'rules', 'entities', 'variables', 'ui', 'blueprint'] as const

  it('初始状态只显示空文档一级目录', async () => {
    const ctx = context()
    const state = (await readWorkflowState(ctx, { create: true }))!
    const modules = projectWorkflowState(state).modules

    expect(modules.documents?.availability).toBe('ready')
    expect(modules['document.core']?.availability).toBe('hidden')
    expect(modules['document.pillar']?.availability).toBe('hidden')
    for (const key of BROWSABLE) {
      expect(modules[key]?.availability, `${key} 不应提前出现`).toBe('hidden')
    }
  })

  it('AI 干活期间才跟随当前阶段收窄', async () => {
    const ctx = context()
    const initial = (await readWorkflowState(ctx, { create: true }))!
    const working = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.revision,
    })
    const modules = projectWorkflowState(working).modules

    expect(working.activityStatus).toBe('working')
    // 空的、且不属于当前阶段的模块此时收起，让作者注意力跟着 AI。
    expect(modules.character?.availability).toBe('hidden')
  })

  it('活动之间的间隙不算停下：空目录不冒出来', async () => {
    // brief 交付后下一步立刻要派 design，这段 `complete` 只是间隙。
    // 按它恢复入口会让蓝图、资产库在文档阶段闪现一下，作者以为进错了阶段。
    const ctx = context()
    const initial = (await readWorkflowState(ctx, { create: true }))!
    const working = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.revision,
    })
    const done = await complete(ctx, working)
    const modules = projectWorkflowState(done).modules

    expect(modules['document.core']?.availability, '核心设计尚未开始时入口不应提前出现').toBe('hidden')
    expect(modules.blueprint?.availability, '蓝图不应在文档阶段出现').toBe('hidden')
    expect(modules.assets?.availability, '资产库不应在文档阶段出现').toBe('hidden')
  })

  it('等作者点按钮时保留已解锁入口，但不提前显示未来目录', async () => {
    const ctx = context()
    const initial = (await readWorkflowState(ctx, { create: true }))!
    let state = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.revision,
    })
    state = await complete(ctx, state)
    state = await beginWorkflowActivity(ctx, {
      activity: 'document.core',
      expectedWorkflowRevision: state.revision,
    })
    // 核心方向已产出、等作者选：pendingAuthorGate 命中，AI 确实停着。
    state = await complete(ctx, state)
    const modules = projectWorkflowState(state).modules

    expect(modules.documents?.availability).toBe('ready')
    expect(modules['document.core']?.availability).toBe('ready')
    expect(modules['document.pillar']?.availability).toBe('hidden')
    expect(modules.blueprint?.availability).toBe('hidden')
    expect(modules.assets?.availability).toBe('hidden')
  })

  it('功能开发开始时蓝图、规则、界面和完整资产库整组出现', () => {
    const initial = createInitialWorkflowState('feature-sidebar-game')
    const workingRecord = { revision: 1, status: 'working' as const, artifactRefs: [], evidence: [] }
    const feature: VideoGameWorkflowState = {
      ...initial,
      productPhase: 'feature-development',
      phaseStatus: 'working',
      activity: 'blueprint.outline',
      activityStatus: 'working',
      activeGroup: { id: 'outline', activities: ['blueprint.outline'], status: 'working', revision: 1 },
      phases: {
        ...initial.phases,
        'feature-development': { revision: 1, status: 'working' },
      },
      activities: {
        ...initial.activities,
        'blueprint.outline': workingRecord,
      },
    }
    const modules = projectWorkflowState(feature, {
      ...EMPTY_CONTENT_INVENTORY,
      characterCount: 2,
      sceneCount: 2,
      imageCount: 4,
    }).modules

    expect(modules.blueprint?.availability).not.toBe('hidden')
    expect(modules.rules?.availability).not.toBe('hidden')
    expect(modules.entities?.availability).not.toBe('hidden')
    expect(modules.variables?.availability).not.toBe('hidden')
    expect(modules.formulas?.availability).not.toBe('hidden')
    expect(modules.ui?.availability).not.toBe('hidden')
    expect(modules.assets?.availability).not.toBe('hidden')
    for (const key of ['character', 'scene', 'video', 'image', 'audio', 'font'] as const) {
      expect(modules[key]?.availability, `${key} 应随资产库整体出现`).not.toBe('hidden')
    }
  })

  it('整个 integration 组的 working 状态都投影到蓝图模块', () => {
    for (const activity of ['ui.authoring', 'rules.binding', 'game.finalizing'] as const) {
      const initial = createInitialWorkflowState(`integration-${activity}`)
      const workingRecord = { revision: 1, status: 'working' as const, artifactRefs: [], evidence: [] }
      const state: VideoGameWorkflowState = {
        ...initial,
        productPhase: 'feature-development',
        phaseStatus: 'working',
        activity,
        activityStatus: 'working',
        activeGroup: { id: 'integration', activities: [activity], status: 'working', revision: 1 },
        phases: {
          ...initial.phases,
          'feature-development': { revision: 1, status: 'working' },
        },
        activities: {
          ...initial.activities,
          [activity]: workingRecord,
        },
      }

      expect(projectWorkflowState(state, {
        ...EMPTY_CONTENT_INVENTORY,
        blueprintNodeCount: 2,
        blueprintCount: 1,
      }).modules.blueprint?.availability, activity).toBe('working')
    }
  })

  it('资产生成开始时资产库及全部二级分类一起出现', () => {
    const initial = createInitialWorkflowState('asset-sidebar-game')
    const workingRecord = { revision: 1, status: 'working' as const, artifactRefs: [], evidence: [] }
    const assets: VideoGameWorkflowState = {
      ...initial,
      productPhase: 'asset-generation',
      phaseStatus: 'working',
      activity: 'assets.character',
      activityStatus: 'working',
      activeGroup: {
        id: 'assets',
        activities: ['assets.character', 'assets.scene'],
        status: 'working',
        revision: 1,
      },
      phases: {
        ...initial.phases,
        'feature-development': { revision: 1, status: 'complete' },
        'asset-generation': { revision: 1, status: 'working' },
      },
      activities: {
        ...initial.activities,
        'assets.character': workingRecord,
        'assets.scene': workingRecord,
      },
    }
    const modules = projectWorkflowState(assets).modules

    for (const key of ['assets', 'character', 'scene', 'video', 'image', 'audio', 'font'] as const) {
      expect(modules[key]?.availability, `${key} 应随资产库整体出现`).not.toBe('hidden')
    }
  })

  it('受阻时只保留已解锁入口，受阻模块带阻塞标记', async () => {
    const ctx = context()
    const initial = (await readWorkflowState(ctx, { create: true }))!
    const working = await beginWorkflowActivity(ctx, {
      activity: 'brief.collecting',
      expectedWorkflowRevision: initial.revision,
    })
    const blocked = await reportWorkflowBlocker(ctx, {
      activityRevision: working.activityRevision,
      code: 'author.input-required',
      message: '需要作者补充信息',
      retryable: false,
    })
    const modules = projectWorkflowState(blocked).modules

    expect(blocked.activityStatus).toBe('blocked')
    expect(modules.character?.availability).toBe('hidden')
    expect(modules.documents?.availability).toBe('blocked')
  })

  it('terminal peer failure reconciles a still-working integration activity to blocked', async () => {
    const ctx = context()
    const initial = createInitialWorkflowState('workflow-test-game')
    const workingRecord = {
      revision: 4,
      status: 'working' as const,
      artifactRefs: [],
      evidence: [],
    }
    const completeRecord = {
      revision: 3,
      status: 'complete' as const,
      artifactRefs: [],
      evidence: [],
    }
    const working: VideoGameWorkflowState = {
      ...initial,
      revision: 10,
      productPhase: 'feature-development',
      phaseRevision: 4,
      phaseStatus: 'working',
      activity: 'game.finalizing',
      activityRevision: 4,
      activityStatus: 'working',
      activeGroup: {
        id: 'integration',
        activities: ['ui.authoring', 'rules.binding', 'game.finalizing'],
        status: 'working',
        revision: 4,
      },
      phases: {
        ...initial.phases,
        'feature-development': { revision: 4, status: 'working' },
      },
      activities: {
        ...initial.activities,
        'ui.authoring': completeRecord,
        'rules.binding': completeRecord,
        'game.finalizing': workingRecord,
      },
      productionRefs: ['production-finalizing-1'],
    }
    await ctx.files.write(
      VIDEO_GAME_WORKFLOW_FILE,
      new TextEncoder().encode(JSON.stringify(working)),
    )

    const blocked = await reconcileProductionFailure(ctx, {
      productionId: 'production-finalizing-1',
      reason: 'peer rejected after validation failures',
    })

    expect(blocked.activityStatus).toBe('blocked')
    expect(blocked.activities['game.finalizing']?.status).toBe('blocked')
    expect(blocked.blockers.at(-1)).toMatchObject({
      code: 'production.peer.rejected',
      retryable: true,
      activity: 'game.finalizing',
    })
    const replayed = await reconcileProductionFailure(ctx, {
      productionId: 'production-finalizing-1',
      reason: 'late duplicate lifecycle event',
    })
    expect(replayed.revision).toBe(blocked.revision)
  })

  it('蓝图可玩性审查完成后恢复入口且不再投递进度提示', () => {
    const initial = createInitialWorkflowState('delivered-game')
    const completeRecord = { revision: 1, status: 'complete' as const, artifactRefs: [], evidence: [] }
    const delivered: VideoGameWorkflowState = {
      ...initial,
      productPhase: 'asset-generation',
      phaseStatus: 'complete',
      activity: 'playtest.validating',
      activityStatus: 'complete',
      activeGroup: {
        id: 'delivery',
        activities: ['playtest.validating'],
        status: 'complete',
        revision: 1,
      },
      activities: {
        ...initial.activities,
        'blueprint.outline': completeRecord,
        'characters.modeling': completeRecord,
        'scenes.modeling': completeRecord,
        'rules.catalog': completeRecord,
        'ui.authoring': completeRecord,
        'video.presets.validating': completeRecord,
        'playtest.validating': completeRecord,
      },
    }

    const projection = projectWorkflowState(delivered)
    expect(projection.notice).toBeUndefined()
    for (const key of BROWSABLE) {
      expect(projection.modules[key]?.availability, `${key} 应在交付后恢复`).not.toBe('hidden')
    }
  })

  it('交付后允许场景目录维护且可新建 catalog 场景，无需活动 working', () => {
    const initial = createInitialWorkflowState('delivered-game')
    const completeRecord = { revision: 1, status: 'complete' as const, artifactRefs: [], evidence: [] }
    const delivered: VideoGameWorkflowState = {
      ...initial,
      productPhase: 'asset-generation',
      phaseStatus: 'complete',
      activity: 'playtest.validating',
      activityStatus: 'complete',
      activeGroup: {
        id: 'delivery',
        activities: ['playtest.validating'],
        status: 'complete',
        revision: 1,
      },
      activities: {
        ...initial.activities,
        'playtest.validating': completeRecord,
      },
    }

    expect(isPostDeliveryCatalogMaintenance(delivered)).toBe(true)
    expect(canCreateCatalogAdHocScenes(delivered)).toBe(true)
    expect(() => assertSceneCatalogMutationAllowed(
      delivered,
      undefined,
      ['scenes.previewing', 'assets.scene'],
      ['scenes', 'assets.scene'],
    )).not.toThrow()
    expect(() => assertWorkflowMutationAllowed(
      delivered,
      undefined,
      ['scenes.previewing', 'assets.scene'],
      ['scenes', 'assets.scene'],
    )).toThrow(WorkflowStateError)
  })

  it('完成报告即使建议打开试玩页，Host 仍强制保持蓝图 focus', async () => {
    const ctx = context()
    const initial = createInitialWorkflowState('workflow-test-game')
    const reviewing: VideoGameWorkflowState = {
      ...initial,
      productPhase: 'asset-generation',
      phaseRevision: 1,
      phaseStatus: 'working',
      activity: 'playtest.validating',
      activityRevision: 1,
      activityStatus: 'working',
      activeGroup: {
        id: 'delivery',
        activities: ['playtest.validating'],
        status: 'working',
        revision: 1,
      },
      activities: {
        ...initial.activities,
        'video.presets.validating': { revision: 1, status: 'complete', artifactRefs: [], evidence: [] },
        'playtest.validating': { revision: 1, status: 'working', artifactRefs: [], evidence: [] },
      },
      phases: {
        ...initial.phases,
        'asset-generation': { revision: 1, status: 'working' },
      },
      focus: { location: { kind: 'blueprint' }, reason: 'activity-started', revision: 1 },
    }
    await ctx.files.write(VIDEO_GAME_WORKFLOW_FILE, new TextEncoder().encode(JSON.stringify(reviewing)))

    await expect(setWorkflowFocus(ctx, {
      activityRevision: 1,
      location: { kind: 'play' },
    })).rejects.toMatchObject({ code: 'workflow.focus.playtest-denied' })

    const completed = await completeWorkflowActivity(ctx, {
      ...report(reviewing),
      suggestedFocus: { kind: 'play' },
    }, evidence(reviewing))

    expect(completed.focus?.location).toEqual({ kind: 'blueprint' })
  })
})
