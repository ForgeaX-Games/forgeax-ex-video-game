import { t as translateUi } from '../../i18n'
/**
 * 条款链编辑器 —— ±×÷ 左结合的 `ValueTerm[]` 通用编辑 UI，从 ValueExprEditor 的「选取公式」
 * 模式抽出，供它与「规则 → 公式」的公式条款编辑共用。运算符按钮走 `OpSymbolButtons`
 * （跟 Effect 层「运算」符号按钮同一份视觉/交互实现，见 OpSymbolButtons.tsx）。
 *
 * `allowHoleEntity`：开启后「实体」条款的对象下拉多一个可选的"留空（应用时选择）"项——
 * 选中后该条款的实体本身待定，属性一栏切换成自由文本（约定属性名，可选）。这是本期唯一支持的
 * 公式留空类型；`allowHoleEntity` 关闭时行为与现状完全一致（ValueExprEditor 的「选取公式」）。
 */
import { useState, type CSSProperties, type JSX } from 'react'
import type { Entity, ValueTermOp, Variable } from '@/runtime/core/schema/graph-schema'
import type { EditorValueTerm as ValueTerm } from '@/authoring/blueprint/formula-authoring'
import { OpSymbolButtons } from './OpSymbolButtons'
import { NiSelect } from './ni-ui'
import {
  VALUE_TERM_OP_LABEL,
  allocTermId,
  emptyPickTerm,
  findEntity,
  listAttrOptions,
  listEntityOptions,
  listVarOptions,
} from './valueExprPick'

const row: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }

/** 允许输入过程中的 `-` / `.` / `-0.`；避免 `Number(x)||0` 把负数/小数草稿打回 0。 */
const LOOSE_NUM_RE = /^[+-]?(\d+\.?\d*|\.\d*)?$/

export function LooseNumberInput({
  value,
  onChange,
  emptyValue,
  className,
  style,
  title,
  placeholder,
  'aria-label': ariaLabel,
}: {
  value: number
  onChange: (n: number) => void
  /** 草稿留空并失焦时写入的默认值；不传则恢复最近一次有效值。 */
  emptyValue?: number
  className?: string
  style?: CSSProperties
  title?: string
  placeholder?: string
  'aria-label'?: string
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? String(value)
  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      aria-label={ariaLabel}
      value={shown}
      style={style}
      title={title}
      placeholder={placeholder}
      onFocus={() => setDraft(String(value))}
      onBlur={() => {
        const raw = (draft ?? '').trim()
        const n = Number(raw)
        onChange(raw !== '' && Number.isFinite(n) ? n : (emptyValue ?? value))
        setDraft(null)
      }}
      onChange={(e) => {
        const next = e.target.value
        if (next !== '' && !LOOSE_NUM_RE.test(next)) return
        setDraft(next)
        if (next === '' || next === '+' || next === '-' || next === '.' || next === '+.' || next === '-.') return
        const n = Number(next)
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

function termOp(t: ValueTerm): ValueTermOp {
  return t.op === '+' || t.op === '-' || t.op === '*' || t.op === '/' ? t.op : '+'
}

function isHole(t: ValueTerm): boolean {
  return t.source === 'entity' && !t.refId
}

export function TermChainEditor({
  terms,
  entities,
  variables,
  allowHoleEntity,
  onChange,
}: {
  terms: ValueTerm[]
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  /** 开启「留空（未知实体）」选项；关闭时与现状完全一致。 */
  allowHoleEntity?: boolean
  onChange: (terms: ValueTerm[]) => void
}): JSX.Element {
  const entityOpts = listEntityOptions(entities)
  const varOpts = listVarOptions(variables, { numbersOnly: true })

  function patchTerm(i: number, patch: Partial<ValueTerm>): void {
    const next = terms.map((t, idx) => {
      if (idx !== i) return t
      const n: ValueTerm = { ...t, ...patch }
      if (patch.source === 'entity') {
        const id = n.refId || entityOpts[0]?.id || ''
        const ent = findEntity(entities, id)
        n.refId = id
        n.attr = n.attr && listAttrOptions(ent).some((a) => a.id === n.attr)
          ? n.attr
          : listAttrOptions(ent)[0]?.id ?? 'hp'
        n.constValue = undefined
      }
      if (patch.source === 'var') {
        n.refId = n.refId || varOpts[0]?.id || ''
        n.attr = undefined
        n.constValue = undefined
      }
      if (patch.source === 'const') {
        n.refId = ''
        n.attr = undefined
        n.constValue = n.constValue ?? 1
      }
      if (patch.refId && n.source === 'entity') {
        const ent = findEntity(entities, patch.refId)
        const attrs = listAttrOptions(ent)
        if (!attrs.some((a) => a.id === n.attr)) n.attr = attrs[0]?.id ?? n.attr
      }
      // 首项不允许 ×÷（无左操作数）
      if (idx === 0 && (n.op === '*' || n.op === '/')) n.op = '+'
      return n
    })
    onChange(next)
  }

  function removeTerm(i: number): void {
    onChange(terms.filter((_, idx) => idx !== i))
  }

  function addTerm(): void {
    // 默认「×」下一项，方便属性互乘；无目录时用常数（跟抽出前一致）。
    const seed = emptyPickTerm(entities, variables, '*')
    onChange([...terms, { ...seed, id: allocTermId(terms) }])
  }

  return (
    <>
      {terms.map((t, i) => {
        const op = termOp(t)
        const hole = !!allowHoleEntity && isHole(t)
        const ent = t.source === 'entity' ? findEntity(entities, t.refId) : undefined
        const attrs = listAttrOptions(ent)
        const ops: ValueTermOp[] = i === 0 ? ['+', '-'] : ['+', '-', '*', '/']
        return (
          <div key={t.id ?? i} style={{ ...row, border: '1px solid var(--gc-accent-line, #2a2a2a)', borderRadius: 6, padding: 6 }}>
            <OpSymbolButtons
              ariaLabel={i === 0 ? '正负' : '运算'}
              options={ops.map((o) => ({ key: o, symbol: VALUE_TERM_OP_LABEL[o], active: o === op }))}
              onPick={(key) => patchTerm(i, { op: key as ValueTermOp })}
            />
            <NiSelect
              value={t.source}
              onChange={(source) => patchTerm(i, { source: source as ValueTerm['source'] })}
              ariaLabel="对象类型"
            >
              <option value="entity" disabled={entityOpts.length === 0}>{translateUi('ui.copy.b296a773b6df')}</option>
              <option value="var" disabled={varOpts.length === 0}>{translateUi('ui.copy.b418ca60d417')}</option>
              <option value="const">{translateUi('ui.copy.8e8b271e61b4')}</option>
            </NiSelect>
            {t.source === 'entity' ? (
              <>
                <NiSelect value={t.refId} onChange={(refId) => patchTerm(i, { refId })} ariaLabel="实体" style={{ flex: 1, minWidth: 100 }}>
                  {allowHoleEntity ? (
                    <option value="">{translateUi('ui.copy.dd1eb0b49fdc')}</option>
                  ) : (
                    <option value="" disabled>{translateUi('ui.copy.221bbd8719c4')}</option>
                  )}
                  {entityOpts.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </NiSelect>
                {hole ? (
                  <input
                    value={t.attr ?? ''}
                    onChange={(e) => patchTerm(i, { attr: e.target.value || undefined })}
                    placeholder={translateUi('ui.copy.61acab3f8262')}
                    aria-label={translateUi('ui.copy.08cee940f398')}
                    style={{ flex: 1, minWidth: 90 }}
                  />
                ) : (
                  <NiSelect value={t.attr ?? ''} onChange={(attr) => patchTerm(i, { attr })} ariaLabel="属性" style={{ flex: 1, minWidth: 90 }}>
                    <option value="" disabled>{translateUi('ui.copy.f271d5ff29e5')}</option>
                    {attrs.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </NiSelect>
                )}
              </>
            ) : t.source === 'var' ? (
              <NiSelect value={t.refId} onChange={(refId) => patchTerm(i, { refId })} ariaLabel="变量" style={{ flex: 1, minWidth: 100 }}>
                <option value="" disabled>{translateUi('ui.copy.185fdb554da6')}</option>
                {varOpts.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </NiSelect>
            ) : (
              <LooseNumberInput
                value={t.constValue ?? 0}
                onChange={(n) => patchTerm(i, { constValue: n })}
                aria-label={translateUi('ui.copy.8e8b271e61b4')}
                style={{ width: 72 }}
              />
            )}
            <button
              type="button"
              className="gc-mini-danger"
              title={translateUi('ui.copy.bc68b5a6860c')}
              onClick={() => removeTerm(i)}
            >
              {translateUi('ui.copy.3755f56f2f83')}</button>
          </div>
        )
      })}
      <button type="button" className="gc-mini-action" onClick={addTerm}>
        {translateUi('ui.copy.43562695adf6')}</button>
    </>
  )
}
