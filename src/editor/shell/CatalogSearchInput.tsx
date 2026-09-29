import { injectStyleOnce } from '@/editor/styles/injectStyle'
import ruleToolbarSearchIcon from '@/editor/ui-assets/rule-toolbar-search.svg'

const CATALOG_SEARCH_CSS = `
.catalog-search {
  position:relative; display:inline-flex; box-sizing:border-box; width:221px; height:28px; flex:0 0 221px;
  align-items:center; border-radius:8px; color:var(--40, rgba(255, 255, 255, 0.40)); background:rgba(255,255,255,.1);
}
.catalog-search:focus-within { box-shadow:inset 0 0 0 2px rgba(232,134,74,.75); }
.catalog-search > span { position:absolute; z-index:1; top:2px; left:8px; display:grid; width:24px; height:24px; place-items:center; pointer-events:none; }
.catalog-search img { display:block; width:24px; height:24px; }
.catalog-search input, .catalog-search input:focus, .catalog-search input:focus-visible {
  box-sizing:border-box; width:100%; min-width:0; height:28px; border:0; padding:2px 8px 2px 45px; outline:0; box-shadow:none;
  color:var(--40, rgba(255, 255, 255, 0.40)); background:transparent; /* font-family:var(---pingfang-sc, "PingFang SC"); */
  font-size:16px; font-style:normal; font-weight:400; line-height:150%;
}
.catalog-search input::placeholder { color:var(--40, rgba(255, 255, 255, 0.40)); opacity:1; }
`

export interface CatalogSearchInputProps {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder: string
  className?: string
}

/** 各编辑页面统一使用的搜索框。 */
export function CatalogSearchInput({
  value,
  onChange,
  ariaLabel,
  placeholder,
  className = '',
}: CatalogSearchInputProps): JSX.Element {
  injectStyleOnce('catalog-search-input', CATALOG_SEARCH_CSS)
  return (
    <label className={`catalog-search ${className}`.trim()}>
      <span aria-hidden><img src={ruleToolbarSearchIcon} alt="" /></span>
      <input
        type="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
