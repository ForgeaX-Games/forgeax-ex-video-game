import { t as translateUi } from '../../i18n'
import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { NodeAction, Overlay } from '@/runtime/core/schema/graph-schema'
import { EffectsEditor, createDefaultEffect, type EditorPickerCtx } from './editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from './component-form-fields'
import { DEFAULT_SPAWN_TTL_MS, spawnTemplateTtlMs } from '@/authoring/graph/timeline-geometry'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { ComponentInputsDisclosure } from './ComponentInputsDisclosure'
import { SelectDropdown } from './SelectDropdown'
import { NiAddMenu, NiChip, NiIcon, NiIconButton, NiSelect, useNiMenu, type NiMenuOption } from './ni-ui'

export interface ActionOption {
  value: string
  label: string
}

/**
 * 节点配置面板里的动作卡片外观（Figma 15635:81481 添加效果 / 15635:81539 新增节点连线）：
 * 新增入口不在这里，而在上方那条「事件响应」行上（见 `EventResponseRow`）。
 *
 * 卡片解剖与 `ComponentInputsDisclosure` 刻意同构：#1a1a1a 外壳 + 11px 白 50% 标签 +
 * #232323 嵌套控件 + 27px 控件高 + 10px 行距。
 *
 * 卡片里那些字段行由共享编辑器渲染（editors.tsx 的 `EffectsEditor` / `ValueExprEditor` /
 * `CascadingPicker` / `OpSymbolButtons`），它们同时服务仍是旧色板的 ScenarioInspector 与
 * ComponentPropertyPanel，所以一律不改它们自己的文件，只在 `.ni-root` 作用域里按新稿覆盖。
 * 本组件自己的行内 style 同理保留原值（组件属性面板还在用）。
 *
 * 每处 !important 都只为压掉共享文件写在元素上的行内 style，出了
 * `.ni-root .ni-na-card` 一概不生效；theme.ts 的通用 button 规则只有 (0,1,1)，
 * 本作用域的普通选择器就能压过，不需要为它加 !important。
 */
const NODE_ACTIONS_CSS = `
/* 「事件响应」整行可点：光标与 hover 反馈落在行上，右侧图标只是提示。 */
.ni-root .ni-na-row-trigger { cursor: pointer; }
.ni-root .ni-na-row-trigger:hover { border-color: var(--ni-w-20); }
.ni-root .ni-na-row-trigger:focus-visible { outline: 1px solid var(--ni-accent); outline-offset: 2px; }
.ni-root .ni-na-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--ni-w-60);
}
.ni-root .ni-na-row-trigger:hover .ni-na-row-icon { color: var(--ni-w-100); }
.ni-root .ni-na-row-chips {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

/* ── 卡片外壳 + 卡片头 ─────────────────────────────────────────────────── */
.ni-root .ni-na-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  background: var(--ni-input) !important;
  border: 0.611px solid var(--ni-w-08) !important;
  border-radius: var(--ni-radius) !important;
  padding: 5px 9.16px !important;
}
.ni-root .ni-na-card-head {
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  margin-bottom: 0 !important;
}
.ni-root .ni-na-card-title {
  min-width: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 稿子里那枚 12px 垃圾桶紧贴卡片右内边距；ni-icon-btn 的 20px 方格左右各富余 4px，补回去。 */
.ni-root .ni-na-card-head .ni-icon-btn { margin-right: -4px; }

/* ── 字段行：标签自然宽 + 控件 flex:1 0 0 ────────────────────────────────
 * 行容器与标签有三个来源：本文件的 field()（.ni-na-field）、editors.tsx 的 field()
 * （.editor-field-row）、ValueExprEditor 的「数值来源 / 数值」两行。
 * 后两者的 gap / marginBottom / 标签 width·opacity 都是行内值，只能 !important 压。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-root .ni-na-field {
  width: 100%;
  min-width: 0;
  gap: 10px !important;
  margin-bottom: 0 !important;
}
.ni-root .ni-na-card .editor-field-row {
  align-items: center;
  width: 100%;
  min-width: 0;
  gap: 10px !important;
  margin-bottom: 0 !important;
}
.ni-root .ni-na-card [data-value-expression],
.ni-root .ni-na-card [data-value-expression-source],
.ni-root .ni-na-card [data-value-expression-value] { gap: 10px !important; }
.ni-root .ni-na-field > span:first-child,
.ni-root .ni-na-card .editor-field-row > span:first-child,
.ni-root .ni-na-card [data-value-expression-source] > span:first-child,
.ni-root .ni-na-card [data-value-expression-value] > span:first-child {
  flex: none;
  width: auto !important;
  opacity: 1 !important;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
/* 「类型」那只下拉在 editors.tsx 里没有行内 flex，靠这条撑满行。 */
.ni-root .ni-na-card .editor-field-row > .ni-select-root { flex: 1 0 0; min-width: 0; }

/* 「新增节点连线」卡片里的目标节点行走 ni-ui 的 NiField（shared.tsx），默认标签在上，
   这里拉成与其它字段一致的一行；「从 X 到」里的节点名按稿子画成胶囊。 */
.ni-root .ni-na-card[data-action-kind='advance'] .ni-field { flex-direction: row; align-items: center; gap: 10px; }
.ni-root .ni-na-card[data-action-kind='advance'] .ni-field-label {
  flex: none;
  align-items: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
}
.ni-root .ni-na-card[data-action-kind='advance'] .ni-field-label > span {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 21.865px;
  max-width: 100%;
  overflow: hidden;
  padding: 2.082px 8.33px;
  background: var(--ni-w-20);
  border: 1.041px solid var(--ni-w-20);
  border-radius: 8.33px;
  font-size: 11.453px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ni-root .ni-na-card[data-action-kind='advance'] .ni-field-control { flex: 1 0 0; min-width: 0; }

/* ── 效果行：摊平共享编辑器自带的边框小盒 ─────────────────────────────── */
/* EffectsEditor 外面还包了一层无类名 div，它和每条 [data-effect-editor] 都并进卡片的行流。 */
.ni-root .ni-na-card[data-action-kind='effect'] > div:not(.ni-na-card-head),
.ni-root .ni-na-card [data-effect-editor] {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
/* editors.tsx 的 box 行内给了 1px #2a2a2a 边框 / 6px 圆角 / 6px 内边距 / 6px 上外边距。 */
.ni-root .ni-na-card [data-effect-editor] {
  margin-top: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
}
.ni-root .ni-na-card [data-effect-editor] > p { margin: 0 !important; }
/*
 * 每条效果自带的「摘要 + 撤回 / 删除」行。稿子里没有这一行——但它删的是本条效果，
 * 卡片头那枚垃圾桶删的是整条响应，两者不是一回事，所以留着，压成一条安静的小字行。
 * 摘要的 fontSize/fontWeight 与删除键的红色都是行内值。
 */
.ni-root .ni-na-card [data-effect-editor] > div:first-child {
  gap: 6px !important;
  margin-bottom: 0 !important;
}
.ni-root .ni-na-card [data-effect-editor] > div:first-child > span:first-child {
  color: var(--ni-w-40);
  font-size: 11px !important;
  font-weight: 400 !important;
}
.ni-root .ni-na-card [data-effect-editor] > div:first-child > button {
  flex: none;
  height: 18px;
  padding: 0 6px;
  background: transparent;
  border: 0;
  color: var(--ni-w-40) !important;
  font-size: 11px;
}
.ni-root .ni-na-card [data-effect-editor] > div:first-child > button:hover:not(:disabled) {
  background: var(--ni-w-05);
  color: var(--ni-w-100) !important;
}
/*
 * 每行的「删除」在这里没有意义，收起来。EffectsEditor 在本面板是 allowAdd={false}，
 * 一条 effect 动作永远只装一个效果，所以这个按钮只会把 effects 清成空数组、留下一条
 * 空动作；真正的「删掉这条响应」是卡片头那颗垃圾桶。旧色板面板可以加多个效果，
 * 那里仍然需要它，所以只在本作用域藏，不改 editors.tsx。
 * （撤回留着——它撤的是运算符变换，另一回事。）
 */
.ni-root .ni-na-card [data-effect-editor] > div:first-child > button:last-child { display: none; }

/* ── 控件壳：卡片是 #1a1a1a，里面的控件亮一档到 #232323（稿子 15635:81491） ──
 * 下拉现在一律是 NiSelect：可见的是 .ni-select-shell，尺寸与内边距由 ni-ui 自己给足
 * （壳外框 + 27px 触发行），这里只把底色抬到 #232323、字号拉到卡片档。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-root .ni-na-card input:not([type='range']):not([type='checkbox']):not([type='radio']),
.ni-root .ni-na-card .gc-cascade-trigger {
  box-sizing: border-box;
  height: var(--ni-control-h);
  min-height: var(--ni-control-h);
  padding: 5.498px 9.163px;
  background: #232323;
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  color: var(--ni-w-60);
  font-size: 11px;
}
.ni-root .ni-na-card .ni-select-shell { background: #232323; }
.ni-root .ni-na-card .ni-select-trigger { color: var(--ni-w-60); font-size: 11px; }
.ni-root .ni-na-card .gc-cascade-trigger {
  border-radius: var(--ni-radius);
  font-size: 11px;
}
/* 聚焦 / 展开态仍走面板的橙色描边：上面那条底色规则与 theme.ts 的对应规则权重打平、
   靠注入顺序取胜，会顺带把 accent 描边压掉，所以显式写回来（权重刻意高一档）。
   NiSelect 的壳只被改了底色，描边仍由 ni-ui 的 is-open / :focus-within 规则接管。 */
.ni-root .ni-na-card input:not([type='range']):not([type='checkbox']):not([type='radio']):focus,
.ni-root .ni-na-card .gc-cascade-trigger:hover,
.ni-root .ni-na-card .gc-cascade-trigger[aria-expanded='true'] {
  border-color: var(--ni-accent);
}
/* 稿子里每只下拉右侧都是同一枚 14px 展开箭头（14px 方格内 9.333×4.667 的 chevron）。
   这只 svg 的 viewBox 是 12×9，等比缩进 14×9.333 的框正好画出 9.333×4.667 的箭头。 */
.ni-root .ni-na-card .gc-cascade-trigger-arrow {
  width: 14px;
  height: 9.333px;
  margin: 0;
  opacity: 1;
}

/* ── 「操作」那五颗运算符：稿子是 27×27 的 #232323 方格（15635:81513…） ──
 * 字形仍是 OpSymbolButtons 的文本 + − × ÷ =，只换盒子。
 * minWidth / padding 是行内值；圆角要压 theme.ts 的按钮规则。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-root .ni-na-card .gc-op-symbols { flex: none; gap: 6px !important; }
.ni-root .ni-na-card .gc-op-symbols .gc-mini-action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 27px;
  height: 27px;
  min-width: 27px !important;
  padding: 0 !important;
  background: #232323;
  border: 0.61px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  color: var(--ni-w-60);
}
.ni-root .ni-na-card .gc-op-symbols .gc-mini-action:hover:not(:disabled) { border-color: var(--ni-w-20); color: var(--ni-w-100); }
.ni-root .ni-na-card .gc-op-symbols .gc-mini-action.is-on {
  background: var(--ni-w-20);
  border-color: var(--ni-w-20);
  color: var(--ni-w-100);
  font-weight: 400;
}

/* ── 「数值来源」：选中的来源在控件壳里画成胶囊（稿子 15635:81532） ──
 * 稿子画了「公式 + 公式名称」两颗，我们这只级联下拉的展示值本就是一个串，所以是一颗。
 * 未选态（is-placeholder）是一句长提示，不套胶囊。
 * ───────────────────────────────────────────────────────────────────────── */
.ni-root .ni-na-card [data-value-expression-source] .gc-cascade-trigger-label:not(.is-placeholder) {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  height: 21.865px;
  padding: 2.082px 8.33px;
  background: var(--ni-w-20);
  border: 1.041px solid var(--ni-w-20);
  border-radius: 8.33px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11.453px;
}

/* 「绑定界面」卡片里的「组件属性」小标题：与其它标签同档，行距交给卡片的 gap。 */
.ni-root .ni-na-card[data-action-kind='spawn'] > div:not(.ni-na-card-head) { margin-top: 0 !important; }
.ni-root .ni-na-card[data-action-kind='spawn'] > div:not(.ni-na-card-head) > div:first-child {
  margin: 0 0 10px !important;
  opacity: 1 !important;
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
  font-weight: 400 !important;
}
`

const SETTLEMENT_EFFECT_KINDS = ['attr', 'var'] as const

function replaceSpawnTemplate(
  action: Extract<NodeAction, { kind: 'spawn' }>,
  from: string,
): Extract<NodeAction, { kind: 'spawn' }> {
  const { inputs: _inputs, layout: _layout, ...lifecycle } = action
  return { ...lifecycle, from }
}

function resolveSpawnTemplate(from: string, overlays?: Record<string, Overlay>) {
  const slash = from.indexOf('/')
  if (slash < 0) return undefined
  const overlayId = from.slice(0, slash)
  const childId = from.slice(slash + 1)
  return overlays?.[overlayId]?.children.find((child) => child.id === childId)
}

/**
 * 新绑定一个界面时的显示时长：优先读模板 `window` 声明的可见长度，模板没声明结束时用
 * `DEFAULT_SPAWN_TTL_MS`。
 *
 * 不落成常驻是刻意的：常驻的结束固定在节点末端，拖动结算点会把界面拉长/压短，而作者的心智
 * 是「这个界面有个时长，整体跟着结算点平移」。要常驻在「消失方式」里显式选。
 */
function initialSpawnTtlMs(from: string, overlays?: Record<string, Overlay>): number {
  const template = resolveSpawnTemplate(from, overlays)
  return (template ? spawnTemplateTtlMs(template) : undefined) ?? DEFAULT_SPAWN_TTL_MS
}

function field(
  label: string,
  control: ReactNode,
  labelWidth?: CSSProperties['width'],
): JSX.Element {
  return (
    <label className="ni-na-field" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12, minWidth: 0 }}>
      <span style={{ width: labelWidth ?? 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>{control}</span>
    </label>
  )
}

/** 「添加动作」入口的文案；同时是触发器与候选浮层的无障碍名。 */
const ADD_ACTION_LABEL = '添加动作'
const ADD_ACTION_HINT = '选一种动作追加到本次响应'

/** 动作类型名：候选项与「事件响应」行上的胶囊共用同一套措辞。 */
const NODE_ACTION_KIND_LABEL: Record<NodeAction['kind'], string> = {
  effect: '添加效果',
  advance: '添加连线',
  spawn: '绑定界面',
  hideOverlay: '隐藏界面',
}

/**
 * 「添加动作」的候选树。
 *
 * 暂时用不了的类型不藏起来，而是置灰并把原因写进 tooltip——直接消失的话，作者只会以为
 * 这个动作类型根本不存在，不知道去「界面」里补一个模板就能用。
 * 「添加连线」是例外：一次响应只允许一条，已经有了就不该再出现在候选里。
 *
 * 「绑定界面」再挂一层子项（每个界面模板一项）：作者一次手势就选定模板，不用先落一条
 * 指向第一个模板的绑定、再回卡片里改。
 */
export function nodeActionAddOptions({
  actions,
  allowAdvance = true,
  allowSpawn = true,
  allowHideOverlay = false,
  spawnOptions,
  hideOverlayOptions = [],
}: {
  actions: NodeAction[]
  allowAdvance?: boolean
  allowSpawn?: boolean
  allowHideOverlay?: boolean
  spawnOptions: ActionOption[]
  hideOverlayOptions?: ActionOption[]
}): NiMenuOption[] {
  const options: NiMenuOption[] = [{ value: 'effect', label: NODE_ACTION_KIND_LABEL.effect }]
  if (allowAdvance && !actions.some((action) => action.kind === 'advance')) {
    options.push({ value: 'advance', label: NODE_ACTION_KIND_LABEL.advance })
  }
  if (allowSpawn) {
    options.push(spawnOptions.length
      ? {
          value: 'spawn',
          label: NODE_ACTION_KIND_LABEL.spawn,
          title: translateUi('ui.object.5269f6753abe'),
          children: spawnOptions.map((option) => ({ value: option.value, label: option.label })),
        }
      : {
          value: 'spawn',
          label: NODE_ACTION_KIND_LABEL.spawn,
          disabled: true,
          title: translateUi('ui.object.ed0914c542a5'),
        })
  }
  if (allowHideOverlay) {
    options.push(hideOverlayOptions.length
      ? { value: 'hideOverlay', label: NODE_ACTION_KIND_LABEL.hideOverlay, title: translateUi('ui.object.38a77bba72ba') }
      : { value: 'hideOverlay', label: NODE_ACTION_KIND_LABEL.hideOverlay, disabled: true, title: translateUi('ui.object.04cec8074f8a') })
  }
  return options
}

/**
 * 把一次候选选择落成新的动作列表。`path` 是从根到叶的祖先 value：选到界面模板时它是
 * `['spawn']`，`value` 才是模板 `overlayId/childId`。
 */
export function appendNodeAction({
  actions,
  value,
  path,
  overlays,
  pickers,
  hideOverlayOptions = [],
}: {
  actions: NodeAction[]
  value: string
  path: string[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  hideOverlayOptions?: ActionOption[]
}): NodeAction[] {
  const kind = path[0] ?? value
  if (kind === 'effect') {
    return [...actions, {
      kind: 'effect',
      effects: [createDefaultEffect('attr', pickers?.entities, pickers?.variables)],
    }]
  }
  if (kind === 'advance') return [...actions, { kind: 'advance', edgeId: '' }]
  if (kind === 'spawn') {
    return [...actions, { kind: 'spawn', from: value, ttlMs: initialSpawnTtlMs(value, overlays) }]
  }
  if (kind === 'hideOverlay') {
    const mountId = hideOverlayOptions[0]?.value
    return mountId ? [...actions, { kind: 'hideOverlay', mountId }] : actions
  }
  return actions
}

/**
 * 「事件响应」行（Figma 15635:81443 填充态 / 15635:81582 展开态）：左边标签，中间是这条
 * 事件已经加了哪些响应的胶囊，右边一颗 ＋（展开时转成 ✕）就是新增入口。
 *
 * 胶囊只做概览，每条响应的实际编辑仍在行下方的动作卡片里。
 */
export function EventResponseRow({
  className,
  labelClassName,
  title,
  actions,
  options,
  onSelect,
}: {
  className: string
  labelClassName?: string
  /** 整行的悬停说明。 */
  title?: string
  actions: NodeAction[]
  options: readonly NiMenuOption[]
  onSelect: (value: string, path: string[]) => void
}): JSX.Element {
  injectStyleOnce('ni-node-actions', NODE_ACTIONS_CSS)
  const menu = useNiMenu({ options, onSelect, ariaLabel: ADD_ACTION_LABEL })
  return (
    <>
      {/* 整行都是热区：点标签、胶囊、空白处都等同于点右侧那颗 ＋。
          图标因此退化成纯装饰，无障碍名与 role 都落在行本身上。 */}
      <div
        className={`${className} ni-na-row-trigger`}
        ref={menu.anchorRef}
        title={title ?? ADD_ACTION_HINT}
        role="button"
        tabIndex={0}
        aria-label={ADD_ACTION_LABEL}
        aria-haspopup="listbox"
        aria-expanded={menu.open}
        onClick={menu.toggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          menu.toggle()
        }}
      >
        <span className={labelClassName}>{translateUi('ui.copy.aee6056cf570')}</span>
        <span className="ni-na-row-chips">
          {actions.map((action, index) => (
            <NiChip key={index}>{NODE_ACTION_KIND_LABEL[action.kind]}</NiChip>
          ))}
        </span>
        <span className="ni-na-row-icon" aria-hidden="true">
          <NiIcon name={menu.open ? 'close' : 'plus'} size={14} />
        </span>
      </div>
      {menu.popup}
    </>
  )
}

/** 旧色板面板里的新增入口：那里没有「事件响应」行，仍是整行的「＋ 添加动作」下拉。 */
export function NodeActionAddMenu({
  options,
  onSelect,
}: {
  options: readonly NiMenuOption[]
  onSelect: (value: string, path: string[]) => void
}): JSX.Element {
  return (
    <NiAddMenu
      label={ADD_ACTION_LABEL}
      title={ADD_ACTION_HINT}
      options={options}
      onSelect={onSelect}
    />
  )
}

function removeActionLabel(action: NodeAction): string {
  if (action.kind === 'effect') return '移除效果'
  if (action.kind === 'spawn') return '解除绑定'
  if (action.kind === 'hideOverlay') return '移除隐藏动作'
  return '移除推进'
}

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

function cnOrdinal(prefix: string, ordinal: number): string {
  if (ordinal <= 0) return `${prefix}${ordinal}`
  if (ordinal < 10) return `${prefix}${CN_DIGITS[ordinal]}`
  if (ordinal === 10) return `${prefix}十`
  if (ordinal < 20) return `${prefix}十${CN_DIGITS[ordinal - 10]}`
  if (ordinal < 100) {
    const tens = Math.floor(ordinal / 10)
    const ones = ordinal % 10
    return `${prefix}${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ''}`
  }
  return `${prefix}${ordinal}`
}

/** 按当前效果列表序号生成「效果一」「效果二」；删除后剩余项会按序重排，新增接在末尾。 */
export function effectActionTitle(ordinal: number): string {
  return cnOrdinal('效果', ordinal)
}

/** 按当前显示信息列表序号生成「显示信息一」…；删除后重排，新增接在末尾。 */
export function spawnActionTitle(ordinal: number): string {
  return cnOrdinal('显示信息', ordinal)
}

function TrashIcon(): JSX.Element {
  return (
    <svg
      data-icon="trash-filled"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      width={14}
      height={14}
    >
      <path d="M7 0h6l1 2h5v2H1V2h5l1-2Zm-4 5h14l-1 15H4L3 5Zm4 3v9h2V8H7Zm4 0v9h2V8h-2Z" fillRule="evenodd" />
    </svg>
  )
}

function DurationNumberInput({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  return (
    <input
      aria-label={translateUi('ui.copy.bacb68e166a9')}
      type="number"
      min={0}
      value={draft}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        if (!next.trim()) return
        const parsed = Number(next)
        if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed)
      }}
      onBlur={() => {
        const parsed = Number(draft)
        if (!draft.trim() || !Number.isFinite(parsed) || parsed < 0) {
          setDraft(String(value))
        }
      }}
      style={{ flex: 1, minWidth: 0 }}
    />
  )
}

export function NodeActionsEditor({
  actions,
  spawnOptions,
  overlays,
  pickers,
  allowAdvance = true,
  allowSpawn = true,
  allowHideOverlay = false,
  propertyLayout = false,
  hideOverlayOptions = [],
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  labelWidth,
  renderAdvance,
  onChange,
}: {
  actions: NodeAction[]
  edgeOptions?: ActionOption[]
  spawnOptions: ActionOption[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  allowAdvance?: boolean
  allowSpawn?: boolean
  allowHideOverlay?: boolean
  /** 右栏属性面板布局；只改变新组件动作表单的展示，不改变动作数据。 */
  propertyLayout?: boolean
  /** 当前节点内可被条件隐藏的已有界面挂载。 */
  hideOverlayOptions?: ActionOption[]
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  labelWidth?: CSSProperties['width']
  renderAdvance?: (action: Extract<NodeAction, { kind: 'advance' }>, index: number) => ReactNode
  onChange: (next: NodeAction[]) => void
}): JSX.Element {
  const patchAt = (i: number, action: NodeAction) =>
    onChange(actions.map((current, index) => (index === i ? action : current)))
  injectStyleOnce('ni-node-actions', NODE_ACTIONS_CSS)
  const appendEffect = () => onChange([...actions, {
    kind: 'effect',
    effects: [createDefaultEffect('attr', pickers?.entities, pickers?.variables)],
  }])
  const appendSpawn = () => {
    const from = spawnOptions[0]?.value ?? ''
    onChange([...actions, {
      kind: 'spawn',
      from,
      ...(from ? { ttlMs: initialSpawnTtlMs(from, overlays) } : {}),
    }])
  }
  return (
    <div
      data-node-actions={propertyLayout ? 'property' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: propertyLayout ? 0 : 6 }}
    >
      {actions.map((action, i) => {
        const isPropertyEffect = propertyLayout && action.kind === 'effect'
        const isPropertySpawn = propertyLayout && action.kind === 'spawn'
        const isPropertyAction = isPropertyEffect || isPropertySpawn
        const effectOrdinal = isPropertyEffect
          ? actions.slice(0, i + 1).filter((item) => item.kind === 'effect').length
          : 0
        const spawnOrdinal = isPropertySpawn
          ? actions.slice(0, i + 1).filter((item) => item.kind === 'spawn').length
          : 0
        const hasLaterPropertyAction = isPropertyAction
          && actions.slice(i + 1).some((item) => item.kind === 'effect' || item.kind === 'spawn')
        const spawnTemplate = action.kind === 'spawn' ? resolveSpawnTemplate(action.from, overlays) : undefined
        const spawnValues = action.kind === 'spawn'
          ? { ...(spawnTemplate?.inputs ?? {}), ...(action.inputs ?? {}) }
          : undefined
        const propertyTitle = isPropertyEffect
          ? effectActionTitle(effectOrdinal)
          : isPropertySpawn
            ? spawnActionTitle(spawnOrdinal)
            : ''
        return (
        <div
          key={i}
          data-action-index={i}
          data-action-kind={action.kind}
          data-property-effect-action={isPropertyEffect ? 'true' : undefined}
          data-property-spawn-action={isPropertySpawn ? 'true' : undefined}
          className={isPropertyAction ? undefined : 'ni-na-card'}
          style={isPropertyAction
            ? {
              border: 0,
              borderRadius: 0,
              padding: '4px 0 12px',
              background: 'transparent',
              borderBottom: hasLaterPropertyAction ? '1px solid rgba(255,255,255,0.1)' : 0,
            }
            : { border: '1px solid #2a2a2a', borderRadius: 5, padding: '6px 8px', background: 'rgba(0,0,0,.22)' }}
        >
          {isPropertyAction ? (
            <div className="editor-property-effect-header">
              <b>{propertyTitle}</b>
              <button
                type="button"
                aria-label={isPropertyEffect ? translateUi('ui.copy.625719481bd4') : translateUi('ui.copy.cffc6967479b')}
                title={`${translateUi('ui.template.2f9daa828907')}${propertyTitle}`}
                onClick={() => onChange(actions.filter((_, index) => index !== i))}
              >
                <TrashIcon />
              </button>
            </div>
          ) : (
            <div className="ni-na-card-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              {/* 标题就是动作类型名，与「事件响应」行上的概览胶囊同一份措辞。 */}
              <b className="ni-na-card-title" style={{ fontSize: 11 }}>{NODE_ACTION_KIND_LABEL[action.kind]}</b>
              {/* 稿子把「移除效果」换成一枚 12px 垃圾桶；文案挪到无障碍名与 tooltip 上。 */}
              <NiIconButton
                icon="trash"
                size={12}
                danger
                ariaLabel={removeActionLabel(action)}
                onClick={() => onChange(actions.filter((_, index) => index !== i))}
              />
            </div>
          )}
          {action.kind === 'effect' ? (
            <EffectsEditor
              value={action.effects}
              pickers={pickers}
              createAttribute={onCreateEntityAttribute
                ? { onCreate: onCreateEntityAttribute }
                : undefined}
              createEntity={onCreateEntity
                ? { onCreate: onCreateEntity }
                : undefined}
              createVariable={onCreateVariable
                ? { onCreate: onCreateVariable }
                : undefined}
              createFormula={onCreateFormula
                ? { onCreate: onCreateFormula }
                : undefined}
              allowAdd={false}
              allowedKinds={SETTLEMENT_EFFECT_KINDS}
              labelWidth={labelWidth}
              propertyLayout={propertyLayout}
              onChange={(effects) => {
                if (propertyLayout && !effects?.length) {
                  onChange(actions.filter((_, index) => index !== i))
                  return
                }
                patchAt(i, { kind: 'effect', effects: effects ?? [] })
              }}
            />
          ) : null}
          {action.kind === 'spawn' ? (
            isPropertySpawn ? (
              <div data-property-spawn-editor>
                <div className="editor-property-cascade-field">
                  <span>{translateUi('ui.copy.2327a943fecf')}</span>
                  <SelectDropdown
                    ariaLabel={translateUi('ui.copy.2327a943fecf')}
                    value={action.from}
                    placeholder={translateUi('ui.copy.c8f10eaaeebe')}
                    options={spawnOptions}
                    onChange={(from) => patchAt(i, replaceSpawnTemplate(action, from))}
                  />
                </div>
                <div className="editor-property-cascade-field">
                  <span>{translateUi('ui.copy.2b8ed9f8af07')}</span>
                  <SelectDropdown
                    ariaLabel="消失方式"
                    value={action.ttlMs == null ? 'persistent' : 'duration'}
                    options={[
                      { value: 'persistent', label: translateUi('ui.object.300b6634fef3') },
                      { value: 'duration', label: translateUi('ui.object.d2ebfc6e7993') },
                    ]}
                    onChange={(next) => {
                      if (next === 'persistent') {
                        const { ttlMs: _ttlMs, ...rest } = action
                        patchAt(i, rest)
                        return
                      }
                      patchAt(i, {
                        ...action,
                        ttlMs: action.ttlMs ?? initialSpawnTtlMs(action.from, overlays),
                      })
                    }}
                  />
                </div>
                {action.ttlMs != null ? (
                  <div className="editor-property-cascade-field">
                    <span>{translateUi('ui.copy.bacb68e166a9')}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                      <DurationNumberInput
                        value={action.ttlMs}
                        onChange={(ttlMs) => patchAt(i, { ...action, ttlMs })}
                      />
                      <span style={{ fontSize: 12, opacity: 0.65, flex: 'none' }}>{translateUi('ui.copy.26cc3217be64')}</span>
                    </span>
                  </div>
                ) : null}
                {spawnTemplate && spawnValues ? (
                  <ComponentInputsDisclosure
                    childId={spawnTemplate.id}
                    componentId={spawnTemplate.component}
                    values={spawnValues}
                    pickers={pickers}
                    labelWidth={labelWidth}
                    density="property"
                    onChange={(inputs) => patchAt(i, { ...action, inputs: Object.keys(inputs).length ? inputs : undefined })}
                    onCreateEntityAttribute={onCreateEntityAttribute}
                    onCreateEntity={onCreateEntity}
                    onCreateVariable={onCreateVariable}
                    onCreateFormula={onCreateFormula}
                  />
                ) : null}
              </div>
            ) : (
              <>
                {field('界面', (
                  <NiSelect
                    value={action.from}
                    onChange={(from) => patchAt(i, replaceSpawnTemplate(action, from))}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <option value="">{translateUi('ui.copy.bdf3bc41d249')}</option>
                    {spawnOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </NiSelect>
                ), labelWidth)}
                {field('消失方式', (
                  <NiSelect
                    ariaLabel="消失方式"
                    value={action.ttlMs == null ? 'persistent' : 'duration'}
                    onChange={(next) => {
                      if (next === 'persistent') {
                        const { ttlMs: _ttlMs, ...rest } = action
                        patchAt(i, rest)
                        return
                      }
                      patchAt(i, {
                        ...action,
                        ttlMs: action.ttlMs ?? initialSpawnTtlMs(action.from, overlays),
                      })
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <option value="persistent">{translateUi('ui.copy.08a4dc38a47a')}</option>
                    <option value="duration">{translateUi('ui.copy.91bffcaa7330')}</option>
                  </NiSelect>
                ), labelWidth)}
                {action.ttlMs != null ? field('显示时长', (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
                    <input
                      aria-label={translateUi('ui.copy.bacb68e166a9')}
                      type="number"
                      min={0}
                      value={action.ttlMs ?? ''}
                      onChange={(e) => patchAt(i, { ...action, ttlMs: e.target.value === '' ? undefined : Number(e.target.value) })}
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <span style={{ fontSize: 11, opacity: 0.65 }}>{translateUi('ui.copy.26cc3217be64')}</span>
                  </span>
                ), labelWidth) : null}
                {spawnTemplate && spawnValues ? (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, margin: '8px 0 4px' }}>{translateUi('ui.copy.7314608451a0')}</div>
                    <ComponentInputsDisclosure
                      childId={spawnTemplate.id}
                      componentId={spawnTemplate.component}
                      values={spawnValues}
                      pickers={pickers}
                      labelWidth={labelWidth}
                      density="compact"
                      onChange={(inputs) => patchAt(i, { ...action, inputs: Object.keys(inputs).length ? inputs : undefined })}
                      onCreateEntityAttribute={onCreateEntityAttribute}
                      onCreateEntity={onCreateEntity}
                      onCreateVariable={onCreateVariable}
                      onCreateFormula={onCreateFormula}
                    />
                  </div>
                ) : null}
              </>
            )
          ) : null}
          {action.kind === 'hideOverlay' ? field('目标界面', (
            <NiSelect
              ariaLabel="目标界面"
              value={action.mountId}
              onChange={(mountId) => patchAt(i, { ...action, mountId })}
              style={{ flex: 1, minWidth: 0 }}
            >
              {!hideOverlayOptions.some((option) => option.value === action.mountId) ? (
                <option value={action.mountId}>{translateUi('ui.copy.b75a3f7c56b9')}</option>
              ) : null}
              {hideOverlayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </NiSelect>
          ), labelWidth) : null}
          {action.kind === 'advance' && renderAdvance ? renderAdvance(action, i) : null}
          {action.kind === 'advance' && !renderAdvance ? <div style={{ fontSize: 11, color: '#ce9178' }}>{translateUi('ui.copy.d333376c560f')}</div> : null}
        </div>
        )
      })}
      {/* 新稿把新增入口搬到了上方的「事件响应」行上，由父组件渲染；属性面板还是旧的一排按钮。 */}
      {propertyLayout ? (
        <div
          data-node-action-add="true"
          data-has-actions={actions.length > 0 ? 'true' : undefined}
        >
          <div className="editor-property-add-title">{translateUi('ui.copy.2cd9e6ce817d')}</div>
          <div data-node-action-toolbar style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={appendEffect}>{translateUi('ui.copy.f7b63082c900')}</button>
            {allowAdvance && !actions.some((action) => action.kind === 'advance') ? (
              <button type="button" onClick={() => onChange([...actions, { kind: 'advance', edgeId: '' }])}>{translateUi('ui.copy.73f02907eb77')}</button>
            ) : null}
            {allowSpawn ? (
              <button
                type="button"
                disabled={spawnOptions.length === 0}
                title={spawnOptions.length === 0 ? translateUi('ui.copy.4a8846e9c524') : translateUi('ui.copy.03d9ee5b9d38')}
                onClick={appendSpawn}
              >
                {translateUi('ui.copy.05f9be720346')}</button>
            ) : null}
            {allowHideOverlay ? (
              <button
                type="button"
                disabled={hideOverlayOptions.length === 0}
                title={hideOverlayOptions.length === 0 ? translateUi('ui.copy.da7611ce3419') : translateUi('ui.copy.02f9d634353e')}
                onClick={() => onChange([...actions, { kind: 'hideOverlay', mountId: hideOverlayOptions[0]!.value }])}
              >
                {translateUi('ui.copy.b95a67b104cd')}</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
