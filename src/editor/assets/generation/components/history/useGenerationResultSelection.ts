import { useCallback, useEffect, useState } from 'react'

export interface GenerationResultSelectionOptions {
  initialSelectedAssetId?: string
  appliedAssetId?: string
  resetKey?: string | number
  onApplyResult?: (assetId: string) => Promise<void>
}

/** Shared preview selection and explicit Apply state for image/video history. */
export function useGenerationResultSelection({
  initialSelectedAssetId,
  appliedAssetId,
  resetKey,
  onApplyResult,
}: GenerationResultSelectionOptions) {
  const [selectedAssetId, setSelectedAssetId] = useState<string | undefined>(initialSelectedAssetId)
  const [locallyAppliedAssetId, setLocallyAppliedAssetId] = useState<string>()
  const [applyingAssetId, setApplyingAssetId] = useState<string>()
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedAssetId(initialSelectedAssetId)
    setLocallyAppliedAssetId(undefined)
    setApplyingAssetId(undefined)
    setApplyError(null)
  }, [initialSelectedAssetId, resetKey])

  useEffect(() => {
    setLocallyAppliedAssetId(undefined)
  }, [appliedAssetId])

  const effectiveAppliedAssetId = locallyAppliedAssetId ?? appliedAssetId
  const selectAsset = useCallback((assetId: string | undefined): void => {
    setSelectedAssetId(assetId)
    setApplyError(null)
  }, [])
  const clearSelection = useCallback((): void => selectAsset(undefined), [selectAsset])
  const canApply = useCallback((assetId: string | undefined): boolean => Boolean(
    assetId && onApplyResult && assetId !== effectiveAppliedAssetId,
  ), [effectiveAppliedAssetId, onApplyResult])
  const apply = useCallback((assetId: string): void => {
    if (!onApplyResult || !canApply(assetId) || applyingAssetId) return
    setApplyError(null)
    setApplyingAssetId(assetId)
    void onApplyResult(assetId).then(() => {
      setLocallyAppliedAssetId(assetId)
    }, (error: unknown) => {
      setApplyError(error instanceof Error ? error.message : String(error))
    }).finally(() => setApplyingAssetId(undefined))
  }, [applyingAssetId, canApply, onApplyResult])

  return {
    selectedAssetId,
    selectAsset,
    clearSelection,
    effectiveAppliedAssetId,
    applyingAssetId,
    applyError,
    canApply,
    apply,
  }
}
