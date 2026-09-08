import { useEffect, useState } from 'react'
import { subscribeGameComponents } from '@/runtime/react/component-host'
import { useGraphScenario } from '../persist/graphScenarioStore'

/** Rerender editor surfaces when the active game's generated component catalog changes. */
export function useComponentCatalogRevision(): number {
  const [revision, setRevision] = useState(0)
  const game = useGraphScenario((state) => state.game)

  useEffect(() => subscribeGameComponents((changedGame) => {
    if (!game || changedGame === game) setRevision((current) => current + 1)
  }), [game])

  return revision
}
