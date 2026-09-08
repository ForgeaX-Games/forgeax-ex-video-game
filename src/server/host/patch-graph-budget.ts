export interface PatchGraphBudget {
  readonly maxRequestBytes: number
  readonly maxOps: number
  readonly maxNodesTouched: number
  readonly maxEdgesTouched: number
  readonly maxDiffBytes: number
}

export interface PatchGraphBudgetUsage {
  readonly requestBytes: number
  readonly ops: number
  readonly nodesTouched: number
  readonly edgesTouched: number
  readonly diffBytes: number
}

export const FINALIZATION_PATCH_GRAPH_BUDGET: PatchGraphBudget = {
  maxRequestBytes: 65_536,
  maxOps: 3,
  maxNodesTouched: 3,
  maxEdgesTouched: 8,
  maxDiffBytes: 100_000,
}

interface PatchGraphBudgetSuccess {
  readonly ok: true
  readonly usage: PatchGraphBudgetUsage
  readonly budget: PatchGraphBudget
}

interface PatchGraphBudgetFailure {
  readonly ok: false
  readonly errorCode: 'patch.budget.exceeded'
  readonly failedDimension: keyof PatchGraphBudgetUsage
  readonly failedOpIndex?: number
  readonly usage: PatchGraphBudgetUsage
  readonly budget: PatchGraphBudget
}

export type PatchGraphBudgetResult = PatchGraphBudgetSuccess | PatchGraphBudgetFailure

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

function collectTouchedIds(
  ops: readonly Record<string, unknown>[],
): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  for (const op of ops) {
    const nodeId = stringField(op, 'nodeId')
      ?? stringField(op, 'afterId')
      ?? stringField(op.node, 'id')
    if (nodeId) nodes.add(nodeId)

    const edgeId = stringField(op, 'edgeId') ?? stringField(op.edge, 'id')
    if (edgeId) edges.add(edgeId)
    const operation = stringField(op, 'op') ?? ''
    if (operation === 'connect' || operation === 'disconnect') {
      const source = stringField(op, 'source')
      const target = stringField(op, 'target')
      if (source && target) edges.add(`${source}->${target}`)
    }
  }
  return { nodes, edges }
}

export function assessPatchGraphBudget(
  input: { blueprintId?: unknown; ops: readonly Record<string, unknown>[] },
  budget: PatchGraphBudget = FINALIZATION_PATCH_GRAPH_BUDGET,
): PatchGraphBudgetResult {
  const requestBytes = byteLength(input)
  const diffBytes = byteLength(input.ops)
  const touched = collectTouchedIds(input.ops)
  const usage: PatchGraphBudgetUsage = {
    requestBytes,
    ops: input.ops.length,
    nodesTouched: touched.nodes.size,
    edgesTouched: touched.edges.size,
    diffBytes,
  }
  const dimensions: Array<[keyof PatchGraphBudgetUsage, number]> = [
    ['requestBytes', budget.maxRequestBytes],
    ['ops', budget.maxOps],
    ['nodesTouched', budget.maxNodesTouched],
    ['edgesTouched', budget.maxEdgesTouched],
    ['diffBytes', budget.maxDiffBytes],
  ]
  const failed = dimensions.find(([dimension, maximum]) => usage[dimension] > maximum)
  if (failed) {
    return {
      ok: false,
      errorCode: 'patch.budget.exceeded',
      failedDimension: failed[0],
      ...(failed[0] === 'ops' ? { failedOpIndex: budget.maxOps } : {}),
      usage,
      budget,
    }
  }
  return { ok: true, usage, budget }
}
