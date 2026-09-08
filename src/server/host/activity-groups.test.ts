import { describe, expect, it } from 'vitest'
import beginActivitySchema from '../../../schemas/begin-activity.args.json'
import { ACTIVITY_CONTRACTS } from '../../workflow/activity-contracts'
import {
  ACTIVITY_GROUPS,
  ASSET_PIPELINE_ACTIVITIES,
  ASSET_PIPELINE_TRACKS,
  MAIN_VIDEO_GAME_ACTIVITIES,
  VIDEO_GAME_ACTIVITIES,
  type ActivityRecord,
  type VideoGameActivity,
} from '../../workflow/contracts'
import {
  activeActivitiesIn,
  aggregateGroupStatus,
  conflictingScopesInGroup,
  groupForActivity,
  isGroupComplete,
  isWriteScopeAllowed,
  nextGroup,
  representativeActivity,
} from './activity-groups'

function records(
  entries: Partial<Record<VideoGameActivity, ActivityRecord['status']>>,
): Partial<Record<VideoGameActivity, ActivityRecord>> {
  return Object.fromEntries(
    Object.entries(entries).map(([activity, status]) => [
      activity,
      { revision: 1, status, artifactRefs: [], evidence: [] } as ActivityRecord,
    ]),
  )
}

const modeling = groupForActivity('rules.catalog')
const integration = groupForActivity('ui.authoring')

describe('activity groups', () => {
  it('publishes explicit main and asset activity classifications', () => {
    expect(MAIN_VIDEO_GAME_ACTIVITIES).toEqual([
      'brief.collecting',
      'document.inquiry',
      'document.core',
      'document.pillar',
      'blueprint.outline',
      'rules.catalog',
      'ui.authoring',
      'rules.binding',
      'game.finalizing',
      'playtest.validating',
    ])
    expect(ASSET_PIPELINE_ACTIVITIES).toEqual([
      'characters.modeling',
      'characters.previewing',
      'scenes.modeling',
      'scenes.previewing',
      'assets.character',
      'assets.scene',
      'video.presets.binding',
      'video.presets.validating',
    ])
    expect(ASSET_PIPELINE_TRACKS).toEqual([
      ['characters.modeling', 'characters.previewing', 'assets.character'],
      ['scenes.modeling', 'scenes.previewing', 'assets.scene'],
      ['video.presets.binding', 'video.presets.validating'],
    ])
  })

  it('assigns only main-lane activities to exactly one group', () => {
    const seen = new Map<string, number>()
    for (const group of ACTIVITY_GROUPS) {
      for (const activity of group.tracks.flat()) {
        seen.set(activity, (seen.get(activity) ?? 0) + 1)
      }
    }
    expect([...seen.values()].every((count) => count === 1)).toBe(true)
    expect([...seen.keys()]).toEqual([
      'brief.collecting',
      'document.inquiry',
      'document.core',
      'document.pillar',
      'blueprint.outline',
      'rules.catalog',
      'ui.authoring',
      'rules.binding',
      'game.finalizing',
      'playtest.validating',
    ])
    for (const activity of [
      'characters.modeling',
      'characters.previewing',
      'scenes.modeling',
      'scenes.previewing',
      'assets.character',
      'assets.scene',
      'video.presets.binding',
      'video.presets.validating',
    ] as VideoGameActivity[]) {
      expect(() => groupForActivity(activity), activity).toThrow(/not assigned/)
    }
  })

  // 防漂移：工具 schema 的枚举、活动契约表、活动枚举三处必须同步。
  // 任何一处漏改都会让 Agent 调用合法活动时被 schema 拒绝——正是「撞墙」的典型来源。
  it('keeps the begin-activity schema enum in sync with the activity registry', () => {
    expect([...beginActivitySchema.properties.activity.enum].sort())
      .toEqual([...VIDEO_GAME_ACTIVITIES].sort())
  })

  it('allows rules.binding to wire existing UI reactions together with graph effects', () => {
    expect(isWriteScopeAllowed('rules.binding', ['graph', 'ui'])).toBe(true)
  })

  it('makes finalizing the full blueprint writer', () => {
    expect(isWriteScopeAllowed('game.finalizing', ['graph', 'ui', 'rules'])).toBe(true)
    const contract = ACTIVITY_CONTRACTS['game.finalizing']
    expect(contract.allowedToolNames).toContain('mcp__as-mate-tools__extension__game_video__patch_rules')
    expect(contract.domainGuide).not.toContain('不得在本活动新增或修改界面结构')
  })

  it('declares a contract for every activity', () => {
    expect(Object.keys(ACTIVITY_CONTRACTS).sort()).toEqual([...VIDEO_GAME_ACTIVITIES].sort())
  })

  it('keeps write scopes disjoint across tracks of the same group', () => {
    for (const group of ACTIVITY_GROUPS) {
      expect(conflictingScopesInGroup(group), `group ${group.id}`).toEqual([])
    }
  })

  it('opens rules catalog without putting asset activities in the main group', () => {
    expect(modeling.id).toBe('modeling')
    expect(activeActivitiesIn(modeling, records({}))).toEqual(['rules.catalog'])
  })

  it('advances the integration track only after the previous main activity settles', () => {
    const active = activeActivitiesIn(
      integration,
      records({ 'ui.authoring': 'complete' }),
    )
    expect(active).toEqual(['rules.binding'])
  })

  it('treats not-required as settled', () => {
    const group = groupForActivity('ui.authoring')
    expect(isGroupComplete(group, records({
      'ui.authoring': 'not-required',
      'rules.binding': 'complete',
      'game.finalizing': 'complete',
    }))).toBe(true)
  })

  it('reports a main group complete only when its main track finished', () => {
    const partial = records({
      'ui.authoring': 'complete',
      'rules.binding': 'complete',
    })
    expect(isGroupComplete(integration, partial)).toBe(false)
    expect(isGroupComplete(integration, { ...partial, ...records({ 'game.finalizing': 'complete' }) })).toBe(true)
  })

  it('marks the main group blocked only for a blocked main activity', () => {
    const status = aggregateGroupStatus(
      integration,
      records({
        'characters.modeling': 'blocked',
        'ui.authoring': 'working',
      }),
    )
    expect(status).toBe('working')
  })

  it('picks a stable representative activity for legacy single-activity readers', () => {
    expect(representativeActivity(integration, records({}))).toBe('ui.authoring')
    expect(
      representativeActivity(integration, records({ 'ui.authoring': 'complete' })),
    ).toBe('rules.binding')
  })

  it('uses six main groups and reaches delivery without an asset group', () => {
    expect(ACTIVITY_GROUPS).toHaveLength(6)
    expect(nextGroup('outline')?.id).toBe('modeling')
    expect(nextGroup('modeling')?.id).toBe('integration')
    expect(nextGroup('integration')?.id).toBe('delivery')
    expect(nextGroup('delivery')).toBeUndefined()
  })

  it('rejects writes outside the activity write scope', () => {
    expect(isWriteScopeAllowed('characters.modeling', ['characters'])).toBe(true)
    // 角色线不得碰场景目录，也不得碰节点与边。
    expect(isWriteScopeAllowed('characters.modeling', ['scenes'])).toBe(false)
    expect(isWriteScopeAllowed('characters.modeling', ['graph'])).toBe(false)
    expect(isWriteScopeAllowed('rules.catalog', ['graph'])).toBe(false)
    // 总脉络与总负责人才能写节点与边。
    expect(isWriteScopeAllowed('blueprint.outline', ['graph'])).toBe(true)
    expect(isWriteScopeAllowed('game.finalizing', ['graph', 'ui', 'rules'])).toBe(true)
  })
})
