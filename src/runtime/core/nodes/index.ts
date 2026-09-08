/**
 * 节点类型注册入口 —— 内置 perf / subflow / subflowPack；引擎按 `NodeKindRegistry.resolve(node)` 派发。
 * 新增节点类型：本目录加一个 `<type>.ts` 实现 `NodeKind`，在此登记进 `CORE_NODE_KINDS`。
 */
import { NodeKindRegistry, type NodeKind } from './node-kind'
import { perfNodeKind } from './perf'
import { subflowNodeKind } from './subflow'
import { subflowPackNodeKind } from './subflow-pack'

export * from './node-kind'

export const CORE_NODE_KINDS: NodeKind[] = [perfNodeKind, subflowNodeKind, subflowPackNodeKind]

/** 新建一份已装内置节点类型的注册表（每局引擎持一份）。 */
export function createCoreNodeKindRegistry(): NodeKindRegistry {
  const reg = new NodeKindRegistry()
  for (const k of CORE_NODE_KINDS) reg.register(k)
  return reg
}

/** 进程级共享注册表：供静态校验（validate.ts）判定「node.type 是否已注册」。 */
export const defaultNodeKindRegistry: NodeKindRegistry = createCoreNodeKindRegistry()
