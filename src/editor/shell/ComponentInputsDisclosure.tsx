import { t as translateUi } from '../../i18n'
import type { CSSProperties, JSX } from 'react'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { NiIcon } from './ni-ui'
import type { EditorPickerCtx } from './editors'
import {
  ComponentFormFields,
  summarizeComponentInputs,
  type EntityAttributeCreateHandler,
  type EntityCreateHandler,
  type FormulaCreateHandler,
  type KeyBindingConflictContext,
  type VariableCreateHandler,
} from './component-form-fields'

/**
 * 折叠态按 Figma「组件参数」的输入壳画（15635:81606）。
 *
 * 这里的类名**刻意不写 `.ni-root` 前缀**：同一个折叠卡片既出现在节点配置面板（新色板），
 * 也出现在 ComponentPropertyPanel 的结算动作里（仍是旧色板）。所以颜色一律读 ni-ui 的
 * 变量、并给字面量兜底 —— 在 `.ni-root` 内自动跟随新 token，在外面退回同样的深色。
 */
const NI_OV_INPUTS_CSS = `
.ni-ov-comp {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--ni-input, #1a1a1a);
  border: 0.611px solid var(--ni-w-08, rgba(255, 255, 255, 0.08));
  border-radius: var(--ni-radius, 8px);
  color: var(--ni-w-100, #ffffff);
  font-size: 11px;
  line-height: 1.5;
}
/* 收起态就是一条 27px 的输入壳：5px 上下内边距 + 17px 行高（Figma 15635:81606）。 */
.ni-ov-comp-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 27px;
  padding: 5px 9px;
  min-width: 0;
  list-style: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.5);
}
.ni-ov-comp-summary::-webkit-details-marker { display: none; }
.ni-ov-comp-summary::marker { content: ''; }
.ni-ov-comp-summary:hover { color: var(--ni-w-100, #ffffff); }
/* 展开时标题与首行的间距由 body 的 padding-top 给足 10px，标题自身不再留下边距。 */
.ni-ov-comp[open] .ni-ov-comp-summary { padding-bottom: 0; }
.ni-ov-comp-summary-text {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ni-ov-comp-name,
.ni-ov-comp-id,
.ni-ov-comp-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ni-ov-comp-id { flex: none; color: var(--ni-w-40, rgba(255, 255, 255, 0.4)); }
.ni-ov-comp-value {
  min-width: 0;
  color: var(--ni-w-40, rgba(255, 255, 255, 0.4));
  font-family: ui-monospace, monospace;
}
.ni-ov-comp-caret { flex: none; color: inherit; }
.ni-ov-comp-body { padding: 10px 9px 5px; min-width: 0; }

/* 参数行：行距 10（稿子是容器 gap:10），压过 compactField 的行内 marginBottom:4。 */
.ni-ov-comp-body .cff-field-layout { margin-bottom: 10px !important; }
.ni-ov-comp-body .cff-field-layout:last-child { margin-bottom: 0 !important; }
.ni-ov-comp-body .cff-field-layout > span:first-child { color: rgba(255, 255, 255, 0.5); }
/* 嵌套控件比外壳亮一档，否则同为 #1a1a1a 时看不出边界（稿子 15635:82780）。 */
.ni-ov-comp-body input:not([type='checkbox']):not([type='radio']):not([type='range']),
.ni-ov-comp-body textarea,
.ni-ov-comp-body select,
.ni-ov-comp-body .ni-select-shell,
.ni-ov-comp-body .gc-cascade-trigger {
  background: #232323;
}
`

export function ComponentInputsDisclosure({
  childId,
  componentId,
  values,
  pickers,
  labelWidth,
  controlWidth,
  density = 'compact',
  onChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  keyConflicts,
}: {
  childId: string
  componentId: string
  values: Record<string, unknown>
  pickers?: EditorPickerCtx
  labelWidth?: CSSProperties['width']
  controlWidth?: CSSProperties['width']
  density?: 'compact' | 'property'
  onChange: (next: Record<string, unknown>) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  keyConflicts?: KeyBindingConflictContext
}): JSX.Element {
  const componentName = getComponentManifest(componentId)?.label ?? componentId
  const summary = summarizeComponentInputs(componentId, values)
  const fields = (
    <ComponentFormFields
      componentId={componentId}
      values={values}
      onChange={onChange}
      pickers={pickers}
      excludeKeys={['x', 'y']}
      density={density}
      labelWidth={labelWidth}
      compactControlWidth={controlWidth}
      onCreateEntityAttribute={onCreateEntityAttribute}
      onCreateEntity={onCreateEntity}
      onCreateVariable={onCreateVariable}
      onCreateFormula={onCreateFormula}
      keyConflicts={keyConflicts}
    />
  )

  if (density === 'property') {
    return (
      <div className="editor-property-spawn-props" data-component-inputs-disclosure={`${childId}:${componentId}`}>
        <div className="editor-property-spawn-props-title">{translateUi('ui.copy.7314608451a0')}</div>
        {fields}
      </div>
    )
  }

  injectStyleOnce('ni-overlay-inputs', NI_OV_INPUTS_CSS)
  return (
    <details
      className="ni-ov-comp"
      data-component-inputs-disclosure={`${childId}:${componentId}`}
    >
      <summary
        className="ni-ov-comp-summary"
        title={`${translateUi('ui.template.8085c6fb0eb2')}${childId}（${componentName}${translateUi('ui.template.8607f05374f0')}`}
      >
        <span className="ni-ov-comp-summary-text">
          <span className="ni-ov-comp-name">{componentName}</span>
          <span className="ni-ov-comp-id">{childId}</span>
          {summary ? <span className="ni-ov-comp-value">{summary}</span> : null}
        </span>
        <span className="ni-ov-comp-caret">
          <NiIcon name="unfold" size={12} />
        </span>
      </summary>
      <div className="ni-ov-comp-body">
        {fields}
      </div>
    </details>
  )
}
