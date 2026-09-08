import { t as translateUi } from '../../i18n'
/**
 * 结算后显示组件（NodeAction.spawn）—— 选项 / QTE 结算区共用。
 * 本版：仅当前节点内演出，ttl 截断到节点时长；跳转换节点会清掉瞬态叠层。
 */
import type { CSSProperties, JSX } from 'react'
import type { Entity, Overlay, Variable } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { SpawnInputsEditor } from './spawn-inputs-editor'
import { LooseNumberInput } from './TermChainEditor'

export interface SettlementSpawnValue {
  from: string
  ttlMs?: number
  inputs?: Record<string, unknown>
}

export interface SpawnTemplateOption {
  value: string
  label: string
}

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }
const lbl: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const hint: CSSProperties = { fontSize: 11, opacity: 0.55, margin: '4px 0 0' }
const warn: CSSProperties = { fontSize: 11, color: '#e6a23c', margin: '4px 0 0' }

export function SettlementSpawnEditor({
  value,
  templates,
  overlays,
  entities,
  variables,
  formulas,
  maxTtlMs,
  hasJump,
  onChange,
}: {
  value: SettlementSpawnValue | undefined
  templates: SpawnTemplateOption[]
  overlays?: Record<string, Overlay>
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  formulas?: Record<string, Formula>
  /** 本节点时长上限（ms）；写入时截断，UI 提示用。 */
  maxTtlMs: number
  /** 该结算档已配置跳转边——本版 spawn 不会跨节点。 */
  hasJump?: boolean
  onChange: (next: SettlementSpawnValue | undefined) => void
}): JSX.Element {
  const enabled = !!value?.from
  const ttlCap = Math.max(100, Math.round(maxTtlMs))
  const ttlShown = value?.ttlMs != null && value.ttlMs > 0 ? value.ttlMs : ttlCap

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{translateUi('ui.copy.675047ee9c41')}</div>
      {!enabled ? (
        <button
          type="button"
          style={{ fontSize: 12 }}
          disabled={templates.length === 0}
          onClick={() =>
            onChange({
              from: templates[0]?.value ?? '',
              ttlMs: Math.min(1200, ttlCap),
            })
          }
        >
          {translateUi('ui.copy.4f4888907e5d')}</button>
      ) : (
        <div style={box}>
          <div style={rowStyle}>
            <span style={lbl}>{translateUi('ui.copy.3c4065adbc5f')}</span>
            <select
              style={{ flex: 1, minWidth: 120 }}
              value={value.from}
              onChange={(e) => onChange({ from: e.target.value, ttlMs: value.ttlMs })}
            >
              <option value="">{translateUi('ui.copy.bdf3bc41d249')}</option>
              {templates.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <button type="button" style={{ color: '#ff6b6b', marginLeft: 'auto' }} onClick={() => onChange(undefined)}>
              {translateUi('ui.copy.2f752c005ec5')}</button>
          </div>
          <div style={rowStyle}>
            <span style={lbl}>{translateUi('ui.copy.be15774bbd48')}</span>
            <LooseNumberInput
              value={ttlShown}
              emptyValue={ttlCap}
              style={{ width: 100 }}
              title={`${translateUi('ui.template.298754d6bec8')}${ttlCap}${translateUi('ui.template.6bd9457b76f6')}`}
              onChange={(ttlMs) => {
                onChange({
                  ...value,
                  ttlMs: Math.min(Math.max(100, ttlMs), ttlCap),
                })
              }}
            />
            <span style={{ fontSize: 11, opacity: 0.5 }}>≤ {ttlCap}</span>
          </div>
          <SpawnInputsEditor
            from={value.from}
            inputs={value.inputs}
            overlays={overlays}
            pickers={{ entities, variables, formulas }}
            onChange={(inputs) => onChange({ ...value, inputs })}
          />
          <p style={hint}>{translateUi('ui.copy.f2ba377a4ab1')}</p>
          {hasJump ? (
            <p style={warn}>{translateUi('ui.copy.4aaaa736cc19')}</p>
          ) : null}
        </div>
      )}
      {templates.length === 0 ? (
        <p style={hint}>{translateUi('ui.copy.7b808c87d25e')}</p>
      ) : null}
    </div>
  )
}
