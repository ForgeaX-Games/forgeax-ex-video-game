/**
 * 顶栏两档视图（工作文件 / 试玩）的回位语义：宿主 ProjectBar 上的切换器与侧栏
 * 「试玩」共用这一份 view，所以「工作文件」必须回到进试玩前的那个编辑视图，
 * 而不是硬编码回蓝图。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { topViewOf, useGraphView } from '../graphViewStore'

beforeEach(() => {
  useGraphView.setState({ view: 'graph', lastEditView: 'graph' })
})

describe('topViewOf', () => {
  it('只把 play 归为试玩，其余视图都算工作文件', () => {
    expect(topViewOf('play')).toBe('play')
    expect(topViewOf('graph')).toBe('workfile')
    expect(topViewOf('documents')).toBe('workfile')
    expect(topViewOf('video-generate')).toBe('workfile')
    expect(topViewOf('image-generate')).toBe('workfile')
  })
})

describe('setTopView', () => {
  it('从任意编辑视图进试玩，再回工作文件时回到原视图', () => {
    useGraphView.getState().setView('documents')

    useGraphView.getState().setTopView('play')
    expect(useGraphView.getState().view).toBe('play')

    useGraphView.getState().setTopView('workfile')
    expect(useGraphView.getState().view).toBe('documents')
  })

  it('试玩期间不把 play 记成回位目标', () => {
    useGraphView.getState().setView('rule')
    useGraphView.getState().setView('play')

    expect(useGraphView.getState().lastEditView).toBe('rule')
  })

  it('已经在目标档位时是 no-op（不会把当前编辑视图顶掉）', () => {
    useGraphView.getState().setView('ui')

    useGraphView.getState().setTopView('workfile')

    expect(useGraphView.getState().view).toBe('ui')
  })

  it('侧栏点「试玩」后顶栏档位随之变成 play', () => {
    useGraphView.getState().setView('play')

    expect(topViewOf(useGraphView.getState().view)).toBe('play')
  })
})
