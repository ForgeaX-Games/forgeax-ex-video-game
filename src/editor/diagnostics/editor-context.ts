import { useGraphScenario } from '../persist/graphScenarioStore'
import { useGraphView } from '../persist/graphViewStore'
import { registerDiagnosticContext } from '@/lib/diagnostics/error-report'

export function registerEditorDiagnosticContext(fallbackGameId?: string): () => void {
  return registerDiagnosticContext(() => {
    const scenario = useGraphScenario.getState()
    return {
      gameId: scenario.game || fallbackGameId,
      view: useGraphView.getState().view,
      blueprintId: scenario.activeBlueprintId,
      selectedNodeId: scenario.selectedNodeId,
    }
  })
}
