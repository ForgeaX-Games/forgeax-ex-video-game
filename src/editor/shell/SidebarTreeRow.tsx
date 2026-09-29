/**
 * SidebarTreeRow —— 侧栏树行的纯展示原子。
 *
 * 只画一行的视觉外壳（缩进 + 箭头/图标 + 文案），行为交给调用方。样式来源是
 * `NewSidebar` 注入的 `ns-row / ns-chev / ns-label` 一组 class——
 * 这份 class 契约就是「新旧资产库长得一样」的单一真相，因此这里不自带任何 CSS。
 *
 * `NsRow` 是主导航那棵功能行（含重命名/删除/新建等），职责更重；本组件只服务
 * 「只读、点了就展开或选中」的简单树（新版资产库）。两者共享 class，不共享数据模型。
 */

import type { DragEventHandler } from 'react'
import { tf as formatUi } from '../../i18n'

const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export interface SidebarTreeRowProps {
  depth: number
  label: string
  active: boolean
  expandable: boolean
  expanded: boolean
  dropActive?: boolean
  onDragEnter?: DragEventHandler<HTMLDivElement>
  onDragLeave?: DragEventHandler<HTMLDivElement>
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
  onActivate: () => void
  onToggle: () => void
}

export function SidebarTreeRow({
  depth,
  label,
  active,
  expandable,
  expanded,
  dropActive = false,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onActivate,
  onToggle,
}: SidebarTreeRowProps): JSX.Element {
  const toggleLabel = formatUi(
    expanded ? 'sidebar.action.collapse' : 'sidebar.action.expand',
    { name: label },
  )
  return (
    <div
      className={`ns-row${active ? ' is-active' : ''}${dropActive ? ' is-drop-target' : ''}`}
      role="treeitem"
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={active}
      data-depth={depth}
      tabIndex={0}
      style={{ paddingLeft: depth * 8 }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onActivate()
      }}
    >
      {expandable ? (
        <button
          type="button"
          className={`ns-chev${expanded ? '' : ' is-collapsed'}`}
          aria-label={toggleLabel}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          {ChevronIcon}
        </button>
      ) : (
        <span className="ns-chev-spacer" aria-hidden />
      )}
      <span className="ns-label" title={label}>
        {label}
      </span>
    </div>
  )
}
