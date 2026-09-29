// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentManifest } from '@/runtime/core/schema/node-config-schema'
import { RuntimeComponentHost, type OverlayRendererRegistration } from '../RuntimeComponentHost'
import type { SkinCtx } from '../rendererRegistry'

afterEach(cleanup)

const manifest: ComponentManifest = {
  id: 'test.hud',
  inputs: [
    { key: 'current', valueType: 'number', component: 'numberExpr' },
    { key: 'max', valueType: 'number', component: 'numberExpr' },
  ],
  events: [],
}

function Leaf(props: Record<string, unknown>): JSX.Element {
  return (
    <span
      data-testid="leaf"
      data-current={String(props.current)}
      data-max={String(props.max)}
    />
  )
}

function EventLeaf(props: Record<string, unknown>): JSX.Element {
  const emit = props.emit as ((key: string, payload?: Record<string, unknown>) => void) | undefined
  return (
    <button type="button" onClick={() => emit?.('select', { count: 2, label: 'double' })}>
      select
    </button>
  )
}

function hud(hp: number): SkinCtx {
  return {
    hud: {
      entities: {
        'ent-boss': {
          hp,
          maxHp: 700,
          attrs: { hp },
          attrMax: { hp: 700 },
          initialAttrs: { hp: 700 },
        },
      },
      vars: {},
      flags: {},
      score: 0,
    },
  }
}

describe('RuntimeComponentHost', () => {
  it('passes flat concrete props to the leaf', () => {
    const registration: OverlayRendererRegistration = {
      component: Leaf,
      manifest,
    }
    const view = render(
      <RuntimeComponentHost
        registration={registration}
        overlay={{
          elementId: 'boss-hp',
          component: 'test.hud',
          inputs: {
            current: { expr: 'entity.ent-boss.attr.hp' },
            max: 700,
          },
        }}
        ctx={hud(350)}
      />,
    )
    expect(view.getByTestId('leaf')).toHaveAttribute('data-current', '350')
    expect(view.getByTestId('leaf')).toHaveAttribute('data-max', '700')
  })

  it('recomputes formula values when hud changes', () => {
    const registration: OverlayRendererRegistration = {
      component: Leaf,
      manifest,
    }
    const overlay = {
      elementId: 'boss-hp',
      component: 'test.hud',
      inputs: { current: { expr: 'entity.ent-boss.attr.hp' }, max: 700 },
    }
    const view = render(
      <RuntimeComponentHost registration={registration} overlay={overlay} ctx={hud(700)} />,
    )
    expect(view.getByTestId('leaf')).toHaveAttribute('data-current', '700')

    view.rerender(
      <RuntimeComponentHost registration={registration} overlay={overlay} ctx={hud(350)} />,
    )
    expect(view.getByTestId('leaf')).toHaveAttribute('data-current', '350')
  })


  it('forwards an event payload from the leaf to the runtime callback', () => {
    const emit = vi.fn()
    const view = render(
      <RuntimeComponentHost
        registration={{ component: EventLeaf, manifest }}
        overlay={{ elementId: 'choice', component: 'test.hud', inputs: {} }}
        emit={emit}
      />,
    )

    fireEvent.click(view.getByRole('button', { name: 'select' }))
    expect(emit).toHaveBeenCalledWith('select', { count: 2, label: 'double' })
  })
})
