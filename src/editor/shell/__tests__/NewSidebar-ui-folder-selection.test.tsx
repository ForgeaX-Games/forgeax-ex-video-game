import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '@/runtime/core/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { useRuleSelection } from '../../persist/ruleSelectionStore'
import { useUiSelection } from '../../persist/uiSelectionStore'
import { GraphConfigView } from '../GraphConfigView'
import { NewSidebar } from '../NewSidebar'

vi.mock('../../assets/useVideoAssets', () => ({
  useVideoAssets: () => ({ items: [] }),
}))

const initialScenario = useGraphScenario.getState()
const emptyGraph: GameGraph = { nodes: [], edges: [] }
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'entry', graph: emptyGraph }

// 三个根级文件夹（基础/自定义/test）各挂一个 scheme，复现用户反馈的多一级目录场景。
beforeEach(() => {
  useGraphView.setState({ view: 'ui' })
  useRuleSelection.setState({ section: 'entities', itemId: null })
  useUiSelection.getState().clearUiSelection()
  useGraphScenario.setState({
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph: emptyGraph,
    meta: {
      ui: {
        overlays: {
          'scheme-a': { id: 'scheme-a', title: '方案A', children: [] },
          'scheme-b': { id: 'scheme-b', title: '方案B', children: [] },
          'scheme-c': { id: 'scheme-c', title: '方案C', children: [] },
        },
      },
      uiTree: {
        root: [
          { kind: 'folder', id: 'ui-folder:basic', name: '基础界面', children: [{ kind: 'scheme', id: 'ui-scheme:scheme-a', overlayId: 'scheme-a' }] },
          { kind: 'folder', id: 'ui-folder:custom', name: '自定义界面', children: [{ kind: 'scheme', id: 'ui-scheme:scheme-b', overlayId: 'scheme-b' }] },
          { kind: 'folder', id: 'ui-folder:test', name: 'test', children: [{ kind: 'scheme', id: 'ui-scheme:scheme-c', overlayId: 'scheme-c' }] },
        ],
      },
    },
  })
})

afterEach(() => {
  cleanup()
  useGraphScenario.setState(initialScenario, true)
  useUiSelection.getState().clearUiSelection()
  useGraphView.setState({ view: 'graph' })
  useRuleSelection.setState({ section: 'entities', itemId: null })
})

// 模拟 GraphMain：按当前 view 渲染对应 GraphConfigView（界面 overlays / 规则 entities·variables·formulas）。
function GraphConfigViewScenario(): JSX.Element {
  const view = useGraphView((state) => state.view)
  const scenario = useGraphScenario.getState().scn()
  if (view === 'ui') {
    return <GraphConfigView title="界面" icon="🖥" tabs={[{ section: 'overlays', label: '自定义界面' }]} scenario={scenario} />
  }
  if (view === 'rule') {
    return (
      <GraphConfigView
        title="规则"
        icon="📏"
        tabs={[
          { section: 'entities', label: '实体' },
          { section: 'variables', label: '变量' },
          { section: 'formulas', label: '公式' },
        ]}
        scenario={scenario}
      />
    )
  }
  return <div data-testid="empty-stage" />
}

describe('NewSidebar interface folder selection', () => {
  it('clears scheme selection without flicker when switching to 规则/公式', () => {
    // 订阅 uiSelection，记录 selectedTreeNodeId 的变化序列。
    // 不变量：切到非 ui 视图时清空界面选中（对齐主树「高亮随 view 变」），且清空过程不闪烁——
    // 不会先回跳到别的 scheme 再变 null。
    const trace: Array<string | null> = []
    let last: string | null = useUiSelection.getState().selectedTreeNodeId
    trace.push(last)
    const unsub = useUiSelection.subscribe((next) => {
      if (next.selectedTreeNodeId !== last) {
        last = next.selectedTreeNodeId
        trace.push(last)
      }
    })

    render(
      <>
        <NewSidebar />
        <GraphConfigViewScenario />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: '展开 界面' }))
    // 展开「基础界面」文件夹（文件夹行点击只展开，不选中），再选中其下方案。
    fireEvent.click(screen.getByRole('button', { name: '基础界面 文件夹' }))
    fireEvent.click(screen.getByRole('button', { name: '选择界面方案 方案A' }))

    // 切到规则 → 公式：每次切走都应清空界面选中。
    fireEvent.click(screen.getByText('规则'))
    fireEvent.click(screen.getByText('公式'))

    unsub()

    // 末态：界面选中被清空。
    expect(useUiSelection.getState().selectedTreeNodeId).toBeNull()
    // 选中方案后到清空之间，不应出现回跳到别的 scheme id（无闪烁）。
    const schemeIndex = trace.indexOf('ui-scheme:scheme-a')
    expect(schemeIndex).toBeGreaterThan(-1)
    expect(trace.slice(schemeIndex + 1)).toEqual([null])
  })
})
