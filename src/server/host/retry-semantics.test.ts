import { describe, expect, it } from 'vitest'
import { retryDispositionFor } from './workflow-state'

describe('拒绝语义三态', () => {
  it('乐观锁冲突归 retry-now：重读后重试同一意图即可', () => {
    expect(retryDispositionFor('workflow.revision.conflict')).toBe('retry-now')
    expect(retryDispositionFor('workflow.activity.stale')).toBe('retry-now')
  })

  it('内容不达标归 fix-then-retry：必须先改内容', () => {
    expect(retryDispositionFor('workflow.completion.rejected')).toBe('fix-then-retry')
    expect(retryDispositionFor('rules.variable.invalid-id')).toBe('fix-then-retry')
    expect(retryDispositionFor('rules.formula.unknown-function')).toBe('fix-then-retry')
    expect(retryDispositionFor('rules.formula.invalid-arity')).toBe('fix-then-retry')
  })

  it('越权与等人归 stop：重试无意义，必须交回编排者', () => {
    for (const code of [
      'workflow.gate.required',
      'workflow.gate.external-only',
      'workflow.transition.invalid',
      'workflow.capability.denied',
      'workflow.write-scope.denied',
      'workflow.not-required.denied',
    ]) {
      expect(retryDispositionFor(code), code).toBe('stop')
    }
  })

  it('未登记的错误码默认 stop，宁可交回人也不盲目重试', () => {
    expect(retryDispositionFor('something.unknown')).toBe('stop')
  })
})
