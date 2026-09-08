import { act } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const graphAppProps = vi.hoisted(() => [] as unknown[])
const graphAppFailure = vi.hoisted(() => ({ error: null as Error | null }))

vi.mock('../GraphApp', () => ({
  GraphApp: (props: unknown) => {
    graphAppProps.push(props)
    if (graphAppFailure.error) throw graphAppFailure.error
    return <div data-testid="graph-app" />
  },
}))
vi.mock('@/i18n', () => ({
  initLocaleSync: vi.fn(),
  setLocale: vi.fn(),
  t: (key: string) => key,
  tf: (key: string, vars: Record<string, string | number>) => `${key}:${JSON.stringify(vars)}`,
  useT: () => (key: string) => key,
}))
vi.mock('@/editor/styles/global.css', () => ({}))

import { mount } from '../mount'
import { resetHostInitForTests } from '@/lib/forgeax-http'
import { resetHostInjectionForTests } from '@/editor/host-init'
import {
  getErrorReports,
  reportRenderError,
} from '@/lib/diagnostics/error-report'

afterEach(() => {
  graphAppProps.length = 0
  graphAppFailure.error = null
  resetHostInitForTests()
  resetHostInjectionForTests()
  document.body.innerHTML = ''
})

function mountInto(options?: Parameters<typeof mount>[1]) {
  const root = document.createElement('div')
  document.body.append(root)
  let handle!: ReturnType<typeof mount>
  act(() => {
    handle = mount(root, options)
  })
  return handle
}

test('forwards the host pane and slug into GraphApp instead of only the URL', () => {
  const handle = mountInto({ pane: 'center', slug: 'demo-game' })

  expect(graphAppProps[0]).toMatchObject({ pane: 'center', gameId: 'demo-game' })
  act(() => handle.unmount())
})

test('leaves GraphApp on its URL-derived defaults when the host says nothing', () => {
  const handle = mountInto()

  expect(graphAppProps[0]).toMatchObject({ pane: undefined, gameId: undefined })
  act(() => handle.unmount())
})

test('isolates a GraphApp render failure in the in-process mount', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  graphAppFailure.error = new Error('editor render exploded')

  const handle = mountInto({ pane: 'center', slug: 'broken-game' })

  expect(document.body).toHaveTextContent('diagnostics.root.title')
  expect(document.body).toHaveTextContent('editor render exploded')
  expect(document.querySelector('[role="status"]')).not.toBeNull()
  expect(document.body).toHaveTextContent('diagnostics.retryWorkbench')
  expect(document.body).not.toHaveTextContent('diagnostics.reload')
  act(() => handle.unmount())
})

test('captures live editor context before the first descendant render fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const { useGraphScenario } = await import('@/editor/persist/graphScenarioStore')
  const { useGraphView } = await import('@/editor/persist/graphViewStore')
  useGraphScenario.setState({
    game: 'context-game',
    activeBlueprintId: 'boss-blueprint',
    selectedNodeId: 'intro-node',
  })
  useGraphView.setState({ view: 'graph' })
  graphAppFailure.error = new Error('first render failed')

  const handle = mountInto({ slug: 'fallback-game' })

  expect(getErrorReports()[0]?.context).toMatchObject({
    gameId: 'fallback-game',
    view: 'graph',
    blueprintId: 'boss-blueprint',
    selectedNodeId: 'intro-node',
  })
  act(() => handle.unmount())
})

test('clears diagnostics after the final in-process mount unmounts', () => {
  const handle = mountInto()
  act(() => {
    reportRenderError({ error: new Error('stale error'), region: 'test-region' })
  })
  expect(getErrorReports()).toHaveLength(1)

  act(() => handle.unmount())

  expect(getErrorReports()).toHaveLength(0)
})

test('accepts the host locale and updates it without remounting', async () => {
  const { initLocaleSync, setLocale } = await import('@/i18n')
  const handle = mountInto({ locale: 'zh' })

  expect(initLocaleSync).toHaveBeenCalledWith('zh')
  act(() => handle.setLocale('en'))
  expect(setLocale).toHaveBeenCalledWith('en')

  act(() => handle.unmount())
})

test('scopes the in-process stylesheet to its mount root', () => {
  const root = document.createElement('div')
  const inspector = document.createElement('div')
  const preview = document.createElement('div')
  const docActionSlot = document.createElement('div')
  document.body.append(root, inspector, preview, docActionSlot)

  let handle!: ReturnType<typeof mount>
  act(() => {
    handle = mount(root, {
      inspectorEl: inspector,
      previewEl: preview,
      docActionSlotEl: docActionSlot,
    })
  })
  expect(root).toHaveClass('ks-app-host')
  expect(inspector).toHaveClass('ks-app-host')
  expect(preview).toHaveClass('ks-app-host')
  expect(docActionSlot).toHaveClass('ks-app-host')
  expect(root).not.toHaveClass('ks-app-host-slot')
  expect(inspector).toHaveClass('ks-app-host-slot')
  expect(preview).toHaveClass('ks-app-host-slot')
  expect(docActionSlot).toHaveClass('ks-app-host-slot')

  act(() => handle.unmount())
  expect(root).not.toHaveClass('ks-app-host')
  expect(inspector).not.toHaveClass('ks-app-host')
  expect(preview).not.toHaveClass('ks-app-host')
  expect(docActionSlot).not.toHaveClass('ks-app-host')
  expect(inspector).not.toHaveClass('ks-app-host-slot')
  expect(preview).not.toHaveClass('ks-app-host-slot')
  expect(docActionSlot).not.toHaveClass('ks-app-host-slot')
})

test('stores inspectorEl and onNodeSelect for the GraphStudio external panel', async () => {
  const { getInspectorMountOptions } = await import('@/editor/host-init')
  const inspectorEl = document.createElement('div')
  document.body.append(inspectorEl)
  const onNodeSelect = vi.fn()

  const handle = mountInto({ inspectorEl, onNodeSelect })

  expect(getInspectorMountOptions()).toEqual({
    inspectorEl,
    onNodeSelect,
    previewEl: undefined,
    onPreviewOpenChange: undefined,
    onInspectorTabChange: undefined,
  })
  act(() => handle.unmount())
  expect(getInspectorMountOptions()).toEqual({
    inspectorEl: undefined,
    previewEl: undefined,
    onNodeSelect: undefined,
    onPreviewOpenChange: undefined,
    onInspectorTabChange: undefined,
  })
})

test('stores previewEl and clears both host slots on unmount', async () => {
  const { getInspectorMountOptions } = await import('@/editor/host-init')
  const inspectorEl = document.createElement('div')
  const previewEl = document.createElement('div')
  previewEl.append(document.createElement('span'))
  document.body.append(inspectorEl, previewEl)
  const onPreviewOpenChange = vi.fn()

  const handle = mountInto({ inspectorEl, previewEl, onPreviewOpenChange })

  expect(getInspectorMountOptions()).toMatchObject({ previewEl, onPreviewOpenChange })
  act(() => handle.unmount())
  expect(previewEl.childNodes.length).toBe(0)
  expect(getInspectorMountOptions().previewEl).toBeUndefined()
})

test('openDocument exposes author docs, hides internal docs, and preserves the design-options gate', async () => {
  const { useDocumentNav } = await import('@/editor/persist/documentNavStore')
  const { useGraphView } = await import('@/editor/persist/graphViewStore')
  useDocumentNav.setState({ documentType: 'intake' })
  useGraphView.setState({ view: 'graph' })

  const handle = mountInto({})
  act(() => handle.openDocument('pillar'))
  expect(useDocumentNav.getState().documentType).toBe('pillar')
  expect(useGraphView.getState().view).toBe('documents')

  act(() => handle.openDocument('intake'))
  expect(useDocumentNav.getState().documentType).toBe('core')
  act(() => handle.openDocument('inquiry'))
  expect(useDocumentNav.getState().documentType).toBe('core')

  act(() => handle.openDocument('design-options'))
  expect(useDocumentNav.getState().documentType).toBe('design-options')
  act(() => handle.unmount())
})

test('setTopView drives the shared view store and reports back through subscribeTopView', async () => {
  const { useGraphView } = await import('@/editor/persist/graphViewStore')
  useGraphView.setState({ view: 'documents', lastEditView: 'documents' })
  const seen: string[] = []

  const handle = mountInto({})
  const unsubscribe = handle.subscribeTopView((view) => seen.push(view))

  expect(handle.getTopView()).toBe('workfile')
  act(() => handle.setTopView('play'))
  expect(useGraphView.getState().view).toBe('play')
  expect(handle.getTopView()).toBe('play')

  // 「工作文件」回到进试玩前的那个编辑视图，而不是默认蓝图。
  act(() => handle.setTopView('workfile'))
  expect(useGraphView.getState().view).toBe('documents')

  expect(seen).toEqual(['play', 'workfile'])
  unsubscribe()
  act(() => handle.unmount())
})

test('subscribeTopView ignores view changes that stay inside 工作文件', async () => {
  const { useGraphView } = await import('@/editor/persist/graphViewStore')
  useGraphView.setState({ view: 'graph', lastEditView: 'graph' })
  const seen: string[] = []

  const handle = mountInto({})
  const unsubscribe = handle.subscribeTopView((view) => seen.push(view))

  act(() => useGraphView.getState().setView('rule'))
  act(() => useGraphView.getState().setView('assets'))

  expect(seen).toEqual([])
  unsubscribe()
  act(() => handle.unmount())
})

test('stores docActionSlotEl and clears it on unmount', async () => {
  const { getDocumentMountOptions } = await import('@/editor/host-init')
  const docActionSlotEl = document.createElement('div')
  docActionSlotEl.textContent = 'HOST_BAR'
  document.body.append(docActionSlotEl)

  const handle = mountInto({ docActionSlotEl })

  expect(getDocumentMountOptions()).toEqual({ docActionSlotEl })
  act(() => handle.unmount())
  expect(docActionSlotEl.childNodes.length).toBe(0)
  expect(getDocumentMountOptions()).toEqual({ docActionSlotEl: undefined })
})

test('exposes a live design-options gate setter for the host author flow', async () => {
  const { getDesignOptionsGate } = await import('@/editor/documents/design-options-gate')
  const handle = mountInto()
  const onApplied = vi.fn()
  act(() => handle.setDesignOptionsGate({ onApplied }))
  expect(getDesignOptionsGate()?.onApplied).toBe(onApplied)
  act(() => handle.unmount())
  expect(getDesignOptionsGate()).toBeNull()
})
