import { t as translateUi } from '../../../i18n'
/**
 * NodeInspector 各配置分区共用的表单原语与派生工具。内容自 `NodeInspector.tsx` 原样迁出。
 */
import { useState, type ReactNode } from 'react'
import type { Entity, GameEdge, OverlayChild, RoutingSettlement, Variable } from '@/runtime/core/schema/graph-schema'
import { authoringOptionLabel } from '@/authoring/formulas/authoring-option-label'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { LooseNumberInput } from '../TermChainEditor'
import { NiField, NiSelect } from '../ni-ui'

export const OVERLAY_CONFIG_CONTROL_WIDTH = '320px'
export const OVERLAY_CONFIG_BASE_LABELS = ['类型', '实体', '属性', '操作', '数值来源', '数值']

export function estimatedLabelUnits(label: string): number {
  return Array.from(label).reduce((units, char) => {
    if (/\s/.test(char)) return units + 0.35
    return units + (/[\x00-\x7F]/.test(char) ? 0.62 : 1)
  }, 0)
}

export function overlayConfigLabelWidth(children: OverlayChild[]): string {
  const labels = [
    ...OVERLAY_CONFIG_BASE_LABELS,
    ...children.flatMap((child) =>
      (getComponentManifest(child.component)?.inputs ?? [])
        .filter((input) => input.key !== 'x' && input.key !== 'y')
        .map((input) => input.label?.trim() || input.key)),
  ]
  const maxUnits = Math.max(4, ...labels.map(estimatedLabelUnits))
  return `${Math.ceil(maxUnits * 11 + 8)}px`
}

export function serializableEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

export function sparseOverlayInputOverride(
  base: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    if (!serializableEqual(value, base?.[key])) out[key] = value
  }
  return out
}

export function row(label: string, node: ReactNode): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        marginBottom: 4,
        fontSize: 12,
        minWidth: 0,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{label}</span>
      {/* 约束右侧控件：长 select 文案不得撑破父层 */}
      <span style={{ flex: 1, minWidth: 0, maxWidth: '100%', display: 'flex', alignItems: 'center' }}>{node}</span>
    </label>
  )
}

export function AdvanceTargetRow({
  sourceLabel,
  currentTarget,
  nodeOptions,
  onChange,
}: {
  sourceLabel: string
  currentTarget: string
  nodeOptions: OptItem[]
  onChange: (targetId: string) => void
}): JSX.Element {
  return (
    <NiField label={<>{translateUi('ui.copy.8ab977960a69')}<span title={sourceLabel} style={{ color: 'var(--ni-w-100)' }}>{sourceLabel}</span> {translateUi('ui.copy.792bbe6e08f5')}</>}>
      <NiSelect ariaLabel="目标节点" value={currentTarget} onChange={onChange}>
        <option value="">{translateUi('ui.copy.ad27a11dfbbe')}</option>
        {nodeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NiSelect>
    </NiField>
  )
}

export function RouteTimingEditor({
  edge,
  routingSettlement,
  defaultAtMs = 1000,
  onChange,
}: {
  edge: GameEdge
  routingSettlement?: RoutingSettlement
  defaultAtMs?: number
  onChange: (transition: 'immediate' | 'onSettlement', settlement?: RoutingSettlement) => void
}): JSX.Element {
  const timing = edge.data?.transition === 'onSettlement'
    ? routingSettlement?.type === 'at' ? 'at' : 'complete'
    : 'immediate'
  return (
    <>
      <NiField label={translateUi('ui.copy.aa4e2de47d57')}>
        <NiSelect
          value={timing}
          onChange={(value) => {
            if (value === 'immediate') onChange('immediate')
            else if (value === 'at') onChange('onSettlement', { type: 'at', ms: Math.max(0, Math.round(defaultAtMs)) })
            else onChange('onSettlement', { type: 'complete' })
          }}
        >
          <option value="immediate">{translateUi('ui.copy.a6b30f2d19fe')}</option>
          <option value="complete">{translateUi('ui.copy.4495ffb5d14b')}</option>
          <option value="at">{translateUi('ui.copy.06fbe86aec21')}</option>
        </NiSelect>
      </NiField>
      {timing === 'at' ? (
        <NiField label={translateUi('ui.copy.e9a51ecb88a1')}>
          <LooseNumberInput
            value={routingSettlement?.type === 'at' ? routingSettlement.ms : 0}
            emptyValue={0}
            onChange={(value) => onChange('onSettlement', {
              type: 'at',
              ms: Math.max(0, value),
            })}
            className="ni-input ni-input-num"
            style={{ flex: 1, minWidth: 0 }}
          />
          <span style={{ fontSize: 12, color: 'var(--ni-w-60)', flexShrink: 0 }}>{translateUi('ui.copy.26cc3217be64')}</span>
        </NiField>
      ) : null}
    </>
  )
}

/** 悬停 / 模块内聚焦时边框微亮；`nested` 仅略缩进，底色与父级一致。 */
const HOVER_CARD_CLASS = 'ni-hover-card'
const HOVER_CARD_NESTED = 'ni-hover-card--nested'
const HOVER_CARD_STYLE_ID = 'ni-hover-card-style-v8'

export function ensureHoverCardStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(HOVER_CARD_STYLE_ID)) return
  for (const id of [
    'ni-hover-card-style',
    'ni-hover-card-style-v2',
    'ni-hover-card-style-v3',
    'ni-hover-card-style-v4',
    'ni-hover-card-style-v5',
    'ni-hover-card-style-v6',
    'ni-hover-card-style-v7',
  ]) {
    document.getElementById(id)?.remove()
  }
  const el = document.createElement('style')
  el.id = HOVER_CARD_STYLE_ID
  el.textContent = `
.${HOVER_CARD_CLASS} {
  margin-top: 8px;
  border-radius: 6px;
  padding: 8px;
  border: 1px solid #333;
  background: #141414;
  transition: border-color 120ms ease;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.${HOVER_CARD_CLASS}:hover,
.${HOVER_CARD_CLASS}:focus-within {
  border-color: #4ea1ff;
}
.${HOVER_CARD_CLASS}.${HOVER_CARD_NESTED} {
  margin-left: 6px;
  border-color: #2c2c2c;
}
.${HOVER_CARD_CLASS}.${HOVER_CARD_NESTED}:hover,
.${HOVER_CARD_CLASS}.${HOVER_CARD_NESTED}:focus-within {
  border-color: #6bc4a8;
}
`
  document.head.appendChild(el)
}

export function HoverCard({
  header,
  children,
  nested,
  accent,
  anchorRef,
  anchorId,
}: {
  header: ReactNode
  children: ReactNode
  /** 子模块（如覆盖物下的事件）：略缩进；悬停青绿边，底色与父级同。 */
  nested?: boolean
  /** 聚焦态：橙色描边 + 微高亮底（预览台选中该挂载时）。 */
  accent?: boolean
  /** 时间轴选中后滚入右侧可视区的卡片根节点。 */
  anchorRef?: (element: HTMLDivElement | null) => void
  anchorId?: string
}): JSX.Element {
  ensureHoverCardStyle()
  return (
    <div
      ref={anchorRef}
      data-focus-anchor={anchorId}
      className={nested ? `${HOVER_CARD_CLASS} ${HOVER_CARD_NESTED}` : HOVER_CARD_CLASS}
      style={accent ? { outline: '1px solid #f08840', outlineOffset: 1 } : undefined}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: '1px solid #262626',
        }}
      >
        {header}
      </div>
      {children}
    </div>
  )
}

export function sectionLabel(text: string): JSX.Element {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, margin: '8px 0 4px', letterSpacing: 0.2 }}>
      {text}
    </div>
  )
}

/** 下拉项：value 落盘、label 展示（组件中文名等）。 */
export interface OptItem {
  value: string
  label: string
}

/**
 * 节点「视频」下拉项：id 写入 media.ref；label 与 durationMs 仅展示。
 * `durationMs` 是可选展示元数据，不进蓝图文档。
 */
export interface VideoOption {
  id: string
  label: string
  durationMs?: number
  /** Editor-only media URL used for compact visual previews such as the graph minimap. */
  previewUrl?: string
}

// ── watch 字段级联选择（对象 → 字段 → …，最多 5 层）+ 手动输入 ────────────────────
/** 字段树节点：seg 拼进 expr 路径；有 children 则可继续下钻，叶子即完整路径。 */
export interface FieldNode {
  seg: string
  label: string
  children?: FieldNode[]
}

/** 由 scenario 的实体/变量派生可监听字段树：entity.<id>.attr.<name> / var.<id> / score。 */
export function buildFieldTree(
  entities: Record<string, Entity> | undefined,
  variables: Record<string, Variable> | undefined,
): FieldNode[] {
  const ents: FieldNode[] = Object.values(entities ?? {}).map((e) => ({
    seg: e.id,
    label: authoringOptionLabel(e.name, e.id),
    children: [
      {
        seg: 'attr',
        label: translateUi('ui.object.86de52d17820'),
        children: Object.keys(e.attrs ?? {}).map((a) => ({
          seg: a,
          label: authoringOptionLabel(e.attrMeta?.[a]?.label, a),
        })),
      },
    ],
  }))
  const vars: FieldNode[] = Object.values(variables ?? {}).map((v) => ({
    seg: v.id,
    label: authoringOptionLabel(v.name, v.id),
  }))
  return [
    { seg: 'entity', label: translateUi('ui.object.eb4308300e83'), children: ents },
    { seg: 'var', label: translateUi('ui.object.a772fa4ebe36'), children: vars },
    { seg: 'score', label: translateUi('ui.object.89e35e662a1e') },
  ]
}

/** 路径 segs 是否能在字段树中逐级命中（决定默认走级联还是手动）。 */
function pathInTree(tree: FieldNode[], path: string): boolean {
  if (!path) return true
  let opts: FieldNode[] | undefined = tree
  for (const seg of path.split('.')) {
    const hit: FieldNode | undefined = opts?.find((o) => o.seg === seg)
    if (!hit) return false
    opts = hit.children
  }
  return true
}

const MAX_FIELD_LEVELS = 5

/** watch.of 编辑：级联下拉（选对象→选字段…）+ 手动输入兜底。 */
export function WatchFieldEditor({
  tree,
  value,
  onChange,
}: {
  tree: FieldNode[]
  value: string
  onChange: (path: string) => void
}): JSX.Element {
  const [manual, setManual] = useState<boolean>(!!value && !pathInTree(tree, value))
  const segs = value ? value.split('.') : []
  // 逐层收集可选项：level0=根；选中且有 children 才展开下一层。
  const levels: Array<{ opts: FieldNode[]; cur: string }> = []
  let opts: FieldNode[] | undefined = tree
  let depth = 0
  while (opts && opts.length && depth < MAX_FIELD_LEVELS) {
    const cur = segs[depth] ?? ''
    levels.push({ opts, cur })
    const hit: FieldNode | undefined = opts.find((o) => o.seg === cur)
    if (!hit) break
    opts = hit.children
    depth++
  }
  const pick = (level: number, seg: string) => {
    const next = seg ? [...segs.slice(0, level), seg] : segs.slice(0, level)
    onChange(next.join('.'))
  }
  return (
    <>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
        <span style={{ width: 76, opacity: 0.7, flexShrink: 0 }}>{translateUi('ui.copy.77a49f2c3874')}</span>
        <label style={{ fontSize: 11, opacity: 0.7, display: 'flex', gap: 3, alignItems: 'center' }}>
          <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> {translateUi('ui.copy.2a4a4de8068b')}</label>
      </label>
      {manual ? (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={translateUi('ui.copy.c18081223f40')}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {levels.map((lv, k) => (
            <NiSelect
              key={k}
              value={lv.cur}
              onChange={(seg) => pick(k, seg)}
              // flex:none 顶掉 NiSelect 壳默认的 flex:1：这几级下拉原本按内容宽排在一行里。
              style={{ flex: 'none', fontSize: 12, maxWidth: 150 }}
            >
              <option value="">{k === 0 ? translateUi('ui.copy.66bd4c551279') : translateUi('ui.copy.57feb21e0693')}</option>
              {lv.opts.map((o) => <option key={o.seg} value={o.seg}>{o.label}</option>)}
            </NiSelect>
          ))}
          <span style={{ fontSize: 11, opacity: 0.5, alignSelf: 'center', fontFamily: 'monospace' }}>{value || '—'}</span>
        </div>
      )}
    </>
  )
}
