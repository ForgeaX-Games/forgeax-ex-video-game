import { t as translateUi } from '../../i18n'
import type { CSSProperties, JSX, ReactNode } from 'react'
import type {
  NodeAction,
  Overlay,
  OverlayEventRef,
  OverlayReaction,
  Reaction,
} from '@/runtime/core/schema/graph-schema'
import {
  overlayReactionKey,
  resolveOverlayReaction,
} from '@/runtime/core/schema/overlay-events'
import { getComponentManifest } from '@/runtime/core/registry/component-registry'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import {
  appendNodeAction,
  EventResponseRow,
  NodeActionAddMenu,
  NodeActionsEditor,
  nodeActionAddOptions,
  type ActionOption,
} from './NodeActionsEditor'
import type { EditorPickerCtx } from './editors'
import type {
  EntityAttributeCreateHandler,
  EntityCreateHandler,
  FormulaCreateHandler,
  VariableCreateHandler,
} from './component-form-fields'
import { NI_ROOT_CLASS } from './ni-ui'

/** 稿子里的事件标题是「事件N·出口名」（Figma 15635:81611）。 */
function eventTitle(event: OverlayEventRef, ordinal: number): string {
  return `事件${ordinal}·${event.label?.trim() || event.localEventId}`
}

/** 标题只留下序号与出口名，组件与 id 这些定位信息挪进悬停提示，免得撑破窄栏。 */
function eventTip(event: OverlayEventRef): string {
  const component = getComponentManifest(event.componentId)?.label?.trim()
  return [component, event.childId, event.localEventId].filter(Boolean).join(' · ')
}

const MOUNT_EVENT_HINT = '目录动作先执行，挂载动作按顺序追加；选目标节点会同步写出边。'

/**
 * 挂载事件块的新壳（Figma 15635:81612）：事件标题 + 「事件响应」输入壳行 + 缩进动作行。
 * 只在 `.ni-root`（节点配置面板）内生效 —— 目录模式还挂在旧色板的
 * ComponentPropertyPanel 上，那里继续用原来的方框。
 */
const NI_OV_EVENTS_CSS = `
.${NI_ROOT_CLASS} .ni-ov-events { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-ov-event { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.${NI_ROOT_CLASS} .ni-ov-event-title {
  font-size: var(--ni-fs-meta);
  color: var(--ni-w-60);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${NI_ROOT_CLASS} .ni-control.ni-ov-event-row { gap: 8px; padding-right: 4px; }
.${NI_ROOT_CLASS} .ni-ov-event-row-label {
  flex: none;
  color: var(--ni-w-60);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

function mountEventActions(reactions: Reaction[] | undefined, event: OverlayEventRef): NodeAction[] {
  const keys = new Set([
    event.localEventId,
    event.eventId,
    `${event.childId}:${event.localEventId}`,
    `${event.mountId}:${event.localEventId}`,
    `${event.mountId}:${event.childId}:${event.localEventId}`,
  ])
  return (reactions ?? []).flatMap((reaction) =>
    reaction.when.type === 'event' && keys.has(reaction.when.id) ? reaction.do : [])
}

export function ComponentEventsEditor({
  events,
  catalogReactions,
  mountReactions,
  mode,
  edgeOptions = [],
  spawnOptions,
  overlays,
  pickers,
  labelWidth,
  allowSpawn = true,
  showEventTitle = true,
  propertyLayout = false,
  onCreateEntityAttribute,
  onCreateEntity,
  onCreateVariable,
  onCreateFormula,
  renderRoute,
  onCatalogChange,
  onMountActionsChange,
}: {
  events: OverlayEventRef[]
  catalogReactions?: OverlayReaction[]
  mountReactions?: Reaction[]
  mode: 'catalog' | 'mount'
  edgeOptions?: ActionOption[]
  spawnOptions: ActionOption[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  labelWidth?: CSSProperties['width']
  allowSpawn?: boolean
  showEventTitle?: boolean
  propertyLayout?: boolean
  onCreateEntityAttribute?: EntityAttributeCreateHandler
  onCreateEntity?: EntityCreateHandler
  onCreateVariable?: VariableCreateHandler
  onCreateFormula?: FormulaCreateHandler
  renderRoute?: (event: OverlayEventRef) => ReactNode
  onCatalogChange?: (next: OverlayReaction[] | undefined) => void
  onMountActionsChange?: (event: OverlayEventRef, actions: NodeAction[]) => void
}): JSX.Element {
  if (!events.length) {
    return <div style={{ fontSize: 11, opacity: 0.6 }}>{translateUi('ui.copy.48f184462db4')}</div>
  }
  // 挂载模式只出现在节点配置面板里，所以新壳按它开关；目录模式仍在旧色板面板中。
  const niLayout = mode === 'mount'
  if (niLayout) injectStyleOnce('ni-overlay-events', NI_OV_EVENTS_CSS)
  const writeCatalog = (event: OverlayEventRef, actions: NodeAction[]) => {
    const key = overlayReactionKey(event.childId, event.localEventId)
    const rest = (catalogReactions ?? []).filter((reaction) => reaction.when.id !== key)
    if (actions.length) {
      rest.push({
        when: { type: 'event', id: key },
        do: actions.filter((action) => action.kind !== 'advance' && action.kind !== 'hideOverlay'),
      })
    }
    onCatalogChange?.(rest.length ? rest : undefined)
  }
  return (
    <div className={niLayout ? 'ni-ov-events' : undefined} style={niLayout ? undefined : { display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.map((event, index) => {
        const key = overlayReactionKey(event.childId, event.localEventId)
        const inherited = resolveOverlayReaction(catalogReactions, event.childId, event.localEventId)?.do ?? []
        const appended = mountEventActions(mountReactions, event)
        const edited = (mode === 'catalog' ? inherited : appended) as NodeAction[]
        const title = eventTitle(event, index + 1)
        const write = (next: NodeAction[]) => mode === 'catalog'
          ? writeCatalog(event, next)
          : onMountActionsChange?.(event, next)
        const addOptions = nodeActionAddOptions({
          actions: edited,
          allowAdvance: mode === 'mount',
          allowSpawn,
          spawnOptions,
        })
        const addAction = (value: string, path: string[]) => write(
          appendNodeAction({ actions: edited, value, path, overlays, pickers }),
        )
        const actions = (
          <NodeActionsEditor
            actions={edited}
            edgeOptions={edgeOptions}
            spawnOptions={spawnOptions}
            overlays={overlays}
            pickers={pickers}
            labelWidth={labelWidth}
            allowAdvance={mode === 'mount'}
            allowSpawn={allowSpawn}
            propertyLayout={propertyLayout}
            onCreateEntityAttribute={onCreateEntityAttribute}
            onCreateEntity={onCreateEntity}
            onCreateVariable={onCreateVariable}
            onCreateFormula={onCreateFormula}
            renderAdvance={renderRoute ? () => renderRoute(event) : undefined}
            onChange={write}
          />
        )
        if (!niLayout) {
          return (
            <section key={key} data-event-key={key} style={{ border: '1px solid #2c2c2c', borderRadius: 6, padding: 8 }}>
              {showEventTitle ? <div style={{ fontSize: 12, fontWeight: 600 }} title={eventTip(event)}>{title}</div> : null}
              {actions}
              {/* 属性面板自带一排「新增」按钮；旧色板的目录面板没有事件响应行，仍用整行下拉。 */}
              {propertyLayout ? null : <NodeActionAddMenu options={addOptions} onSelect={addAction} />}
            </section>
          )
        }
        return (
          <section key={key} data-event-key={key} className="ni-ov-event">
            {showEventTitle ? (
              <span className="ni-ov-event-title" title={eventTip(event)}>{title}</span>
            ) : null}
            <EventResponseRow
              className="ni-control ni-ov-event-row"
              labelClassName="ni-ov-event-row-label"
              title={MOUNT_EVENT_HINT}
              actions={edited}
              options={addOptions}
              onSelect={addAction}
            />
            {actions}
          </section>
        )
      })}
    </div>
  )
}
