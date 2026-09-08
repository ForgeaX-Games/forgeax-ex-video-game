/**
 * subflowPack —— 跨图子蓝图容器：进入即压栈 + 切到 pack 自带的图、进其入口（同引擎、共享态，非新实例）；
 * 弹回时不重播、切回原图续走。切图/压栈/弹回由引擎调度层执行，这里只表达 descend 意图。
 */
import type { NodeKind, NodeRuntimeCtx, NextIntent } from './node-kind'

export const subflowPackNodeKind: NodeKind = {
  type: 'subflowPack',
  execute(ctx: NodeRuntimeCtx): NextIntent {
    if (ctx.returning) {
      ctx.beginResume()
      return { kind: 'advance' }
    }
    const pack = ctx.resolvePackEntry(ctx.node)
    return pack ? { kind: 'descend', entry: pack.entry, graph: pack.graph } : { kind: 'advance' }
  },
}
