/**
 * subProcess —— 私有内嵌子流程容器：进入即切到容器持有的图与入口；
 * 由子流程弹回时不重播、直接沿 out 续走。返回(pop)由引擎调度层处理。
 */
import { getSubProcess } from '../schema/graph-schema'
import type { NodeKind, NodeRuntimeCtx, NextIntent } from './node-kind'

export const subflowNodeKind: NodeKind = {
  type: 'subProcess',
  execute(ctx: NodeRuntimeCtx): NextIntent {
    if (ctx.returning) {
      ctx.beginResume()
      return { kind: 'advance' }
    }
    const process = getSubProcess(ctx.node.data)
    return process
      ? { kind: 'descend', entry: process.entry, graph: process.graph }
      : { kind: 'advance' }
  },
}
