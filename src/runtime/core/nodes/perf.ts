/**
 * perf —— 演出节点（默认类型）。
 * enter：换片 → 跑全部 enter 元素（统一 renderOverlay）→ enter 相位 reactions；
 * 瞬时 → advance；有 media/时长/可 emit 组件 → await（等 onEnd 或组件 event）。
 * next：媒体播完/时长到点 → advance（无 default 出边且仅有 event 边时引擎停住等待 emit）。
 */
import type { NodeKind, NodeRuntimeCtx, NextIntent } from './node-kind'

export const perfNodeKind: NodeKind = {
  type: 'perf',
  execute(ctx: NodeRuntimeCtx): NextIntent {
    const { node } = ctx
    ctx.beginPerform()
    for (const el of ctx.childrenOf(node)) {
      if (el.trigger.when !== 'enter' || el.window) continue
      ctx.runElement(el)
      if (ctx.redirected) break
    }
    if (!ctx.redirected) ctx.applyEnterReactions(node)
    if (ctx.redirected) return { kind: 'await' }
    return ctx.isInstant(node) ? { kind: 'advance' } : { kind: 'await' }
  },
  next(): NextIntent {
    return { kind: 'advance' }
  },
}
