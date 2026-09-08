import { describe, expect, it } from 'vitest'
import { preflightActivity } from './activity-preflight'
import { createInitialWorkflowState, EMPTY_CONTENT_INVENTORY } from './workflow-state'
import type { ContentInventory } from './workflow-state'
import type { VideoGameActivity, VideoGameWorkflowState } from '../../workflow/contracts'

/**
 * 派发前预检（设计 §9.7.2 L2）。
 *
 * 这是 `requiredInputs` 第一次被真正求值——在此之前它只是契约里的一段描述，
 * 没有任何代码读它，前置不齐照样能派发，然后在子 Agent 里撞守卫。
 */

function state(patch: (draft: VideoGameWorkflowState) => void = () => {}): VideoGameWorkflowState {
  const draft = createInitialWorkflowState('g')
  patch(draft)
  return draft
}

function inventory(patch: Partial<ContentInventory> = {}): ContentInventory {
  return { ...EMPTY_CONTENT_INVENTORY, ...patch }
}

function complete(draft: VideoGameWorkflowState, activity: VideoGameActivity): void {
  draft.activities[activity] = { revision: 1, status: 'complete', artifactRefs: [], evidence: [] }
}

describe('派发前预检', () => {
  it('缺需求契约时不放行 document.core，并指名该重派谁', () => {
    const result = preflightActivity(state(), inventory(), 'document.core')

    expect(result.ready).toBe(false)
    // 一次给全缺口，不分轮暴露（设计 §9.7.5）。
    expect(result.gaps).toContainEqual(
      { kind: 'required-input', detail: '缺少前置产物：brief', resolveWith: 'brief.collecting' },
    )
    expect(result.gaps.map((gap) => gap.kind)).toContain('group')
    expect(result.dispatch).toBeUndefined()
  })

  it('需求契约就位后 document.core 放行，并给出派发载荷', () => {
    const ready = state((draft) => {
      draft.requirementContract = {
        schemaVersion: 1,
        rawIntent: '武松打虎',
        dimensions: {},
        locale: 'zh-CN',
        collectedAt: new Date().toISOString(),
      }
      draft.inquiryContract = {
        schemaVersion: 1,
        answers: Array.from({ length: 5 }, (_, index) => ({
          question: `关键取舍 ${index + 1}`,
          answer: '选择 B',
        })),
        collectedAt: new Date().toISOString(),
      }
      complete(draft, 'brief.collecting')
      complete(draft, 'document.inquiry')
      draft.activity = 'document.core'
      draft.activeGroup = { id: 'design', activities: ['document.core'], status: 'not-started', revision: 1 }
    })

    const result = preflightActivity(ready, inventory(), 'document.core')

    expect(result.ready).toBe(true)
    expect(result.dispatch).toMatchObject({
      activity: 'document.core',
      objective: expect.stringContaining('核心'),
      hardChecks: expect.arrayContaining(['document.design-options.ready']),
      requiredInputs: ['brief', 'inquiry'],
      writeScope: ['documents'],
    })
  })

  it('只有基础需求、没有前置补充问询时不放行 document.core', () => {
    const missingInquiry = state((draft) => {
      draft.requirementContract = {
        schemaVersion: 1,
        rawIntent: '武松打虎',
        dimensions: {},
        locale: 'zh-CN',
        collectedAt: new Date().toISOString(),
      }
      complete(draft, 'brief.collecting')
      draft.activity = 'document.core'
      draft.activeGroup = { id: 'design', activities: ['document.core'], status: 'not-started', revision: 1 }
    })

    const result = preflightActivity(missingInquiry, inventory(), 'document.core')

    expect(result.ready).toBe(false)
    expect(result.gaps).toContainEqual({
      kind: 'required-input',
      detail: '缺少前置产物：inquiry',
      resolveWith: 'document.inquiry',
    })
  })

  it('支柱门未过时不放行总脉络，缺口归给作者', () => {
    const ready = state((draft) => {
      draft.activity = 'blueprint.outline'
      draft.activeGroup = { id: 'outline', activities: ['blueprint.outline'], status: 'not-started', revision: 1 }
      complete(draft, 'document.core')
      complete(draft, 'document.pillar')
    })

    const result = preflightActivity(ready, inventory({ documents: { pillar: 1, core: 1 } }), 'blueprint.outline')

    expect(result.ready).toBe(false)
    expect(result.gaps).toContainEqual({
      kind: 'author-gate',
      detail: '作者门 pillar 尚未通过',
      resolveWith: 'author',
    })
  })

  it('当前组未全绿时不放行下一组的活动', () => {
    const mid = state((draft) => {
      draft.activity = 'rules.catalog'
      draft.activeGroup = {
        id: 'modeling',
        activities: ['rules.catalog'],
        status: 'working',
        revision: 1,
      }
      complete(draft, 'blueprint.outline')
    })

    const result = preflightActivity(mid, inventory({ characterCount: 2, sceneCount: 1, blueprintNodeCount: 3 }), 'rules.binding')

    expect(result.ready).toBe(false)
    expect(result.gaps.map((gap) => gap.kind)).toContain('group')
  })

  it('主规则线和两条资产线互不阻塞，都能通过预检', () => {
    const modeling = state((draft) => {
      draft.activity = 'rules.catalog'
      draft.activeGroup = {
        id: 'modeling',
        activities: ['rules.catalog'],
        status: 'working',
        revision: 1,
      }
      draft.assetPipeline.activeActivities = ['characters.modeling', 'scenes.modeling']
      complete(draft, 'blueprint.outline')
    })
    const lines: VideoGameActivity[] = ['characters.modeling', 'scenes.modeling', 'rules.catalog']

    for (const line of lines) {
      const result = preflightActivity(modeling, inventory({ blueprintNodeCount: 3 }), line)
      expect(result.ready, `${line}: ${JSON.stringify(result.gaps)}`).toBe(true)
    }
  })

  it('主代表游标陈旧时从已完成总脉络恢复规则预检', () => {
    const stale = state((draft) => {
      draft.productPhase = 'feature-development'
      draft.activity = 'characters.modeling'
      draft.activeGroup = {
        id: 'brief',
        activities: ['brief.collecting'],
        status: 'not-started',
        revision: 1,
      }
      draft.assetPipeline.activeActivities = ['characters.modeling']
      complete(draft, 'blueprint.outline')
    })

    const result = preflightActivity(
      stale,
      inventory({ blueprintNodeCount: 3 }),
      'rules.catalog',
    )

    expect(result.ready, JSON.stringify(result.gaps)).toBe(true)
  })

  it('恢复出的主游标不会让未来活动跳过规则目录', () => {
    const stale = state((draft) => {
      draft.productPhase = 'feature-development'
      draft.activity = 'characters.modeling'
      draft.activeGroup = {
        id: 'brief',
        activities: ['brief.collecting'],
        status: 'not-started',
        revision: 1,
      }
      complete(draft, 'blueprint.outline')
      complete(draft, 'ui.authoring')
    })

    const result = preflightActivity(
      stale,
      inventory({ blueprintNodeCount: 3, uiCount: 1 }),
      'rules.binding',
    )

    expect(result.ready).toBe(false)
    expect(result.gaps.map((gap) => gap.kind)).toContain('group')
  })

  it('已完成的活动要走显式 rework，不允许悄悄重派', () => {
    const done = state((draft) => {
      draft.activity = 'rules.catalog'
      draft.activeGroup = {
        id: 'modeling',
        activities: ['rules.catalog'],
        status: 'working',
        revision: 1,
      }
      complete(draft, 'blueprint.outline')
      complete(draft, 'characters.modeling')
    })

    const result = preflightActivity(done, inventory({ blueprintNodeCount: 3, characterCount: 2 }), 'characters.modeling')

    expect(result.ready).toBe(false)
    expect(result.gaps.map((gap) => gap.kind)).toContain('group')
  })

  it('不再有 intake 文件门：需求契约就是 brief 的唯一凭据', () => {
    const withDocumentButNoContract = state((draft) => {
      draft.activity = 'document.core'
      draft.activeGroup = { id: 'design', activities: ['document.core'], status: 'not-started', revision: 1 }
    })

    // 就算内容平面还留着旧的 intake 文档，也不能当作 brief 已就绪。
    const result = preflightActivity(
      withDocumentButNoContract,
      inventory({ documents: { intake: 1 } }),
      'document.core',
    )

    expect(result.ready).toBe(false)
  })
})

describe('asset activity preflight', () => {
  function outlined(): VideoGameWorkflowState {
    return state((draft) => {
      complete(draft, 'blueprint.outline')
      draft.productPhase = 'feature-development'
      draft.phaseStatus = 'working'
      draft.activity = 'rules.catalog'
      draft.activeGroup = {
        id: 'modeling',
        activities: ['rules.catalog'],
        status: 'not-started',
        revision: 2,
      }
    })
  }

  it.each(['characters.modeling', 'scenes.modeling'] as const)(
    'allows %s after outline without requiring its old main group',
    (activity) => {
      const result = preflightActivity(
        outlined(),
        inventory({ blueprintNodeCount: 3 }),
        activity,
      )

      expect(result.ready, JSON.stringify(result.gaps)).toBe(true)
      expect(result.dispatch?.activity).toBe(activity)
    },
  )

  it('requires rules for character modeling only when entity binding is requested', () => {
    const pureVisual = preflightActivity(
      outlined(),
      inventory({ blueprintNodeCount: 3 }),
      'characters.modeling',
      { entityIdBindingRequested: false },
    )
    const entityBound = preflightActivity(
      outlined(),
      inventory({ blueprintNodeCount: 3 }),
      'characters.modeling',
      { entityIdBindingRequested: true },
    )

    expect(pureVisual.ready).toBe(true)
    expect(entityBound.ready).toBe(false)
    expect(entityBound.gaps).toContainEqual({
      kind: 'required-input',
      detail: '缺少前置产物：rules',
      resolveWith: 'rules.catalog',
    })
  })

  it('allows preset binding immediately after outline without waiting for finalization or asset outputs', () => {
    const waiting = outlined()

    const ready = preflightActivity(
      waiting,
      inventory({ blueprintNodeCount: 3 }),
      'video.presets.binding',
    )

    expect(ready.ready, JSON.stringify(ready.gaps)).toBe(true)
  })

  it('allows preset validation after binding without waiting for playtest', () => {
    const ready = outlined()
    complete(ready, 'video.presets.binding')

    const result = preflightActivity(
      ready,
      inventory({ blueprintNodeCount: 3 }),
      'video.presets.validating',
    )

    expect(ready.activities['playtest.validating']).toBeUndefined()
    expect(result.ready, JSON.stringify(result.gaps)).toBe(true)
  })
})
