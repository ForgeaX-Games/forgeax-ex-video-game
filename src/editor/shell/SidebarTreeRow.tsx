/**
 * SidebarTreeRow —— 侧栏树行的纯展示原子。
 *
 * 只画一行的视觉外壳（缩进 + 箭头/图标 + 文案），行为交给调用方。样式来源是
 * `NewSidebar` 注入的 `ns-row / ns-chev / ns-leading / ns-label` 一组 class——
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

const AssetLibraryIcon = (
  <svg
    aria-hidden
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    preserveAspectRatio="none"
    overflow="visible"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M1.212 12C0.876 12 0.59 11.882 0.354 11.646C0.118 11.41 0 11.1243 0 10.7888V2.6145C0 2.4685 0.02325 2.331 0.06975 2.202C0.11625 2.073 0.18625 1.95425 0.27975 1.84575L1.44825 0.44325C1.55675 0.29675 1.6925 0.18625 1.8555 0.11175C2.0185 0.0372501 2.19325 0 2.37975 0H9.59175C9.77775 0 9.95475 0.0372501 10.1227 0.11175C10.2907 0.18625 10.429 0.2965 10.5375 0.4425L11.7203 1.875C11.8138 1.9835 11.8837 2.10475 11.9302 2.23875C11.9767 2.37225 12 2.51225 12 2.65875V10.7888C12 11.1238 11.882 11.4095 11.646 11.646C11.41 11.882 11.1243 12 10.7888 12H1.212ZM1.035 2.106H10.95L9.9525 0.9075C9.904 0.8595 9.8485 0.82125 9.786 0.79275C9.7235 0.76425 9.6585 0.75 9.591 0.75H2.394C2.327 0.75 2.262 0.7645 2.199 0.7935C2.136 0.8225 2.081 0.861 2.034 0.909L1.035 2.106ZM8.24925 2.856H3.75V6.9585C3.75 7.1885 3.84475 7.3635 4.03425 7.4835C4.22375 7.6035 4.4195 7.6105 4.6215 7.5045L6 6.822L7.37925 7.5045C7.58075 7.61 7.77625 7.603 7.96575 7.4835C8.15525 7.3635 8.25 7.1885 8.25 6.9585L8.24925 2.856Z"
      fill="currentColor"
    />
  </svg>
)

export interface SidebarTreeRowProps {
  depth: number
  label: string
  active: boolean
  expandable: boolean
  expanded: boolean
  /** 顶层入口用资产库图标替代箭头，与旧资产库入口一致。 */
  leading?: 'asset-library'
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
  leading,
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
      {leading === 'asset-library' ? (
        <button
          type="button"
          className="ns-leading"
          aria-label={toggleLabel}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
        >
          {AssetLibraryIcon}
        </button>
      ) : expandable ? (
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
