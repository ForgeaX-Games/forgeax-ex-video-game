import { describe, expect, it } from 'vitest'
import { mergePillarContracts, missingBeatIds } from '../pillar-merge'
import type { PillarInteractionContract } from '../pillar-interaction-contract'

function beat(id: string): PillarInteractionContract['beats'][number] {
  return {
    id,
    narrativeIntent: `${id} 推进`,
    playerInformation: [`${id} 推进`],
    uiCapabilities: ['player-choice'],
    actions: [{
      id: `${id}-act`,
      intent: '继续',
      stateMutationOwner: 'none',
      requiredRole: 'player-choice',
      stateChange: '继续',
      immediateFeedback: '继续',
      downstreamPayoff: '继续',
      exitIntent: '继续',
    }],
    settlements: [],
  }
}

describe('mergePillarContracts', () => {
  it('replaces beats with the same id and keeps beats the patch omitted', () => {
    const base: PillarInteractionContract = {
      schemaVersion: 4,
      cast: [{ name: '诸葛亮' }],
      beats: [beat('B01'), beat('B02')],
    }
    const merged = mergePillarContracts(base, {
      schemaVersion: 4,
      beats: [{
        ...beat('B02'),
        narrativeIntent: '夜观天象',
        playerInformation: ['夜观天象'],
      }],
    })
    expect(merged.cast).toEqual([{ name: '诸葛亮' }])
    expect(merged.beats.map((entry) => entry.id)).toEqual(['B01', 'B02'])
    expect(merged.beats[1]?.narrativeIntent).toBe('夜观天象')
  })

  it('orders appended beats by skeleton id so later branches stay reachable', () => {
    const merged = mergePillarContracts(
      { schemaVersion: 4, beats: [beat('B01'), beat('B03'), beat('B04')] },
      { schemaVersion: 4, beats: [beat('B02')] },
    )
    expect(merged.beats.map((entry) => entry.id)).toEqual(['B01', 'B02', 'B03', 'B04'])
  })

  it('keeps header tables when a later beat patch sends empty arrays', () => {
    const merged = mergePillarContracts(
      {
        schemaVersion: 4,
        cast: [{ name: '诸葛亮', summary: '羽扇纶巾从容调度' }],
        endings: [{ id: 'ending-main', title: '雾满载归', summary: '满载十万箭回营' }],
        beats: [beat('B01')],
      },
      { schemaVersion: 4, cast: [], endings: [], beats: [beat('B10')] },
    )
    expect(merged.cast).toEqual([{ name: '诸葛亮', summary: '羽扇纶巾从容调度' }])
    expect(merged.endings).toEqual([{ id: 'ending-main', title: '雾满载归', summary: '满载十万箭回营' }])
    expect(merged.beats.map((entry) => entry.id)).toEqual(['B01', 'B10'])
  })

  it('reports skeleton beats that have not been written yet', () => {
    const missing = missingBeatIds(
      { beats: [beat('B01'), beat('B02')] },
      ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10'],
    )
    expect(missing).toContain('B08')
    expect(missing).toContain('B10')
    expect(missing).not.toContain('B01')
  })
})
