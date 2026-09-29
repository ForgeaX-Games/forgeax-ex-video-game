import type { JSX } from 'react'
import emptyIcon from '@/editor/ui-assets/entity-empty.svg?url'
import { injectStyleOnce } from '@/editor/styles/injectStyle'

const CATALOG_EMPTY_STATE_CSS = `
.catalog-empty-state {
  display:flex; flex:1; min-height:320px; align-items:center; justify-content:center;
}
.catalog-empty-state-content {
  display:flex; width:148px; flex-direction:column; align-items:center; gap:24px;
}
.catalog-empty-state-message {
  display:flex; width:148px; flex-direction:column; align-items:center; gap:8px;
}
.catalog-empty-state-icon {
  display:flex; width:80px; height:80px; align-items:center; justify-content:center;
}
.catalog-empty-state-icon img { display:block; width:72px; height:80px; }
.catalog-empty-state-message p {
  width:148px; margin:0; color:rgba(255,255,255,.4); text-align:center;
  font:400 16px/24px "PingFang SC",sans-serif;
}
.catalog-empty-state-action {
  box-sizing:border-box; display:flex; width:148px; height:40px; align-items:center; justify-content:center;
  padding:2px 42px; border:0; border-radius:8px; background:#fff; color:#000;
  font:400 16px/24px "PingFang SC",sans-serif; white-space:nowrap; cursor:pointer;
}
.catalog-empty-state-action:hover { background:#f2f2f2; color:#000; }
.catalog-empty-state-action:focus-visible { outline:2px solid var(--gc-accent); outline-offset:2px; }
`

export function CatalogEmptyState({
  message,
  action,
  className,
}: {
  message: string
  action?: { label: string; onClick: () => void }
  className?: string
}): JSX.Element {
  injectStyleOnce('catalog-empty-state', CATALOG_EMPTY_STATE_CSS)
  return <div className={['catalog-empty-state', className].filter(Boolean).join(' ')}>
    <div className="catalog-empty-state-content">
      <div className="catalog-empty-state-message">
        <span className="catalog-empty-state-icon" aria-hidden><img src={emptyIcon} alt="" /></span>
        <p>{message}</p>
      </div>
      {action ? <button type="button" className="catalog-empty-state-action" onClick={action.onClick}>{action.label}</button> : null}
    </div>
  </div>
}
