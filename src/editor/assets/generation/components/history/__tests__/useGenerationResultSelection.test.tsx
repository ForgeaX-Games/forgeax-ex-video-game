// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGenerationResultSelection } from '../useGenerationResultSelection'

describe('useGenerationResultSelection', () => {
  it('only exposes Apply for a selected result that is not already applied', async () => {
    const onApplyResult = vi.fn(async () => {})
    const { result } = renderHook(() => useGenerationResultSelection({
      initialSelectedAssetId: 'current',
      appliedAssetId: 'current',
      onApplyResult,
    }))

    expect(result.current.canApply('current')).toBe(false)
    act(() => result.current.selectAsset('history'))
    expect(result.current.selectedAssetId).toBe('history')
    expect(result.current.canApply('history')).toBe(true)

    act(() => result.current.apply('history'))
    await waitFor(() => expect(onApplyResult).toHaveBeenCalledWith('history'))
    await waitFor(() => expect(result.current.canApply('history')).toBe(false))
  })

  it('resets preview selection and local Apply state when the target changes', async () => {
    const onApplyResult = vi.fn(async () => {})
    const { result, rerender } = renderHook(
      ({ resetKey }) => useGenerationResultSelection({
        initialSelectedAssetId: 'current',
        appliedAssetId: 'current',
        resetKey,
        onApplyResult,
      }),
      { initialProps: { resetKey: 'target-1' } },
    )

    act(() => {
      result.current.selectAsset('history')
      result.current.apply('history')
    })
    await waitFor(() => expect(result.current.canApply('history')).toBe(false))

    rerender({ resetKey: 'target-2' })

    await waitFor(() => expect(result.current.selectedAssetId).toBe('current'))
    expect(result.current.canApply('history')).toBe(true)
  })
})
