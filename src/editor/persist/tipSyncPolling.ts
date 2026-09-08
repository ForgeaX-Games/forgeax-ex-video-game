import { useGraphScenario } from './graphScenarioStore'

const DEFAULT_INTERVAL_MS = 1500

export type TipSyncPollingOptions = {
  intervalMs?: number
  sync?: () => Promise<unknown>
  isVisible?: () => boolean
}

let refCount = 0
let timer: ReturnType<typeof setInterval> | null = null
let inTick = false

export function installTipSyncPolling(options: TipSyncPollingOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const sync = options.sync ?? (() => useGraphScenario.getState().syncTipIfClean())
  const isVisible =
    options.isVisible
    ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible')

  refCount += 1
  if (refCount === 1) {
    timer = setInterval(() => {
      if (inTick || !isVisible()) return
      inTick = true
      void Promise.resolve(sync()).finally(() => {
        inTick = false
      })
    }, intervalMs)
  }

  return () => {
    refCount = Math.max(0, refCount - 1)
    if (refCount === 0 && timer) {
      clearInterval(timer)
      timer = null
      inTick = false
    }
  }
}

export function resetTipSyncPollingForTests(): void {
  if (timer) clearInterval(timer)
  timer = null
  refCount = 0
  inTick = false
}
