/**
 * ni-ui 原语 —— 节点配置面板五个分区共用的壳。
 *
 * 边界：这里只有外观和无状态交互（点了往上抛），不知道 graph / node.data 是什么。
 * 任何要读写图的逻辑都留在各分区组件里，走 `patchData` / `graph-edit` 的既有入口。
 */
import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, JSX, MutableRefObject, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { NiChevronDown, NiIcon, type NiIconName } from './NiIcon'
import { ensureNiUiStyle } from './theme'

const POPUP_MAX_H = 280
const POPUP_GAP = 4
/** 估一行胶囊的高度（12px 行高 + 上下 padding + 行间距），用来判断「下方到底放不放得下」。 */
const POPUP_ROW_H = 28
const POPUP_LIST_PAD = 26
/** 翻上去也得留得下这么多，否则宁可向下滚动。 */
const POPUP_MIN_H = 96

function popupDesiredHeight(itemCount: number): number {
  return Math.min(POPUP_MAX_H, Math.max(POPUP_MIN_H, itemCount * POPUP_ROW_H + POPUP_LIST_PAD))
}

/** 浮层最宽不超过这个值，再长的候选才退回省略号。 */
const POPUP_MAX_W = 420
/** 浮层与视口边缘的最小留白。 */
const POPUP_EDGE = 8

interface AnchoredRect {
  /**
   * 水平锚点二选一：触发器在视口左半边时左对齐，靠右时改为右对齐，
   * 让浮层向左生长而不是被视口右缘挤窄。
   */
  left?: number
  right?: number
  /** 至少和触发器一样宽；实际宽度由内容撑（width: max-content）。 */
  minWidth: number
  maxWidth: number
  /** 已选好的落点：向下时是 top，向上时是 bottom（距视口底）。 */
  top?: number
  bottom?: number
  maxHeight: number
}

function sameRect(a: AnchoredRect, b: AnchoredRect): boolean {
  return a.left === b.left && a.right === b.right
    && a.top === b.top && a.bottom === b.bottom
    && a.minWidth === b.minWidth && a.maxWidth === b.maxWidth
    && a.maxHeight === b.maxHeight
}

/**
 * 把浮层钉在触发器上。用 fixed + 视口测量而不是 absolute，是因为配置面板本身在一个
 * `overflow:auto` 的滚动列里——absolute 浮层会被祖先裁掉。
 */
function useAnchoredRect(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  itemCount: number,
): AnchoredRect | null {
  const [rect, setRect] = useState<AnchoredRect | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      setRect(null)
      return
    }
    const update = () => {
      const el = anchorRef.current
      if (!el || typeof window === 'undefined') return
      const r = el.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - POPUP_GAP * 2
      const above = r.top - POPUP_GAP * 2
      const desired = popupDesiredHeight(itemCount)
      // 下方装不下整张列表、且上方更宽裕时向上翻。两边都不够就选更宽的那侧内部滚动。
      const flip = below < desired && above > below
      // 触发器过窄时浮层要能变宽，否则长选项只能省略号、根本看不出选的是什么。
      // 靠右的触发器改成右对齐，多出来的宽度往左长，不会顶到视口外。
      const anchorRight = r.left > window.innerWidth / 2
      const horizontal = anchorRight
        ? { right: Math.max(POPUP_EDGE, window.innerWidth - r.right), maxWidth: Math.max(r.width, Math.min(POPUP_MAX_W, r.right - POPUP_EDGE)) }
        : { left: Math.max(POPUP_EDGE, r.left), maxWidth: Math.max(r.width, Math.min(POPUP_MAX_W, window.innerWidth - r.left - POPUP_EDGE)) }
      const next: AnchoredRect = {
        ...horizontal,
        minWidth: r.width,
        ...(flip
          ? { bottom: window.innerHeight - r.top + POPUP_GAP, maxHeight: Math.max(POPUP_MIN_H, Math.min(desired, above)) }
          : { top: r.bottom + POPUP_GAP, maxHeight: Math.max(POPUP_MIN_H, Math.min(desired, below)) }),
      }
      // 值没变就保持同一个对象：浮层内部滚动也会触发这个监听，每次都换新对象会白重渲一轮。
      setRect((prev) => (prev && sameRect(prev, next) ? prev : next))
    }
    update()
    window.addEventListener('resize', update)
    // capture：面板列自身滚动时也要跟着走。
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, anchorRef, itemCount])
  return rect
}

/** 点击外部 / Esc 收起。 */
function useDismiss(open: boolean, onDismiss: () => void, ...insideRefs: RefObject<HTMLElement | null>[]): void {
  const refs = useRef(insideRefs)
  refs.current = insideRefs
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (refs.current.some((ref) => ref.current?.contains(target))) return
      onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onDismiss])
}

/**
 * 候选胶囊浮层。`tone='input'` 跟随下拉壳的 #1a1a1a，`tone='panel'` 是「＋ 添加X」用的 #2b2b2b。
 * 渲染到 body，所以容器自己带上 `ni-root` 才吃得到作用域样式。
 */
function NiPopupList({
  rect,
  tone,
  items,
  value,
  panelRef,
  ariaLabel,
  backLabel,
  onBack,
  onPick,
}: {
  rect: AnchoredRect | null
  tone: 'input' | 'panel'
  items: readonly NiSelectOption[]
  value?: string
  panelRef: MutableRefObject<HTMLDivElement | null>
  ariaLabel?: string
  /** 下钻后显示的返回行文案（父项标签）。 */
  backLabel?: string
  onBack?: () => void
  onPick: (value: string) => void
}): JSX.Element | null {
  const listRef = useRef<HTMLDivElement | null>(null)
  /**
   * 长列表（视频素材可能上百条）：**打开时**把当前值滚进可视区，否则作者看到的是列表顶部。
   *
   * 只做一次。这里曾经跟着 `rect` 跑，结果是：在浮层里滚动 → 冒到 window 的捕获监听重算
   * 锚点 → rect 变 → 本效果重跑 → 又把选中项拉回视野，表现为「列表滚不动」。
   * 浮层关闭时整个组件卸载，标志位自然复位。
   */
  const didAutoScroll = useRef(false)
  useLayoutEffect(() => {
    if (!rect || didAutoScroll.current) return
    didAutoScroll.current = true
    listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [rect])
  if (!rect || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={panelRef}
      className="ni-root ni-portal"
      style={{
        position: 'fixed',
        // 宽度按内容撑，下限是触发器宽、上限由视口留白算出。
        width: 'max-content',
        minWidth: rect.minWidth,
        maxWidth: rect.maxWidth,
        ...(rect.left != null ? { left: rect.left } : { right: rect.right }),
        ...(rect.top != null ? { top: rect.top } : { bottom: rect.bottom }),
      }}
    >
      <div
        ref={listRef}
        className={tone === 'panel' ? 'ni-menu-list is-panel' : 'ni-menu-list'}
        role="listbox"
        aria-label={ariaLabel}
        style={{ maxHeight: rect.maxHeight }}
      >
        {onBack ? (
          <div className="ni-menu-row">
            <button type="button" className="ni-menu-item is-back" tabIndex={-1} onClick={onBack}>
              <NiIcon name="chevron" size={9} />
              <span className="ni-menu-item-label">{backLabel ?? '返回'}</span>
            </button>
          </div>
        ) : null}
        {items.map((option) => (
          <div className="ni-menu-row" key={option.value}>
            <button
              type="button"
              className="ni-menu-item"
              tabIndex={-1}
              title={option.title ?? option.label}
              data-selected={value != null && option.value === value}
              disabled={option.disabled}
              onClick={() => onPick(option.value)}
            >
              <span className="ni-menu-item-label">{option.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  )
}

/** 一个配置分区：橙色竖条 + 标题 + 内容，分区之间靠底边分隔。 */
export function NiSection({
  title,
  extra,
  children,
  gap,
}: {
  title: string
  /** 标题行右侧（计数、折叠开关等）。 */
  extra?: ReactNode
  children?: ReactNode
  /** 覆盖分区内容与标题之间的间距（视频区稿子是 12px，其余 14px）。 */
  gap?: number
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <section className="ni-section" style={gap == null ? undefined : { gap }}>
      <div className="ni-section-head">
        <span className="ni-section-title">{title}</span>
        {extra ? <span className="ni-section-head-extra">{extra}</span> : null}
      </div>
      {children}
    </section>
  )
}

/** 标签在上、控件在下的字段。`hint` 是标签右侧的小字（如视频时长 15s）。 */
export function NiField({
  label,
  hint,
  htmlFor,
  children,
}: {
  label?: ReactNode
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
}): JSX.Element {
  ensureNiUiStyle()
  const body = <div className="ni-field-control">{children}</div>
  if (!label) return <div className="ni-field">{body}</div>
  return (
    <label className="ni-field" htmlFor={htmlFor}>
      <span className="ni-field-label">
        {label}
        {hint ? <span className="ni-field-hint">{hint}</span> : null}
      </span>
      {body}
    </label>
  )
}

export interface NiSelectOption {
  value: string
  label: string
  disabled?: boolean
  /** 悬停说明；不传则回落到 label（长文案被省略号截断时仍看得到全文）。 */
  title?: string
}

/** 菜单项可以再挂一层子项：选中父项不落值，而是把候选换成它的 children。 */
export interface NiMenuOption extends NiSelectOption {
  children?: readonly NiMenuOption[]
}

/** 把调用方直接传的 `<option>` 子节点读成候选项，供自绘列表渲染。 */
function optionsFromChildren(children: ReactNode): NiSelectOption[] {
  const out: NiSelectOption[] = []
  for (const child of Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== 'option') continue
    const props = child.props as { value?: string; disabled?: boolean; children?: ReactNode }
    out.push({
      value: String(props.value ?? ''),
      label: Children.toArray(props.children).filter((part) => typeof part === 'string').join(''),
      disabled: props.disabled,
    })
  }
  return out
}

/**
 * 下拉（Figma Component 126 · 15635:81344）。收起是一只 Text Input 壳，展开时同一只壳长高，
 * 把候选胶囊**内联**铺在触发行下面，把下方内容顶下去 —— 不是浮层。
 *
 * DOM 里同时留着一个透明、不吃鼠标的原生 `<select>`：它继续承担无障碍语义与既有测试的
 * `fireEvent.change` 入口，视觉全部交给上面的壳。这样换皮不动任何调用方与断言。
 */
export function NiSelect({
  ariaLabel,
  value,
  options,
  onChange,
  title,
  disabled,
  id,
  style,
  placeholder,
  children,
}: {
  ariaLabel?: string
  value: string
  options?: readonly NiSelectOption[]
  onChange: (value: string) => void
  title?: string
  disabled?: boolean
  id?: string
  style?: CSSProperties
  placeholder?: string
  /** 需要自定义 `<option>` 结构（分组、占位项）时直接传子节点，与 `options` 二选一。 */
  children?: ReactNode
}): JSX.Element {
  ensureNiUiStyle()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const items = options ?? optionsFromChildren(children)
  const selected = items.find((option) => option.value === value)
  const rect = useAnchoredRect(open, rootRef, items.length)
  useDismiss(open, () => setOpen(false), rootRef, panelRef)

  const shellClass = [
    'ni-select-shell',
    open ? 'is-open' : '',
    disabled ? 'is-disabled' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="ni-select-root" ref={rootRef} style={style}>
      <select
        id={id}
        className="ni-select-native"
        aria-label={ariaLabel}
        title={title}
        value={value}
        disabled={disabled}
        // 掐掉原生弹层，改开自绘列表；键盘（方向键 / Home / End）仍走原生，值照常写回。
        onMouseDown={(event) => {
          event.preventDefault()
          if (!disabled) setOpen((prev) => !prev)
        }}
        onChange={(event) => onChange(event.target.value)}
      >
        {children ?? items.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {/* 壳只是原生 select 的外观替身：语义、焦点、tooltip 都留在上面那个元素上。 */}
      <div className={shellClass} aria-hidden="true">
        <button
          type="button"
          className="ni-select-trigger"
          tabIndex={-1}
          disabled={disabled}
        >
          <span className={selected?.label ? 'ni-select-value' : 'ni-select-value is-placeholder'}>
            {selected?.label || placeholder || ''}
          </span>
          <NiChevronDown />
        </button>
      </div>
      {open && !disabled ? (
        <NiPopupList
          rect={rect}
          tone="input"
          items={items}
          value={value}
          panelRef={panelRef}
          ariaLabel={ariaLabel}
          onPick={(next) => {
            setOpen(false)
            if (next !== value) onChange(next)
          }}
        />
      ) : null}
    </div>
  )
}

/** 单行文本输入。 */
export function NiInput({
  ariaLabel,
  value,
  onChange,
  placeholder,
  title,
  disabled,
  id,
  numeric,
  style,
}: {
  ariaLabel?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  title?: string
  disabled?: boolean
  id?: string
  /** 右对齐 + 去掉原生 spinner；数值仍以字符串上抛，解析交给调用方。 */
  numeric?: boolean
  style?: CSSProperties
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <input
      id={id}
      className={numeric ? 'ni-input ni-input-num' : 'ni-input'}
      aria-label={ariaLabel}
      title={title}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      style={style}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

/** 二选一（单次/循环、自动/手动）。语义是两个互斥按钮，不是 radio 组。 */
export function NiSegmented<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  title,
  style,
}: {
  ariaLabel?: string
  value: T
  options: readonly { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  title?: string
  style?: CSSProperties
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <span className="ni-segmented" role="group" aria-label={ariaLabel} title={title} style={style}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ni-segmented-item"
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

/** 分区底部的虚位「＋ 添加 X」。 */
export function NiAddButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <button type="button" className="ni-add-btn" onClick={onClick} disabled={disabled} title={title}>
      <NiIcon name="plus" size={12} />
      {label}
    </button>
  )
}

/**
 * 候选浮层的可复用内核：把「开合 + 定位 + 下钻」抽出来，触发器交给调用方自己画。
 *
 * 用它是因为设计稿里触发器长相各异——有虚位「＋ 添加X」按钮，也有「事件响应」那一行右侧
 * 的小 ＋（展开时变 ✕）。它们共用同一张候选浮层，只是外面那颗按钮不同。
 *
 * `options` 里带 `children` 的项不落值，点它把候选换成子层，浮层顶部出现返回行；
 * 叶子项才触发 `onSelect(value, path)`，`path` 是从根到该叶子的祖先 value 列表。
 */
export function useNiMenu({
  options,
  onSelect,
  tone = 'panel',
  ariaLabel,
}: {
  options: readonly NiMenuOption[]
  onSelect: (value: string, path: string[]) => void
  tone?: 'input' | 'panel'
  ariaLabel?: string
}): {
  anchorRef: MutableRefObject<HTMLDivElement | null>
  open: boolean
  toggle: () => void
  close: () => void
  popup: JSX.Element | null
} {
  ensureNiUiStyle()
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState<string[]>([])
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // 沿 path 走到当前层；路径失效（options 变了）时退回根层。
  let level: readonly NiMenuOption[] = options
  let parentLabel: string | undefined
  for (const seg of path) {
    const hit = level.find((option) => option.value === seg)
    if (!hit?.children) { level = options; parentLabel = undefined; break }
    level = hit.children
    parentLabel = hit.label
  }

  const rect = useAnchoredRect(open, anchorRef, level.length + (path.length ? 1 : 0))
  const close = () => { setOpen(false); setPath([]) }
  useDismiss(open, close, anchorRef, panelRef)

  return {
    anchorRef,
    open,
    toggle: () => (open ? close() : setOpen(true)),
    close,
    popup: open ? (
      <NiPopupList
        rect={rect}
        tone={tone}
        items={level}
        panelRef={panelRef}
        ariaLabel={ariaLabel}
        backLabel={parentLabel}
        onBack={path.length ? () => setPath((prev) => prev.slice(0, -1)) : undefined}
        onPick={(next) => {
          const hit = level.find((option) => option.value === next)
          if (hit?.children?.length) {
            setPath((prev) => [...prev, next])
            return
          }
          const picked = [...path]
          close()
          onSelect(next, picked)
        }}
      />
    ) : null,
  }
}

/**
 * 「＋ 添加 X」按钮 + 候选浮层（Figma Component 127 · 15635:81648/81660）。
 *
 * 稿子把候选画在按钮正下方是展开示意；实际按通用下拉走浮层，不顶动下方内容。
 * 「＋ 添加效果 / 添加连线 / 绑定界面」这类「选一种再新增」的入口都用它。
 */
export function NiAddMenu({
  label,
  options,
  onSelect,
  disabled,
  title,
  ariaLabel,
}: {
  label: string
  options: readonly NiMenuOption[]
  onSelect: (value: string, path: string[]) => void
  disabled?: boolean
  title?: string
  ariaLabel?: string
}): JSX.Element {
  const menu = useNiMenu({ options, onSelect, ariaLabel: ariaLabel ?? label })
  return (
    <div className="ni-add-menu-root" ref={menu.anchorRef}>
      <button
        type="button"
        className="ni-add-btn"
        aria-expanded={menu.open}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? label}
        title={title}
        disabled={disabled}
        onClick={menu.toggle}
      >
        <NiIcon name="plus" size={12} />
        {label}
      </button>
      {disabled ? null : menu.popup}
    </div>
  )
}

/** 头部小胶囊按钮（从此试玩 / 删除节点）。 */
export function NiPillButton({
  icon,
  label,
  ariaLabel,
  onClick,
  danger,
  title,
}: {
  icon?: NiIconName
  label: string
  /** 图标改成矢量后，可见文案与无障碍名可能需要分开（旧名字仍被多处测试定位）。 */
  ariaLabel?: string
  onClick: () => void
  danger?: boolean
  title?: string
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <button
      type="button"
      className={danger ? 'ni-pill-btn is-danger' : 'ni-pill-btn'}
      aria-label={ariaLabel}
      onClick={onClick}
      title={title}
    >
      {icon ? <NiIcon name={icon} size={14} /> : null}
      {label}
    </button>
  )
}

/** 只有图标的方按钮（卡片右上角的删除、事件行的关闭）。 */
export function NiIconButton({
  icon,
  ariaLabel,
  onClick,
  danger,
  disabled,
  title,
  rotate,
  size = 14,
}: {
  icon: NiIconName
  ariaLabel: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  title?: string
  rotate?: number
  size?: number
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <button
      type="button"
      className={danger ? 'ni-icon-btn is-danger' : 'ni-icon-btn'}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <NiIcon name={icon} size={size} rotate={rotate} />
    </button>
  )
}

/**
 * 一份挂载 / 一条结算 / 一条出边的容器。
 * `anchorId` / `anchorRef` 是预览台与时间轴的联动锚点（`data-focus-anchor`），
 * 换皮时必须原样保留，否则右侧滚动定位会断。
 */
export function NiCard({
  title,
  badges,
  extra,
  children,
  accent,
  anchorId,
  anchorRef,
  onTitleClick,
  titleTitle,
}: {
  title?: ReactNode
  badges?: ReactNode
  extra?: ReactNode
  children?: ReactNode
  accent?: boolean
  anchorId?: string
  anchorRef?: (element: HTMLDivElement | null) => void
  onTitleClick?: () => void
  titleTitle?: string
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <div
      ref={anchorRef}
      data-focus-anchor={anchorId}
      className={accent ? 'ni-card is-accent' : 'ni-card'}
    >
      {title || badges || extra ? (
        <div className="ni-card-head">
          <span
            className="ni-card-title"
            title={titleTitle}
            style={onTitleClick ? { cursor: 'pointer' } : undefined}
            onClick={onTitleClick}
          >
            {title}
          </span>
          {badges}
          {extra ? <span className="ni-card-head-extra">{extra}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

/**
 * 分区内相邻条目之间的分隔线（Figma Line 82 · 15635:81558）。
 * 上下净距交给容器的 gap，所以它自己零高——界面挂载之间与出边之间共用同一条。
 */
export function NiDivider(): JSX.Element {
  ensureNiUiStyle()
  return <div className="ni-divider" aria-hidden="true" />
}

/** 嵌在卡片里的深色子面板（条件详情、属性比例等）。 */
export function NiSubPanel({ title, children }: { title?: ReactNode; children: ReactNode }): JSX.Element {
  ensureNiUiStyle()
  return (
    <div className="ni-subpanel">
      {title ? <span className="ni-subpanel-title">{title}</span> : null}
      {children}
    </div>
  )
}

/** 标签片：1组件 / 2事件 / 应默 / 属性比例。 */
export function NiChip({
  children,
  muted,
  title,
}: {
  children: ReactNode
  muted?: boolean
  title?: string
}): JSX.Element {
  ensureNiUiStyle()
  return <span className={muted ? 'ni-chip is-muted' : 'ni-chip'} title={title}>{children}</span>
}

/** 事件下挂的动作行（添加效果 / 新增节点连线 / 添加界面 / 隐藏界面）。 */
export function NiActionRow({
  label,
  onClick,
  quiet,
  disabled,
  title,
  extra,
}: {
  label: ReactNode
  onClick?: () => void
  quiet?: boolean
  disabled?: boolean
  title?: string
  extra?: ReactNode
}): JSX.Element {
  ensureNiUiStyle()
  return (
    <button
      type="button"
      className={quiet ? 'ni-action-row is-quiet' : 'ni-action-row'}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {label}
      {extra}
    </button>
  )
}

/**
 * 音量滑杆。`bubble` 是拖动时浮在拇指上方的数值气泡（稿子里那颗 66）。
 * `className` 允许调用方追加既有类名（BGM 区仍带 `ni-bgm-volume`，测试依赖它）。
 */
export function NiSlider({
  ariaLabel,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  bubble,
  className,
  onChange,
}: {
  ariaLabel: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  bubble?: ReactNode
  className?: string
  onChange: (value: number) => void
}): JSX.Element {
  ensureNiUiStyle()
  const ratio = max === min ? 0 : (value - min) / (max - min)
  const percent = Math.min(1, Math.max(0, ratio)) * 100
  return (
    <span className="ni-slider-wrap">
      {/* 气泡在 disabled 下也留着：它同时是「有没有设过值」的读数（未设置 / 66%），不只是拖动提示。 */}
      {bubble != null ? (
        // translateX 随进度从 0 走到 -100%：固定 -50% 时两端的气泡会探出轨道，
        // 100% 那一档把配置面板撑出横向滚动条。这样气泡始终贴着拇指又不越界。
        <span
          className="ni-slider-bubble"
          style={{
            left: `calc(${percent}% + ${(0.5 - percent / 100) * 12}px)`,
            transform: `translateX(-${percent}%)`,
          }}
        >
          {bubble}
        </span>
      ) : null}
      <input
        type="range"
        className={className ? `ni-slider ${className}` : 'ni-slider'}
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        // 填充色与 padding 必须留在行内：`.ni-bgm-volume` 那套旧全局规则会盖掉类里的 padding。
        style={{
          padding: 0,
          background: `linear-gradient(to right, #ffffff 0%, #ffffff ${percent}%, rgba(255,255,255,0.2) ${percent}%, rgba(255,255,255,0.2) 100%)`,
        }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </span>
  )
}
