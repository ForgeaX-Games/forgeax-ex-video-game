import { t as translateUi } from '../../i18n'
/**
 * GraphConfigView —— 新引擎场景级配置中间页（界面 / 规则）。
 * 与蓝图共用 graphScenario store。规则页由 Extension 主导航切换分类。
 *
 * 两种形态：
 *  - **界面**（overlays）：目录只在应用左栏，主区直接渲染单个 OverlaySchemeEditor；
 *    选中态来自 uiSelection，方案内容仍写回 scenario.ui.overlays。
 *  - **规则**（实体/变量/公式）：主区直接渲染 ScenarioInspector。
 */
import { useEffect, useMemo } from 'react'
import type { GameScenario, Layout, Overlay, OverlayChild, UiTreeNode } from '@/runtime/core/schema/graph-schema'
import { ScenarioInspector, type ScenarioSection } from './ScenarioInspector'
import { OverlaySchemeEditor } from './OverlaySchemeEditor'
import { useGraphScenario, graphUndo, graphRedo } from '../persist/graphScenarioStore'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { CATALOG_CSS } from './catalogCss'
import {
  NEW_COMPONENT_PRESETS,
  BASE_HUD_PREFIX,
  listInterfaceCustomSchemeIds,
  listBaseHudIds,
} from '@/authoring/demo/builtin-schemes'
import { findDuplicateOverlays } from './overlay-dedup'
import type { Formula } from '@/authoring/blueprint/formula-authoring'
import { countOverlayReferences } from '@/authoring/graph/overlay-edit'
import {
  ensureEntity,
  ensureEntityAttribute,
  ensureFormula,
  ensureVariable,
  type EntityAttributeCreateRequest,
  type EntityCreateRequest,
  type FormulaCreateRequest,
  type VariableCreateRequest,
} from '@/authoring/formulas/meta-catalog'
import { collectItemIds } from './itemCatalog'
import { overlayTitleExists } from './overlay-title'
import { ensureUiTree } from '../persist/ui-tree'
import { useUiSelection } from '../persist/uiSelectionStore'
import { useRuleSelection } from '../persist/ruleSelectionStore'

export interface ConfigTab {
  section: ScenarioSection
  label: string
}

function findSchemeNodeId(nodes: readonly UiTreeNode[], overlayId: string): string | undefined {
  for (const node of nodes) {
    if (node.kind === 'scheme' && node.overlayId === overlayId) return node.id
    if (node.kind === 'folder') {
      const found = findSchemeNodeId(node.children, overlayId)
      if (found) return found
    }
  }
  return undefined
}

export function GraphConfigView({ tabs, title: _title = '配置', icon: _icon = '⚙', scenario: _scenario }: { tabs: ConfigTab[]; title?: string; icon?: string; scenario: GameScenario }): JSX.Element {
  injectStyleOnce('graph-catalog', CATALOG_CSS)
  const meta = useGraphScenario((s) => s.meta)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const setMeta = useGraphScenario((s) => s.setMeta)
  const renameScenarioId = useGraphScenario((s) => s.renameScenarioId)
  const renameUiNode = useGraphScenario((s) => s.renameUiNode)
  const removeUiNode = useGraphScenario((s) => s.removeUiNode)

  // 键盘撤销/重做：Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 或 Ctrl+Y 重做；输入框内不拦截（留给原生文本撤销）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); graphUndo() }
      else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); graphRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const overlaysMode = tabs.length === 1 && tabs[0]?.section === 'overlays'
  const activeRuleSection = useRuleSelection((state) => state.section)
  const activeRuleItemId = useRuleSelection((state) => state.itemId)
  const active = overlaysMode
    ? (tabs[0]?.section ?? 'entities')
    : (tabs.some((tab) => tab.section === activeRuleSection) ? activeRuleSection : tabs[0]?.section ?? 'entities')
  // overlay 资源池「已用/未用」：统计每个 overlay 被多少节点挂载引用。
  const overlayUsage = useMemo(
    () => countOverlayReferences(Object.values(blueprints).map((doc) => doc.graph)),
    [blueprints],
  )
  const itemIds = useMemo(
    () => collectItemIds(meta.ui?.overlays, Object.values(blueprints).map((doc) => doc.graph)),
    [blueprints, meta.ui?.overlays],
  )

  // ── 界面（overlays）形态：树 + 单方案编辑 ──
  const allOverlays = meta.ui?.overlays ?? {}
  // 内容重复标记：三类方案（自定义 / 内置 / 基础 base:*）在同一目录里互查，overlayId → 同内容的其它 id[]。
  // 只提示不处理（§8 人为最终权威）；纯派生，不落盘（§2 Derive）。
  const dupMap = useMemo(() => findDuplicateOverlays(allOverlays), [allOverlays])
  // 界面 tab 保持新建方案置顶；其它方案选择器继续沿用通用排序。
  const schemeIds = useMemo(() => listInterfaceCustomSchemeIds(allOverlays), [allOverlays])
  const baseIds = useMemo(() => listBaseHudIds(allOverlays), [allOverlays])
  const selectedOverlayId = useUiSelection((state) => state.selectedOverlayId)
  // 主区展示用的方案：选中项不存在于当前 overlays（删除/首次/空选中）时，
  // 回落到第一个全局方案，保证 OverlaySchemeEditor 始终有内容可渲染。
  // node:* 方案不会进入全局方案集，但可以由界面树选中，必须直接展示。
  // 注意：这里只做「渲染回落」，不回写选中态——选中态纯用户驱动（与左栏主树一致），
  // 否则新建方案时 add-scheme 的 selectUiNode 会与此处回写抢态，导致 is-selected 闪烁。
  const selOverlay = selectedOverlayId && allOverlays[selectedOverlayId]
    ? selectedOverlayId
    : (schemeIds[0] ?? baseIds[0] ?? '')
  const uiTree = ensureUiTree(meta.uiTree, allOverlays)
  // 基础覆盖物方案只锁结构：单组件不可增删；inputs/layout 可编辑。
  const selLocked = selOverlay.startsWith(BASE_HUD_PREFIX)

  const setOverlays = (overlays: Record<string, Overlay>) => {
    setMeta((current) => ({ ...current, ui: { ...current.ui, overlays } }))
  }
  const createEntityAttribute = (request: EntityAttributeCreateRequest) => {
    setMeta((current) => {
      const entities = ensureEntityAttribute(current.entities, request)
      return entities && entities !== current.entities ? { ...current, entities } : current
    })
  }
  const createEntity = (request: EntityCreateRequest) => {
    setMeta((current) => {
      const entities = ensureEntity(current.entities, request)
      return entities !== current.entities ? { ...current, entities } : current
    })
  }
  const createVariable = (request: VariableCreateRequest) => {
    setMeta((current) => {
      const variables = ensureVariable(current.variables, request)
      return variables !== current.variables ? { ...current, variables } : current
    })
  }
  const createFormula = (request: FormulaCreateRequest) => {
    setMeta((current) => {
      const currentFormulas = current.formulas as Record<string, Formula> | undefined
      const formulas = ensureFormula(currentFormulas, request, {
        entities: current.entities,
        variables: current.variables,
      })
      return formulas !== currentFormulas ? { ...current, formulas } : current
    })
  }
  const renameScheme = (oid: string, title: string) => {
    if (!allOverlays[oid]) return
    const nodeId = findSchemeNodeId(uiTree.root, oid)
    if (nodeId && !renameUiNode(nodeId, title)) {
      // store action 拦截了重名/基础方案等情形；重名时给作者一个提示。
      if (overlayTitleExists(allOverlays, title, oid)) {
        window.alert(`界面方案名称「${title.trim()}」已存在`)
      }
    }
  }
  const removeScheme = (oid: string) => {
    const nodeId = findSchemeNodeId(uiTree.root, oid)
    if (nodeId) removeUiNode(nodeId)
  }
  const patchSchemePrompt = (oid: string, prompt: string) => {
    const ov = allOverlays[oid]
    if (!ov) return
    setOverlays({ ...allOverlays, [oid]: { ...ov, prompt } })
  }
  // 简介字段（Overlay.prompt）经 GraphConfigView 写回 meta.ui.overlays。
  const addSchemeChild = (
    oid: string,
    componentId: string,
    place?: { inputs?: Record<string, unknown>; layout?: Partial<Layout> },
  ): string | undefined => {
    const ov = allOverlays[oid]
    if (!ov) return undefined
    const childId = `${componentId}-${Object.keys(ov.children).length}-${Date.now().toString(36)}`
    // 默认参数不写进 inputs；两个参数面板统一从 manifest.default 读取 placeholder。
    const preset = NEW_COMPONENT_PRESETS.find((p) => p.id === componentId)
    const made: OverlayChild = preset
      ? preset.make(childId)
      : {
          id: childId,
          component: componentId,
          trigger: { when: 'enter' },
          window: { startMs: 0 },
          inputs: {},
        }
    // 新规格画布落点只写 layout；inputs 仅合并组件业务参数。
    const child: OverlayChild = place
      ? {
          ...made,
          inputs: place.inputs ? { ...made.inputs, ...place.inputs } : made.inputs,
          layout: place.layout ? { ...made.layout, ...place.layout } : made.layout,
        }
      : made
    setOverlays({ ...allOverlays, [oid]: { ...ov, children: [...ov.children, child] } })
    return childId
  }
  const removeSchemeChild = (oid: string, childId: string) => {
    const ov = allOverlays[oid]
    if (!ov) return
    const reactions = ov.reactions?.filter((reaction) => !reaction.when.id.startsWith(`${childId}:`))
    setOverlays({
      ...allOverlays,
      [oid]: {
        ...ov,
        children: ov.children.filter((c) => c.id !== childId),
        reactions: reactions?.length ? reactions : undefined,
      },
    })
  }
  const patchOverlayChild = (
    oid: string,
    childId: string,
    patch: { inputs?: Record<string, unknown>; component?: string; layout?: Partial<Layout> },
  ) => {
    const ov = allOverlays[oid]
    if (!ov) return
    setOverlays({
      ...allOverlays,
      [oid]: {
        ...ov,
        children: ov.children.map((c) =>
          c.id !== childId
            ? c
            : {
                ...c,
                ...(patch.component != null ? { component: patch.component } : {}),
                // 参数表传入的是下一份完整 inputs；不可浅合并，否则被删除的 key 会被旧值补回来。
                inputs: patch.inputs ?? c.inputs,
                layout: patch.layout ? { ...c.layout, ...patch.layout } : c.layout,
              },
        ),
      },
    })
  }
  const reorderSchemeChildren = (oid: string, orderedChildIds: readonly string[]) => {
    const ov = allOverlays[oid]
    if (!ov || orderedChildIds.length !== ov.children.length) return
    const childrenById = new Map(ov.children.map((child) => [child.id, child]))
    const orderedChildren = orderedChildIds.map((id) => childrenById.get(id))
    if (orderedChildren.some((child) => !child)) return
    const children = orderedChildren.map((child, index) => ({
      ...child!,
      layout: {
        ...child!.layout,
        zIndex: orderedChildIds.length - index,
      },
    }))
    setOverlays({ ...allOverlays, [oid]: { ...ov, children } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--color-background-base, #333333)' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {overlaysMode ? (
          (() => {
            const ov = allOverlays[selOverlay]
            if (!ov) {
              return (
                <div style={{ flex: 1, padding: 18, opacity: 0.6, fontSize: 12 }}>
                  {translateUi('ui.copy.296cb0b0dfbe')}</div>
              )
            }
            return (
              <OverlaySchemeEditor
                overlayId={selOverlay}
                overlay={ov}
                overlays={allOverlays}
                entities={meta.entities ?? {}}
                variables={meta.variables ?? {}}
                formulas={meta.formulas as Record<string, Formula> | undefined}
                itemIds={itemIds}
                usageCount={overlayUsage[selOverlay] ?? 0}
                locked={selLocked}
                duplicateOf={dupMap.get(selOverlay) ?? []}
                onRename={(t) => renameScheme(selOverlay, t)}
                onRemove={() => removeScheme(selOverlay)}
                onPromptChange={(prompt) => patchSchemePrompt(selOverlay, prompt)}
                onAddChild={(p, place) => addSchemeChild(selOverlay, p, place)}
                onRemoveChild={(c) => removeSchemeChild(selOverlay, c)}
                onPatchChild={(c, patch) => patchOverlayChild(selOverlay, c, patch)}
                onReorderChildren={(orderedChildIds) =>
                  reorderSchemeChildren(selOverlay, orderedChildIds)}
                onReactionsChange={(reactions) =>
                  setOverlays({ ...allOverlays, [selOverlay]: { ...ov, reactions } })}
                onCreateEntityAttribute={createEntityAttribute}
                onCreateEntity={createEntity}
                onCreateVariable={createVariable}
                onCreateFormula={createFormula}
              />
            )
          })()
        ) : (
          <div className="gc-rule-stage">
            <ScenarioInspector
              value={{ ...meta, formulas: meta.formulas as Record<string, Formula> | undefined }}
              section={active}
              focusItemId={activeRuleItemId}
              overlayUsage={overlayUsage}
              onChange={setMeta}
              onRenameScenarioId={renameScenarioId}
              onCreateEntityAttribute={createEntityAttribute}
              onCreateEntity={createEntity}
              onCreateVariable={createVariable}
            />
          </div>
        )}
      </div>
    </div>
  )
}
