import { t as translateUi, tf as formatUi } from '../../i18n'
/**
 * 结构化编辑器 —— 类型化输入（effects / condition / 选项）。
 * 数值与实体·属性·变量一律走选取式下拉，不暴露 entity.xxx 手写框。
 *
 * 控件底：main 的 metaCatalog + ValueExprEditor。
 * 兼容：`EditorPickerCtx` / `pickers`（含 nodeLabel）与直接传 `entities`/`variables`。
 */
import { useRef, useState, type CSSProperties, type JSX } from 'react'
import type {
  CmpOp,
  Entity,
  GraphClause,
  GraphCondition,
  GraphEffect,
  Layout,
  NumericEffectOp,
  NumOrExpr,
  Variable,
} from '@/runtime/core/schema/graph-schema'
import { variableValueKind } from '@/runtime/core/schema/graph-schema'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { flowHandleDisplay } from '@/authoring/graph/flow-handle-labels'
import { buildDefaults, getComponent, getComponentManifest } from '@/runtime/core/registry/component-registry'
import {
  attrDisplayName,
  attrValueText,
  catalogIdOccupied,
  entityDisplayName,
  findEntity,
  listAttrOptions,
  listEntityOptions,
  listVarOptions,
  nextAvailableCatalogId,
  nextCatalogId,
  type EntityAttributeCreateRequest,
  type EntityCreateRequest,
} from '@/authoring/formulas/meta-catalog'
import { CascadingPicker, type CascadingPickerOption } from './CascadingPicker'
import {
  ValueExprEditor,
  type ValueExprAttributeCreateConfig,
  type ValueExprEntityCreateConfig,
  type ValueExprFormulaCreateConfig,
  type ValueExprVariableCreateConfig,
} from './ValueExprEditor'
import { TextValueEditor, type TextOrRef } from './TextValueEditor'
import { LooseNumberInput } from './TermChainEditor'
import { NiSelect } from './ni-ui'
import { EffectOpButtons } from './OpSymbolButtons'
import {
  compileValuePick,
  decodeEffectOperation,
  encodeEffectOperation,
  resolveValuePick,
  type EffectDisplayOp,
} from './valueExprPick'

/** 交互事件目录项（共享壳 = ComponentEvent；kind 扩展字段按 variant 编辑）。 */
export interface ComponentEventLike {
  id: string
  label?: string
  /** choice/skill：逐项门控（组件私有）。 */
  condition?: GraphCondition
  /** hotspot：画面锚点（组件私有，归一化 0~1）。 */
  x?: number
  y?: number
}

export type EventsEditorVariant = 'plain' | 'choice' | 'hotspot'

export type MetaCatalogProps = {
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  /** 公式库（「规则 → 公式」维护）；数值字段（ValueInput）借它开出「应用公式」模式。 */
  formulas?: Record<string, Formula>
  /** 从当前项目已有 item effect / hasItem condition 派生的道具 id。 */
  itemIds?: readonly string[]
}

/** 兼容包装：entities/variables + 节点下拉展示。 */
export interface EditorPickerCtx extends MetaCatalogProps {
  /** 节点下拉展示；缺省用 id。 */
  nodeLabel?: (id: string) => string
}

type CatalogArgs = MetaCatalogProps & {
  pickers?: EditorPickerCtx
  nodeLabel?: (id: string) => string
}

function resolveCatalog(args: CatalogArgs): {
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  formulas: Record<string, Formula> | undefined
  itemIds: readonly string[]
  nodeLabel?: (id: string) => string
} {
  return {
    entities: args.entities ?? args.pickers?.entities,
    variables: args.variables ?? args.pickers?.variables,
    formulas: args.formulas ?? args.pickers?.formulas,
    itemIds: args.itemIds ?? args.pickers?.itemIds ?? [],
    nodeLabel: args.nodeLabel ?? args.pickers?.nodeLabel,
  }
}

const CMP_OPS: CmpOp[] = ['gte', 'lte', 'gt', 'lt', 'eq', 'neq']
const CMP_LABEL: Record<CmpOp, string> = { gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '=', neq: '≠' }
const EFFECT_KIND_LABEL: Record<string, string> = { attr: '属性', var: '变量', flag: '标记', item: '道具' }
const OP_LABEL: Record<string, string> = { give: '给予', take: '取走' }
const CLAUSE_LABEL: Record<string, string> = {
  attrRatio: '属性比例', attr: '属性值', attrCompare: '属性比较', var: '变量', flag: '标记', visited: '到过节点', score: '分数', hasItem: '拥有道具',
}

const box: CSSProperties = { border: '1px solid #2a2a2a', borderRadius: 6, padding: 6, marginTop: 6 }

function textValueFromEditor(value: TextOrRef): string | { ref: string } {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'ref' in value && typeof value.ref === 'string') return { ref: value.ref }
  return typeof value === 'number' ? String(value) : ''
}
const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }
const lbl: CSSProperties = { width: 52, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const del: CSSProperties = { color: '#ff6b6b', marginLeft: 'auto' }
const hint: CSSProperties = { fontSize: 11, opacity: 0.55, marginBottom: 4 }

function ItemIdEditor({
  value,
  itemIds,
  onChange,
}: {
  value: string
  itemIds: readonly string[]
  onChange: (itemId: string) => void
}): JSX.Element {
  const ids = [...new Set(itemIds.filter(Boolean))].sort()
  const known = ids.includes(value)
  return (
    <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
      <NiSelect
        ariaLabel="道具"
        value={known ? value : '__custom__'}
        onChange={(next) => {
          if (next !== '__custom__') onChange(next)
        }}
        style={{ flex: 1, minWidth: 0 }}
      >
        {ids.map((id) => <option key={id} value={id}>{id}</option>)}
        <option value="__custom__">{translateUi('ui.copy.b3476b216f91')}</option>
      </NiSelect>
      {!known ? (
        <input
          aria-label={translateUi('ui.copy.7f5a6f8de7ec')}
          value={value}
          placeholder={translateUi('ui.copy.ec8818e9949c')}
          onChange={(event) => onChange(event.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : null}
    </div>
  )
}

/** NumOrExpr 值相等判断：数字比值、表达式比串——用于判「运算符变换是否真的改了值」，没改则不入撤回栈。 */
function numOrExprEqual(a: NumOrExpr | undefined, b: NumOrExpr | undefined): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (typeof a === 'object' && a && typeof b === 'object' && b) return a.expr === b.expr
  return false
}

function field(
  label: string,
  node: JSX.Element,
  labelWidth?: CSSProperties['width'],
): JSX.Element {
  // 用 div 而非 label：子树常含 button，包在 label 里会点到文字也触发按钮（如「乘」误删）。
  return (
    <div className="editor-field-row" style={rowStyle}>
      <span style={labelWidth === undefined ? lbl : { ...lbl, width: labelWidth }}>{label}</span>
      {node}
    </div>
  )
}

// ── 位置（x/y 归一化 0~1）——字幕/飘字/选项/通用组件/QTE point 皮肤共用 ──────────────
export function PositionEditor({
  x,
  y,
  defaultX,
  defaultY,
  onChange,
  variant = 'percent',
  resettable,
  disabled,
}: {
  x: number | undefined
  y: number | undefined
  defaultX: number
  defaultY: number
  onChange: (next: { x?: number; y?: number }) => void
  /** percent=数字输入框（%）；slider=0~1 滑条（字幕现状）。 */
  variant?: 'percent' | 'slider'
  /** 显示「归位到默认位置」按钮，清空 x/y 回落到样式默认值。 */
  resettable?: boolean
  /**
   * 该组件不支持自由定位（`isPositionable()` 为 false，如 HUD 血条按角色/规则锚定固定屏幕位置）时置灰：
   * 控件仍展示（不隐藏，方便看清当前坐标从哪来），但禁止输入。
   */
  disabled?: boolean
}): JSX.Element {
  const vx = typeof x === 'number' ? x : defaultX
  const vy = typeof y === 'number' ? y : defaultY
  const hint = disabled ? (
    <div className="gc-inspector-hint" title={translateUi('ui.copy.ec8a0b9ccc58')}>{translateUi('ui.copy.77abf81fc6a9')}</div>
  ) : null
  if (variant === 'slider') {
    return (
      <>
        <div className="gc-field-row">
          <label><span>{translateUi('ui.copy.c032adc1ff62')}{vx.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.01} value={vx} disabled={disabled} onChange={(e) => onChange({ x: Number(e.target.value) })} />
          </label>
          <label><span>{translateUi('ui.copy.23eb4d3f4155')}{vy.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.01} value={vy} disabled={disabled} onChange={(e) => onChange({ y: Number(e.target.value) })} />
          </label>
        </div>
        {hint}
        {resettable && !disabled ? (
          <button type="button" className="gc-tsp-toggle" onClick={() => onChange({ x: undefined, y: undefined })}>{translateUi('ui.copy.06818e263d7f')}</button>
        ) : null}
      </>
    )
  }
  return (
    <div className="gc-inspector-grid2">
      <label><span>{translateUi('ui.copy.d3f60a57ed63')}</span>
        <input type="number" value={Math.round(vx * 100)} disabled={disabled} onChange={(e) => onChange({ x: Number(e.target.value) / 100 })} />
      </label>
      <label><span>{translateUi('ui.copy.a0462af40e68')}</span>
        <input type="number" value={Math.round(vy * 100)} disabled={disabled} onChange={(e) => onChange({ y: Number(e.target.value) / 100 })} />
      </label>
      {hint}
      {resettable && !disabled ? (
        <button type="button" className="gc-tsp-toggle" onClick={() => onChange({ x: undefined, y: undefined })}>{translateUi('ui.copy.06818e263d7f')}</button>
      ) : null}
    </div>
  )
}

/**
 * 该组件是否支持「自由拖拽定位」——编辑器侧判定，**唯一官方入口**，纯结构化推导，不设独立开关字段：
 * 组件 `inputs` 里同时声明了 `x` 和 `y` 才算支持（渲染端才有地方读、写回才有地方落）；
 * 缺其一 → 不支持（HUD 类血条/气力条按角色/规则锚定固定屏幕位置，inputs 里本就没有 x/y）。
 * 未注册组件默认 `true`（保持编辑器旧行为，宁可给手柄不误判）。
 * 新增组件只需在自己 `inputs` 里老实声明 x/y——不必回来改这个函数，也不必再加一个平行的
 * `positionable` 标记跟 inputs 保持同步（那样两处数据源迟早会漂移）。
 * 编辑器预览手柄生成处（`activePreviewOverlaysFromNode`）/ 素材属性面板置灰逻辑均调用此函数。
 * 只读 `getComponent`（registry 对外暴露的查询 API），运行时执行路径（engine.ts / session.ts /
 * rendererRegistry.tsx）从未调用过这个判断——「能不能拖手柄」纯粹是编辑器概念，不是 runtime 关心的事。
 */
export function isPositionable(componentId: string): boolean {
  const inputs = getComponent(componentId)?.inputs
  if (!inputs) return true
  return inputs.some((i) => i.key === 'x') && inputs.some((i) => i.key === 'y')
}

/** 编辑器展示名：读组件 `label`；未注册则退回 id。 */
export function componentTypeLabel(componentId: string): string {
  return getComponent(componentId)?.label || componentId
}

/** 编辑器新建实例：由组件 inputs[].default 组装初值。 */
export function defaultsForComponent(componentId: string): Record<string, unknown> {
  return buildDefaults(getComponent(componentId)?.inputs)
}

const CUE_COMPONENT_IDS = new Set(['InkKou', 'BattleParry'])
const OPTION_COMPONENT_IDS = new Set(['InkYingMo', 'BattleSkill'])

/**
 * 编辑器：组件 inputs 是否声明了多拍点结构（`component: 'qteCues'`）。
 * 有 ⇒ 时间轴走拍点交互；组件侧只需在 inputs 里声明该项，不必另加分类标签。
 */
export function hasCuePointsInput(componentId: string): boolean {
  if (CUE_COMPONENT_IDS.has(componentId)) return true
  const inputs = getComponent(componentId)?.inputs
  return !!inputs?.some((i) => i.component === 'qteCues')
}

/**
 * 编辑器：组件 inputs 是否声明了选项出口清单（`component: 'events'`）。
 * 已有拍点结构的走拍点分支，不落进本分支。
 */
export function hasOptionEventsInput(componentId: string): boolean {
  if (hasCuePointsInput(componentId)) return false
  if (OPTION_COMPONENT_IDS.has(componentId)) return true
  const inputs = getComponent(componentId)?.inputs
  return !!inputs?.some((i) => i.component === 'events')
}

/**
 * 该组件是否读取 `Layout.width/height` 这个整体尺寸盒子——编辑器侧判定，**只问 inputs 结构**：
 * - 声明了 `x`+`y` → 自定位，通常配 STAGE_FILL，不消费宽高滑杆
 * - 声明了拍点（`qteCues`）或选项清单（`events`）→ 在铺满盒内自绘，同样不消费
 * 不按 component id 枚举。
 */
export function isSizable(componentId: string): boolean {
  const plugin = getComponent(componentId)
  if (!plugin) return true
  const keys = new Set((plugin.inputs ?? []).map((i) => i.key))
  if (keys.has('x') && keys.has('y')) return false
  if (hasCuePointsInput(componentId) || hasOptionEventsInput(componentId)) return false
  return true
}

/**
 * 该组件是否**可交互**（有可触发的出口事件）——从组件契约 derive（manifest.events，
 * 含从 inputs.events 折出的），不按 component id 硬编码。运行时点击只落在可交互组件的热区上，
 * 故重叠遮挡风险只在两个可交互组件之间。重叠判定用**真实渲染的可点热区**（见
 * OverlayCatalogPreview 的 DOM 测量），不用 layout 框——多数交互皮肤是「铺满层里放锚点按钮」，
 * layout 框反映不出真实热区。
 */
export function isInteractive(componentId: string): boolean {
  return (getComponentManifest(componentId)?.events?.length ?? 0) > 0
}

/**
 * 画布定位模式（从组件**现有** inputs 推导，不加 manifest 字段）：
 * 组件已暴露 `x`/`y` 输入槽（字幕/选项/飘字等，本就是位置控件）→ 位置存 `inputs.x/y`；
 * 否则 → `layout.left/top`。满屏组件无需特判：其内容铺满画面，拖拽被「不溢出」钳制天然锁死。
 */
export type PositionMode = { kind: 'inputs'; xKey: string; yKey: string } | { kind: 'layout' }
export function positionModeOf(componentId: string): PositionMode {
  const inputs = getComponentManifest(componentId)?.inputs ?? []
  if (inputs.some((i) => i.key === 'x') && inputs.some((i) => i.key === 'y')) {
    return { kind: 'inputs', xKey: 'x', yKey: 'y' }
  }
  return { kind: 'layout' }
}

// ── 尺寸（width/height 归一化 0~1，相对舞台）——对所有组件通用，对应 `Layout.width/height` ──────
// 与 PositionEditor 同一套「slider + 百分比读数」范式；未开启时 = undefined（沿用皮肤自身尺寸/
// fit-content），开启后写入 Layout.width/height——预览与全屏试玩共用同一份 childWrapStyle 换算
// SSOT（见 runtime/schema/layout.ts），两边看到的百分比含义完全一致。
export function SizeEditor({
  width,
  height,
  onChange,
  disabled,
}: {
  width: number | undefined
  height: number | undefined
  onChange: (next: Pick<Layout, 'width' | 'height'>) => void
  /**
   * 该组件不读 Layout 盒子（`isSizable()` 为 false）时置灰：拖动滑杆预览/试玩
   * 都不会有任何变化，不能悄悄啥都不做，得显式说明，否则会被当成「拖了没反应，是不是坏了」的 bug。
   */
  disabled?: boolean
}): JSX.Element {
  const hasW = typeof width === 'number'
  const hasH = typeof height === 'number'
  return (
    <>
      <div className="gc-field-row">
        <label>
          <span>
            <input type="checkbox" checked={hasW} disabled={disabled} onChange={(e) => onChange({ width: e.target.checked ? (width ?? 0.3) : undefined })} />
            {' '}{translateUi('ui.copy.6395f44b7357')}{hasW ? `${Math.round(width! * 100)}%` : translateUi('ui.copy.2484f5fdb0f1')}
          </span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            disabled={disabled || !hasW}
            value={hasW ? Math.round(width! * 100) : 30}
            onChange={(e) => onChange({ width: Number(e.target.value) / 100 })}
          />
        </label>
        <label>
          <span>
            <input type="checkbox" checked={hasH} disabled={disabled} onChange={(e) => onChange({ height: e.target.checked ? (height ?? 0.3) : undefined })} />
            {' '}{translateUi('ui.copy.b096b3f5acd6')}{hasH ? `${Math.round(height! * 100)}%` : translateUi('ui.copy.2484f5fdb0f1')}
          </span>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            disabled={disabled || !hasH}
            value={hasH ? Math.round(height! * 100) : 30}
            onChange={(e) => onChange({ height: Number(e.target.value) / 100 })}
          />
        </label>
      </div>
      {disabled ? (
        <div className="gc-inspector-hint" title={translateUi('ui.copy.3d6ae2fe624a')}>
          {translateUi('ui.copy.74de1f68615c')}</div>
      ) : null}
    </>
  )
}

// ── NumOrExpr（常量 / 状态绑定 / 具名公式）────────────────────────────────────
export function ValueInput({
  value,
  defaultValue,
  onChange,
  entities,
  variables,
  formulas,
  itemIds,
  effectOp,
  fieldLabels,
  fieldLabelWidth,
  onClear,
  emptyWhenUndefined,
  emptyLabel,
  preferredEntityIds,
  preferredAttrIds,
  allowAttribute,
  createAttribute,
  createEntity,
  createVariable,
  createFormula,
  stackControls,
  assignmentLayout,
  propertyLayout,
}: {
  value: NumOrExpr | string | undefined
  defaultValue?: number
  onChange: (v: NumOrExpr) => void
  onClear?: () => void
  emptyWhenUndefined?: boolean
  emptyLabel?: string
  preferredEntityIds?: readonly string[]
  preferredAttrIds?: readonly string[]
  allowAttribute?: (entity: Entity | undefined, attrId: string) => boolean
  createAttribute?: ValueExprAttributeCreateConfig
  createEntity?: ValueExprEntityCreateConfig
  createVariable?: ValueExprVariableCreateConfig
  createFormula?: ValueExprFormulaCreateConfig
  stackControls?: boolean
  assignmentLayout?: boolean
  propertyLayout?: boolean
  /** 挂了这个 = 这个值要配一个 Effect「运算」符号按钮，嵌进编辑器顶部（跟常量/选取公式同一行）。 */
  effectOp?: { op: EffectDisplayOp; onOpChange: (next: EffectDisplayOp) => void }
  fieldLabels?: { source: string; value: string }
  fieldLabelWidth?: CSSProperties['width']
} & MetaCatalogProps): JSX.Element {
  return (
    <div className="value-input-shell" style={{ flex: 1, minWidth: 0 }}>
      <ValueExprEditor
        value={value ?? defaultValue}
        entities={entities}
        variables={variables}
        formulas={formulas}
        onChange={onChange}
        onClear={onClear}
        emptyWhenUndefined={emptyWhenUndefined}
        emptyLabel={emptyLabel}
        effectOp={effectOp}
        preferredEntityIds={preferredEntityIds}
        preferredAttrIds={preferredAttrIds}
        allowAttribute={allowAttribute}
        createAttribute={createAttribute}
        createEntity={createEntity}
        createVariable={createVariable}
        createFormula={createFormula}
        fieldLabels={fieldLabels}
        fieldLabelWidth={fieldLabelWidth}
        stackControls={stackControls}
        assignmentLayout={assignmentLayout}
        propertyLayout={propertyLayout}
        numericOnly
      />
    </div>
  )
}

export function TextValueInput({
  value,
  onChange,
  entities,
  variables,
  formulas,
  preferredEntityIds,
  entityNameOnly,
  createAttribute,
  createEntity,
  createVariable,
  createFormula,
  stackControls,
  propertyLayout,
}: {
  value: TextOrRef | undefined
  onChange: (v: TextOrRef) => void
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
  formulas?: Record<string, Formula>
  preferredEntityIds?: readonly string[]
  entityNameOnly?: boolean
  createAttribute?: ValueExprAttributeCreateConfig
  createEntity?: ValueExprEntityCreateConfig
  createVariable?: ValueExprVariableCreateConfig
  createFormula?: ValueExprFormulaCreateConfig
  stackControls?: boolean
  propertyLayout?: boolean
}): JSX.Element {
  return (
    <div className="text-value-input-shell" style={{ flex: 1, minWidth: 0 }}>
      <TextValueEditor
        value={value}
        entities={entities}
        variables={variables}
        formulas={formulas}
        preferredEntityIds={preferredEntityIds}
        entityNameOnly={entityNameOnly}
        createAttribute={createAttribute}
        createEntity={createEntity}
        createVariable={createVariable}
        createFormula={createFormula}
        stackControls={stackControls}
        propertyLayout={propertyLayout}
        onChange={onChange}
      />
    </div>
  )
}

export function EntitySelect({
  value,
  entities,
  createEntity,
  onChange,
}: {
  value: string
  entities: Record<string, Entity> | undefined
  createEntity?: ValueExprEntityCreateConfig
  onChange: (id: string) => void
}): JSX.Element {
  const [createDrafts, setCreateDrafts] = useState<Record<string, {
    entityId: string
    name: string
  }>>({})
  const opts = listEntityOptions(entities)
  const known = new Set(opts.map((option) => option.id))
  const pickerOptions: CascadingPickerOption[] = [
    ...opts.map((option) => ({
      key: `entity:${encodeURIComponent(option.id)}`,
      label: option.label,
      value: option.id,
    })),
    ...(value && !known.has(value) ? [{
      key: `missing:${encodeURIComponent(value)}`,
      label: `${value}${translateUi('ui.object.56ebcf99736b')}`,
      value,
      disabled: true,
    }] : []),
  ]
  if (createEntity) {
    const template = createEntity.template ?? {
      entityId: nextCatalogId('entity', entities),
      name: translateUi('cascade.default.entity'),
    }
    const defaultId = nextAvailableCatalogId(template.entityId, entities)
    const draftKey = `create-effect-entity:${encodeURIComponent(defaultId)}`
    const defaults = { entityId: defaultId, name: template.name }
    const draft = { ...defaults, ...createDrafts[draftKey] }
    const entityId = draft.entityId.trim()
    const actionKey = `${draftKey}:confirm`
    const patch = (change: Partial<typeof defaults>): void => {
      setCreateDrafts((current) => ({
        ...current,
        [draftKey]: { ...defaults, ...current[draftKey], ...change },
      }))
    }
    pickerOptions.push({
      key: `configure:${actionKey}`,
      presentation: 'create',
      label: formatUi('cascade.create.entity', { name: draft.name.trim() || entityId || defaultId }),
      children: [
        {
          key: `detail:${actionKey}:name`,
          label: translateUi('cascade.field.entityName'),
          editor: {
            value: draft.name,
            ariaLabel: translateUi('cascade.aria.entityName'),
            onChange: (next) => patch({ name: next }),
          },
        },
        {
          key: actionKey,
          label: translateUi('ui.object.f4ed02d48c46'),
          value: actionKey,
          presentation: 'confirm',
          disabled: !entityId || catalogIdOccupied(entities, entityId),
        },
      ],
    })
    const select = (selected: string): void => {
      if (selected !== actionKey) {
        onChange(selected)
        return
      }
      createEntity.onCreate({
        ...template,
        entityId,
        name: draft.name.trim(),
      })
      onChange(entityId)
    }
    return (
      <CascadingPicker
        ariaLabel="实体"
        value={value}
        displayValue={opts.find((option) => option.id === value)?.label ?? value}
        placeholder={translateUi('ui.copy.bfac98c6c0a0')}
        options={pickerOptions}
        onSelect={select}
        narrowSafe
      />
    )
  }
  return (
    <NiSelect value={value} onChange={onChange} style={{ flex: 1 }}>
      <option value="" disabled={pickerOptions.length > 0}>{translateUi('ui.copy.221bbd8719c4')}</option>
      {opts.map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
      {value && !known.has(value) ? (
        <option value={value} disabled>{value}{translateUi('ui.copy.9f2484ac56e6')}</option>
      ) : null}
    </NiSelect>
  )
}

/** 属性下拉：依 `entityId` 实时扫该实体的 attrs（复用同一份 metaCatalog，与 EntitySelect 同源联动）。 */
export function AttrSelect({
  entityId,
  value,
  entities,
  fallbackValues,
  createAttribute,
  onChange,
}: {
  entityId: string
  value: string
  entities: Record<string, Entity> | undefined
  fallbackValues?: readonly string[]
  createAttribute?: ValueExprAttributeCreateConfig
  onChange: (attr: string) => void
}): JSX.Element {
  const [createDrafts, setCreateDrafts] = useState<Record<string, {
    attrId: string
    label: string
    initialValue: string
  }>>({})
  if (!entityId) {
    return (
      <NiSelect value="" onChange={onChange} disabled style={{ flex: 1 }}>
        <option value="">{translateUi('ui.copy.93dce2515d0a')}</option>
      </NiSelect>
    )
  }
  const entity = findEntity(entities, entityId)
  const attrs = listAttrOptions(entity)
  const known = new Set(attrs.map((attr) => attr.id))
  const fallbacks = (fallbackValues ?? [])
    .filter((id, index, all) => id && !known.has(id) && all.indexOf(id) === index)
    .map((id) => ({ id, label: `${id}${translateUi('ui.object.8471b4016ab5')}` }))
  const options = [...attrs, ...fallbacks]
  const pickerOptions: CascadingPickerOption[] = options.map((attr) => ({
    key: `attr:${encodeURIComponent(attr.id)}`,
    label: attr.label,
    secondaryText: known.has(attr.id) ? attrValueText(entity, attr.id) : undefined,
    value: attr.id,
  }))
  if (createAttribute) {
    const template = createAttribute.template ?? {
      attrId: 'attr0',
      initialValue: 0,
      meta: { label: translateUi('cascade.default.attribute'), initial: 0 },
    }
    const occupied = new Set([
      ...Object.keys(entity?.attrs ?? {}),
      ...Object.keys(entity?.attrMeta ?? {}),
    ])
    let defaultAttrId = template.attrId
    if (occupied.has(defaultAttrId)) {
      const suffix = /^(.*?)(\d+)$/.exec(defaultAttrId)
      const prefix = suffix?.[1] ?? defaultAttrId
      let index = suffix ? Number(suffix[2]) + 1 : 2
      while (occupied.has(`${prefix}${index}`)) index += 1
      defaultAttrId = `${prefix}${index}`
    }
    const draftKey = `create-effect-attr:${encodeURIComponent(entityId)}:${encodeURIComponent(defaultAttrId)}`
    const defaults = {
      attrId: defaultAttrId,
      label: template.meta?.label ?? template.attrId,
      initialValue: String(template.initialValue),
    }
    const draft = { ...defaults, ...createDrafts[draftKey] }
    const attrId = draft.attrId.trim()
    const initialValue = draft.initialValue.trim() ? Number(draft.initialValue) : Number.NaN
    const validInitialValue = Number.isFinite(initialValue)
    const occupiedAttr = Object.hasOwn(entity?.attrs ?? {}, attrId)
      || Object.hasOwn(entity?.attrMeta ?? {}, attrId)
    const actionKey = `${draftKey}:confirm`
    const request: EntityAttributeCreateRequest = {
      ...template,
      entityId,
      attrId,
      initialValue: validInitialValue ? initialValue : 0,
      meta: {
        ...template.meta,
        label: draft.label.trim() || undefined,
        initial: validInitialValue ? initialValue : 0,
      },
    }
    const patch = (change: Partial<typeof defaults>): void => {
      setCreateDrafts((current) => ({
        ...current,
        [draftKey]: { ...defaults, ...current[draftKey], ...change },
      }))
    }
    pickerOptions.push({
      key: `configure:${actionKey}`,
      presentation: 'create',
      label: formatUi('cascade.create.attribute', { name: draft.label.trim() || attrId || defaultAttrId }),
      children: [
        {
          key: `detail:${actionKey}:label`,
          label: translateUi('cascade.field.attributeName'),
          editor: {
            value: draft.label,
            ariaLabel: translateUi('cascade.aria.attributeName'),
            onChange: (next) => patch({ label: next }),
          },
        },
        {
          key: `detail:${actionKey}:initial`,
          label: translateUi('cascade.field.initialValue'),
          editor: {
            value: draft.initialValue,
            ariaLabel: translateUi('cascade.aria.attributeInitialValue'),
            inputMode: 'decimal',
            invalid: !validInitialValue,
            onChange: (next) => patch({ initialValue: next }),
          },
        },
        {
          key: actionKey,
          label: translateUi('ui.object.f4ed02d48c46'),
          value: actionKey,
          presentation: 'confirm',
          disabled: !attrId || occupiedAttr || !validInitialValue,
        },
      ],
    })
    const select = (selected: string): void => {
      if (selected !== actionKey) {
        onChange(selected)
        return
      }
      createAttribute.onCreate(request)
      onChange(attrId)
    }
    return (
      <CascadingPicker
        ariaLabel="属性"
        value={value}
        displayValue={attrDisplayName(entity, value)}
        placeholder={translateUi('ui.copy.fadd7c88f54f')}
        options={pickerOptions}
        onSelect={select}
        narrowSafe
      />
    )
  }
  return (
    <NiSelect value={value} onChange={onChange} style={{ flex: 1 }}>
      <option value="" disabled={options.length > 0}>{translateUi('ui.copy.f271d5ff29e5')}</option>
      {options.map((attr) => (
        <option key={attr.id} value={attr.id}>{attr.label}</option>
      ))}
    </NiSelect>
  )
}

function VarSelect({
  value,
  variables,
  flagsOnly,
  numbersOnly,
  valueType,
  onChange,
}: {
  value: string
  variables: Record<string, Variable> | undefined
  flagsOnly?: boolean
  numbersOnly?: boolean
  valueType?: 'number' | 'text' | 'all'
  onChange: (id: string) => void
}): JSX.Element {
  const opts = listVarOptions(variables, {
    flagsOnly,
    valueType: valueType ?? (numbersOnly ? 'number' : 'all'),
  })
  return (
    <NiSelect value={value} onChange={onChange} style={{ flex: 1 }}>
      <option value="" disabled={opts.length > 0}>{translateUi('ui.copy.185fdb554da6')}</option>
      {opts.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </NiSelect>
  )
}

// ── effects ───────────────────────────────────────────────────────────────────
type EffectKind = GraphEffect['kind']
// 「标记」(flag) 从新建下拉隐藏（避免与「变量」混淆）；已有 flag 数据仍可编辑。
const EFFECT_KINDS: EffectKind[] = ['attr', 'var', 'item']

/** 新建一条效果的默认值（属性 / 变量 / …）；供 EffectsEditor 与「＋ 添加效果」动作共用。 */
export function createDefaultEffect(
  kind: EffectKind,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): GraphEffect {
  const ent = listEntityOptions(entities)[0]?.id ?? ''
  const attr = listAttrOptions(findEntity(entities, ent))[0]?.id ?? 'hp'
  const numVar = listVarOptions(variables, { numbersOnly: true })[0]?.id ?? ''
  const flagVar = listVarOptions(variables, { flagsOnly: true })[0]?.id ?? ''
  switch (kind) {
    case 'attr':
      return { kind: 'attr', entityId: ent, attr, op: 'add', value: 0 }
    case 'var':
      return { kind: 'var', varId: numVar, op: 'add', value: 0 }
    case 'flag':
      return { kind: 'flag', varId: flagVar, value: true }
    case 'item':
      return { kind: 'item', itemId: '', op: 'give', count: 1 }
  }
}

function defaultEffect(
  kind: EffectKind,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): GraphEffect {
  return createDefaultEffect(kind, entities, variables)
}

/** 折叠标题只标识效果目标；操作和值由展开后的控件展示。 */
function summarizeEffect(
  eff: GraphEffect,
  entities?: Record<string, Entity>,
  variables?: Record<string, Variable>,
): string {
  const kind = EFFECT_KIND_LABEL[eff.kind] ?? eff.kind
  const entLabel = (id: string) => listEntityOptions(entities).find((o) => o.id === id)?.label ?? id
  const varLabel = (id: string) => listVarOptions(variables).find((o) => o.id === id)?.label ?? id
  const attrLabel = (entityId: string, attr: string) =>
    listAttrOptions(findEntity(entities, entityId)).find((a) => a.id === attr)?.label ?? attr
  switch (eff.kind) {
    case 'attr':
      return `${kind} · ${entLabel(eff.entityId)} 的 ${attrLabel(eff.entityId, eff.attr)}`
    case 'var':
      return `${kind} · ${varLabel(eff.varId)}`
    case 'flag':
      return `${kind} · ${varLabel(eff.varId)} 设为 ${eff.value ? '是' : '否'}`
    case 'item':
      return `${kind} · ${OP_LABEL[eff.op] ?? eff.op} ${eff.itemId || '？'} ×${eff.count}`
  }
}

function EffectRow({
  eff,
  allowedKinds,
  entities,
  variables,
  formulas,
  itemIds,
  createAttribute,
  createEntity,
  createVariable,
  createFormula,
  onChange,
  onDelete,
  canUndoOp,
  onOpSnapshot,
  onUndoOp,
  labelWidth,
  propertyLayout = false,
}: {
  eff: GraphEffect
  allowedKinds: readonly EffectKind[]
  onChange: (e: GraphEffect) => void
  onDelete: () => void
  createAttribute?: ValueExprAttributeCreateConfig
  createEntity?: ValueExprEntityCreateConfig
  createVariable?: ValueExprVariableCreateConfig
  createFormula?: ValueExprFormulaCreateConfig
  /** 本行运算符撤回：canUndoOp = 有快照可撤；onOpSnapshot = 变换前存快照；onUndoOp = 执行撤回。 */
  canUndoOp?: boolean
  onOpSnapshot?: (snap: { op: NumericEffectOp; value: NumOrExpr }) => void
  onUndoOp?: () => void
  labelWidth?: CSSProperties['width']
  propertyLayout?: boolean
} & MetaCatalogProps): JSX.Element {
  const entityOpts = listEntityOptions(entities)
  const flagVars = listVarOptions(variables, { flagsOnly: true })
  const summary = summarizeEffect(eff, entities, variables)
  const isTextVarEffect = eff.kind === 'var' && eff.valueType === 'text'
  const operation = eff.kind === 'attr' || (eff.kind === 'var' && !isTextVarEffect)
    ? decodeEffectOperation(eff.op, eff.value)
    : undefined
  const selectableKinds = allowedKinds.includes(eff.kind)
    ? allowedKinds
    : [...allowedKinds, eff.kind]

  const handleOpChange = (nextDisplayOp: EffectDisplayOp): void => {
    if (!operation) return
    if (eff.kind !== 'attr' && (eff.kind !== 'var' || eff.valueType === 'text')) return
    const next = encodeEffectOperation(nextDisplayOp, operation.value)
    if (next.op === eff.op && numOrExprEqual(next.value, eff.value)) return
    onOpSnapshot?.({ op: eff.op, value: eff.value })
    if (eff.kind === 'attr') {
      onChange({ ...eff, ...next })
    } else if (eff.kind === 'var') {
      onChange({ ...eff, ...next })
    }
  }

  const handleValueChange = (value: NumOrExpr): void => {
    if (!operation) return
    const next = encodeEffectOperation(operation.op, value)
    if (eff.kind === 'attr') {
      onChange({ ...eff, ...next })
    } else if (eff.kind === 'var' && eff.valueType !== 'text') {
      onChange({ ...eff, ...next })
    }
  }

  if (propertyLayout && operation && (eff.kind === 'attr' || eff.kind === 'var')) {
    const subjectValue = compileValuePick({
      mode: 'pick',
      terms: [eff.kind === 'attr'
        ? { op: '+', source: 'entity', refId: eff.entityId, attr: eff.attr }
        : { op: '+', source: 'var', refId: eff.varId }],
    })
    const selectSubject = (next: NumOrExpr): void => {
      const selected = resolveValuePick(next, entities, variables)
      if (selected.mode !== 'pick') return
      const term = selected.terms[0]
      if (term?.source === 'entity' && term.refId && term.attr) {
        onChange({ kind: 'attr', entityId: term.refId, attr: term.attr, ...encodeEffectOperation(operation.op, operation.value) })
      } else if (term?.source === 'var' && term.refId) {
        onChange({ kind: 'var', varId: term.refId, ...encodeEffectOperation(operation.op, operation.value) })
      }
    }
    return (
      <div data-effect-editor data-property-effect-editor>
        <div className="editor-property-cascade-field">
          <span>{translateUi('ui.copy.e860084e32ad')}</span>
          <ValueExprEditor
            value={subjectValue}
            entities={entities}
            variables={variables}
            formulas={formulas}
            createAttribute={createAttribute}
            createEntity={createEntity}
            createVariable={createVariable}
            allowedSources={['entity', 'var']}
            pickerAriaLabel="效果主体"
            numericOnly
            stackControls
            onChange={selectSubject}
          />
        </div>
        <div className="editor-property-assign-field">
          <span>{translateUi('ui.copy.adba59233ed3')}</span>
          <ValueInput
            value={operation.value}
            entities={entities}
            variables={variables}
            formulas={formulas}
            createAttribute={createAttribute}
            createEntity={createEntity}
            createVariable={createVariable}
            createFormula={createFormula}
            effectOp={{ op: operation.op, onOpChange: handleOpChange }}
            assignmentLayout
            onChange={handleValueChange}
          />
        </div>
      </div>
    )
  }

  return (
    <div data-effect-editor style={box}>
      <div style={rowStyle}>
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0 }} title={summary}>
          {summary}
        </span>
        {(eff.kind === 'attr' || eff.kind === 'var') && canUndoOp && (
          <button
            type="button"
            style={{ marginLeft: 'auto', cursor: 'pointer' }}
            onClick={onUndoOp}
            title={translateUi('ui.copy.8634002f994f')}
          >
            {translateUi('ui.copy.f16418c45919')}</button>
        )}
        <button
          type="button"
          style={(eff.kind === 'attr' || eff.kind === 'var') && canUndoOp ? { ...del, marginLeft: 4 } : del}
          onClick={onDelete}
          title={`${translateUi('ui.template.a9bbc10e1c98')}${summary}`}
        >
          {translateUi('ui.copy.3755f56f2f83')}</button>
      </div>
      {field('类型', (
        <NiSelect
          value={eff.kind}
          onChange={(value) => onChange(defaultEffect(value as EffectKind, entities, variables))}
          title={`${translateUi('ui.template.68b336f93820')}${allowedKinds.map((kind) => EFFECT_KIND_LABEL[kind] ?? kind).join(' / ')}`}
        >
          {selectableKinds.map((k) => (
            <option key={k} value={k}>{EFFECT_KIND_LABEL[k] ?? k}</option>
          ))}
        </NiSelect>
      ), labelWidth)}
      {eff.kind === 'attr' && (
        <>
          {entityOpts.length === 0 && <p style={hint}>{translateUi('ui.copy.862f9f65032b')}</p>}
          {field('实体', (
            <EntitySelect
              value={eff.entityId}
              entities={entities}
              createEntity={createEntity}
              onChange={(entityId) => {
                const attr = listAttrOptions(findEntity(entities, entityId))[0]?.id ?? eff.attr
                onChange({ ...eff, entityId, attr })
              }}
            />
          ), labelWidth)}
          {field('属性', (
            <AttrSelect
              entityId={eff.entityId}
              value={eff.attr}
              entities={entities}
              createAttribute={createAttribute}
              onChange={(attr) => onChange({ ...eff, attr })}
            />
          ), labelWidth)}
          {field('操作', (
            <EffectOpButtons op={operation?.op ?? eff.op} onChange={handleOpChange} />
          ), labelWidth)}
          <ValueInput
            value={operation?.value ?? eff.value}
            entities={entities}
            variables={variables}
            formulas={formulas}
            createAttribute={createAttribute}
            createEntity={createEntity}
            createVariable={createVariable}
            createFormula={createFormula}
            onChange={handleValueChange}
            fieldLabels={{ source: '数值来源', value: '数值' }}
            fieldLabelWidth={labelWidth}
          />
        </>
      )}
      {eff.kind === 'var' && (
        <>
          {listVarOptions(variables, { valueType: 'all' }).length === 0 && <p style={hint}>{translateUi('ui.copy.fc21a3d3c6f5')}</p>}
          {field('变量', (
            <VarSelect
              value={eff.varId}
              variables={variables}
              valueType="all"
              onChange={(varId) => {
                if (variableValueKind(variables?.[varId]) === 'text') {
                  onChange({ kind: 'var', varId, valueType: 'text', op: 'set', value: '' })
                  return
                }
                onChange({
                  kind: 'var',
                  varId,
                  valueType: 'number',
                  ...encodeEffectOperation(operation?.op ?? 'add', operation?.value ?? 0),
                })
              }}
            />
          ), labelWidth)}
          {eff.valueType === 'text' ? (
            <>
              {field('操作', <span>{translateUi('interactionPlan.operation.set')}</span>, labelWidth)}
              <TextValueInput
                value={eff.value}
                entities={entities}
                variables={variables}
                formulas={formulas}
                createAttribute={createAttribute}
                createEntity={createEntity}
                createVariable={createVariable}
                createFormula={createFormula}
                onChange={(value) => onChange({ ...eff, value: textValueFromEditor(value) })}
              />
            </>
          ) : (
            <>
              {field('操作', (
                <EffectOpButtons op={operation?.op ?? eff.op} onChange={handleOpChange} />
              ), labelWidth)}
              <ValueInput
                value={operation?.value ?? eff.value}
                entities={entities}
                variables={variables}
                formulas={formulas}
                createAttribute={createAttribute}
                createEntity={createEntity}
                createVariable={createVariable}
                createFormula={createFormula}
                onChange={handleValueChange}
                fieldLabels={{ source: '数值来源', value: '数值' }}
                fieldLabelWidth={labelWidth}
              />
            </>
          )}
        </>
      )}
      {eff.kind === 'flag' && (
        <>
          {flagVars.length === 0 && <p style={hint}>{translateUi('ui.copy.39f606411e29')}</p>}
          {field('标记', (
            <VarSelect
              value={eff.varId}
              variables={variables}
              flagsOnly
              onChange={(varId) => onChange({ ...eff, varId })}
            />
          ), labelWidth)}
          {field('值', (
            <NiSelect value={String(eff.value)} onChange={(value) => onChange({ ...eff, value: value === 'true' })}>
              <option value="true">{translateUi('ui.copy.30160a21b92a')}</option>
              <option value="false">{translateUi('ui.copy.8bf5c10ad937')}</option>
            </NiSelect>
          ), labelWidth)}
        </>
      )}
      {eff.kind === 'item' && (
        <>
          {field('道具', <ItemIdEditor value={eff.itemId} itemIds={itemIds ?? []} onChange={(itemId) => onChange({ ...eff, itemId })} />, labelWidth)}
          {field('操作', (
            <NiSelect value={eff.op} onChange={(value) => onChange({ ...eff, op: value as 'give' | 'take' })}>
              <option value="give">{translateUi('ui.copy.137e9fdd5786')}</option>
              <option value="take">{translateUi('ui.copy.e832acd8cfbb')}</option>
            </NiSelect>
          ), labelWidth)}
          {field('数量', <LooseNumberInput value={eff.count} emptyValue={0} onChange={(count) => onChange({ ...eff, count })} style={{ width: 90 }} />, labelWidth)}
        </>
      )}
    </div>
  )
}

export function EffectsEditor({
  value,
  onChange,
  entities,
  variables,
  formulas,
  itemIds,
  pickers,
  createAttribute,
  createEntity,
  createVariable,
  createFormula,
  labelWidth,
  allowAdd = true,
  allowedKinds = EFFECT_KINDS,
  propertyLayout = false,
}: {
  value: GraphEffect[] | undefined
  onChange: (v: GraphEffect[]) => void
  pickers?: EditorPickerCtx
  createAttribute?: ValueExprAttributeCreateConfig
  createEntity?: ValueExprEntityCreateConfig
  createVariable?: ValueExprVariableCreateConfig
  createFormula?: ValueExprFormulaCreateConfig
  labelWidth?: CSSProperties['width']
  allowAdd?: boolean
  /** 限制新建/切换效果时可选择的类型；既有的其他类型仍保留显示，避免静默改写历史数据。 */
  allowedKinds?: readonly EffectKind[]
  propertyLayout?: boolean
} & MetaCatalogProps): JSX.Element {
  const cat = resolveCatalog({ entities, variables, formulas, itemIds, pickers })
  const list = value ?? []
  // 每行的运算符撤回栈（按行 index 存于父层——EffectsEditor 不会因单行 onChange 重挂，故栈稳定）。
  // 每次运算符变换（+ − × ÷ =）前把变换前的 {op, value} 压栈；撤回弹一步（连点 N 次可撤 N 次），
  // 栈空 → 撤回键置灰。切节点/重开抽屉时本组件重挂，栈天然重置（以「本次打开」为分界）。
  const opStacks = useRef<Map<number, { op: NumericEffectOp; value: NumOrExpr }[]>>(new Map())
  const [, bumpUndo] = useState(0)
  return (
    <div>
      {list.map((eff, i) => (
        <EffectRow
          key={i}
          eff={eff}
          allowedKinds={allowedKinds}
          entities={cat.entities}
          variables={cat.variables}
          formulas={cat.formulas}
          itemIds={cat.itemIds}
          createAttribute={createAttribute}
          createEntity={createEntity}
          createVariable={createVariable}
          createFormula={createFormula}
          labelWidth={labelWidth}
          propertyLayout={propertyLayout}
          onChange={(next) => onChange(list.map((e, idx) => (idx === i ? next : e)))}
          onDelete={() => { opStacks.current.delete(i); onChange(list.filter((_, idx) => idx !== i)) }}
          canUndoOp={(opStacks.current.get(i)?.length ?? 0) > 0}
          onOpSnapshot={(snap) => {
            const stack = opStacks.current.get(i) ?? []
            stack.push(snap)
            opStacks.current.set(i, stack)
            bumpUndo((n) => n + 1)
          }}
          onUndoOp={() => {
            const stack = opStacks.current.get(i)
            const snap = stack?.pop()
            if (!snap) return
            const cur = list[i]
            if (cur && (cur.kind === 'attr' || (cur.kind === 'var' && cur.valueType !== 'text'))) {
              const reverted: GraphEffect = { ...cur, op: snap.op, value: snap.value }
              onChange(list.map((e, idx) => (idx === i ? reverted : e)))
            }
            bumpUndo((n) => n + 1)
          }}
        />
      ))}
      {allowAdd ? (
        <button style={{ marginTop: 4 }} onClick={() => onChange([...list, defaultEffect('attr', cat.entities, cat.variables)])}>{translateUi('ui.copy.fd5d72c9a748')}</button>
      ) : null}
    </div>
  )
}

// ── condition（GraphCondition = { all: GraphClause[] }）────────────────────────
type ClauseType = GraphClause['type']
// score 当前没有写入效果或正式业务来源，不再提供新建入口；历史 score 条件仍可编辑。
const CLAUSE_TYPES: ClauseType[] = ['attrRatio', 'attr', 'attrCompare', 'var', 'flag', 'visited', 'hasItem']

function defaultClause(
  type: ClauseType,
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): GraphClause {
  const ents = listEntityOptions(entities)
  const ent = ents[0]?.id ?? ''
  const ent2 = ents[1]?.id ?? ent
  const attr = listAttrOptions(findEntity(entities, ent))[0]?.id ?? 'hp'
  const numVar = listVarOptions(variables, { numbersOnly: true })[0]?.id ?? ''
  const flagVar = listVarOptions(variables, { flagsOnly: true })[0]?.id ?? ''
  switch (type) {
    case 'var':
      return { type: 'var', varId: numVar, op: 'gte', value: 0 }
    case 'flag':
      return { type: 'flag', varId: flagVar, equals: true }
    case 'visited':
      return { type: 'visited', nodeId: '' }
    case 'attr':
      return { type: 'attr', entityId: ent, attr, op: 'lte', value: 0 }
    case 'attrRatio':
      return { type: 'attrRatio', entityId: ent, attr, op: 'lte', value: 0 }
    case 'attrCompare':
      return { type: 'attrCompare', left: ent, right: ent2, attr: listAttrOptions(findEntity(entities, ent)).find((a) => a.id === 'speed')?.id ?? attr, op: 'gte' }
    case 'score':
      return { type: 'score', op: 'gte', value: 0 }
    case 'hasItem':
      return { type: 'hasItem', itemId: '', count: 1 }
  }
}

const opSelect = (op: CmpOp, onChange: (op: CmpOp) => void): JSX.Element => (
  <NiSelect ariaLabel="比较运算符" value={op} onChange={(value) => onChange(value as CmpOp)}>
    {CMP_OPS.map((o) => (
      <option key={o} value={o}>{CMP_LABEL[o]}</option>
    ))}
  </NiSelect>
)

function ClauseRow({
  clause,
  nodeIds,
  entities,
  variables,
  itemIds,
  nodeLabel,
  onChange,
  onDelete,
}: {
  clause: GraphClause
  nodeIds: string[]
  nodeLabel?: (id: string) => string
  onChange: (c: GraphClause) => void
  onDelete: () => void
} & MetaCatalogProps): JSX.Element {
  const clauseTypes = clause.type === 'score'
    ? [...CLAUSE_TYPES, 'score' as ClauseType]
    : CLAUSE_TYPES
  return (
    <div style={box}>
      <div style={rowStyle}>
        <NiSelect ariaLabel="条件字段类型" value={clause.type} onChange={(value) => onChange(defaultClause(value as ClauseType, entities, variables))}>
          {clauseTypes.map((t) => (
            <option key={t} value={t}>{CLAUSE_LABEL[t] ?? t}</option>
          ))}
        </NiSelect>
        <button style={del} onClick={onDelete}>{translateUi('ui.copy.3755f56f2f83')}</button>
      </div>
      {(clause.type === 'attr' || clause.type === 'attrRatio') && (
        <>
          {field('实体', (
            <EntitySelect
              value={clause.entityId}
              entities={entities}
              onChange={(entityId) => {
                const attr = listAttrOptions(findEntity(entities, entityId))[0]?.id ?? clause.attr
                onChange({ ...clause, entityId, attr })
              }}
            />
          ))}
          {field('属性', (
            <AttrSelect
              entityId={clause.entityId}
              value={clause.attr}
              entities={entities}
              onChange={(attr) => onChange({ ...clause, attr })}
            />
          ))}
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
          {field('值', <LooseNumberInput aria-label={translateUi('ui.copy.f4643126b81d')} value={clause.value} emptyValue={0} onChange={(value) => onChange({ ...clause, value })} style={{ width: 90 }} />)}
        </>
      )}
      {clause.type === 'attrCompare' && (
        <>
          {field('左', (
            <EntitySelect value={clause.left} entities={entities} onChange={(left) => onChange({ ...clause, left })} />
          ))}
          {field('右', (
            <EntitySelect value={clause.right} entities={entities} onChange={(right) => onChange({ ...clause, right })} />
          ))}
          {field('属性', (
            <AttrSelect
              entityId={clause.left}
              value={clause.attr}
              entities={entities}
              onChange={(attr) => onChange({ ...clause, attr })}
            />
          ))}
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
        </>
      )}
      {clause.type === 'var' && (
        <>
          {field('变量', (
            <VarSelect
              value={clause.varId}
              variables={variables}
              valueType="all"
              onChange={(varId) => {
                if (variableValueKind(variables?.[varId]) === 'text') {
                  onChange({ type: 'var', varId, valueType: 'text', op: 'eq', value: '' })
                  return
                }
                onChange({ type: 'var', varId, valueType: 'number', op: clause.op, value: typeof clause.value === 'number' ? clause.value : 0 })
              }}
            />
          ))}
          {clause.valueType === 'text' ? (
            <>
              {field('op', (
                <NiSelect ariaLabel="比较运算符" value={clause.op} onChange={(value) =>
                  onChange({ ...clause, op: value as 'eq' | 'neq' })}
                >
                  <option value="eq">=</option>
                  <option value="neq">≠</option>
                </NiSelect>
              ))}
              <TextValueInput
                value={clause.value}
                entities={entities}
                variables={variables}
                onChange={(value) => onChange({ ...clause, value: textValueFromEditor(value) })}
              />
            </>
          ) : (
            <>
              {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
              {field('值', <LooseNumberInput aria-label={translateUi('ui.copy.f4643126b81d')} value={clause.value} emptyValue={0} onChange={(value) => onChange({ ...clause, value })} style={{ width: 90 }} />)}
            </>
          )}
        </>
      )}
      {clause.type === 'flag' && (
        <>
          {field('标记', (
            <VarSelect
              value={clause.varId}
              variables={variables}
              flagsOnly
              onChange={(varId) => onChange({ ...clause, varId })}
            />
          ))}
          {field('等于', (
            <NiSelect value={String(clause.equals)} onChange={(value) => onChange({ ...clause, equals: value === 'true' })}>
              <option value="true">{translateUi('ui.copy.30160a21b92a')}</option>
              <option value="false">{translateUi('ui.copy.8bf5c10ad937')}</option>
            </NiSelect>
          ))}
        </>
      )}
      {clause.type === 'visited' && field('节点', (
        <NiSelect value={clause.nodeId} onChange={(nodeId) => onChange({ ...clause, nodeId })} style={{ flex: 1 }}>
          <option value="">{translateUi('ui.copy.a6e6eb462001')}</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>{nodeLabel?.(id) ?? id}</option>
          ))}
        </NiSelect>
      ))}
      {clause.type === 'score' && (
        <>
          {field('op', opSelect(clause.op, (op) => onChange({ ...clause, op })))}
          {field('值', <LooseNumberInput aria-label={translateUi('ui.copy.f4643126b81d')} value={clause.value} emptyValue={0} onChange={(value) => onChange({ ...clause, value })} style={{ width: 90 }} />)}
        </>
      )}
      {clause.type === 'hasItem' && (
        <>
          {field('道具', <ItemIdEditor value={clause.itemId} itemIds={itemIds ?? []} onChange={(itemId) => onChange({ ...clause, itemId })} />)}
          {field('拥有数量至少', <LooseNumberInput value={clause.count ?? 1} emptyValue={1} onChange={(count) => onChange({ ...clause, count })} style={{ width: 90 }} />)}
        </>
      )}
    </div>
  )
}

export function ConditionEditor({
  value,
  nodeIds,
  onChange,
  entities,
  variables,
  itemIds,
  pickers,
}: {
  value: GraphCondition | undefined
  nodeIds: string[]
  onChange: (v: GraphCondition | undefined) => void
  pickers?: EditorPickerCtx
} & MetaCatalogProps): JSX.Element {
  const cat = resolveCatalog({ entities, variables, itemIds, pickers })
  const all = value?.all ?? []
  const set = (next: GraphClause[]) => onChange(next.length ? { all: next } : undefined)
  return (
    <div>
      {all.length === 0 && <div style={{ opacity: 0.5, fontSize: 11 }}>{translateUi('ui.copy.560ad76cf06c')}</div>}
      {all.map((c, i) => (
        <ClauseRow
          key={i}
          clause={c}
          nodeIds={nodeIds}
          entities={cat.entities}
          variables={cat.variables}
          itemIds={cat.itemIds}
          nodeLabel={cat.nodeLabel}
          onChange={(next) => set(all.map((x, idx) => (idx === i ? next : x)))}
          onDelete={() => set(all.filter((_, idx) => idx !== i))}
        />
      ))}
      <button style={{ marginTop: 4 }} onClick={() => set([...all, defaultClause('attrRatio', cat.entities, cat.variables)])}>{translateUi('ui.copy.b94240f27168')}</button>
    </div>
  )
}

// ── 交互事件目录（共享 id/label；choice→condition / hotspot→x,y 为组件私有扩展）──
function allocEventId(list: ComponentEventLike[]): string {
  let i = list.length
  let id = `opt${i}`
  const used = new Set(list.map((e) => e.id))
  while (used.has(id)) {
    i += 1
    id = `opt${i}`
  }
  return id
}

export function EventsEditor({
  value,
  onChange,
  variant = 'plain',
  pickers,
}: {
  value: ComponentEventLike[] | undefined
  onChange: (v: ComponentEventLike[]) => void
  /** plain=目录；choice=可配门控；hotspot=可配锚点。 */
  variant?: EventsEditorVariant
  pickers?: EditorPickerCtx
}): JSX.Element {
  const list = value ?? []
  const cat = pickers ?? {}
  const patch = (i: number, p: Partial<ComponentEventLike>) => onChange(list.map((e, idx) => (idx === i ? { ...e, ...p } : e)))
  return (
    <div>
      <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }}>
        {translateUi('ui.copy.b40c5f0b636c')}<code>{translateUi('ui.copy.21680ce50c8d')}</code>{translateUi('ui.copy.a5969803df38')}{variant === 'choice' ? translateUi('ui.copy.e3d3cae00cdd') : null}
        {variant === 'hotspot' ? translateUi('ui.copy.c370d5122882') : null}
      </div>
      {list.map((o, i) => (
        <div key={`${o.id}-${i}`} style={box}>
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4 }} title={o.id}>
            {translateUi('ui.copy.578c1bbb3c8d')}{flowHandleDisplay(o.id, o.label)}
          </div>
          {field('标识', (
            <input
              value={o.id}
              onChange={(e) => patch(i, { id: e.target.value })}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
              title={translateUi('ui.copy.3d9c0e02d971')}
            />
          ))}
          {field('显示文案', <input value={o.label ?? ''} onChange={(e) => patch(i, { label: e.target.value })} style={{ flex: 1 }} />)}
          {variant === 'hotspot' ? (
            <div style={{ display: 'flex', gap: 4 }}>
              {field('x', (
                <input type="number" step={0.05} value={o.x ?? ''} onChange={(e) => patch(i, { x: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ flex: 1, fontSize: 11 }} />
              ))}
              {field('y', (
                <input type="number" step={0.05} value={o.y ?? ''} onChange={(e) => patch(i, { y: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ flex: 1, fontSize: 11 }} />
              ))}
            </div>
          ) : null}
          {variant === 'choice' ? (
            <>
              <div style={{ fontSize: 11, opacity: 0.7, margin: '4px 0 2px' }}>{translateUi('ui.copy.87fe0545b72e')}</div>
              <ConditionEditor
                value={o.condition}
                nodeIds={[]}
                pickers={cat}
                entities={cat.entities}
                variables={cat.variables}
                onChange={(condition) => patch(i, { condition: condition ?? undefined })}
              />
            </>
          ) : null}
          <button style={{ ...del, marginTop: 4 }} onClick={() => onChange(list.filter((_, idx) => idx !== i))}>{translateUi('ui.copy.3755f56f2f83')}</button>
        </div>
      ))}
      <button
        style={{ marginTop: 4 }}
        onClick={() => {
          const id = allocEventId(list)
          onChange([...list, { id, label: `${translateUi('ui.object.9ab489a37074')}${list.length + 1}` }])
        }}
      >
        {translateUi('ui.copy.16b57b58a995')}</button>
    </div>
  )
}
