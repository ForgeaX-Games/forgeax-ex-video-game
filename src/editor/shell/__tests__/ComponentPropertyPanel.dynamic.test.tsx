// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshGameComponents } from '@/runtime/react/component-host'
import {
  registerComponent,
  unregisterComponent,
} from '@/runtime/core/registry/component-registry'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { ComponentPropertyPanel } from '../ComponentPropertyPanel'

const COMPONENT_ID = 'project.dynamic-properties'
const moduleUrl = vi.fn(() => [
  'data:text/javascript,',
  'export default [{',
  '  component: function DynamicProperties() { return null },',
  `  manifest: { id: "${COMPONENT_ID}", label: "动态属性控件", inputs: [`,
  '    { key: "label", label: "原字段", valueType: "string" },',
  '    { key: "tone", label: "Agent 新增字段", valueType: "string" },',
  '    { key: "accent", label: "强调色", valueType: "color", default: "rgba(255,145,56,0.8)" }',
  '  ], events: [] },',
  '}]',
].join(''))

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => ({ gameComponents: { moduleUrl } }),
}))

afterEach(() => {
  cleanup()
  unregisterComponent(COMPONENT_ID)
  useGraphScenario.setState({ game: '' })
})

describe('ComponentPropertyPanel dynamic manifest', () => {
  it('shows fields added while the property panel is already open', async () => {
    registerComponent(COMPONENT_ID, {
      label: '动态属性控件',
      inputs: [{ key: 'label', label: '原字段', valueType: 'string' }],
      events: [],
    })
    const game = `game-${crypto.randomUUID()}`
    useGraphScenario.setState({ game })
    const selectedChild = { id: 'dynamic', component: COMPONENT_ID, inputs: {} }
    render(
      <ComponentPropertyPanel
        overlay={{ id: 'screen', children: [selectedChild] }}
        selectedChild={selectedChild}
        entities={{}}
        variables={{}}
        onRemoveChild={vi.fn()}
        onPatchChild={vi.fn()}
        onReactionsChange={vi.fn()}
      />,
    )

    expect(screen.getByText('原字段')).toBeTruthy()
    expect(screen.queryByText('Agent 新增字段')).toBeNull()

    await act(async () => {
      await refreshGameComponents(game)
    })

    expect(screen.getByText('Agent 新增字段')).toBeTruthy()
    expect(screen.getByText('强调色')).toBeTruthy()
    expect(document.querySelector('.gc-cp-trigger')).toBeTruthy()
  })
})
