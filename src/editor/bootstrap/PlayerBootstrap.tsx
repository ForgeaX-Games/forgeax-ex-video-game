import { useCallback, useMemo } from 'react'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { GraphPlayer } from '../shell/GraphPlayer'
import { GameBootstrap } from './GameBootstrap'

/**
 * Standalone player entry. The document only becomes available after the host
 * handshake confirms an initialized package and the store has loaded it.
 */
export function PlayerBootstrap(): JSX.Element {
  const ensureBoot = useGraphScenario((state) => state.ensureBoot)
  const loadEpoch = useGraphScenario((state) => state.loadEpoch)
  const scenarioForPlayer = useGraphScenario((state) => state.scn)
  const scenario = useMemo(() => scenarioForPlayer(), [loadEpoch, scenarioForPlayer])
  const boot = useCallback((gameId: string) => ensureBoot(gameId), [ensureBoot])

  return <GameBootstrap onBoot={boot}><GraphPlayer scenario={scenario} /></GameBootstrap>
}
