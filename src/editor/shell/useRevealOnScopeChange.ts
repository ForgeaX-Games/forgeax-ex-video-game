/**
 * 蓝图视图（或试玩执行图）切换时，脉冲一次 revealNodeId，供 GraphCanvas 平移到目标节点。
 * 同 scope 内节点推进不重复触发；脉冲结束后清空，避免长期挡住编辑选中的 reveal。
 */
import { useEffect, useRef, useState } from 'react'

const SET_DELAY_MS = 50
/** 给 GraphCanvas 的 reveal effect（含一次重试）留出时间后清空。 */
const CLEAR_AFTER_MS = 400

export function useRevealOnScopeChange(
  scopeKey: string | null | undefined,
  nodeId: string | null | undefined,
  /** 从空 scope 恢复（如打开浮层）时不脉冲，只在内容变化（下钻/面包屑）时脉冲。 */
  skipOpenPulse = false,
): string | null {
  const [revealId, setRevealId] = useState<string | null>(null)
  const lastScope = useRef<string | null>(null)
  const nodeIdRef = useRef(nodeId)
  nodeIdRef.current = nodeId

  useEffect(() => {
    if (!scopeKey) {
      lastScope.current = null
      setRevealId(null)
      return
    }
    if (lastScope.current === scopeKey) return
    if (skipOpenPulse && lastScope.current === null) {
      // 打开浮层：只记录基准，不平移；下钻/面包屑等内容变化才脉冲。
      lastScope.current = scopeKey
      return
    }
    const id = nodeIdRef.current
    if (!id) return
    lastScope.current = scopeKey
    // 先清空再设：跨图节点 id 撞名时也能再次触发 GraphCanvas 的 reveal effect。
    setRevealId(null)
    const setT = window.setTimeout(() => setRevealId(nodeIdRef.current ?? null), SET_DELAY_MS)
    const clearT = window.setTimeout(() => setRevealId(null), SET_DELAY_MS + CLEAR_AFTER_MS)
    return () => {
      clearTimeout(setT)
      clearTimeout(clearT)
    }
    // 只跟 scope：同图内 currentNodeId 变化不得拆掉正在进行的脉冲计时。
  }, [scopeKey])

  return revealId
}
