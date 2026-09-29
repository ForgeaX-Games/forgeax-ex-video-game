import { useEffect, useMemo, useState } from 'react'
import type { Entity, Overlay, Variable } from '@/runtime/core/schema/graph-schema'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { OverlayCatalogPreview } from './OverlayCatalogPreview'
import { CatalogSearchInput } from './CatalogSearchInput'
import { useAdaptiveCatalogGrid } from './useAdaptiveCatalogGrid'
import { t as translateUi, tf as formatUi } from '../../i18n'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { CUSTOM_UI_FOLDER_ID } from '../persist/ui-tree'
import { UI_TEMPLATE_COMPOSE_EVENT } from '../persist/graphUiTreeSync'
import entityEmptyIcon from '@/editor/ui-assets/entity-empty.svg?url'
import { UiTemplateCreateDialog } from './UiTemplateCreateDialog'

const OVERLAY_SCHEME_LIBRARY_CSS = `
.osl-root { width:100%; height:100%; min-width:0; min-height:0; overflow:auto; background:#333; color:#fff; }
.osl-content { display:flex; flex-direction:column; gap:40px; width:100%; min-height:100%; box-sizing:border-box; padding:24px; }
.osl-toolbar { display:flex; align-items:center; justify-content:flex-end; width:100%; height:28px; }
.osl-grid { --adaptive-grid-min-column-gap:16px; display:grid; grid-template-columns:repeat(var(--adaptive-grid-columns, 1), 256px); align-content:start; align-items:start; row-gap:16px; column-gap:var(--adaptive-grid-column-gap, var(--adaptive-grid-min-column-gap)); }
.osl-grid.is-empty { flex:1; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(320px,1fr); place-items:center; }
.osl-card { all:unset; display:flex; flex-direction:column; align-items:center; width:256px; cursor:pointer; }
.osl-preview { position:relative; width:256px; height:144px; overflow:hidden; background:#4c4c4c; }
.osl-preview .ocp-root, .osl-preview .ocp-stage { width:100%; height:100%; aspect-ratio:auto; }
.osl-preview .ocp-stage { background:#4c4c4c; }
.osl-card-label { display:flex; align-items:center; justify-content:center; box-sizing:border-box; width:134px; height:27.76px; padding:2px 9px; border-radius:0 0 5.74px 5.74px; color:#fff; font-size:14px; font-weight:400; line-height:22.26px; }
.osl-card:hover .ocp-viewport::after, .osl-card:focus-visible .ocp-viewport::after,
.osl-card:hover .osl-preview::after, .osl-card:focus-visible .osl-preview::after {
  content:""; position:absolute; z-index:999; inset:0; box-sizing:border-box; border:1px solid #ff9c2a; pointer-events:none;
}
.osl-card:focus-visible { outline:1px solid #ff9c2a; outline-offset:3px; }
`

export interface OverlaySchemeLibraryProps {
  schemes: ReadonlyArray<{ treeNodeId: string; overlay: Overlay }>
  entities: Record<string, Entity>
  variables: Record<string, Variable>
  onOpen: (treeNodeId: string, overlayId: string) => void
}

/** 界面模板的入口页。方案缩略图直接复用发布前的真实预览渲染。 */
export function OverlaySchemeLibrary({
  schemes,
  entities,
  variables,
  onOpen,
}: OverlaySchemeLibraryProps): JSX.Element {
  injectStyleOnce('overlay-scheme-library', OVERLAY_SCHEME_LIBRARY_CSS)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const createUiScheme = useGraphScenario((state) => state.createUiScheme)
  useEffect(() => {
    const openCreateDialog = (): void => setCreateOpen(true)
    window.addEventListener(UI_TEMPLATE_COMPOSE_EVENT, openCreateDialog)
    return () => window.removeEventListener(UI_TEMPLATE_COMPOSE_EVENT, openCreateDialog)
  }, [])
  const visibleSchemes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return schemes
    return schemes.filter(({ overlay }) =>
      `${overlay.title} ${overlay.id}`.toLocaleLowerCase().includes(needle))
  }, [query, schemes])
  const grid = useAdaptiveCatalogGrid({ itemCount: visibleSchemes.length, cardWidth: 256, minColumnGap: 16 })

  return (
    <section className="osl-root" aria-label={translateUi('overlayLibrary.listAria')}>
      <div className="osl-content">
        <header className="osl-toolbar">
          <CatalogSearchInput
            ariaLabel={translateUi('ui.copy.346e069b7cd4')}
            placeholder={translateUi('ui.copy.346e069b7cd4')}
            value={query}
            onChange={setQuery}
          />
        </header>
        <div ref={grid.ref} style={grid.style} className={`osl-grid${visibleSchemes.length === 0 ? ' is-empty' : ''}`}>
          {visibleSchemes.map(({ treeNodeId, overlay }) => (
            <button
              key={overlay.id}
              type="button"
              className="osl-card"
              aria-label={formatUi('overlayLibrary.openAria', { name: overlay.title || overlay.id })}
              onClick={() => onOpen(treeNodeId, overlay.id)}
            >
              <div className="osl-preview">
                <OverlayCatalogPreview
                  overlay={overlay}
                  entities={entities}
                  variables={variables}
                  showTimeScrubber={false}
                />
              </div>
              <span className="osl-card-label">{overlay.title || overlay.id}</span>
            </button>
          ))}
          {visibleSchemes.length === 0 ? (
            <div className="gc-rule-empty" role="status">
              <div className="gc-rule-empty-content">
                <div className="gc-rule-empty-message">
                  <span className="gc-rule-empty-icon" aria-hidden><img src={entityEmptyIcon} alt="" /></span>
                  <p>{translateUi('componentLibrary.templates.empty')}</p>
                </div>
                <button type="button" className="gc-rule-empty-create" onClick={() => setCreateOpen(true)}>{translateUi('componentLibrary.templates.create')}</button>
              </div>
            </div>
          ) : null}
        </div>
        {createOpen ? (
          <UiTemplateCreateDialog
            onClose={() => setCreateOpen(false)}
            onConfirm={(name) => {
              createUiScheme(CUSTOM_UI_FOLDER_ID, name)
              setCreateOpen(false)
            }}
          />
        ) : null}
      </div>
    </section>
  )
}
