import { t as translateUi } from '../../i18n'
/**
 * 按组件 `ComponentManifest.inputs` 渲染 overlay child 的输入：
 * 有 `component`（color/entity/attr/events/hotspotEvents/effects/textStyle/qteCues…）优先用对应输入组件；
 * 否则按 `valueType`（string/number/boolean + `options`→select）出标量控件。
 *
 * 复合输入（`component: textStyle/effects/events/hotspotEvents/qteCues`，或 valueType='json'）：
 * events/hotspotEvents/effects 出结构化编辑器，textStyle/qteCues 暂交「视频」轨编辑器（见 docs/inputs-ssot.md）。
 * 填了 `component` 优先用它，否则按 valueType。
 * `component: 'entity'`：场景实体下拉（复用 EffectsEditor 同源的 EntitySelect，见 editors.tsx / metaCatalog.ts）。
 * `component: 'attr'`：实体属性下拉——实时扫**同一 inputs 里 `component: 'entity'` 那一项**当前选中的实体的
 * attrs（复用同一份 AttrSelect，见 editors.tsx；与 EffectRow/ClauseRow 的实体→属性级联同源），实体项一变属性下拉即联动刷新。
 */
import { useState, type CSSProperties, type JSX } from 'react'
import type { ComponentInput } from '@/runtime/core/schema/node-config-schema'
import type { Entity, NumOrExpr } from '@/runtime/core/schema/graph-schema'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { hasOptionEventsInput } from './editors'
import { AttrSelect, EffectsEditor, EntitySelect, EventsEditor, TextValueInput, ValueInput, type ComponentEventLike, type EditorPickerCtx } from './editors'
import type { TextOrRef } from './TextValueEditor'
import { ColorPicker } from './ColorPicker'
import { KeyConflictInput } from './KeyConflictInput'
import { NiSelect } from './ni-ui'
import { entityDisplayName, findEntity, listAttrOptions } from './valueExprPick'
import type {
  EntityAttributeCreateRequest,
  EntityCreateRequest,
  FormulaCreateRequest,
  VariableCreateRequest,
} from '@/authoring/formulas/meta-catalog'
import type { KeyBindingConflict } from './keyBindingConflicts'
import { conflictForInput, keyConflictTooltip } from './keyBindingConflicts'

/** 右栏/检视器传入的按键冲突上下文；缺省则不做按键重复校验 UI。 */
export interface KeyBindingConflictContext {
  overlayId: string
  childId: string
  conflicts: ReadonlyMap<string, KeyBindingConflict>
}

/**
 * events 编辑器的 variant 由触发的输入标记本身决定，不查组件 id 也不查任何跨组件分类表：
 * 标记是 `hotspotEvents` ⇒ 画面锚点 x/y；标记是 `events` 时再问 registry「这个组件的 inputs
 * 里有没有出口清单结构」（`hasOptionEventsInput`）来决定是「可配门控 condition」还是纯出口目录。
 */
function eventsVariantFor(componentId: string, marker: string): 'plain' | 'choice' | 'hotspot' {
  if (marker === 'hotspotEvents') return 'hotspot'
  return hasOptionEventsInput(componentId) ? 'choice' : 'plain'
}

const rowStyle: CSSProperties = { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }
const lbl: CSSProperties = { width: 72, opacity: 0.7, flexShrink: 0, fontSize: 11 }
const DEFAULT_COMPACT_LABEL_WIDTH = '7em'
const COMPACT_CONTROL_WIDTH = 320
const DEFAULT_HP_ATTRIBUTE: EntityAttributeCreateRequest = {
  entityId: '',
  attrId: 'hp',
  initialValue: 100,
  meta: { label: '生命', initial: 100, min: 0, max: 100 },
}

export type EntityAttributeCreateHandler = (request: EntityAttributeCreateRequest) => void
export type EntityCreateHandler = (request: EntityCreateRequest) => void
export type VariableCreateHandler = (request: VariableCreateRequest) => void
export type FormulaCreateHandler = (request: FormulaCreateRequest) => void

function MissingAttributeCreateControl({
  entity,
  entityId,
  attrId,
  onCreate,
}: {
  entity: Entity
  entityId: string
  attrId: string
  onCreate: EntityAttributeCreateHandler
}): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const displayName = entityDisplayName(entity, entityId)
  const entityLabel = displayName === entityId ? entityId : `${displayName}（${entityId}）`
  const request: EntityAttributeCreateRequest = {
    ...DEFAULT_HP_ATTRIBUTE,
    entityId,
    attrId,
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="gc-mini-action"
        aria-label={`${translateUi('ui.template.089144e3fe97')}${attrId}`}
        title={`${translateUi('ui.template.d7246cf37a3b')}${entityLabel}${translateUi('ui.template.b046e7f83030')}${attrId}」`}
        onClick={() => setConfirming(true)}
        style={{ fontSize: 11, whiteSpace: 'nowrap' }}
      >
        {translateUi('ui.copy.bbac96591084')}</button>
    )
  }

  return (
    <div
      role="alertdialog"
      aria-label={`${translateUi('ui.template.0763228c7ca1')}${attrId}`}
      style={{
        flexBasis: '100%',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto auto',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        border: '1px solid rgba(224,163,95,0.45)',
        borderRadius: 6,
        background: 'rgba(200,149,90,0.1)',
        color: '#e7d7c2',
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      <span>
        {translateUi('ui.copy.6a16bc35a166')}{entityLabel}{translateUi('ui.copy.64538b19bfaa')}{attrId}{translateUi('ui.copy.c2d26a8d5b42')}</span>
      <button
        type="button"
        className="gc-mini-action is-on"
        onClick={() => {
          onCreate(request)
          setConfirming(false)
        }}
      >
        {translateUi('ui.copy.bd5ef91d969e')}</button>
      <button type="button" className="gc-mini-action" onClick={() => setConfirming(false)}>
        {translateUi('ui.copy.4d0b4688c787')}</button>
    </div>
  )
}

function fieldHint(inp: ComponentInput): string {
  const name = inp.label ?? inp.key
  const parts = [`${name}（inputs.${inp.key}）`]
  if (inp.component) parts.push(`类型：${inp.component}`)
  else parts.push(`类型：${inp.valueType}`)
  if (inp.options?.length) parts.push(`可选：${inp.options.map((o) => o.label || o.value).join(' / ')}`)
  if (inp.default !== undefined) parts.push(`默认：${typeof inp.default === 'object' ? JSON.stringify(inp.default) : String(inp.default)}`)
  return parts.join(' · ')
}

function defaultPlaceholder(inp: ComponentInput): string | undefined {
  if (inp.default === undefined || inp.default === null || typeof inp.default === 'object') return undefined
  return String(inp.default)
}

function field(label: string, node: JSX.Element, title?: string): JSX.Element {
  return (
    <div className="cff-field-layout" style={rowStyle} title={title}>
      <span style={lbl}>{label}</span>
      {node}
    </div>
  )
}

function compactField(
  label: string,
  node: JSX.Element,
  title: string,
  labelWidth?: CSSProperties['width'],
  controlWidth?: CSSProperties['width'],
): JSX.Element {
  return (
    <div
      className="cff-field-layout"
      style={{
        display: 'grid',
        gridTemplateColumns: `${labelWidth ?? DEFAULT_COMPACT_LABEL_WIDTH} minmax(0, ${controlWidth ?? `${COMPACT_CONTROL_WIDTH}px`})`,
        alignItems: 'center',
        columnGap: 10,
        width: '100%',
        minWidth: 0,
        fontSize: 11,
        marginBottom: 4,
      }}
      title={title}
    >
      <span style={{
        opacity: 0.55,
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {node}
    </div>
  )
}

function patchValue(
  values: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  // 空字符串是文字组件作者明确配置的内容；只有 undefined 才表示移除覆盖并回退默认值。
  if (value === undefined) {
    const { [key]: _drop, ...rest } = values
    return rest
  }
  return { ...values, [key]: value }
}

/**
 * `component: 'attr'` 依赖同一 inputs 列表里 `component: 'entity'` 那一项的当前取值——
 * 即「属性」总是跟随「实体」联动（对齐 EffectRow/ClauseRow 里 entityId→attr 的下拉级联）。
 * 取第一个 entity 项即可：目前一个组件最多一个实体绑定入口（如 battleHpBar 的 bind）。
 */
function boundEntityId(inputs: ComponentInput[], values: Record<string, unknown>): string {
  const entityInput = inputs.find((i) => i.component === 'entity')
  const v = entityInput ? values[entityInput.key] : undefined
  if (typeof v === 'string') return v
  return typeof entityInput?.default === 'string' ? entityInput.default : ''
}

/**
 * 切换实体时同步修正依赖它的属性字段。
 *
 * 旧属性若在新实体上仍存在则保留；否则优先使用 manifest 默认属性，再回落到新实体首个属性。
 * 默认属性继续保持稀疏存储，只有非默认选择才写入 inputs。
 */
function patchEntityBinding(
  inputs: ComponentInput[],
  values: Record<string, unknown>,
  entityKey: string,
  entityId: string,
  entities: Record<string, Entity> | undefined,
): Record<string, unknown> {
  let next = patchValue(values, entityKey, entityId || undefined)
  const attrs = listAttrOptions(findEntity(entities, entityId))
  const attrIds = new Set(attrs.map((attr) => attr.id))

  for (const attrInput of inputs.filter((input) => input.component === 'attr')) {
    const storedValue = values[attrInput.key]
    const stored = typeof storedValue === 'string' ? storedValue : ''
    const fallback = typeof attrInput.default === 'string' ? attrInput.default : ''
    const current = stored || fallback
    if (current && attrIds.has(current)) continue

    const selected = fallback && attrIds.has(fallback) ? fallback : (attrs[0]?.id ?? '')
    next = patchValue(next, attrInput.key, selected === fallback ? undefined : selected)
  }
  return next
}

function isHpBarComponent(componentId: string): boolean {
  return componentId === 'BattlePlayerHpBar' || componentId === 'BattleEnemyHpBar'
}

function preferredEntityIds(
  componentId: string,
  entities: Record<string, Entity> | undefined,
): string[] | undefined {
  const role = componentId === 'BattleEnemyHpBar'
    ? /enemy|boss|foe|敌|怪|首领/i
    : componentId === 'BattlePlayerHpBar'
      ? /player|hero|ally|玩家|主角|我方/i
      : undefined
  if (!role) return undefined
  const ids = Object.values(entities ?? {})
    .filter((entity) => role.test([entity.id, entity.kind, entity.name].filter(Boolean).join(' ')))
    .map((entity) => entity.id)
  return ids.length ? ids : undefined
}

type AttributeSemantic = 'current-hp' | 'max-hp' | 'current-qi' | 'max-qi'

function attributeSemantic(componentId: string, inputKey: string): AttributeSemantic | undefined {
  if (componentId !== 'BattlePlayerHpBar' && componentId !== 'BattleEnemyHpBar') return undefined
  if (inputKey === 'current') return 'current-hp'
  if (inputKey === 'max') return 'max-hp'
  if (inputKey === 'qi') return 'current-qi'
  if (inputKey === 'qiMax') return 'max-qi'
  return undefined
}

const SEMANTIC_FALLBACK_IDS: Record<AttributeSemantic, readonly string[]> = {
  'current-hp': ['hp', 'health'],
  'max-hp': ['hpMax', 'maxHp', 'healthMax', 'maxHealth'],
  'current-qi': ['qi', 'energy', 'rage'],
  'max-qi': ['qiMax', 'maxQi', 'energyMax', 'maxEnergy', 'rageMax', 'maxRage'],
}

function normalizedSemanticText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.\-—:：/\\()[\]（）【】]/g, '')
}

function labelMatchesSemantic(label: string, semantic: AttributeSemantic): boolean {
  const text = normalizedSemanticText(label)
  const maximum = /最大|上限|峰值|maximum|max|limit|cap/.test(text)
  const hp = /血量|生命值?|health|hitpoints?|hp/.test(text)
  const qi = /气力|能量|怒气|energy|rage|mana|qi/.test(text)
  if (semantic === 'current-hp') return hp && !maximum
  if (semantic === 'max-hp') return hp && maximum
  if (semantic === 'current-qi') return qi && !maximum
  return qi && maximum
}

function attributeMatchesSemantic(
  entity: Entity | undefined,
  attrId: string,
  semantic: AttributeSemantic,
): boolean {
  const displayName = entity?.attrMeta?.[attrId]?.label?.trim()
  if (displayName) return labelMatchesSemantic(displayName, semantic)
  return SEMANTIC_FALLBACK_IDS[semantic].some((candidate) =>
    candidate.toLowerCase() === attrId.toLowerCase())
}

function attributeCreateTemplate(
  componentId: string,
  inputKey: string,
): Omit<EntityAttributeCreateRequest, 'entityId'> | undefined {
  if (!isHpBarComponent(componentId)) return undefined
  if (inputKey === 'current') {
    return {
      attrId: 'hp',
      initialValue: 100,
      meta: { label: translateUi('ui.object.635dc61cf819'), initial: 100, min: 0, max: 100 },
    }
  }
  if (inputKey === 'max') {
    return {
      attrId: 'hpMax',
      initialValue: 100,
      meta: { label: translateUi('ui.object.50fc4aec16cd'), initial: 100, min: 0 },
    }
  }
  if (inputKey === 'qi') {
    return {
      attrId: 'qi',
      initialValue: 3,
      meta: { label: translateUi('ui.object.8d44ff0da992'), initial: 3, min: 0, max: 5 },
    }
  }
  if (inputKey === 'qiMax') {
    return {
      attrId: 'qiMax',
      initialValue: 5,
      meta: { label: translateUi('ui.object.4d294bcbda03'), initial: 5, min: 0 },
    }
  }
  return undefined
}

function entityCreateTemplate(componentId: string): EntityCreateRequest | undefined {
  if (componentId === 'BattleEnemyHpBar') {
    return { entityId: 'ent-boss', name: '敌方' }
  }
  if (componentId === 'BattlePlayerHpBar') {
    return { entityId: 'ent-player', name: '我方' }
  }
  return undefined
}

function isComplexInput(inp: ComponentInput): boolean {
  return (
    inp.component === 'events'
    || inp.component === 'hotspotEvents'
    || inp.component === 'effects'
    || inp.component === 'qteCues'
    || inp.component === 'textStyle'
  )
}

/** 出口事件清单类输入（分组时归「事件」组，其余 inputs 归「参数」组）。 */
function isEventInput(inp: ComponentInput): boolean {
  return inp.component === 'events' || inp.component === 'hotspotEvents'
}

/** 组内小标题：比 NodeInspector 的 sectionLabel 再低一级（更小更淡），标示 details 内部的分组。 */
function groupLabel(text: string): JSX.Element {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.5, letterSpacing: 0.4, margin: '0 0 3px' }}>
      {text}
    </div>
  )
}

function summarizeComplex(inp: ComponentInput, val: unknown): string {
  if (Array.isArray(val)) {
    if (inp.component === 'events' || inp.component === 'hotspotEvents') {
      const labels = val.map((e) => {
        if (e && typeof e === 'object' && 'label' in e && typeof (e as { label?: unknown }).label === 'string') {
          return (e as { label: string }).label
        }
        if (e && typeof e === 'object' && 'id' in e) return String((e as { id: unknown }).id)
        return '?'
      })
      return `${val.length} 项${labels.length ? `（${labels.slice(0, 4).join('·')}${labels.length > 4 ? '…' : ''}）` : ''}`
    }
    return `${val.length} 项`
  }
  if (inp.component) return `在「视频」轨配置`
  return '已配置'
}

/**
 * 复合输入（events / effects）在 compact 密度下的折叠壳。
 *
 * 右侧那个 `▾` 是必需的：`listStyle:'none'` 去掉了浏览器原生折叠三角，不补图标就看不出这一行
 * 可以点开去配（与 NodeInspector 的「组件」/「位置」折叠条同一套图标约定：右对齐、低透明度）。
 */
function complexDisclosure(key: string, head: string, hint: string, body: JSX.Element): JSX.Element {
  return (
    <details key={key} style={{ marginBottom: 4, fontSize: 11, width: '100%' }}>
      <summary
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          opacity: 0.85,
          listStyle: 'none',
        }}
        title={`${hint}${translateUi('ui.template.309cfbb1ce07')}`}
      >
        <span>{head}</span>
        <span style={{ opacity: 0.4, marginLeft: 'auto' }}>▾</span>
      </summary>
      <div style={{ marginTop: 4 }}>{body}</div>
    </details>
  )
}

function renderInput(
  componentId: string,
  inp: ComponentInput,
  inputs: ComponentInput[],
  values: Record<string, unknown>,
  onPatch: (key: string, value: unknown) => void,
  onValuesChange: (next: Record<string, unknown>) => void,
  pickers: EditorPickerCtx | undefined,
  compact: boolean,
  labelWidth?: CSSProperties['width'],
  controlWidth?: CSSProperties['width'],
  onCreateEntityAttribute?: EntityAttributeCreateHandler,
  onCreateEntity?: EntityCreateHandler,
  onCreateVariable?: VariableCreateHandler,
  onCreateFormula?: FormulaCreateHandler,
  stackExpressionControls = true,
  propertyLayout = false,
  keyConflicts?: KeyBindingConflictContext,
): JSX.Element | null {
  const val = values[inp.key]
  const label = inp.label ?? inp.key
  const hint = fieldHint(inp)
  const wrap = (node: JSX.Element): JSX.Element =>
    compact ? compactField(label, node, hint, labelWidth, controlWidth) : field(label, node, hint)
  const keyConflict = keyConflicts
    ? conflictForInput(keyConflicts.conflicts, keyConflicts.overlayId, keyConflicts.childId, inp.key)
    : undefined
  const keyConflictTip = keyConflictTooltip(keyConflict)

  // 有 component 优先用它渲染（复合编辑器）；events / effects 直接出结构化子编辑器，textStyle / qteCues 暂交「视频」轨。
  if (inp.component === 'events' || inp.component === 'hotspotEvents') {
    const body = (
      <EventsEditor
        value={Array.isArray(val) ? (val as ComponentEventLike[]) : undefined}
        variant={eventsVariantFor(componentId, inp.component)}
        pickers={pickers}
        onChange={(events) => onPatch(inp.key, events)}
      />
    )
    if (!compact) {
      return (
        <div key={inp.key} style={{ marginBottom: 6 }} title={hint}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
          {body}
        </div>
      )
    }
    return complexDisclosure(inp.key, `${label} · ${summarizeComplex(inp, val)}`, hint, body)
  }
  if (inp.component === 'effects') {
    const body = (
      <EffectsEditor
        value={Array.isArray(val) ? (val as never) : undefined}
        pickers={pickers}
        onChange={(effs) => onPatch(inp.key, effs)}
      />
    )
    if (!compact) {
      return (
        <div key={inp.key} style={{ marginBottom: 6 }} title={hint}>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>{label}</div>
          {body}
        </div>
      )
    }
    return complexDisclosure(inp.key, `${label} · ${summarizeComplex(inp, val)}`, hint, body)
  }
  if ((inp.valueType as string) === 'color' || inp.component === 'color') {
    return (
      <span key={inp.key}>
        {wrap(
          <ColorPicker
            value={typeof val === 'string' ? val : undefined}
            placeholder={defaultPlaceholder(inp)}
            onChange={(next) => onPatch(inp.key, next)}
          />,
        )}
      </span>
    )
  }
  if (inp.component === 'numberExpr') {
    const optional = inp.required !== true && inp.default === undefined
    const isNewComponent = !!getComponentManifest(componentId)
    const stackControls = compact && isNewComponent && stackExpressionControls
    const preferredEntities = preferredEntityIds(componentId, pickers?.entities)
    const semantic = attributeSemantic(componentId, inp.key)
    const semanticAttrIds = semantic ? SEMANTIC_FALLBACK_IDS[semantic] : undefined
    const createTemplate = attributeCreateTemplate(componentId, inp.key)
    const createEntityTemplate = entityCreateTemplate(componentId)
    const expressionEditor = inp.valueType === 'string' ? (
      <TextValueInput
        value={(val ?? inp.default) as TextOrRef | undefined}
        entities={pickers?.entities}
        variables={pickers?.variables}
        formulas={pickers?.formulas}
        preferredEntityIds={preferredEntities}
        entityNameOnly={
          (isHpBarComponent(componentId) && inp.key === 'label')
          || inp.key === 'speaker'
        }
        createAttribute={onCreateEntityAttribute
          ? {
            ...(createTemplate ? { template: createTemplate } : {}),
            onCreate: onCreateEntityAttribute,
          }
          : undefined}
        createEntity={onCreateEntity
          ? {
            ...(createEntityTemplate ? { template: createEntityTemplate } : {}),
            onCreate: onCreateEntity,
          }
          : undefined}
        createVariable={isNewComponent && onCreateVariable
          ? { onCreate: onCreateVariable }
          : undefined}
        createFormula={isNewComponent && onCreateFormula
          ? { onCreate: onCreateFormula }
          : undefined}
        stackControls={stackControls}
        propertyLayout={propertyLayout}
        onChange={(next) => onPatch(inp.key, next)}
      />
    ) : (
      <ValueInput
        value={val as NumOrExpr | string | undefined}
        defaultValue={typeof inp.default === 'number' ? inp.default : undefined}
        entities={pickers?.entities}
        variables={pickers?.variables}
        formulas={pickers?.formulas}
        preferredEntityIds={preferredEntities}
        preferredAttrIds={semanticAttrIds}
        allowAttribute={semantic
          ? (entity, attrId) => attributeMatchesSemantic(entity, attrId, semantic)
          : undefined}
        createAttribute={onCreateEntityAttribute
          ? {
            ...(createTemplate ? { template: createTemplate } : {}),
            onCreate: onCreateEntityAttribute,
          }
          : undefined}
        createEntity={onCreateEntity
          ? {
            ...(createEntityTemplate ? { template: createEntityTemplate } : {}),
            onCreate: onCreateEntity,
          }
          : undefined}
        createVariable={isNewComponent && onCreateVariable
          ? { onCreate: onCreateVariable }
          : undefined}
        createFormula={isNewComponent && onCreateFormula
          ? { onCreate: onCreateFormula }
          : undefined}
        stackControls={stackControls}
        propertyLayout={propertyLayout}
        onChange={(next) => onPatch(inp.key, next)}
        emptyWhenUndefined={optional}
      />
    )
    if (propertyLayout) {
      return (
        <div key={inp.key} className="editor-property-cascade-field" title={hint}>
          <span>{label}</span>
          {expressionEditor}
        </div>
      )
    }
    return (
      <div
        key={inp.key}
        style={{
          display: 'grid',
          gridTemplateColumns: `${labelWidth ?? 'max-content'} ${controlWidth === undefined
            ? 'minmax(0, 1fr)'
            : `minmax(0, ${controlWidth})`}`,
          columnGap: 8,
          alignItems: 'start',
          width: '100%',
          minWidth: 0,
          flexBasis: '100%',
          flexGrow: 0,
          flexShrink: 0,
          marginBottom: 6,
          fontSize: 11,
        }}
      >
        <span style={{ opacity: 0.55, flexShrink: 0, fontSize: 11, paddingTop: 6, whiteSpace: 'nowrap' }}>{label}</span>
        {expressionEditor}
      </div>
    )
  }
  if (inp.component === 'entity') {
    const entityId = typeof val === 'string' ? val : (typeof inp.default === 'string' ? inp.default : '')
    const missingTemplate = !!entityId && !findEntity(pickers?.entities, entityId)
    return (
      <span key={inp.key} style={missingTemplate && isHpBarComponent(componentId) ? { flexBasis: '100%', minWidth: 0 } : undefined}>
        {wrap(
          <EntitySelect
            value={entityId}
            entities={pickers?.entities}
            onChange={(id) => {
              if (isHpBarComponent(componentId)) {
                onValuesChange(patchEntityBinding(inputs, values, inp.key, id, pickers?.entities))
                return
              }
              onPatch(inp.key, id || undefined)
            }}
          />,
        )}
        {missingTemplate && isHpBarComponent(componentId) ? (
          <span
            role="status"
            style={{ display: 'block', margin: '2px 0 6px', color: '#e6a23c', fontSize: 11 }}
          >
            {translateUi('ui.copy.39c577165baa')}{entityId}{translateUi('ui.copy.5acbe5154d5a')}</span>
        ) : null}
      </span>
    )
  }
  if (inp.component === 'attr') {
    const attrValue = typeof val === 'string' ? val : (typeof inp.default === 'string' ? inp.default : '')
    const entityId = boundEntityId(inputs, values)
    const entity = findEntity(pickers?.entities, entityId)
    if (isHpBarComponent(componentId) && entityId && !entity) return null
    const declared = entity
      ? Object.hasOwn(entity.attrs ?? {}, attrValue) || Object.hasOwn(entity.attrMeta ?? {}, attrValue)
      : false
    const canCreate = isHpBarComponent(componentId)
      && attrValue === 'hp'
      && !!entity
      && !declared
      && !!onCreateEntityAttribute
    return (
      <div
        key={inp.key}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
          flexBasis: canCreate ? '100%' : undefined,
        }}
      >
        {wrap(
          <AttrSelect
            entityId={entityId}
            value={attrValue}
            entities={pickers?.entities}
            fallbackValues={isHpBarComponent(componentId) ? [attrValue] : undefined}
            onChange={(attr) => onPatch(inp.key, attr || undefined)}
          />,
        )}
        {canCreate ? (
          <MissingAttributeCreateControl
            entity={entity}
            entityId={entityId}
            attrId={attrValue}
            onCreate={onCreateEntityAttribute}
          />
        ) : null}
      </div>
    )
  }
  if (inp.component) {
    // 其它输入组件（textStyle / qteCues / 未接入的）暂交「视频」轨编辑器。
    const tip = `${hint} · 请用「${inp.component}」编辑器（暂在「视频」轨配置）`
    if (compact) {
      return (
        <span key={inp.key} style={{ fontSize: 11, opacity: 0.55 }} title={tip}>
          {label}{translateUi('ui.copy.676301f4abcb')}</span>
      )
    }
    return (
      <div key={inp.key} style={{ fontSize: 11, opacity: 0.55, marginBottom: 4 }} title={tip}>
        {label}{translateUi('ui.copy.c4052ee84f32')}{inp.component}{translateUi('ui.copy.38fac865d932')}</div>
    )
  }
  if (inp.options) {
    const selectedValue = typeof val === 'string'
      ? val
      : typeof inp.default === 'string' && inp.options.some((option) => option.value === inp.default)
        ? inp.default
        : (inp.options[0]?.value ?? '')
    return (
      <span key={inp.key}>
        {wrap(
          <NiSelect
            ariaLabel={label}
            value={selectedValue}
            onChange={(next) => onPatch(inp.key, next)}
            style={{
              width: compact ? '100%' : undefined,
              minWidth: 0,
              flex: compact ? undefined : 1,
              maxWidth: compact ? COMPACT_CONTROL_WIDTH : undefined,
              fontSize: 12,
            }}
            title={hint}
          >
            {inp.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </NiSelect>,
        )}
      </span>
    )
  }
  switch (inp.valueType) {
    case 'number':
      return (
        <span key={inp.key}>
          {wrap(
            <input
              type="number"
              value={typeof val === 'number' ? val : ''}
              placeholder={defaultPlaceholder(inp)}
              onChange={(e) => onPatch(inp.key, e.target.value === '' ? undefined : Number(e.target.value))}
              onBlur={(e) => {
                if (e.currentTarget.value === '' && typeof inp.default === 'number') {
                  onPatch(inp.key, inp.default)
                }
              }}
              style={{
                width: compact ? '100%' : undefined,
                minWidth: 0,
                flex: compact ? undefined : 1,
                maxWidth: compact ? COMPACT_CONTROL_WIDTH : undefined,
                fontSize: 12,
              }}
              title={hint}
            />,
          )}
        </span>
      )
    case 'boolean':
      return (
        <span key={inp.key}>
          {wrap(
            <input
              type="checkbox"
              checked={Boolean(val)}
              onChange={(e) => onPatch(inp.key, e.target.checked)}
              title={hint}
            />,
          )}
        </span>
      )
    case 'string':
    default: {
      const isKeyField = /key$/i.test(inp.key) || /按键/.test(label)
      if (isKeyField && keyConflicts) {
        return (
          <span key={inp.key}>
            {wrap(
              <KeyConflictInput
                value={typeof val === 'string' ? val : ''}
                placeholder={defaultPlaceholder(inp)}
                conflict={!!keyConflict}
                tooltip={keyConflictTip}
                onChange={(next) => onPatch(inp.key, next)}
                style={{
                  width: compact ? '100%' : undefined,
                  maxWidth: compact ? COMPACT_CONTROL_WIDTH : undefined,
                }}
              />,
            )}
          </span>
        )
      }
      return (
        <span key={inp.key}>
          {wrap(
            <input
              value={typeof val === 'string' ? val : ''}
              placeholder={defaultPlaceholder(inp)}
              onChange={(e) => onPatch(inp.key, e.target.value)}
              style={{
                width: compact ? '100%' : undefined,
                minWidth: 0,
                flex: compact ? undefined : 1,
                maxWidth: compact ? COMPACT_CONTROL_WIDTH : undefined,
                fontSize: 12,
              }}
              title={hint}
            />,
          )}
        </span>
      )
    }
  }
}

/** 摘要若干常见 inputs，供折叠标题一行展示。 */
export function summarizeComponentInputs(
  componentId: string,
  values: Record<string, unknown>,
): string {
  const bits: string[] = []
  const push = (key: string, fmt?: (v: unknown) => string) => {
    const v = values[key]
    if (v === undefined || v === '') return
    bits.push(fmt ? fmt(v) : `${key}=${String(v)}`)
  }
  push('x', (v) => `x=${v}`)
  push('y', (v) => `y=${v}`)
  push('timeoutMs', (v) => `${v}ms`)
  push('glyph')
  if (!isHpBarComponent(componentId)) push('label')
  push('bind')
  push('attr')
  push('speaker')
  push('text', (v) => `「${String(v).slice(0, 12)}${String(v).length > 12 ? '…' : ''}」`)
  push('value', (v) => {
    if (typeof v === 'number') return `数值=${v}`
    if (v && typeof v === 'object' && typeof (v as { expr?: unknown }).expr === 'string') {
      const expr = (v as { expr: string }).expr
      return `公式=${expr.slice(0, 16)}${expr.length > 16 ? '…' : ''}`
    }
    return `数值=${String(v)}`
  })
  if (Array.isArray(values.events)) {
    const evs = values.events as Array<{ id?: string; label?: string }>
    bits.push(evs.map((e) => e.label || e.id || '?').slice(0, 4).join('/'))
  }
  return bits.slice(0, 5).join(' · ')
}

/** 由组件 manifest.inputs 驱动的通用配置面板（标量 + select；复合项提示跳过）。 */
export function ComponentFormFields({
  componentId,
  values,
  onChange,
  pickers,
  includeKeys,
  excludeKeys,
  density = 'default',
  labelWidth,
  compactControlWidth,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  keyConflicts,
}: {
  componentId: string
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  pickers?: EditorPickerCtx
  /** 仅渲染指定字段；右栏按语义拆分配置分类时使用。 */
  includeKeys?: string[]
  /**
   * 排除某些字段——已有专属编辑器接管时用（如 x/y 走 PositionEditor、
   * speaker 走「显示说话人前缀」开关、events 走结算区自带的分支编辑）。
   */
  excludeKeys?: string[]
  /** compact：节点检视器窄栏；property：右侧属性栏双列，并让动态值内部横排。 */
  density?: 'default' | 'compact' | 'property'
  /** compact 模式的标签列宽；界面 Tab 使用足以容纳「总时长ms」的稳定宽度。 */
  labelWidth?: CSSProperties['width']
  /** compact 模式的控件列宽；省略时动态表达式继续占满剩余空间。 */
  compactControlWidth?: CSSProperties['width']
  /** 新血条绑定默认 hp 但实体未声明时，经二次确认后由场景持有者补建。 */
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  /** 新血条没有可选实体时，经二次确认后由场景持有者补建。 */
  onCreateEntity?: EntityCreateHandler
  /** 新组件动态值缺少变量时，经级联确认后补建到场景变量目录。 */
  onCreateVariable?: VariableCreateHandler
  /** 新组件动态值缺少公式时，经级联确认后补建到场景公式目录。 */
  onCreateFormula?: FormulaCreateHandler
  /** 交互按键重复冲突（右栏/方案编辑传入）。 */
  keyConflicts?: KeyBindingConflictContext
}): JSX.Element | null {
  const compact = density !== 'default'
  const propertyLayout = density === 'property'
  const allInputs = getComponentManifest(componentId)?.inputs ?? []
  const includedInputs = includeKeys
    ? allInputs.filter((input) => includeKeys.includes(input.key))
    : allInputs
  const inputs = excludeKeys?.length
    ? includedInputs.filter((inp) => !excludeKeys.includes(inp.key))
    : includedInputs
  if (!inputs.length) {
    return <div style={{ fontSize: 11, opacity: 0.5 }}>{translateUi('ui.copy.50601677bc5e')}{componentId}）</div>
  }
  const onPatch = (key: string, value: unknown) => onChange(patchValue(values, key, value))
  /**
   * 分两组呈现（平铺混排时看不出层次）：
   *  - **参数**：标量 + 需专属编辑器的结构化参数（拍点 / 文字样式…）——都是「这个组件长什么样、怎么判定」
   *  - **事件**：`events` / `hotspotEvents` 出口清单——即蓝图出边要接的那些 id，语义与参数不同层
   * 只有一组时不加组标题与分隔线，保持原样（如字幕/血条只有参数、热点只有事件）。
   */
  const params = inputs.filter((i) => !isEventInput(i))
  const events = inputs.filter(isEventInput)
  const paramScalars = params.filter((i) => !isComplexInput(i))
  const paramComplexes = params.filter(isComplexInput)
  const grouped = params.length > 0 && events.length > 0
  return (
    <div>
      {params.length > 0 ? (
        <div style={grouped ? { marginBottom: 6 } : undefined}>
          {grouped ? groupLabel('参数配置') : null}
          {compact ? (
            <div
              className={propertyLayout ? 'cff-property-grid' : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: propertyLayout ? 'repeat(2, minmax(0, 1fr))' : undefined,
                columnGap: propertyLayout ? 8 : undefined,
                gap: propertyLayout ? undefined : 2,
                alignItems: 'center',
                width: '100%',
                minWidth: 0,
              }}
            >
              {paramScalars.map((inp) => (
                <div
                  key={inp.key}
                  className={`cff-property-field${inp.component === 'numberExpr' ? ' is-expression' : ''}${inp.key === 'fixedText' ? ' is-full-width' : ''}`}
                  style={{
                    minWidth: 0,
                    gridColumn: propertyLayout && (inp.component === 'numberExpr' || inp.key === 'fixedText')
                      ? '1 / -1'
                      : undefined,
                  }}
                >
                  {renderInput(componentId, inp, inputs, values, onPatch, onChange, pickers, true, labelWidth, compactControlWidth, onCreateEntityAttribute, onCreateEntity, onCreateVariable, onCreateFormula, true, propertyLayout, keyConflicts)}
                </div>
              ))}
            </div>
          ) : (
            paramScalars.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, onChange, pickers, false, labelWidth, compactControlWidth, onCreateEntityAttribute, onCreateEntity, onCreateVariable, onCreateFormula, true, false, keyConflicts))
          )}
          {paramComplexes.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, onChange, pickers, compact, labelWidth, compactControlWidth, onCreateEntityAttribute, onCreateEntity, onCreateVariable, onCreateFormula, true, propertyLayout, keyConflicts))}
        </div>
      ) : null}
      {events.length > 0 ? (
        <div style={grouped ? { borderTop: '1px solid #2f2f2f', paddingTop: 5 } : undefined}>
          {grouped ? groupLabel('事件配置') : null}
          {events.map((inp) => renderInput(componentId, inp, inputs, values, onPatch, onChange, pickers, compact, labelWidth, compactControlWidth, onCreateEntityAttribute, onCreateEntity, onCreateVariable, onCreateFormula, true, propertyLayout, keyConflicts))}
        </div>
      ) : null}
    </div>
  )
}
