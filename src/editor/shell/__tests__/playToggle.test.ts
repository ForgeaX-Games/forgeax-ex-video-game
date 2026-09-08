import { describe, expect, it } from 'vitest'
import { playToggleShowsPlay, resolvePlayToggleAction } from '../playToggle'

describe('resolvePlayToggleAction', () => {
  it('shows pause while playing', () => {
    expect(resolvePlayToggleAction({ paused: false, ended: false })).toBe('pause')
    expect(playToggleShowsPlay('pause')).toBe(false)
  })

  it('shows play while paused', () => {
    expect(resolvePlayToggleAction({ paused: true, ended: false })).toBe('resume')
    expect(playToggleShowsPlay('resume')).toBe(true)
  })

  it('shows play (restart) when the session has ended, even if not paused', () => {
    expect(resolvePlayToggleAction({ paused: false, ended: true })).toBe('restart')
    expect(resolvePlayToggleAction({ paused: true, ended: true })).toBe('restart')
    expect(playToggleShowsPlay('restart')).toBe(true)
  })
})
