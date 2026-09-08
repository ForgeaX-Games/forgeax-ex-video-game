import { t as translateUi } from '../../../i18n'
/**
 * 结算分区 —— 定时 / 条件 / 界面显隐统一为结算；底层仍是同一组 node.data.reactions。
 *
 * 视觉取自 Figma 15635:81253（空态）/ 15635:82040（填充态）/ 15635:83366（条件满足详情）。
 * 换皮只动排版与外观：每个控件写图的入口（patchAt / commit /
 * setSettlementAdvanceTarget）与联动锚点（data-settlement-index、data-selected）都保持原样。
 */
import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import type { Entity, GameEdge, GameGraph, GameNode, GameNodeData, GraphCondition, NodeAction, Overlay, RoutingSettlement, Variable } from '@/runtime/core/schema/graph-schema'
import type { Reaction } from '@/runtime/core/schema/node-config-schema'
import {
  setSettlementAdvanceTarget,
  updateEventRouteTiming,
  type NodeDataPatch,
} from '@/authoring/graph/graph-edit'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { ConditionEditor, type EditorPickerCtx } from '../editors'
import { scrollIntoViewWithin } from '../focus-scroll'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from '../component-form-fields'
import {
  appendNodeAction,
  EventResponseRow,
  NodeActionsEditor,
  nodeActionAddOptions,
} from '../NodeActionsEditor'
import { LooseNumberInput } from '../TermChainEditor'
import { NiAddMenu, NiField, NiIcon, NiSection, NiSelect, NiSubPanel, niIconMaskCss } from '../ni-ui'
import {
  AdvanceTargetRow,
  RouteTimingEditor,
  WatchFieldEditor,
  type FieldNode,
  type OptItem,
} from './shared'

/**
 * 稿子把「触发类型」提成了卡片标题（时间轴结算 / 条件结算 / …）。这里仍旧是一只下拉：
 * 四种触发都得留在作者手边，只是闭合态按标题画（16px 白 + 一枚小 chevron）。
 */
const SETTLEMENT_CSS = `
.ni-root .ni-st-list { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.ni-root .ni-st-empty { font-size: var(--ni-fs-body); color: var(--ni-w-40); }
.ni-root .ni-st-rule { height: 0; border-top: 1px solid var(--ni-w-10); }

/* 卡片左右各溢出 6px，好让选中描边包住内容而不挤掉分区的 16px 内边距。 */
.ni-root .ni-st-card {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: calc(100% + 12px);
  margin: 0 -6px;
  padding: 6px;
  border-radius: var(--ni-radius);
  min-width: 0;
  transition: border-color 120ms ease;
}
.ni-root .ni-st-card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 卡片标题是纯文字：类型在「添加结算」时就定了，建好之后不再可切换（稿子 15635:82040）。 */
.ni-root .ni-st-card-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ni-w-100);
  font-size: var(--ni-fs-label);
  font-weight: 500;
}
.ni-root .ni-st-del { margin-left: auto; }
.ni-root .ni-st-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* 字段：块级内容（条件 / 结算动作）用 div 承载标签，避免 <label> 把内部按钮一起点了。 */
.ni-root .ni-st-stack { flex-direction: column; align-items: stretch; gap: 8px; }
.ni-root .ni-st-unit { flex: none; font-size: var(--ni-fs-body); color: var(--ni-w-60); }
.ni-root .ni-st-legacy { font-size: var(--ni-fs-body); color: #e8b339; }

.ni-root .ni-st-actions { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
/* 新增结算动作的入口就在这一行右侧（Figma 15635:81443）；行内还概览已加的响应。 */
.ni-root .ni-st-actions-head {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--ni-control-h);
  padding: 5.498px 4px 5.498px 9.163px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
  color: var(--ni-w-60);
}
.ni-root .ni-st-actions-head > span:first-child { flex: none; }

/*
 * WatchFieldEditor / ConditionEditor 住在共享的 shared.tsx / editors.tsx —— 它们同时服务
 * 仍是旧色板的面板，不能改自己的文件。这里只在本分区的作用域里把它们的闭合态拉到新稿；
 * 那几处 !important 是为了压掉共享文件里的行内 style，出了 .ni-st-* 就不生效。
 */
.ni-root .ni-st-watch { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ni-root .ni-st-watch > label { margin-bottom: 0 !important; }
.ni-root .ni-st-watch > label > span:first-child {
  width: auto !important;
  opacity: 1 !important;
  color: var(--ni-w-60);
  font-size: var(--ni-fs-label);
}
.ni-root .ni-st-watch > label > label { margin-left: auto; color: var(--ni-w-60); }

.ni-root .ni-st-cond { flex: 1; min-width: 0; }
.ni-root .ni-st-cond > div > div {
  border-color: var(--ni-w-08) !important;
  border-radius: var(--ni-radius) !important;
}
.ni-root .ni-st-cond .editor-field-row > span { opacity: 1 !important; color: var(--ni-w-60); }
/* 子句「删除」换成垃圾桶图标，与节点连线里的条件子句同一个样子（文字留在 DOM 里作可访问名）。 */
.ni-root .ni-st-cond > div > div > div:first-child:not(.editor-field-row) > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0 !important;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--ni-w-40) !important;
  font-size: 0 !important;
}
.ni-root .ni-st-cond > div > div > div:first-child:not(.editor-field-row) > button::before {
  content: '';
  display: block;
  width: 12px;
  height: 12px;
  background: currentColor;
  ${niIconMaskCss('trash')}
}
.ni-root .ni-st-cond > div > div > div:first-child:not(.editor-field-row) > button:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.14);
  color: #ff6b6b !important;
}
.ni-root .ni-st-cond .ni-select-shell,
.ni-root .ni-st-cond input:not([type='range']):not([type='checkbox']):not([type='radio']) { background: #232323; }
`

/** 历史生命周期相位仍可读取；作者侧新增和编辑统一落成精确的 `at(ms)`。 */
function isLifecycle(r: Reaction): boolean {
  return r.when.type === 'enter' || r.when.type === 'at' || r.when.type === 'exit' || r.when.type === 'complete'
}

type SettlementTriggerType = 'at' | 'condition' | 'shown' | 'hidden'
/**
 * 标题化的触发类型名，取自稿子（15635:82049 / 82086 / 82141）；落盘的 `when.type` 不变。
 *
 * 这一份同时供「添加结算」下拉与卡片标题使用。类型只在新增时选定，卡片里不提供切换——
 * 稿子（15635:82040）画的就是两张固定标题的卡；改类型 = 删掉重加。
 */
const SETTLEMENT_TRIGGER_LABEL: Record<SettlementTriggerType, string> = {
  at: '时间轴结算',
  condition: '条件结算',
  // 旧图仍可能落盘 shown/hidden；标题要认得，但「添加结算」入口不再提供这两项。
  shown: '时间轴结算·界面出现',
  hidden: '时间轴结算·界面消失',
}
/** 「添加结算」入口只开放这两种触发；界面出现/消失改走绑定界面动作，不再单独建结算。 */
const ADD_SETTLEMENT_TRIGGERS: SettlementTriggerType[] = ['at', 'condition']
/**
 * 触发类型 → 落盘的 `when`。新增结算与标题里改类型共用这一份，避免两处对「一个类型
 * 应该长什么样」写在两处。目前只有「添加结算」用它——卡片建好后不再改类型。
 */
function settlementWhenFor(
  type: SettlementTriggerType,
  { atMs, componentValue }: { atMs: number; componentValue: string },
): Reaction['when'] {
  if (type === 'at') return { type: 'at', ms: atMs }
  if (type === 'condition') return { type: 'watch', of: '', on: 'change' }
  return { type, of: componentValue }
}

function isReactive(r: Reaction): boolean {
  return r.when.type === 'watch'
    || r.when.type === 'state'
    || r.when.type === 'shown'
    || r.when.type === 'hidden'
}
function isSettlement(r: Reaction): boolean {
  return isLifecycle(r) || isReactive(r)
}
function settlementTriggerType(r: Reaction): SettlementTriggerType {
  const type = r.when.type
  if (type === 'watch' || type === 'state') return 'condition'
  return type === 'shown' || type === 'hidden' ? type : 'at'
}

export function watchPathFromCondition(condition: GraphCondition | undefined): string {
  const clauses = condition?.all
  if (!Array.isArray(clauses) || clauses.length !== 1) return ''
  const clause = clauses[0]!
  if (clause.type === 'attr') return `entity.${clause.entityId}.attr.${clause.attr}`
  if (clause.type === 'var') return `var.${clause.varId}`
  return clause.type === 'score' ? 'score' : ''
}

function lifecycleAtMs(r: Reaction, durationMs?: number): number {
  if (r.when.type === 'at') return r.when.ms
  if (r.when.type === 'enter') return 0
  return Math.max(0, Math.round(durationMs ?? 0))
}

function isSettlementControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('button, input, select, textarea, label, a, summary, details, [role="button"], [contenteditable="true"]'))
}

function legacyPhaseHint(r: Reaction): string | null {
  if (r.when.type === 'at') return null
  if (r.when.type === 'complete') {
    return r.when.if
      ? '旧「收尾」相位 · 带 if 条件（仍生效）：改这条会丢弃条件并落成播到 ms'
      : '旧「收尾」相位（仍生效，作 if 分支的兜底）：改这条即落成播到 ms'
  }
  if (r.when.type === 'exit') return '旧「离开前」相位（任何离开路径都触发）：改这条即落成播到 ms'
  return '旧「进入时」相位：改这条即落成播到 ms'
}

/** 与 `NiField` 同款视觉，但用 div 承载：块级子树里带按钮，包进 `<label>` 会点文字就误触发。 */
function SettlementField({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="ni-field">
      <span className="ni-field-label">{label}</span>
      <div className="ni-field-control ni-st-stack">{children}</div>
    </div>
  )
}

function LifecycleReactionsEditor({
  reactions,
  sourceLabel,
  nodeOptions,
  durationMs,
  insertMs,
  focusedIndex,
  focusAnchorRevision,
  onFocusIndex,
  pickers,
  entities,
  variables,
  advanceEdgeFor,
  advanceTargetFor,
  onAdvanceTargetChange,
  routingSettlement,
  onSetAdvanceTiming,
  componentOptions,
  spawnOptions,
  hideOverlayOptions,
  overlays,
  fieldTree,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  onChange,
}: {
  reactions: Reaction[] | undefined
  sourceLabel: string
  nodeOptions: OptItem[]
  durationMs?: number
  insertMs?: number
  focusedIndex?: number | null
  focusAnchorRevision?: number
  onFocusIndex?: (lifecycleIndex: number | null) => void
  pickers?: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  advanceEdgeFor: (edgeId: string) => GameEdge | undefined
  advanceTargetFor: (edgeId: string) => string
  onAdvanceTargetChange: (settlementIndex: number, actionIndex: number, targetId: string) => void
  routingSettlement?: RoutingSettlement
  onSetAdvanceTiming: (
    edgeId: string,
    transition: 'immediate' | 'onSettlement',
    settlement?: RoutingSettlement,
  ) => void
  componentOptions: OptItem[]
  spawnOptions: OptItem[]
  hideOverlayOptions: OptItem[]
  overlays?: Record<string, Overlay>
  fieldTree: FieldNode[]
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  onChange: (next: Reaction[] | undefined) => void
}): JSX.Element {
  const settlements = (reactions ?? []).filter(isSettlement)
  const rest = (reactions ?? []).filter((r) => !isSettlement(r))
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const commit = (next: Reaction[]) => {
    const merged = [...next, ...rest]
    onChange(merged.length ? merged : undefined)
  }
  const patchAt = (i: number, r: Reaction) => commit(settlements.map((c, j) => (j === i ? r : c)))
  const removeAt = (i: number) => {
    if (focusedIndex === i) onFocusIndex?.(null)
    else if (focusedIndex != null && focusedIndex > i) onFocusIndex?.(focusedIndex - 1)
    commit(settlements.filter((_, j) => j !== i))
  }
  useEffect(() => {
    if (focusAnchorRevision == null || focusedIndex == null) return
    scrollIntoViewWithin(itemRefs.current[focusedIndex])
  }, [focusAnchorRevision])

  useEffect(() => {
    if (focusedIndex != null && focusedIndex >= settlements.length) onFocusIndex?.(null)
  }, [focusedIndex, settlements.length, onFocusIndex])

  return (
    <div className="ni-st-list">
      {settlements.length === 0 ? <div className="ni-st-empty">{translateUi('ui.copy.1c9261662487')}</div> : null}
      {settlements.map((r, i) => {
        const atMs = lifecycleAtMs(r, durationMs)
        const legacy = isLifecycle(r) ? legacyPhaseHint(r) : null
        const triggerType = settlementTriggerType(r)
        const watchWhen = r.when.type === 'watch' ? r.when : null
        const stateWhen = r.when.type === 'state' ? r.when : null
        const conditionMode = stateWhen ? 'state' : (watchWhen?.on ?? 'change')
        const componentWhen = r.when.type === 'shown' || r.when.type === 'hidden' ? r.when : null
        const focused = focusedIndex === i
        // 定时结算也能绑界面：出现时刻跟随本结算的 at.ms，时间轴上作为组跟着菱形走。
        const allowSettlementSpawn = triggerType === 'condition' || triggerType === 'at'
        // hideOverlay 只命中挂载界面，命中不了 spawn 出来的界面，因此不在定时结算里放开。
        const allowSettlementHideOverlay = triggerType === 'condition'
        const writeActions = (actions: NodeAction[]) => {
          const advanceIndex = r.do.findIndex((action) => action.kind === 'advance')
          if (advanceIndex >= 0 && !actions.some((action) => action.kind === 'advance')) {
            onAdvanceTargetChange(i, advanceIndex, '')
            return
          }
          patchAt(i, { ...r, do: actions })
        }
        return (
          <Fragment key={i}>
            {i > 0 ? <div className="ni-st-rule" /> : null}
            <div
              ref={(el) => { itemRefs.current[i] = el }}
              data-lifecycle-effect-index={i}
              data-settlement-index={i}
              data-selected={focused ? 'true' : 'false'}
              className="ni-st-card"
              onClick={(event) => {
                if (isSettlementControlTarget(event.target)) return
                onFocusIndex?.(i)
              }}
              // 选中态留在行内 border 上：时间轴菱形与本卡片的双向联动靠它做视觉回指。
              style={{ border: `1px solid ${focused ? '#b9d79c' : 'transparent'}` }}
            >
              <div className="ni-st-card-head">
                {/* 类型在新增时就选定了，卡片里不再提供切换（见 SETTLEMENT_TRIGGER_LABEL 上的说明）。 */}
                <span className="ni-st-card-title" data-settlement-trigger={triggerType}>
                  {SETTLEMENT_TRIGGER_LABEL[triggerType]}
                </span>
                <button
                  type="button"
                  className="ni-icon-btn is-danger ni-st-del"
                  title={translateUi('ui.copy.bb4d6e5df0f3')}
                  onClick={() => removeAt(i)}
                >
                  <NiIcon name="trash" size={14} />
                  <span className="ni-st-sr">{translateUi('ui.copy.bb4d6e5df0f3')}</span>
                </button>
              </div>
              {triggerType === 'at' ? (
                <NiField label={translateUi('ui.copy.e9a51ecb88a1')}>
                  <LooseNumberInput
                    value={atMs}
                    emptyValue={0}
                    title={durationMs ? `${translateUi('ui.template.72b7bdc3c78b')}${durationMs}${translateUi('ui.template.f785c3ce1d58')}` : undefined}
                    placeholder={translateUi('ui.copy.190aa17b8309')}
                    className="ni-input ni-input-num"
                    onChange={(value) => patchAt(i, { ...r, when: { type: 'at', ms: Math.max(0, value) } })}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <span className="ni-st-unit">{translateUi('ui.copy.26cc3217be64')}</span>
                </NiField>
              ) : null}
              {watchWhen || stateWhen ? (
                <>
                  <NiField label={translateUi('ui.copy.c2bf6240efc6')}>
                    <NiSelect
                      ariaLabel="条件类型"
                      value={conditionMode}
                      options={[
                        { value: 'change', label: translateUi('ui.object.55b08c282cad') },
                        { value: 'inc', label: translateUi('ui.object.3d251721851c') },
                        { value: 'dec', label: translateUi('ui.object.2bfafcd89878') },
                        { value: 'state', label: translateUi('ui.object.f5b23a5c5fe7') },
                      ]}
                      onChange={(value) => {
                        const mode = value as 'change' | 'inc' | 'dec' | 'state'
                        const when: Reaction['when'] = mode === 'state'
                          ? { type: 'state', condition: stateWhen?.condition ?? { all: [] } }
                          : {
                              type: 'watch',
                              of: watchWhen?.of ?? (stateWhen ? watchPathFromCondition(stateWhen.condition) : ''),
                              on: mode,
                            }
                        patchAt(i, { ...r, when })
                      }}
                    />
                  </NiField>
                  {watchWhen ? (
                    <div className="ni-st-watch">
                      <WatchFieldEditor
                        tree={fieldTree}
                        value={watchWhen.of}
                        onChange={(of) => patchAt(i, { ...r, when: { ...watchWhen, of } })}
                      />
                    </div>
                  ) : null}
                  {stateWhen ? (
                    <SettlementField label={translateUi('ui.copy.72f1cf759c9b')}>
                      <NiSubPanel>
                        <div className="ni-st-cond">
                          <ConditionEditor
                            value={stateWhen.condition}
                            nodeIds={nodeOptions.map((option) => option.value)}
                            pickers={pickers}
                            entities={entities}
                            variables={variables}
                            onChange={(condition) => patchAt(i, {
                              ...r,
                              when: { type: 'state', condition: condition ?? { all: [] } },
                            })}
                          />
                        </div>
                      </NiSubPanel>
                    </SettlementField>
                  ) : null}
                </>
              ) : null}
              {componentWhen ? (
                <NiField label={translateUi('ui.copy.eba4af5f1f03')}>
                  <NiSelect
                    value={componentWhen.of}
                    onChange={(value) => patchAt(i, { ...r, when: { type: componentWhen.type, of: value } })}
                  >
                    <option value="">{translateUi('ui.copy.9484ab471ef1')}</option>
                    {componentWhen.of && !componentOptions.some((option) => option.value === componentWhen.of) ? (
                      <option value={componentWhen.of}>{componentWhen.of}{translateUi('ui.copy.45d3c9d2ebbd')}</option>
                    ) : null}
                    {componentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </NiSelect>
                </NiField>
              ) : null}
              {legacy ? <div className="ni-st-legacy">{legacy}</div> : null}
              <SettlementField label={translateUi('ui.copy.07facf9ec32c')}>
                <div className="ni-st-actions">
                  <EventResponseRow
                    className="ni-st-actions-head"
                    actions={r.do}
                    options={nodeActionAddOptions({
                      actions: r.do,
                      allowSpawn: allowSettlementSpawn,
                      allowHideOverlay: allowSettlementHideOverlay,
                      spawnOptions,
                      hideOverlayOptions,
                    })}
                    onSelect={(value, path) => writeActions(appendNodeAction({
                      actions: r.do,
                      value,
                      path,
                      overlays,
                      pickers,
                      hideOverlayOptions,
                    }))}
                  />
                  <NodeActionsEditor
                    actions={r.do}
                    spawnOptions={spawnOptions}
                    overlays={overlays}
                    pickers={pickers}
                    allowSpawn={allowSettlementSpawn}
                    allowHideOverlay={allowSettlementHideOverlay}
                    hideOverlayOptions={hideOverlayOptions}
                    onCreateEntityAttribute={onCreateEntityAttribute}
                    onCreateEntity={onCreateEntity}
                    onCreateVariable={onCreateVariable}
                    onCreateFormula={onCreateFormula}
                    renderAdvance={(action, actionIndex) => {
                      const edge = action.edgeId ? advanceEdgeFor(action.edgeId) : undefined
                      return (
                        <>
                          <AdvanceTargetRow
                            sourceLabel={sourceLabel}
                            currentTarget={advanceTargetFor(action.edgeId)}
                            nodeOptions={nodeOptions}
                            onChange={(targetId) => onAdvanceTargetChange(i, actionIndex, targetId)}
                          />
                          {edge ? (
                            <RouteTimingEditor
                              edge={edge}
                              routingSettlement={routingSettlement}
                              defaultAtMs={atMs}
                              onChange={(transition, settlement) => onSetAdvanceTiming(action.edgeId, transition, settlement)}
                            />
                          ) : null}
                        </>
                      )
                    }}
                    onChange={writeActions}
                  />
                </div>
              </SettlementField>
            </div>
          </Fragment>
        )
      })}
      {/* 新增入口是类型选择（稿子 15635:82029）：选哪一种就直接落成那一种触发，
          不必先建一条定时结算再去标题里改类型。只开放时间轴 / 条件两种。 */}
      <NiAddMenu
        label={translateUi('ui.copy.e2b79022fffe')}
        title={translateUi('ui.copy.a259e1df0624')}
        options={ADD_SETTLEMENT_TRIGGERS.map((type) => ({
          value: type,
          label: SETTLEMENT_TRIGGER_LABEL[type],
        }))}
        onSelect={(value) => {
          const nextIndex = settlements.length
          commit([...settlements, {
            when: settlementWhenFor(value as SettlementTriggerType, {
              atMs: Math.max(0, Math.round(insertMs ?? 0)),
              componentValue: componentOptions[0]?.value ?? '',
            }),
            // 空动作：作者自己点「添加动作」再选效果 / 添加连线 / 绑界面，不预塞一条效果。
            do: [],
          }])
          onFocusIndex?.(nextIndex)
        }}
      />
    </div>
  )
}

export function SettlementSection({
  graph,
  node,
  d,
  nodeLabel,
  targetNodeOptions,
  settlementInsertMs,
  focusedLifecycleIndex,
  focusAnchorRevision,
  onFocusLifecycle,
  pickers,
  entities,
  variables,
  componentOptions,
  spawnOptions,
  hideOverlayOptions,
  overlays,
  fieldTree,
  patchData,
  onChange,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
}: {
  graph: GameGraph
  node: GameNode
  d: GameNodeData
  nodeLabel: (id: string) => string
  targetNodeOptions: OptItem[]
  settlementInsertMs?: number
  focusedLifecycleIndex?: number | null
  focusAnchorRevision?: number
  onFocusLifecycle?: (lifecycleIndex: number | null) => void
  pickers: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  componentOptions: OptItem[]
  spawnOptions: OptItem[]
  hideOverlayOptions: OptItem[]
  overlays?: Record<string, Overlay>
  fieldTree: FieldNode[]
  patchData: (p: NodeDataPatch) => void
  onChange: (g: GameGraph) => void
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
}): JSX.Element {
  injectStyleOnce('ni-settlement', SETTLEMENT_CSS)
  return (
      /* 定时 / 条件 / 界面显隐统一为结算；底层仍是同一组 node.data.reactions。 */
      <NiSection title={translateUi('ui.copy.4c506e4ef106')}>
        <LifecycleReactionsEditor
          reactions={d.reactions}
          sourceLabel={nodeLabel(node.id)}
          nodeOptions={targetNodeOptions}
          durationMs={d.durationMs}
          insertMs={settlementInsertMs}
          focusedIndex={focusedLifecycleIndex}
          focusAnchorRevision={focusAnchorRevision}
          onFocusIndex={onFocusLifecycle}
          pickers={pickers}
          entities={entities}
          variables={variables}
          advanceEdgeFor={(edgeId) => graph.edges.find((edge) => edge.id === edgeId)}
          advanceTargetFor={(edgeId) => graph.edges.find((edge) => edge.id === edgeId)?.target ?? ''}
          onAdvanceTargetChange={(settlementIndex, actionIndex, targetId) => onChange(
            setSettlementAdvanceTarget(graph, node.id, settlementIndex, actionIndex, targetId),
          )}
          routingSettlement={d.routingSettlement}
          onSetAdvanceTiming={(edgeId, transition, settlement) => {
            const edge = graph.edges.find((candidate) => candidate.id === edgeId)
            if (!edge) return
            onChange(updateEventRouteTiming(
              graph,
              node.id,
              edge.sourceHandle ?? 'default',
              transition,
              settlement,
            ))
          }}
          componentOptions={componentOptions}
          spawnOptions={spawnOptions}
          hideOverlayOptions={hideOverlayOptions}
          overlays={overlays}
          fieldTree={fieldTree}
          onCreateEntityAttribute={onCreateEntityAttribute}
          onCreateEntity={onCreateEntity}
          onCreateVariable={onCreateVariable}
          onCreateFormula={onCreateFormula}
          onChange={(reactions) => patchData({ reactions })}
        />
      </NiSection>
  )
}
