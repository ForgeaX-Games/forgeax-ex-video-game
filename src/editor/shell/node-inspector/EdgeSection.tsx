import { t as translateUi } from '../../../i18n'
/**
 * 节点连线（出边）分区 —— 先连目标；条件可选；交互出口仅选项/QTE 等需要时再改。
 *
 * 视觉按 Figma「1.3 造化工坊国内版」15635:81264 / 84079 / 83425 / 83366 重做，
 * 骨架全部复用 `../ni-ui`；**读写图的调用（connect / reconnect / disconnect /
 * updateEdgeData）与其参数一字未改**。
 *
 * 条件详情由共享的 `ConditionEditor`（`../editors`）渲染，它同时服务仍是 lime 色板的
 * ScenarioInspector / ComponentPropertyPanel，所以不能改它自己的文件。这里只在
 * `.ni-root .ni-edge-*` 作用域内，对它已经产出的 DOM 做后代选择器换皮。
 */
import { Fragment, useState } from 'react'
import type { Entity, GameGraph, GameNode, GraphCondition, Variable } from '@/runtime/core/schema/graph-schema'
import { connect, disconnect, reconnect, updateEdgeData } from '@/authoring/graph/graph-edit'
import { ConditionEditor, type EditorPickerCtx } from '../editors'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { NiAddButton, NiCard, NiChip, NiDivider, NiIconButton, NiInput, NiSection, NiSelect, niIconMaskCss } from '../ni-ui'

/**
 * 条件片的展示文案。`editors.tsx` 里的 `CLAUSE_LABEL` 是同一份中文名，但它没有导出、
 * 而那个文件不归本分区改，所以这里留一份只读镜像；认不出的类型直接显示原始 type
 * （与 `editors.tsx` 的兜底一致），不会因为上游新增子句类型而丢片。
 */
const CLAUSE_CHIP_LABEL: Record<string, string> = {
  attrRatio: '属性比例',
  attr: '属性值',
  attrCompare: '属性比较',
  var: '变量',
  flag: '标记',
  visited: '到过节点',
  score: '分数',
  hasItem: '拥有道具',
}

/**
 * 稿子里 ConditionEditor 那部分的换皮全在这里：
 * - 它的根只当布局容器（列 + 8px）；
 * - 空态提示「无条件（恒真）」被搬进条件壳里当占位文案（`.is-empty` 由本文件挂，
 *   不用 `:has()` 判断，选择器对老浏览器也成立）；
 * - 每条子句变成稿子的深色子面板，子句类型下拉被压成子面板标题的样子；
 * - 「+ 条件（AND）」按钮浮到条件壳右侧变成 ＋（文字仍在 DOM 里，可访问名不变）。
 * 凡是要盖掉 `editors.tsx` 内联样式的地方才用 `!important`。
 */
const NI_EDGE_CSS = `
.ni-root .ni-edge-card > .ni-card { gap: 8px; }

.ni-root .ni-edge-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ni-root .ni-edge-field-label { font-size: var(--ni-fs-meta); color: var(--ni-w-60); }

/* ── 条件 ───────────────────────────────────────────────────────────────── */
.ni-root .ni-edge-cond { position: relative; display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.ni-root .ni-edge-cond-shell {
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: var(--ni-control-h);
  padding: 3px 34px 3px 9.163px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
}

.ni-root .ni-edge-cond-body { min-width: 0; }
.ni-root .ni-edge-cond-body > div { display: flex; flex-direction: column; gap: 8px; min-width: 0; }

/* 空态：ConditionEditor 的「无条件（恒真）」当条件壳的占位文案 */
.ni-root .ni-edge-cond.is-empty .ni-edge-cond-body > div > div {
  position: absolute;
  top: 0;
  left: 9.163px;
  display: flex;
  align-items: center;
  height: var(--ni-control-h);
  margin: 0;
  color: var(--ni-w-40);
  font-size: 11px !important;
  opacity: 1 !important;
  pointer-events: none;
}

/* 有子句：每条 = 稿子里的深色子面板 */
.ni-root .ni-edge-cond:not(.is-empty) .ni-edge-cond-body > div > div {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  margin-top: 0 !important;
  padding: 8px 9.16px !important;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08) !important;
  border-radius: var(--ni-radius) !important;
}

/* 子面板首行：类型下拉压成标题 + 右侧安静的删除 */
.ni-root .ni-edge-cond-body > div > div > div:first-child:not(.editor-field-row) {
  gap: 8px !important;
  margin-bottom: 0 !important;
}
.ni-root .ni-edge-cond-body > div > div > div:first-child:not(.editor-field-row) > select {
  height: auto;
  padding: 0;
  padding-right: 16px;
  background: transparent;
  border-color: transparent;
  color: var(--ni-w-60);
  font-size: 11px;
}
/* 子句的「删除」按文字渲染在 editors.tsx 里；这里把文字压掉换成垃圾桶图标，
   可访问名仍是「删除」（文本还在 DOM 里，只是 font-size:0）。 */
.ni-root .ni-edge-cond-body > div > div > div:first-child:not(.editor-field-row) > button {
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
.ni-root .ni-edge-cond-body > div > div > div:first-child:not(.editor-field-row) > button::before {
  content: '';
  display: block;
  width: 12px;
  height: 12px;
  background: currentColor;
  ${niIconMaskCss('trash')}
}
.ni-root .ni-edge-cond-body > div > div > div:first-child:not(.editor-field-row) > button:hover:not(:disabled) {
  background: rgba(255, 107, 107, 0.14);
  color: #ff6b6b !important;
}

/* 子面板里的 标签 + 控件 行 */
.ni-root .ni-edge-cond-body .editor-field-row {
  gap: 10px !important;
  width: 100%;
  min-width: 0;
  margin-bottom: 0 !important;
}
.ni-root .ni-edge-cond-body .editor-field-row > span:first-child {
  flex: none;
  width: 40px !important;
  color: var(--ni-w-60);
  font-size: 11px !important;
  opacity: 1 !important;
}
.ni-root .ni-edge-cond-body .editor-field-row > :not(:first-child) {
  flex: 1 1 0;
  min-width: 0;
  width: auto !important;
}
.ni-root .ni-edge-cond-body .editor-field-row select,
.ni-root .ni-edge-cond-body .editor-field-row input:not([type='checkbox']):not([type='radio']),
.ni-root .ni-edge-cond-body .editor-field-row .gc-cascade-trigger {
  box-sizing: border-box;
  height: var(--ni-control-h);
  background: #232323;
  font-size: 11px;
}

/* 「+ 条件（AND）」→ 条件壳右侧的 ＋（几何取 Figma 导出的 plus.svg） */
.ni-root .ni-edge-cond-body > div > button {
  position: absolute;
  top: 0;
  right: 6px;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: var(--ni-control-h);
  margin: 0 !important;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: var(--ni-w-100);
  font-size: 0;
  cursor: pointer;
}
.ni-root .ni-edge-cond-body > div > button::before {
  content: '';
  display: block;
  width: 10.5px;
  height: 10.5px;
  background: currentColor;
  ${niIconMaskCss('plus')}
}
.ni-root .ni-edge-cond-body > div > button:hover:not(:disabled) { background: var(--ni-w-10); }

/* ── 连线条件 · 权重 ────────────────────────────────────────────────────── */
.ni-root .ni-edge-weight { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ni-root .ni-edge-weight-lead { flex: none; font-size: var(--ni-fs-meta); color: var(--ni-w-60); }
.ni-root .ni-edge-weight-group { display: flex; align-items: flex-end; gap: 4px; }
.ni-root .ni-edge-weight-name { flex: none; font-size: 11px; color: var(--ni-w-60); }
.ni-root .ni-edge-weight-box {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 5px;
  border: 0.4px solid var(--ni-w-40);
  border-radius: 4px;
}
.ni-root .ni-edge-weight-box:focus-within { border-color: var(--ni-accent); }
.ni-root .ni-edge-weight-input {
  box-sizing: border-box;
  width: 40px;
  height: auto;
  padding: 0 !important;
  background: transparent !important;
  border: 0 !important;
  border-radius: 0;
  color: var(--ni-w-100);
  font-size: 11px;
}
.ni-root .ni-edge-weight-input:focus { border: 0 !important; box-shadow: none; }
.ni-root .ni-edge-weight-input::placeholder { color: var(--ni-w-40); }
.ni-root .ni-edge-weight-suffix { flex: none; font-size: 11px; color: var(--ni-w-100); }

/* ── 行内壳（交互出口 / 出口 id）────────────────────────────────────────── */
.ni-root .ni-edge-inline {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 9.16px;
  background: var(--ni-input);
  border: 0.611px solid var(--ni-w-08);
  border-radius: var(--ni-radius);
}
.ni-root .ni-edge-inline-label { flex: none; font-size: 11px; color: var(--ni-w-60); }
.ni-root .ni-edge-inline .ni-select,
.ni-root .ni-edge-inline .ni-input { background: #232323; }
`

function ensureEdgeStyle(): void {
  injectStyleOnce('ni-edge', NI_EDGE_CSS)
}

/** 单条出边编辑：目标优先 → 条件可选 → 交互出口可选（默认可默认推进）。 */
function EdgeRouteEditor({
  edge,
  selected,
  nodeIds,
  nodeLabel,
  flowHandleOptions,
  pickers,
  entities,
  variables,
  onSelect,
  onReconnect,
  onPatchData,
  onDelete,
}: {
  edge: import('@/runtime/core/schema/graph-schema').GameEdge
  /** 纯展示的高亮：新增后指出「加的是这一条」，点卡片任意处也能切过来。 */
  selected?: boolean
  nodeIds: string[]
  nodeLabel: (id: string) => string
  flowHandleOptions: Array<{ value: string; label: string }>
  pickers?: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onSelect?: () => void
  onReconnect: (patch: { target?: string; sourceHandle?: string }) => void
  onPatchData: (data: import('@/runtime/core/schema/graph-schema').EdgeRouting) => void
  onDelete: () => void
}): JSX.Element {
  const handleVal = edge.sourceHandle ?? 'default'
  const inList = flowHandleOptions.some((h) => h.value === handleVal)
  const [customMode, setCustomMode] = useState(!inList)
  const clauses = edge.data?.condition?.all ?? []
  const handleId = `ni-edge-handle-${edge.id}`
  const customHandleId = `ni-edge-handle-custom-${edge.id}`
  const weightId = `ni-edge-weight-${edge.id}`

  return (
    <div className="ni-edge-card" onClick={onSelect}>
      <NiCard
        title={translateUi('ui.copy.465618d04405')}
        accent={selected}
        extra={<NiIconButton icon="trash" ariaLabel="删除边" danger onClick={onDelete} />}
      >
        <NiSelect value={edge.target} onChange={(target) => onReconnect({ target })}>
          {nodeIds.map((id) => <option key={id} value={id}>{nodeLabel(id)}</option>)}
        </NiSelect>

        <div className="ni-edge-field">
          <span className="ni-edge-field-label" title={translateUi('ui.copy.a9aa061433f3')}>{translateUi('ui.copy.72f1cf759c9b')}</span>
          <div className={clauses.length ? 'ni-edge-cond' : 'ni-edge-cond is-empty'}>
            {/*
              条件片只做展示（子句的增删改仍在下面的 ConditionEditor 里）。
              新增只认右上那颗 ＋：这一行里还排着已有的子句片，整行做热区会让「想看一眼」
              变成「误加一条」。
            */}
            <div className="ni-edge-cond-shell">
              {clauses.map((clause, index) => (
                <NiChip key={index}>{CLAUSE_CHIP_LABEL[clause.type] ?? clause.type}</NiChip>
              ))}
            </div>
            <div className="ni-edge-cond-body">
              <ConditionEditor
                value={edge.data?.condition}
                nodeIds={nodeIds}
                pickers={pickers}
                entities={entities}
                variables={variables}
                onChange={(condition) => onPatchData({ condition: condition as GraphCondition })}
              />
            </div>
          </div>
        </div>

        <div className="ni-edge-weight">
          <span className="ni-edge-weight-lead">{translateUi('ui.copy.4ec9f02e56c7')}</span>
          <span className="ni-edge-weight-group">
            <label className="ni-edge-weight-name" htmlFor={weightId}>{translateUi('ui.copy.5b7bfdcd1eb8')}</label>
            {/* `%` 只是稿子上的视觉后缀：`EdgeRouting.weight` 是加权随机用的相对数，
                既不是百分比也不做归一化，这里不参与任何换算。 */}
            <span className="ni-edge-weight-box">
              <input
                id={weightId}
                type="number"
                className="ni-input-num ni-edge-weight-input"
                value={edge.data?.weight ?? ''}
                onChange={(ev) => {
                  const value = ev.target.value
                  onPatchData({ weight: value === '' ? undefined : Number(value) })
                }}
                placeholder={translateUi('ui.copy.bc14c9531954')}
                title={translateUi('ui.copy.a79532e6cf7b')}
              />
              <span className="ni-edge-weight-suffix" aria-hidden="true">%</span>
            </span>
          </span>
        </div>

        <div className="ni-edge-inline">
          <label className="ni-edge-inline-label" htmlFor={handleId}>{translateUi('ui.copy.1c761076b5fc')}</label>
          <NiSelect
            id={handleId}
            value={customMode ? '__custom__' : handleVal}
            onChange={(v) => {
              if (v === '__custom__') {
                setCustomMode(true)
                return
              }
              setCustomMode(false)
              onReconnect({ sourceHandle: v })
            }}
            title={translateUi('ui.copy.b3d0115658e5')}
          >
            {flowHandleOptions.map((h) => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
            <option value="__custom__">{translateUi('ui.copy.14bc1405bf05')}</option>
          </NiSelect>
        </div>

        {/* 稿子没画自定义出口 id，但它是「自定义…」唯一的落点，保留并换皮。 */}
        {customMode ? (
          <div className="ni-edge-inline">
            <label className="ni-edge-inline-label" htmlFor={customHandleId}>{translateUi('ui.copy.00ac6b67b5c0')}</label>
            <NiInput
              id={customHandleId}
              value={handleVal}
              onChange={(v) => onReconnect({ sourceHandle: v.trim() || 'default' })}
              placeholder={translateUi('ui.copy.787b29129a4b')}
              title={translateUi('ui.copy.4dd0b47dc70c')}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
        ) : null}
      </NiCard>
    </div>
  )
}

export function EdgeSection({
  graph,
  node,
  nodeIds,
  nodeLabel,
  flowHandleOptions,
  pickers,
  entities,
  variables,
  onChange,
}: {
  graph: GameGraph
  node: GameNode
  nodeIds: string[]
  nodeLabel: (id: string) => string
  flowHandleOptions: Array<{ value: string; label: string }>
  pickers: EditorPickerCtx
  entities?: Record<string, Entity>
  variables?: Record<string, Variable>
  onChange: (g: GameGraph) => void
}): JSX.Element {
  ensureEdgeStyle()
  /** 刚加的那条高亮一下，和「添加结算 / 添加界面」新增即选中的表现对齐；纯展示，不落盘。 */
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  /**
   * 「添加连线」先出一张空目标的卡片，选中目标才 `connect` 落边。
   * 不预塞「第一个别的节点」当目标：那条边当场就生效，作者还没决定去哪，图里已经多了一条
   * 会被运行时走的路。图里因此永远没有目标为空的边，画布 / 引擎都不用理这个中间态。
   *
   * 存的是「哪个节点正在待连」而不是 boolean：配置面板不随选中节点重挂，
   * 布尔值会把上一个节点没连完的草稿漏到下一个节点上。
   */
  const [draftSource, setDraftSource] = useState<string | null>(null)
  const drafting = draftSource === node.id
  const edges = graph.edges.filter((e) => e.source === node.id)
  // 只有一条时高亮没有信息量（没有别的卡片要跟它区分），反而是噪点。
  const showSelection = edges.length > 1
  return (
    /* 出边：先连目标；条件可选；交互出口仅选项/QTE 等需要时再改 */
    <NiSection title={translateUi('ui.copy.d1ca38194207')}>
      {edges.map((e, i) => (
        <Fragment key={e.id}>
        {/* 出边之间的分隔线，与「界面」多张挂载之间用的是同一条（Figma Line 82）。 */}
        {i > 0 ? <NiDivider /> : null}
        <EdgeRouteEditor
          edge={e}
          selected={showSelection && selectedEdgeId === e.id}
          nodeIds={nodeIds}
          nodeLabel={nodeLabel}
          flowHandleOptions={flowHandleOptions}
          pickers={pickers}
          entities={entities}
          variables={variables}
          onSelect={() => setSelectedEdgeId(e.id)}
          onReconnect={(patch) => onChange(reconnect(graph, e.id, patch))}
          onPatchData={(data) => onChange(updateEdgeData(graph, e.id, data))}
          onDelete={() => {
            if (selectedEdgeId === e.id) setSelectedEdgeId(null)
            onChange(disconnect(graph, e.id))
          }}
        />
        </Fragment>
      ))}
      {drafting ? (
        <Fragment>
          {edges.length ? <NiDivider /> : null}
          <div className="ni-edge-card">
            <NiCard
              title={translateUi('ui.copy.465618d04405')}
              accent
              extra={(
                <NiIconButton
                  icon="trash"
                  ariaLabel="取消添加连线"
                  title={translateUi('edgeSection.draft.cancel')}
                  danger
                  onClick={() => setDraftSource(null)}
                />
              )}
            >
              <NiSelect
                value=""
                onChange={(target) => {
                  const next = connect(graph, { source: node.id, sourceHandle: 'default', target })
                  // connect 只返回新图，新边靠差集认出来；同 handle 同目标已经有边时它去重不加边，
                  // 这时高亮那条既有的边，别让「选完什么都没发生」看着像点坏了。
                  const added = next.edges.find((edge) => !graph.edges.some((prev) => prev.id === edge.id))
                  const same = edges.find((edge) => edge.target === target && (edge.sourceHandle ?? 'default') === 'default')
                  setSelectedEdgeId(added?.id ?? same?.id ?? null)
                  setDraftSource(null)
                  onChange(next)
                }}
              >
                <option value="">{translateUi('edgeSection.target.unset')}</option>
                {/* 自环由 connect 静默拒掉，所以本节点压根不进候选，不给作者点空的机会。 */}
                {nodeIds.filter((id) => id !== node.id).map((id) => <option key={id} value={id}>{nodeLabel(id)}</option>)}
              </NiSelect>
            </NiCard>
          </div>
        </Fragment>
      ) : null}
      <NiAddButton
        label={translateUi('ui.copy.3b70c830c9ad')}
        onClick={() => setDraftSource(node.id)}
        disabled={drafting}
        title={translateUi('ui.copy.5866c6de95e5')}
      />
    </NiSection>
  )
}
