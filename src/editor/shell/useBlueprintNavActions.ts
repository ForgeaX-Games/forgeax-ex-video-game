/**
 * 蓝图侧栏 CRUD 状态机 —— 新建 / 重命名 / 删除 popConfirm / 设为入口。
 * 删除确认用自适应 fixed 浮层（优先按钮下方，空间不足翻上/侧），portal 到 body 避免裁切。
 */
import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type RefObject,
} from 'react'
import { blueprintsReferencing } from '@/authoring/graph/blueprint-refs'
import { useGraphScenario } from '../persist/graphScenarioStore'

export const DUPLICATE_TITLE_MSG = '已存在同名蓝图'

const POP_PAD = 8
/** 浮层与触发钮间距（含箭头尖端空隙） */
const POP_GAP = 8
const ARROW_EDGE_PAD = 12
const POP_FALLBACK = { width: 180, height: 96 }

export type PopSide = 'below' | 'above' | 'right' | 'left'

export interface AdaptivePopPlacement {
  side: PopSide
  style: CSSProperties
}

/**
 * 相对触发元素自适应放置浮层：优先按钮下方（水平对齐触发钮并 clamp）；
 * 下方不够 → 上方；上下都不够 → 右侧 / 左侧；最后 clamp 进视口。
 * `--ns-arrow` = 箭头中心相对浮层左/上边的偏移，指向触发钮中心。
 */
export function placeAdaptivePop(
  trigger: HTMLElement | null,
  size: { width: number; height: number } = POP_FALLBACK,
): AdaptivePopPlacement | null {
  if (!trigger || typeof window === 'undefined') return null
  const r = trigger.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pw = Math.min(size.width, vw - POP_PAD * 2)
  const ph = Math.min(size.height, vh - POP_PAD * 2)

  const spaceRight = vw - r.right - POP_GAP - POP_PAD
  const spaceLeft = r.left - POP_GAP - POP_PAD
  const spaceBelow = vh - r.bottom - POP_GAP - POP_PAD
  const spaceAbove = r.top - POP_GAP - POP_PAD

  // 下方/上方：尽量与触发钮右对齐（侧栏删除钮靠右），再 clamp
  const alignUnderButton = () =>
    Math.min(Math.max(POP_PAD, r.right - pw), vw - pw - POP_PAD)

  let left: number
  let top: number
  let side: PopSide

  if (spaceBelow >= ph) {
    side = 'below'
    left = alignUnderButton()
    top = r.bottom + POP_GAP
  } else if (spaceAbove >= ph) {
    side = 'above'
    left = alignUnderButton()
    top = r.top - POP_GAP - ph
  } else if (spaceRight >= pw) {
    side = 'right'
    left = r.right + POP_GAP
    top = r.top + r.height / 2 - ph / 2
  } else if (spaceLeft >= pw) {
    side = 'left'
    left = r.left - POP_GAP - pw
    top = r.top + r.height / 2 - ph / 2
  } else {
    // 四面都紧：优先贴下方，尽量落在视口内
    side = spaceBelow >= spaceAbove ? 'below' : 'above'
    left = alignUnderButton()
    top = side === 'below' ? r.bottom + POP_GAP : r.top - POP_GAP - ph
  }

  left = Math.min(Math.max(POP_PAD, left), vw - pw - POP_PAD)
  top = Math.min(Math.max(POP_PAD, top), vh - ph - POP_PAD)

  const triggerCx = r.left + r.width / 2
  const triggerCy = r.top + r.height / 2
  const arrowAlong = side === 'below' || side === 'above'
    ? Math.min(Math.max(ARROW_EDGE_PAD, triggerCx - left), pw - ARROW_EDGE_PAD)
    : Math.min(Math.max(ARROW_EDGE_PAD, triggerCy - top), ph - ARROW_EDGE_PAD)

  return {
    side,
    style: {
      position: 'fixed',
      top,
      left,
      width: pw,
      zIndex: 1000,
      ['--ns-arrow' as string]: `${arrowAlong}px`,
    },
  }
}

export interface BlueprintNavActions {
  mainId: string
  composing: boolean
  draftName: string | null
  composeError: string | null
  setDraftName: (v: string) => void
  clearComposeError: () => void
  composeInputRef: RefObject<HTMLInputElement>
  openCompose: () => void
  cancelCompose: () => void
  confirmCompose: () => void
  renameId: string | null
  renameDraft: string
  renameError: string | null
  setRenameDraft: (v: string) => void
  clearRenameError: () => void
  renameRootRef: RefObject<HTMLDivElement>
  renameInputRef: RefObject<HTMLInputElement>
  openRename: (id: string) => void
  cancelRename: () => void
  confirmRename: () => void
  pendingDeleteId: string | null
  pendingTitle: string
  deletePopRef: RefObject<HTMLDivElement>
  deletePopStyle: CSSProperties | null
  deletePopSide: PopSide | null
  openDelete: (id: string, trigger: HTMLElement) => void
  cancelDelete: () => void
  confirmDelete: () => void
  setMain: (id: string) => void
}

export function useBlueprintNavActions(): BlueprintNavActions {
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainId = useGraphScenario((s) => s.mainBlueprintId)
  const create = useGraphScenario((s) => s.createBlueprint)
  const rename = useGraphScenario((s) => s.renameBlueprint)
  const del = useGraphScenario((s) => s.deleteBlueprint)
  const setMain = useGraphScenario((s) => s.setMainBlueprint)
  const authoringProject = useGraphScenario((s) => s.authoringProject)

  const [draftName, setDraftName] = useState<string | null>(null)
  const [composeError, setComposeError] = useState<string | null>(null)
  const composing = draftName !== null
  const composeInputRef = useRef<HTMLInputElement>(null!)

  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const renameRootRef = useRef<HTMLDivElement>(null!)
  const renameInputRef = useRef<HTMLInputElement>(null!)

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const deletePopRef = useRef<HTMLDivElement>(null!)
  const deleteTriggerRef = useRef<HTMLElement | null>(null)
  const [deletePopPlacement, setDeletePopPlacement] = useState<AdaptivePopPlacement | null>(null)

  const cancelCompose = () => {
    setDraftName(null)
    setComposeError(null)
  }
  const cancelRename = () => {
    setRenameId(null)
    setRenameDraft('')
    setRenameError(null)
  }
  const closeDelete = (restoreFocus: boolean) => {
    const trigger = deleteTriggerRef.current
    setPendingDeleteId(null)
    deleteTriggerRef.current = null
    setDeletePopPlacement(null)
    if (restoreFocus) trigger?.focus()
  }
  const cancelDelete = () => closeDelete(true)

  const openCompose = () => {
    cancelRename()
    closeDelete(false)
    setComposeError(null)
    setDraftName('')
  }
  const confirmCompose = () => {
    const t = draftName?.trim()
    if (!t) { cancelCompose(); return }
    const r = create(t)
    if (!r.ok) {
      setComposeError(DUPLICATE_TITLE_MSG)
      composeInputRef.current?.focus()
      composeInputRef.current?.select()
      return
    }
    cancelCompose()
  }

  const openRename = (id: string) => {
    cancelCompose()
    closeDelete(false)
    setRenameError(null)
    setRenameId(id)
    setRenameDraft(blueprints[id]?.title ?? '')
  }
  const confirmRename = () => {
    if (!renameId) return
    const t = renameDraft.trim()
    if (!t) { cancelRename(); return }
    const r = rename(renameId, t)
    if (!r.ok && r.reason === 'duplicate_title') {
      setRenameError(DUPLICATE_TITLE_MSG)
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
      return
    }
    cancelRename()
  }

  const openDelete = (id: string, trigger: HTMLElement) => {
    if (id === mainId) {
      alert('主蓝图不可删')
      return
    }
    const refs = blueprintsReferencing(authoringProject(), id)
    if (refs.length) {
      alert(`被引用，无法删除：${refs.join(', ')}`)
      return
    }
    cancelCompose()
    cancelRename()
    deleteTriggerRef.current = trigger
    // 先按 fallback 尺寸落点，portal 挂上后再用真实尺寸校准
    setDeletePopPlacement(placeAdaptivePop(trigger, POP_FALLBACK))
    setPendingDeleteId(id)
  }
  const confirmDelete = () => {
    if (!pendingDeleteId) return
    const r = del(pendingDeleteId)
    closeDelete(false)
    if (!r.ok) {
      alert(
        r.blockedBy?.includes('__main__')
          ? '主蓝图不可删'
          : `被引用，无法删除：${r.blockedBy?.join(', ')}`,
      )
    }
  }

  useLayoutEffect(() => {
    if (!pendingDeleteId) {
      setDeletePopPlacement(null)
      return
    }
    const place = () => {
      const trigger = deleteTriggerRef.current
      const pop = deletePopRef.current
      const size = pop
        ? { width: pop.offsetWidth || POP_FALLBACK.width, height: pop.offsetHeight || POP_FALLBACK.height }
        : POP_FALLBACK
      setDeletePopPlacement(placeAdaptivePop(trigger, size))
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    // 侧栏滚动时跟着挪
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [pendingDeleteId])

  useEffect(() => {
    if (!composing) return
    composeInputRef.current?.focus()
    composeInputRef.current?.select()
  }, [composing])

  useEffect(() => {
    if (!renameId) return
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renameId])

  useEffect(() => {
    if (!renameId) return
    const onPointer = (e: PointerEvent) => {
      const root = renameRootRef.current
      if (root && !root.contains(e.target as Node)) cancelRename()
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [renameId])

  useEffect(() => {
    if (!pendingDeleteId) return
    const onPointer = (e: PointerEvent) => {
      const pop = deletePopRef.current
      const trigger = deleteTriggerRef.current
      const t = e.target as Node
      if (pop?.contains(t) || trigger?.contains(t)) return
      closeDelete(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDelete(true)
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [pendingDeleteId])

  const pendingTitle = pendingDeleteId ? (blueprints[pendingDeleteId]?.title ?? pendingDeleteId) : ''

  return {
    mainId,
    composing,
    draftName,
    composeError,
    setDraftName,
    clearComposeError: () => setComposeError(null),
    composeInputRef,
    openCompose,
    cancelCompose,
    confirmCompose,
    renameId,
    renameDraft,
    renameError,
    setRenameDraft,
    clearRenameError: () => setRenameError(null),
    renameRootRef,
    renameInputRef,
    openRename,
    cancelRename,
    confirmRename,
    pendingDeleteId,
    pendingTitle,
    deletePopRef,
    deletePopStyle: deletePopPlacement?.style ?? null,
    deletePopSide: deletePopPlacement?.side ?? null,
    openDelete,
    cancelDelete,
    confirmDelete,
    setMain,
  }
}
