/**
 * 节点运行时层（runtime/nodes）—— 类型派生 + 注册表回退。
 * 锁住「按 GameNode 解析出 NodeKind」的派发规则：data 派生优先、未知 type 回退 perf。
 */
import { describe, expect, test } from 'vitest'
import { createCoreNodeKindRegistry, resolveNodeType } from '../core/nodes'
import type { GameNode } from '../core/schema/graph-schema'
import { node } from './test-fixtures'

const typed = (type: string): GameNode =>
  ({ id: 'n', type, position: { x: 0, y: 0 }, data: { name: 'n' } } as unknown as GameNode)
const subProcess = { entry: 'entry1', graph: { nodes: [node('entry1')], edges: [] } }

describe('resolveNodeType', () => {
  test('普通节点 → perf', () => {
    expect(resolveNodeType(node('n'))).toBe('perf')
  })
  test('data.subProcess → subProcess', () => {
    expect(resolveNodeType(node('n', { subProcess }))).toBe('subProcess')
  })
  test('data.subFlowPack → subflowPack', () => {
    expect(resolveNodeType(node('n', { subFlowPack: { id: 'pack1' } }))).toBe('subflowPack')
  })
  test('subFlowPack 优先于 subProcess', () => {
    expect(resolveNodeType(node('n', { subProcess, subFlowPack: { id: 'p' } }))).toBe('subflowPack')
  })
  test('未注册的 node.type 原样返回（由注册表兜底）', () => {
    expect(resolveNodeType(typed('mystery'))).toBe('mystery')
  })
})

describe('NodeKindRegistry', () => {
  const reg = createCoreNodeKindRegistry()
  test('按派生类型解析内置 kind', () => {
    expect(reg.resolve(node('n'))!.type).toBe('perf')
    expect(reg.resolve(node('n', { subProcess }))!.type).toBe('subProcess')
    expect(reg.resolve(node('n', { subFlowPack: { id: 'p' } }))!.type).toBe('subflowPack')
  })
  test('未知 type 回退 perf', () => {
    expect(reg.resolve(typed('mystery'))!.type).toBe('perf')
  })
})
