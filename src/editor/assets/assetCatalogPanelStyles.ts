/**
 * Asset catalog surface styles.
 *
 * The catalog panel is mounted from a host page that also renders other editor
 * surfaces. Keep every rule under `.acp-root` so insertion order cannot leak
 * into the host (or let host defaults reshape the catalog controls).
 */
export const ASSET_CATALOG_PANEL_CSS = `
.acp-root {
  --asset-canvas: #1a1a1a;
  --asset-surface: #333;
  --asset-surface-deep: #1a1a1a;
  --asset-brand: #e8864a;
  --asset-brand-light: #ff9c2a;
  --asset-brand-soft: rgba(232,134,74,.2);
  --asset-text-primary: #fff;
  --asset-text-secondary: rgba(255,255,255,.6);
  --asset-text-muted: rgba(255,255,255,.4);
  --asset-overlay: rgba(255,255,255,.1);
  --asset-overlay-hover: rgba(255,255,255,.16);
  --asset-border: rgba(255,255,255,.1);
  --asset-focus: rgba(232,134,74,.75);
  position: relative;
  display: flex;
  container-type: inline-size;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
  background: var(--asset-surface);
  color: var(--asset-text-primary);
  font-family: Inter, "PingFang SC", sans-serif;
  font-weight: 400;
}

.acp-root .acp-head {
  box-sizing: border-box;
  display: flex;
  height: 58px;
  min-height: 58px;
  align-items: center;
  gap: 16px;
  overflow-x: auto;
  flex: 0 0 58px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--asset-border);
  background: var(--asset-surface);
  scrollbar-width: none;
}
.acp-root .acp-head::-webkit-scrollbar { display: none; }
.acp-root .acp-head h1 { margin: 0; color: var(--asset-text-primary); font-size: 16px; font-weight: 500; line-height: 24px; white-space: nowrap; }
.acp-root .acp-breadcrumb { display: inline-flex; min-width: 0; align-items: center; gap: 6px; color: var(--asset-text-muted); font-size: 12px; white-space: nowrap; }
.acp-root .acp-breadcrumb-item { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.acp-root .acp-breadcrumb button,
.acp-root .acp-back { border: 0; padding: 0; color: var(--asset-text-secondary); background: transparent; font: inherit; cursor: pointer; }
.acp-root .acp-breadcrumb button:hover,
.acp-root .acp-breadcrumb button:focus-visible,
.acp-root .acp-back:hover,
.acp-root .acp-back:focus-visible { color: var(--asset-text-primary); outline: none; }
.acp-root .acp-head > span { color: var(--asset-text-muted); font-size: 12px; white-space: nowrap; }
.acp-root .acp-head > input {
  box-sizing: border-box;
  width: 221px;
  min-width: 221px;
  height: 28px;
  flex: 0 0 221px;
  border: 0;
  border-radius: 6px;
  padding: 1px 8px 3px;
  outline: 0;
  color: #919191;
  background: rgba(255,255,255,.1);
  font: inherit;
  font-size: 16px;
  line-height: 24px;
}
.acp-root .acp-head > input:focus-visible { box-shadow: inset 0 0 0 2px var(--asset-focus); }
.acp-root .acp-head > input::placeholder { color: #919191; opacity: 1; }

.acp-root .acp-toolbar {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 16px;
}
.acp-root .acp-toolbar-icon {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
}
.acp-root .acp-catalog-head {
  height: 52px;
  min-height: 52px;
  flex: 0 0 52px;
  justify-content: flex-end;
  overflow: visible;
  padding: 24px 24px 0;
  border-bottom: 0;
}
.acp-root .acp-designed-head {
  height: 52px;
  min-height: 52px;
  flex: 0 0 52px;
  overflow: visible;
  padding: 24px 24px 0;
  border-bottom: 0;
}
.acp-root .acp-designed-actions { position: relative; margin-left: auto; }
.acp-root .acp-search {
  position: relative;
  display: inline-flex;
  box-sizing: border-box;
  width: 221px;
  height: 28px;
  flex: 0 0 221px;
  align-items: center;
  border-radius: 8px;
  background: var(--asset-overlay);
  color: #919191;
}
.acp-root .acp-search:focus-within { box-shadow: inset 0 0 0 2px var(--asset-focus); }
.acp-root .acp-search > span { position: absolute; z-index: 1; top: 2px; left: 8px; display: grid; width: 24px; height: 24px; place-items: center; pointer-events: none; }
.acp-root .acp-search img { display: block; width: 24px; height: 24px; }
.acp-root .acp-search input,
.acp-root .acp-search input:focus,
.acp-root .acp-search input:focus-visible {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 28px;
  border: 0;
  padding: 2px 8px 2px 45px;
  outline: 0;
  box-shadow: none;
  color: #919191;
  background: transparent;
  font: inherit;
  font-size: 16px;
  line-height: 24px;
}
.acp-root .acp-search input::placeholder { color: #919191; opacity: 1; }
.acp-root .acp-designed-breadcrumb {
  box-sizing: border-box;
  display: flex;
  min-height: 54px;
  flex: 0 0 54px;
  align-items: flex-start;
  padding: 40px 24px 0;
}
.acp-root .acp-toolbar button,
.acp-root .acp-form button {
  box-sizing: border-box;
  display: inline-flex;
  min-height: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 6px;
  padding: 2px 8px;
  color: var(--asset-text-primary);
  background: var(--asset-overlay);
  font: inherit;
  font-size: 16px;
  line-height: 24px;
  white-space: nowrap;
  cursor: pointer;
}
.acp-root .acp-toolbar button:hover:not(:disabled),
.acp-root .acp-form button:hover:not(:disabled) { background: var(--asset-overlay-hover); }
.acp-root .acp-toolbar button:disabled,
.acp-root .acp-form button:disabled { cursor: not-allowed; opacity: .48; }
.acp-root .acp-toolbar button.acp-primary,
.acp-root .acp-form button.acp-primary { color: #191919; background: var(--asset-brand); }
.acp-root .acp-toolbar button.acp-primary:hover:not(:disabled),
.acp-root .acp-form button.acp-primary:hover:not(:disabled) { background: var(--asset-brand-light); }

.acp-root .acp-grid {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(auto-fill, 140px);
  align-content: start;
  gap: 24px 52px;
  overflow: auto;
  padding: 20px 24px 26px;
}
.acp-root.acp-catalog-root .acp-grid { padding: 40px 24px 26px; }
.acp-root.acp-designed-list .acp-grid { padding: 24px 24px 26px; }
.acp-root .acp-card {
  position: relative;
  display: flex;
  width: 140px;
  min-width: 0;
  min-height: 169px;
  flex-direction: column;
  align-items: center;
  gap: 0;
  overflow: visible;
  border: 0;
  border-radius: 0;
  padding: 0;
  color: var(--asset-text-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  cursor: pointer;
}
.acp-root .acp-card[draggable="true"] { cursor: grab; }
.acp-root .acp-card[draggable="true"]:active { cursor: grabbing; }
.acp-root .acp-card.is-dragging { opacity: .35; }
.acp-root .acp-card-main {
  display: flex;
  width: 100%;
  min-height: 169px;
  flex-direction: column;
  align-items: center;
  gap: 0;
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: center;
  cursor: pointer;
}
.acp-root .acp-thumb {
  position: relative;
  display: grid;
  box-sizing: border-box;
  width: 140px;
  height: 140px;
  min-height: 140px;
  flex: 0 0 140px;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  color: var(--asset-brand-light);
  background: var(--asset-overlay);
  font-size: 34px;
  transition: background .12s ease, box-shadow .12s ease;
}
.acp-root .acp-thumb img,
.acp-root .acp-thumb video,
.acp-root .acp-thumb audio { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.acp-root .acp-thumb.has-type-placeholder { background: transparent; }
.acp-root .acp-type-placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: inherit;
  background: rgba(0,0,0,.2);
}
.acp-root .acp-type-placeholder img { width: 122px; height: 122px; object-fit: contain; }
.acp-root .acp-type-placeholder.is-scene img,
.acp-root .acp-type-placeholder.is-character img,
.acp-root .acp-type-placeholder.is-text img { width: 122px; height: 122px; }
.acp-root .acp-type-placeholder.is-video img { width: 40px; height: 40px; }
.acp-root .acp-type-placeholder.is-audio img { width: 60px; height: 63px; }
.acp-root .acp-audio-waveform-fallback {
  position: relative;
  display: grid;
  width: 110px;
  height: 32px;
  place-items: center;
}
.acp-root .acp-audio-waveform-fallback > img,
.acp-root .acp-audio-waveform-fallback > canvas {
  position: absolute;
  width: 110px;
  height: 32px;
  object-fit: contain;
}
.acp-root .acp-card:hover .acp-thumb { background: rgba(0,0,0,.2); }
.acp-root .acp-card.is-selected .acp-thumb { background: rgba(255,255,255,.2); box-shadow: inset 0 0 0 1px rgba(255,156,42,.6); }
.acp-root .acp-card-hover-actions {
  position: absolute;
  z-index: 5;
  top: 6px;
  left: 6px;
  display: flex;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s ease;
}
.acp-root .acp-card:hover .acp-card-hover-actions,
.acp-root .acp-card:focus-within .acp-card-hover-actions { opacity: 1; pointer-events: auto; }
.acp-root .acp-card-hover-actions button {
  box-sizing: border-box;
  display: grid;
  width: 18px;
  min-width: 18px;
  height: 18px;
  min-height: 18px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: rgba(10,10,10,.72);
  box-shadow: 0 1px 4px rgba(0,0,0,.24);
  cursor: pointer;
  transition: background .12s ease, box-shadow .12s ease;
}
.acp-root .acp-card-hover-actions button:hover { background: rgba(10,10,10,.88); box-shadow: 0 2px 6px rgba(0,0,0,.32); }
.acp-root .acp-card-hover-actions button:focus-visible { outline: 1px solid rgba(255,156,42,.6); outline-offset: 1px; }
.acp-root .acp-card-more img { width: 18px; height: 18px; object-fit: contain; }
.acp-root .acp-card-preview {
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
  display: grid;
  width: 64px;
  min-width: 64px;
  height: 32px;
  min-height: 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 24px;
  background: rgba(0,0,0,.48);
  box-shadow: 0 2px 8px rgba(0,0,0,.24);
  transform: translateX(-50%);
  cursor: pointer;
  transition: background .12s ease, box-shadow .12s ease;
}
.acp-root .acp-card-preview:hover { background: rgba(0,0,0,.68); box-shadow: 0 3px 10px rgba(0,0,0,.32); }
.acp-root .acp-card-preview:focus-visible { outline: 1px solid rgba(255,156,42,.9); outline-offset: 2px; }
.acp-root .acp-card-preview img { width: 24px; height: 24px; object-fit: contain; }
.acp-root.acp-video-list .acp-thumb { position: relative; border: 1px solid transparent; transition: border-color .15s ease, background .15s ease; }
.acp-root.acp-video-list .acp-card:hover .acp-thumb { border-color: rgba(255,156,42,.6); }
.acp-root .acp-card-generation-status { position: absolute; z-index: 3; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; border-radius: inherit; background: rgba(10,10,10,.72); color: var(--asset-text-primary); font-size: 12px; }
.acp-root .acp-card-generation-status > span { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.24); border-top-color: var(--asset-brand); border-radius: 50%; }
.acp-root .acp-folder-thumb {
  position: relative;
  overflow: visible;
  border: 0;
  clip-path: path('M0 6C0 2.6863 2.68629 0 6 0H50.8506C52.5206 0 54.115 0.695986 55.2505 1.92058L71.8399 19.813C72.9753 21.0376 74.5698 21.7335 76.2397 21.7335H134C137.314 21.7335 140 24.4198 140 27.7335V134C140 137.314 137.314 140 134 140H6C2.6863 140 0 137.314 0 134V6Z');
}
.acp-root .acp-folder-preview { position: absolute; z-index: 1; top: 41px; left: 9px; display: grid; width: 121px; height: 78px; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 8px; }
.acp-root .acp-folder-preview > span { display: grid; min-width: 0; min-height: 0; place-items: center; overflow: hidden; border-radius: 6px; background: var(--asset-overlay); }
.acp-root .acp-folder-preview > span.is-folder-preview { background: transparent; }
.acp-root .acp-folder-preview img,
.acp-root .acp-folder-preview video { width: 100%; height: 100%; object-fit: cover; }
.acp-root .acp-folder-preview img.acp-folder-preview-folder { width: 34px; height: 34px; object-fit: contain; }
.acp-root .acp-card:hover .acp-folder-thumb { background: var(--asset-overlay-hover); }
.acp-root .acp-card:active .acp-folder-thumb,
.acp-root .acp-card:focus-visible .acp-folder-thumb { background: rgba(255,255,255,.2); box-shadow: inset 0 0 0 1px rgba(255,156,42,.6); }
.acp-root .acp-card.is-drop-target .acp-folder-thumb { background: rgba(255,255,255,.2); box-shadow: inset 0 0 0 1px rgba(255,156,42,.9); }
.acp-root .acp-card strong,
.acp-root .acp-card small {
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  padding: 4px 10px 0;
  color: var(--asset-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acp-root .acp-card strong {
  height: 29px;
  border-radius: 0 0 6px 6px;
  padding: 4px 10px;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
}
.acp-root .acp-card small { padding-top: 0; color: var(--asset-text-muted); font-size: 11px; line-height: 16px; }
.acp-root .acp-check { position: absolute; top: 8px; right: 8px; left: auto; z-index: 1; accent-color: var(--asset-brand); }
.acp-root .acp-drag-hint { position: fixed; z-index: 10000; max-width: 180px; overflow: hidden; padding: 0 11px; border-radius: 4px; color: #fff; background: rgba(0,0,0,.72); font-size: 11px; line-height: 17px; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }

.acp-root .acp-card-menu {
  position: fixed;
  z-index: 10001;
  display: flex;
  min-width: 116px;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--asset-border);
  border-radius: 10px;
  background: #2b2b2b;
  box-shadow: 0 8px 24px rgba(0,0,0,.45);
}
.acp-root .acp-card-menu button {
  box-sizing: border-box;
  height: 32px;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0 12px;
  color: var(--asset-text-primary);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  white-space: nowrap;
  cursor: pointer;
}
.acp-root .acp-card-menu button:hover { border-color: rgba(255,255,255,.24); background: var(--asset-overlay); }
.acp-root .acp-card-menu button:focus-visible { border-color: var(--asset-focus); outline: none; }

.acp-root .acp-dialog-backdrop {
  position: fixed;
  z-index: 10002;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0,0,0,.5);
}
.acp-root .acp-dialog {
  position: relative;
  box-sizing: border-box;
  display: flex;
  width: 408px;
  max-width: calc(100vw - 48px);
  flex-direction: column;
  gap: 12px;
  border-radius: 12px;
  padding: 24px;
  color: var(--asset-text-primary);
  background: #2b2b2b;
  box-shadow: 0 16px 48px rgba(0,0,0,.5);
}
.acp-root .acp-dialog h2 { margin: 0 0 4px; font-size: 16px; font-weight: 500; line-height: 24px; text-align: center; }
.acp-root .acp-dialog label { color: var(--asset-text-secondary); font-size: 12px; line-height: 18px; }
.acp-root .acp-dialog input {
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  border: 1px solid var(--asset-border);
  border-radius: 8px;
  padding: 0 12px;
  outline: 0;
  color: var(--asset-text-primary);
  background: rgba(255,255,255,.06);
  font: inherit;
  font-size: 14px;
}
.acp-root .acp-dialog input:focus-visible { border-color: var(--asset-focus); }
.acp-root .acp-dialog-message { margin: 0; color: var(--asset-text-secondary); font-size: 14px; line-height: 22px; }
.acp-root .acp-dialog-message strong { color: var(--asset-brand-light); font-weight: 600; }
.acp-root .acp-dialog-error { margin: 0; color: #ff6b5e; font-size: 12px; line-height: 18px; word-break: break-word; }
.acp-root .acp-dialog-close {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  padding: 0;
  color: var(--asset-text-secondary);
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.acp-root .acp-dialog-close:hover { color: var(--asset-text-primary); background: var(--asset-overlay); }
.acp-root .acp-dialog-actions { display: flex; justify-content: center; gap: 16px; padding-top: 4px; }
.acp-root .acp-dialog-actions button {
  box-sizing: border-box;
  min-width: 112px;
  height: 36px;
  border: 0;
  border-radius: 6px;
  padding: 0 16px;
  color: #1a1a1a;
  background: #fff;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.acp-root .acp-dialog-actions .acp-primary { color: #fff; background: var(--asset-brand-light); }
.acp-root .acp-dialog-actions button:disabled { opacity: .5; cursor: not-allowed; }
.acp-root .acp-dialog-actions button:focus-visible { outline: 2px solid var(--asset-focus); outline-offset: 2px; }

.acp-root .acp-empty {
  position: absolute;
  top: 54%;
  left: 50%;
  display: flex;
  width: min(360px, calc(100% - 32px));
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 0;
  transform: translate(-50%, -50%);
  color: var(--asset-text-secondary);
  font-size: 12px;
  text-align: center;
}
.acp-root .acp-empty strong { color: var(--asset-text-primary); font-size: 14px; }
.acp-root .acp-empty p { margin: 0; }
.acp-root .acp-error { margin: 0 24px 10px; color: #ff9b9b; font-size: 12px; }
.acp-root .acp-status { margin: 0; color: #ffb48a; font-size: 11px; }

.acp-root .acp-browser { display: flex; min-width: 0; min-height: 0; flex: 1 1 auto; flex-direction: column; overflow: hidden; }
.acp-root .acp-browser > .acp-form { display: flex; align-items: center; gap: 8px; padding: 12px 24px; background: #292929; }
.acp-root .acp-browser > .acp-form input,
.acp-root .acp-browser > .acp-form select {
  min-width: 0;
  height: 28px;
  border: 1px solid rgba(255,255,255,.2);
  border-radius: 6px;
  padding: 7px 9px;
  color: var(--asset-text-primary);
  background: var(--asset-canvas);
  font: inherit;
}
.acp-root .acp-browser > .acp-form input { flex: 1 1 auto; }

@media (max-width: 780px) {
  .acp-root .acp-head {
    height: auto;
    min-height: 58px;
    flex: 0 0 auto;
    flex-wrap: wrap;
    gap: 8px 12px;
    overflow: visible;
  }
  .acp-root .acp-head .acp-breadcrumb { flex: 1 0 100%; }
  .acp-root .acp-head > input { width: min(221px, 100%); min-width: 0; flex: 1 1 180px; }
  .acp-root .acp-toolbar { flex-wrap: wrap; gap: 8px; }
  .acp-root .acp-designed-head { height: 52px; min-height: 52px; flex: 0 0 52px; flex-wrap: nowrap; overflow-x: auto; padding: 24px 24px 0; }
  .acp-root .acp-catalog-head { height: 52px; min-height: 52px; flex: 0 0 52px; flex-wrap: nowrap; padding: 24px 24px 0; }
  .acp-root .acp-search { width: 180px; flex-basis: 180px; }
  .acp-root .acp-grid { grid-template-columns: repeat(auto-fill, 140px); gap: 20px; padding: 20px; }
  .acp-root .acp-browser > .acp-form { flex-wrap: wrap; }
}
@container (max-width: 780px) {
  .acp-root .acp-head {
    height: auto;
    min-height: 58px;
    flex: 0 0 auto;
    flex-wrap: wrap;
    gap: 8px 12px;
    overflow: visible;
  }
  .acp-root .acp-head .acp-breadcrumb { flex: 1 0 100%; }
  .acp-root .acp-head > input { width: min(221px, 100%); min-width: 0; flex: 1 1 180px; }
  .acp-root .acp-toolbar { flex-wrap: wrap; gap: 8px; }
  .acp-root .acp-designed-head { height: 52px; min-height: 52px; flex: 0 0 52px; flex-wrap: nowrap; overflow-x: auto; padding: 24px 24px 0; }
  .acp-root .acp-catalog-head { height: 52px; min-height: 52px; flex: 0 0 52px; flex-wrap: nowrap; padding: 24px 24px 0; }
  .acp-root .acp-search { width: 180px; flex-basis: 180px; }
  .acp-root .acp-grid { gap: 20px; padding: 20px; }
  .acp-root .acp-browser > .acp-form { flex-wrap: wrap; }
}
`
