import type { Entity, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula, FormulaParseFailureSnapshot } from '@/authoring/blueprint/formula-authoring'
import type { ContextReference } from '../../platform/context-reference'
import {
  SOURCE_EXTENSION_ID,
  truncatePayloadIfNeeded,
  toolsAction,
} from './reference-payload'

export interface FormulaAgentReferenceInput {
  gameId: string
  blueprintId?: string
  blueprintTitle?: string
  /** 公式在 meta.formulas 中的 key（也是 `set-formula` op 的 formulaId）。 */
  formulaKey: string
  formula: Formula
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** parse 失败时透传失败草稿 + 诊断，给「AI 修复公式」一个靶子。 */
  failure?: FormulaParseFailureSnapshot | null
  /** 参数绑定未完成时透传「哪些留空位缺绑定」，给「AI 补全参数」一个靶子。 */
  bindingIssues?: ReadonlyArray<{ readonly label: string; readonly reason: string }>
}

function formulaDisplayName(input: FormulaAgentReferenceInput): string {
  return input.formula.name || input.formulaKey
}

/**
 * 把一个公式投影成 Agent 可独立理解的引用负载：公式本体（id/name/description/ast）之外
 * 还带它可能引用的实体/变量目录。失败草稿或未完成绑定作为可选上下文附上，让「修复 /
 * 补全」类指令有明确靶子。JSON 是数据而非指令；权威来源仍是 `get-graph`。
 */
function buildFormulaPayload(input: FormulaAgentReferenceInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    kind: 'game-video.formula-reference.v1',
    gameId: input.gameId,
    blueprint: {
      ...(input.blueprintId === undefined ? {} : { id: input.blueprintId }),
      ...(input.blueprintTitle === undefined ? {} : { title: input.blueprintTitle }),
    },
    formulaKey: input.formulaKey,
    formula: {
      id: input.formula.id,
      ...(input.formula.name === undefined ? {} : { name: input.formula.name }),
      ...(input.formula.description === undefined ? {} : { description: input.formula.description }),
      ast: input.formula.ast,
      ...(input.formula.draftEmpty ? { draftEmpty: true } : {}),
    },
    entities: input.entities ?? {},
    variables: input.variables ?? {},
  }
  if (input.failure) {
    payload.failure = {
      invalidDraft: input.failure.invalidDraft,
      parserDiagnostic: input.failure.parserDiagnostic,
    }
  }
  if (input.bindingIssues && input.bindingIssues.length > 0) {
    payload.incompleteBindings = input.bindingIssues.map((issue) => ({
      label: issue.label,
      reason: issue.reason,
    }))
  }
  return payload
}

function formulaIdentity(payload: Record<string, unknown>): Record<string, unknown> {
  const formula = payload.formula as { id?: unknown; name?: unknown } | undefined
  return {
    kind: payload.kind,
    gameId: payload.gameId,
    blueprint: payload.blueprint,
    formulaKey: payload.formulaKey,
    formula: { id: formula?.id, name: formula?.name },
  }
}

/**
 * `chat.reference.accept@1` 的公式 producer。写回走 `patch-graph` 的 `set-formula` op：
 * `ops: [{ op: 'set-formula', formulaId, formula: { id, name?, description?, ast } }]`。
 */
export function buildFormulaContextReference(input: FormulaAgentReferenceInput): ContextReference {
  const payload = buildFormulaPayload(input)
  return {
    refKind: 'game-video.formula.v1',
    sourceExtensionId: SOURCE_EXTENSION_ID,
    display: {
      title: formulaDisplayName(input),
      icon: 'ƒ(x)',
      subtitle: input.failure ? '规则 · 公式（需修复）' : '规则 · 公式',
    },
    payload: truncatePayloadIfNeeded(payload, formulaIdentity(payload)),
    action: toolsAction(['game-video:get-graph', 'game-video:patch-graph']),
  }
}
