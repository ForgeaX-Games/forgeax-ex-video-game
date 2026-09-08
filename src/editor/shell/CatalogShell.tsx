import { t as translateUi } from '../../i18n'
/**
 * CatalogShell —— 通用「左列表 + 右预览」外壳（graph 自带，解耦自旧 forge/CatalogTabs）。
 * 供 GraphConfigView（界面/规则）等配置页复用；样式沿用旧 gc-* 暖色栏目风（仅壳子集）。
 *
 * 两种列表形态（同一套 gc-* 皮）：
 *  - **扁平**：item 无 `children` → 一行可选（规则 tab：实体/变量/…）。
 *  - **分组/树**：item 带 `children` → 渲成可折叠组头 + 缩进叶子行，选中永远落在叶子
 *    （界面 tab：自定义覆盖物组头 → 各方案叶子）。组头可挂 `action`（如「+方案」）。
 * `selectedId` / `renderPreview(selected)` 都以「扁平化后的叶子」为准，两形态一致。
 */
import { useRef, useState, type ReactNode } from 'react'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'

export interface CatalogItem {
  id: string
  label: string
  /** 有 children ⇒ 本项是分组头（本身不可选），children 为可选叶子。 */
  children?: CatalogItem[]
  /** 叶子/行右侧角标（如引用数）。 */
  badge?: ReactNode
  /** 分组头右侧操作槽（如「+方案」按钮）。仅分组头用。 */
  action?: ReactNode
}

/** 扁平化出所有可选叶子（无 children 的项即自身叶子）。 */
function leavesOf(items: readonly CatalogItem[]): CatalogItem[] {
  return items.flatMap((it) => (it.children ? it.children : [it]))
}

function Leaf({
  item,
  selectedId,
  onSelect,
  indented = false,
  renderRowActions,
}: {
  item: CatalogItem
  selectedId: string
  onSelect: (id: string) => void
  indented?: boolean
  renderRowActions?: (id: string) => ReactNode
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      data-leaf-id={item.id}
      className={`gc-row${indented ? ' is-leaf' : ''}${item.id === selectedId ? ' is-on' : ''}`}
      onClick={(e) => { e.currentTarget.focus(); onSelect(item.id) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(item.id)
        }
      }}
    >
      <span className="gc-row-mark" aria-hidden>✓</span>
      <span className="gc-row-label">{item.label}</span>
      {item.badge != null ? <span className="gc-row-badge">{item.badge}</span> : null}
      {renderRowActions && (
        <span className="gc-row-actions" onClick={(e) => e.stopPropagation()}>
          {renderRowActions(item.id)}
        </span>
      )}
    </div>
  )
}

function Group({
  group,
  selectedId,
  onSelect,
  renderRowActions,
}: {
  group: CatalogItem
  selectedId: string
  onSelect: (id: string) => void
  renderRowActions?: (id: string) => ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const children = group.children ?? []
  return (
    <div className="gc-group">
      <div className="gc-group-head">
        <button
          type="button"
          className="gc-group-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="gc-group-caret" aria-hidden>{open ? '▾' : '▸'}</span>
          <span className="gc-group-label">{group.label}</span>
          <span className="gc-group-count">{children.length}</span>
        </button>
        {group.action != null ? <span className="gc-group-action">{group.action}</span> : null}
      </div>
      {open ? (
        <div className="gc-group-children">
          {children.length === 0 ? (
            <div className="gc-group-empty">{translateUi('ui.copy.76bfe31a79b9')}</div>
          ) : (
            children.map((c) => (
              <Leaf key={c.id} item={c} selectedId={selectedId} onSelect={onSelect} renderRowActions={renderRowActions} indented />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export function CatalogShell({
  icon,
  title,
  items,
  selectedId,
  onSelect,
  renderPreview,
  headAction,
  renderRowActions,
  className,
}: {
  icon: string
  title: string
  items: readonly CatalogItem[]
  selectedId: string
  onSelect: (id: string) => void
  renderPreview: (item: CatalogItem | undefined) => ReactNode
  /** 列表标题栏右侧动作槽（如「＋新建」入口）。 */
  headAction?: ReactNode
  /** 每行右侧的行内动作（hover/选中才显）；返回 null 则该行无动作。 */
  renderRowActions?: (id: string) => ReactNode
  /** 仅供调用方附加领域皮肤，不改变 CatalogShell 的交互契约。 */
  className?: string
}): JSX.Element {
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  const leaves = leavesOf(items)
  const selected = leaves.find((i) => i.id === selectedId)
  const hasGroups = items.some((item) => item.children != null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 列表内 ↑/↓ 按扁平叶子顺序切换选中（循环），并把焦点移到新行——好让连续方向键继续走列表、
  // 而非画布（OverlaySchemeEditor 的画布组件切换靠 `.gc-list` 焦点判定让位）。事件源不在某行上则不拦。
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const t = e.target as HTMLElement
    // 行内输入框/下拉/可编辑区（如重命名框）内放行给原生光标移动，不劫持为切换。
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
    if (!t.closest('.gc-row')) return
    if (leaves.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    const step = e.key === 'ArrowDown' ? 1 : -1
    const cur = leaves.findIndex((l) => l.id === selectedId)
    const next = cur < 0 ? (step === 1 ? 0 : leaves.length - 1) : (cur + step + leaves.length) % leaves.length
    const nextId = leaves[next]!.id
    onSelect(nextId)
    // 目标行已在 DOM 里（只是未选中），可同步聚焦；is-on 类由重渲染补上。
    bodyRef.current?.querySelector<HTMLElement>(`[data-leaf-id="${nextId}"]`)?.focus()
  }

  return (
    <div className={`gc-tab${className ? ` ${className}` : ''}`}>
      <aside className="gc-list" aria-label={title}>
        <div className="gc-list-head">
          <span className="gc-list-ico" aria-hidden>{icon}</span>
          <span className="gc-list-title">{title}</span>
          <span className="gc-list-count">{leaves.length}</span>
          {headAction && <span className="gc-list-head-action">{headAction}</span>}
        </div>
        <div className={`gc-list-body${hasGroups ? ' has-groups' : ''}`} ref={bodyRef} onKeyDown={onListKeyDown}>
          {items.map((it) =>
            it.children ? (
              <Group key={it.id} group={it} selectedId={selectedId} onSelect={onSelect} renderRowActions={renderRowActions} />
            ) : (
              <Leaf key={it.id} item={it} selectedId={selectedId} onSelect={onSelect} renderRowActions={renderRowActions} />
            ),
          )}
        </div>
      </aside>
      <section className="gc-preview">{renderPreview(selected)}</section>
    </div>
  )
}
