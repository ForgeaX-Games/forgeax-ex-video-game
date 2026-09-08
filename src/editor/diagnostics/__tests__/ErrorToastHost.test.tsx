import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearErrorReports, reportRenderError } from '@/lib/diagnostics/error-report'
import { ErrorToastHost } from '../ErrorToastHost'

describe('ErrorToastHost', () => {
  beforeEach(() => {
    clearErrorReports()
  })

  it('shows a persistent upper-right diagnostic and merges repeats', () => {
    render(<ErrorToastHost />)
    const error = new Error('skin exploded')

    act(() => {
      reportRenderError({ error, region: 'project-component' })
      reportRenderError({ error, region: 'project-component' })
    })

    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('skin exploded')
    expect(toast).toHaveTextContent('2 次')
    expect(toast.closest('aside')).toHaveStyle({ position: 'fixed', right: '16px', top: '16px' })
  })

  it('expands details and dismisses one report', () => {
    render(<ErrorToastHost />)
    act(() => {
      reportRenderError({
        error: Object.assign(new Error('canvas failed'), { stack: 'Error: canvas failed\n at GraphCanvas' }),
        reactStack: '\n at GraphCanvas',
        region: 'graph-canvas',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '展开错误详情' }))
    expect(screen.getByText(/JS stack:/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('copies the AI-ready diagnostic', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<ErrorToastHost />)
    act(() => {
      reportRenderError({ error: new Error('inspector failed'), region: 'node-inspector' })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '复制错误信息' }))
    })

    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText.mock.calls[0]?.[0]).toContain('Please repair this React render failure')
  })
})
