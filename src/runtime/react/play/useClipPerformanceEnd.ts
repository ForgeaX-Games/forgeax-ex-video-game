/**
 * 同一 clip 只触发一次 performanceEnd；穿链后挡住旧 video 的残余结束事件。
 * 闸门算法见 `clipPerformanceEndGate.ts`。
 */
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { GraphSession, SessionSnapshot } from '@/runtime/core/engine/session'
import { ClipPerformanceEndGate } from './clipPerformanceEndGate'

export function useClipPerformanceEnd(
  sessionRef: RefObject<GraphSession | null>,
  setSnap: Dispatch<SetStateAction<SessionSnapshot | null>> | Dispatch<SetStateAction<SessionSnapshot>>,
  clipSeq: number,
  /** session 重建（重开）时清闸；新 session 的序号会从头开始。 */
  resetKey?: unknown,
): () => void {
  const gateRef = useRef(new ClipPerformanceEndGate())
  useEffect(() => {
    gateRef.current.reset()
  }, [clipSeq, resetKey])

  return useCallback(() => {
    const session = sessionRef.current
    if (!session) return
    if (!gateRef.current.tryBegin(session.runtime.state.currentNodeId)) return
    setSnap(session.performanceEnd())
  }, [sessionRef, setSnap])
}
