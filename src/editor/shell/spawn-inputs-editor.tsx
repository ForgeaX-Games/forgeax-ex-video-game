import { t as translateUi } from '../../i18n'
/**
 * spawn.inputs 第一层 key/value 编辑 —— 按模板组件 inputs 出字段，常量 / 表达式 / 引用。
 * 落盘仍为 Record（字面量 或 {expr}/{ref}）；不碰嵌套 JSON。
 */
import type { CSSProperties, JSX } from 'react'
import type { NumOrExpr, Overlay } from '@/runtime/core/schema/graph-schema'
import type { ComponentInput } from '@/runtime/core/schema/node-config-schema'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { TextValueInput, ValueInput, type EditorPickerCtx } from './editors'
import { NiSelect } from './ni-ui'
import type { TextOrRef } from './TextValueEditor'

type BindMode = 'literal' | 'expr' | 'ref'

const MODE_LABEL: Record<BindMode, string> = {
  literal: '常量',
  expr: '表达式',
  ref: '引用',
}

const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }
const keyLbl: CSSProperties = { width: 72, opacity: 0.75, flexShrink: 0, fontSize: 11 }

function parseBind(v: unknown): { mode: BindMode; text: string } {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (typeof o.expr === 'string') return { mode: 'expr', text: o.expr }
    if (typeof o.ref === 'string') return { mode: 'ref', text: o.ref }
  }
  if (typeof v === 'boolean' || typeof v === 'number') return { mode: 'literal', text: String(v) }
  if (typeof v === 'string') return { mode: 'literal', text: v }
  if (v == null) return { mode: 'literal', text: '' }
  return { mode: 'literal', text: '' }
}

function encodeBind(mode: BindMode, text: string, valueType?: ComponentInput['valueType']): unknown | undefined {
  const t = text.trim()
  if (mode === 'expr') return t ? { expr: t } : undefined
  if (mode === 'ref') return t ? { ref: t } : undefined
  if (!t) return undefined
  if (valueType === 'number') {
    const n = Number(t)
    return Number.isFinite(n) ? n : t
  }
  if (valueType === 'boolean') return t === 'true' || t === '1'
  return t
}

function resolveSpawnInputs(from: string, overlays?: Record<string, Overlay>): ComponentInput[] {
  const slash = from.indexOf('/')
  if (slash < 0) return []
  const overlayId = from.slice(0, slash)
  const childId = from.slice(slash + 1)
  const child = overlays?.[overlayId]?.children.find((c) => c.id === childId)
  if (!child) return []
  return getComponentManifest(child.component)?.inputs ?? []
}

function ParamRow({
  inputKey,
  label,
  valueType,
  value,
  onChange,
  onClear,
}: {
  inputKey: string
  label: string
  valueType?: ComponentInput['valueType']
  value: unknown
  onChange: (next: unknown | undefined) => void
  onClear?: () => void
}): JSX.Element {
  const { mode, text } = parseBind(value)
  const setMode = (m: BindMode) => {
    if (m === mode) return
    if (m === 'expr') onChange(text.trim() ? { expr: text } : { expr: 'abs(delta)' })
    else if (m === 'ref') onChange(text.trim() ? { ref: text } : { ref: 'entity.ent-player.name' })
    else onChange(encodeBind('literal', text, valueType))
  }
  const setText = (t: string) => onChange(encodeBind(mode, t, valueType))
  const placeholder =
    mode === 'expr' ? 'abs(delta) 或 entity.ent-boss.attr.hp'
    : mode === 'ref' ? 'entity.ent-player.name'
    : valueType === 'number' ? '0'
    : valueType === 'boolean' ? 'true / false'
    : '文案'
  return (
    <div style={rowStyle}>
      <span style={keyLbl} title={inputKey}>{label}</span>
      {/* flex:none 顶掉 NiSelect 壳默认的 flex:1，把这只窄下拉钉回原来的 72px。 */}
      <NiSelect value={mode} onChange={(next) => setMode(next as BindMode)} style={{ flex: 'none', fontSize: 11, width: 72 }}>
        {(Object.keys(MODE_LABEL) as BindMode[]).map((m) => (
          <option key={m} value={m}>{MODE_LABEL[m]}</option>
        ))}
      </NiSelect>
      {valueType === 'boolean' && mode === 'literal' ? (
        <NiSelect value={text === 'true' ? 'true' : 'false'} onChange={setText} style={{ flex: 1, fontSize: 12 }}>
          <option value="true">{translateUi('ui.copy.30160a21b92a')}</option>
          <option value="false">{translateUi('ui.copy.8bf5c10ad937')}</option>
        </NiSelect>
      ) : (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 80, fontSize: 12, fontFamily: mode === 'literal' ? undefined : 'monospace' }}
        />
      )}
      {onClear ? (
        <button type="button" style={{ color: '#ff6b6b', fontSize: 11 }} onClick={onClear} title={translateUi('ui.copy.ee9c2a8b9a08')}>×</button>
      ) : null}
    </div>
  )
}

export function SpawnInputsEditor({
  from,
  inputs,
  overlays,
  pickers,
  onChange,
}: {
  from: string
  inputs: Record<string, unknown> | undefined
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  onChange: (next: Record<string, unknown> | undefined) => void
}): JSX.Element {
  const inputDefs = resolveSpawnInputs(from, overlays)
  const bag = inputs ?? {}
  const known = new Set(inputDefs.map((i) => i.key))
  const extras = Object.keys(bag).filter((k) => !known.has(k) && k !== 'component')

  const patchKey = (key: string, value: unknown | undefined) => {
    const next = { ...bag }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange(Object.keys(next).length ? next : undefined)
  }

  const addExtra = () => {
    let i = 0
    let key = `param${i}`
    while (key in bag || known.has(key)) {
      i += 1
      key = `param${i}`
    }
    onChange({ ...bag, [key]: '' })
  }

  if (!from) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>{translateUi('ui.copy.3542aa4a8bf1')}</div>
  }

  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 6px' }}>
        {translateUi('ui.copy.3c864aeda59b')}</div>
      {inputDefs.length === 0 && extras.length === 0 ? (
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4 }}>{translateUi('ui.copy.8c1c5a1ea0d4')}</div>
      ) : null}
      {inputDefs.map((inp) => (
        inp.component === 'numberExpr' ? (
          <div key={inp.key} style={rowStyle}>
            <span style={keyLbl} title={inp.key}>{inp.label?.trim() || inp.key}</span>
            {inp.valueType === 'string' ? (
              <TextValueInput
                value={(bag[inp.key] ?? inp.default) as TextOrRef | undefined}
                entities={pickers?.entities}
                variables={pickers?.variables}
                formulas={pickers?.formulas}
                onChange={(v) => patchKey(inp.key, v)}
              />
            ) : (
              <ValueInput
                value={bag[inp.key] as NumOrExpr | string | undefined}
                defaultValue={typeof inp.default === 'number' ? inp.default : undefined}
                entities={pickers?.entities}
                variables={pickers?.variables}
                formulas={pickers?.formulas}
                onChange={(v) => patchKey(inp.key, v)}
                onClear={inp.default === undefined ? () => patchKey(inp.key, undefined) : undefined}
                emptyLabel="不传入（使用模板默认）"
              />
            )}
          </div>
        ) : (
          <ParamRow
            key={inp.key}
            inputKey={inp.key}
            label={inp.label?.trim() || inp.key}
            valueType={inp.valueType}
            value={bag[inp.key]}
            onChange={(v) => patchKey(inp.key, v)}
          />
        )
      ))}
      {extras.map((key) => (
        <ParamRow
          key={key}
          inputKey={key}
          label={key}
          value={bag[key]}
          onChange={(v) => patchKey(key, v)}
          onClear={() => patchKey(key, undefined)}
        />
      ))}
      <button type="button" style={{ marginTop: 2, fontSize: 11 }} onClick={addExtra}>{translateUi('ui.copy.25e94d30444e')}</button>
    </div>
  )
}
