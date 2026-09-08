import { createContext, useCallback, useContext, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import {
  canPerformGenerationAction,
  type GenerationInteractionAction,
  type GenerationInteractionState,
} from './types'

export interface GenerationInteractionActions {
  setDisabled: (disabled: boolean) => void
  setReadOnly: (readOnly: boolean) => void
  setBusy: (busy: boolean) => void
  reset: () => void
}

export interface GenerationInteractionMeta {
  canInteract: boolean
  canMutate: boolean
  canCancel: boolean
  can: (action: GenerationInteractionAction) => boolean
}

/** Provider value deliberately follows the state/actions/meta contract. */
export interface GenerationInteractionContextValue {
  state: GenerationInteractionState
  actions: GenerationInteractionActions
  meta: GenerationInteractionMeta
}

export interface GenerationInteractionProviderProps {
  initialState?: Partial<GenerationInteractionState>
}

const DEFAULT_INTERACTION_STATE: GenerationInteractionState = {
  disabled: false,
  readOnly: false,
  busy: false,
}

const GenerationInteractionContext = createContext<GenerationInteractionContextValue | null>(null)

export function GenerationInteractionProvider({
  children,
  initialState,
}: PropsWithChildren<GenerationInteractionProviderProps>): React.JSX.Element {
  const initialStateRef = useRef<GenerationInteractionState>({
    ...DEFAULT_INTERACTION_STATE,
    ...initialState,
  })
  const [state, setState] = useState<GenerationInteractionState>(initialStateRef.current)

  const setDisabled = useCallback((disabled: boolean) => {
    setState((current) => ({ ...current, disabled }))
  }, [])

  const setReadOnly = useCallback((readOnly: boolean) => {
    setState((current) => ({ ...current, readOnly }))
  }, [])

  const setBusy = useCallback((busy: boolean) => {
    setState((current) => ({ ...current, busy }))
  }, [])

  const reset = useCallback(() => {
    setState(initialStateRef.current)
  }, [])

  const can = useCallback((action: GenerationInteractionAction) => (
    canPerformGenerationAction(state, action)
  ), [state])

  const value = useMemo<GenerationInteractionContextValue>(() => ({
    state,
    actions: { setDisabled, setReadOnly, setBusy, reset },
    meta: {
      canInteract: !state.disabled,
      canMutate: can('generate'),
      canCancel: can('cancel'),
      can,
    },
  }), [can, reset, setBusy, setDisabled, setReadOnly, state])

  return (
    <GenerationInteractionContext.Provider value={value}>
      {children}
    </GenerationInteractionContext.Provider>
  )
}

export function useGenerationInteraction(): GenerationInteractionContextValue {
  const context = useContext(GenerationInteractionContext)
  if (!context) {
    throw new Error('useGenerationInteraction must be used within GenerationInteractionProvider')
  }
  return context
}

/**
 * Optional counterpart for leaf atoms that can be mounted on their own.
 *
 * The strict hook above remains the right choice for surfaces that require a
 * provider.  Generation atoms use this hook so a caller can either compose
 * them under the provider or pass an explicit interaction state in tests and
 * small host surfaces.
 */
export function useOptionalGenerationInteraction(): GenerationInteractionContextValue | null {
  return useContext(GenerationInteractionContext)
}
