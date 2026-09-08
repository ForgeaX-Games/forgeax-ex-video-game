import { useMemo } from 'react'
import {
  useOptionalGenerationInteraction,
} from './GenerationInteractionProvider'
import {
  canPerformGenerationAction,
  type GenerationInteractionAction,
  type GenerationInteractionState,
} from './types'

export const DEFAULT_GENERATION_INTERACTION: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

export interface GenerationInteractionProps {
  /** Explicit state makes each atom usable without a provider. */
  interaction?: Partial<GenerationInteractionState>
}

export interface ResolvedGenerationInteraction {
  state: GenerationInteractionState
  can: (action: GenerationInteractionAction) => boolean
}

export function useResolvedGenerationInteraction(
  explicit?: Partial<GenerationInteractionState>,
): ResolvedGenerationInteraction {
  const context = useOptionalGenerationInteraction()
  return useMemo(() => {
    const state: GenerationInteractionState = {
      ...(context?.state ?? DEFAULT_GENERATION_INTERACTION),
      ...explicit,
    }
    return {
      state,
      can: (action: GenerationInteractionAction) => canPerformGenerationAction(state, action),
    }
  }, [context?.state, explicit])
}

