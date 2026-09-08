import { act, fireEvent, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearErrorReports, getErrorReports } from '@/lib/diagnostics/error-report'
import { RenderErrorBoundary } from '../RenderErrorBoundary'

function Broken({ fail = true }: { fail?: boolean }): JSX.Element {
  if (fail) throw new Error('broken region')
  return <p>recovered content</p>
}

describe('RenderErrorBoundary', () => {
  beforeEach(() => {
    clearErrorReports()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('keeps siblings mounted when a region fails', () => {
    render(
      <>
        <RenderErrorBoundary region="node-preview" variant="panel">
          <Broken />
        </RenderErrorBoundary>
        <p>healthy sibling</p>
      </>,
    )

    expect(screen.getByText('healthy sibling')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(getErrorReports()[0]?.region).toBe('node-preview')
  })

  it('retries only the failed boundary', () => {
    let fail = true
    function ReadsCurrentFailureState(): JSX.Element {
      return <Broken fail={fail} />
    }

    render(
      <RenderErrorBoundary region="graph-canvas" variant="panel">
        <ReadsCurrentFailureState />
      </RenderErrorBoundary>,
    )
    fail = false
    fireEvent.click(screen.getByRole('button', { name: '重试此区域' }))

    expect(screen.getByText('recovered content')).toBeInTheDocument()
  })

  it('resets when a reset key changes', () => {
    const { rerender } = render(
      <RenderErrorBoundary region="active-view" variant="panel" resetKeys={['graph']}>
        <Broken />
      </RenderErrorBoundary>,
    )

    rerender(
      <RenderErrorBoundary region="active-view" variant="panel" resetKeys={['assets']}>
        <Broken fail={false} />
      </RenderErrorBoundary>,
    )

    expect(screen.getByText('recovered content')).toBeInTheDocument()
  })

  it('offers the same copy action as the root fallback in a region fallback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    render(
      <RenderErrorBoundary region="graph-canvas" variant="panel">
        <Broken />
      </RenderErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: '重试此区域' })).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    })

    expect(writeText.mock.calls[0]?.[0]).toContain('Region: graph-canvas')
  })

  it('isolates a failure rendered into a host-owned portal', () => {
    const portalRoot = document.createElement('div')
    document.body.append(portalRoot)

    render(
      <>
        {createPortal(
          <RenderErrorBoundary region="node-preview" variant="panel">
            <Broken />
          </RenderErrorBoundary>,
          portalRoot,
        )}
        <p>inspector remains available</p>
      </>,
    )

    expect(screen.getByText('inspector remains available')).toBeInTheDocument()
    expect(portalRoot.querySelector('[role="alert"]')).not.toBeNull()
    portalRoot.remove()
  })
})
