import { injectStyleOnce } from '@/editor/styles/injectStyle'

/**
 * Styles for the shared generation atoms.  These selectors intentionally use
 * the atom's semantic class names instead of relying on the legacy vgen sheet,
 * so the same surface renders in a standalone page and in the host dialog.
 */
export const GENERATION_COMPONENTS_CSS = `
.generation-page-layout {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 0;
  color: #f6f1e9;
  background: #1a1a1a;
}
.generation-page-layout.is-page { min-height: 0; flex: 1 1 auto; }
.generation-surface {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(210px, 248px) minmax(0, 1fr);
  grid-template-rows: minmax(260px, 1fr) minmax(220px, auto);
  grid-template-areas:
    "parameters preview"
    "history composer";
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding: 6px;
  background: #171717;
}
.generation-surface__parameters,
.generation-surface__preview,
.generation-surface__composer,
.generation-surface__history,
.generation-surface__upload {
  box-sizing: border-box;
  min-width: 0;
  min-height: 0;
}
.generation-surface__parameters {
  grid-area: parameters;
  overflow: auto;
  padding: 16px;
  border-radius: 8px;
  background: #2c2c2c;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.2) transparent;
}
.generation-surface__preview {
  grid-area: preview;
  overflow: hidden;
  border-radius: 8px;
  background: #202020;
}
.generation-surface__history {
  grid-area: history;
  overflow: hidden;
  border-radius: 8px;
  background: #202020;
}
.generation-surface__composer {
  grid-area: composer;
  overflow: auto;
  padding: 16px;
  border-radius: 8px;
  background: #2c2c2c;
}
.generation-surface__upload { grid-area: upload; }
.generation-page-layout.is-page > .generation-surface { height: 100%; min-height: 0; }
.vgen-generation-layout { --generation-accent: #ff9c2a; }
.vgen-generation-layout.is-page { min-height: 0; }
.vgen-generation-surface { min-height: inherit; }
.vgen-generation-parameters { scrollbar-color: rgba(255,255,255,.2) transparent; }
.vgen-generation-surface .vgen-generation-references { display: flex; min-width: 0; min-height: 0; align-items: center; gap: 8px; overflow-x: auto; }
.vgen-generation-surface .vgen-generation-references:empty { display: none; }
.vgen-generation-surface .vgen-generation-references button { flex: 0 0 auto; }
.vgen-generation-surface .vgen-generation-reference,
.vgen-generation-surface .vgen-generation-reference-add {
  box-sizing: border-box;
  width: 54px;
  height: 54px;
  padding: 0;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 6px;
  background: #2f2923 center / cover no-repeat;
  color: rgba(255,255,255,.7);
  cursor: pointer;
}
.vgen-generation-surface .vgen-generation-reference { position: relative; }
.vgen-generation-surface .vgen-generation-reference span { position: absolute; top: 2px; right: 4px; color: #fff; text-shadow: 0 1px 4px #000; }
.vgen-generation-surface .vgen-generation-reference-add { border-style: dashed; background: transparent; font-size: 20px; }
.vgen-generation-surface .vgen-generation-reference:hover:not(:disabled),
.vgen-generation-surface .vgen-generation-reference-add:hover:not(:disabled),
.vgen-generation-surface .vgen-generation-reference:focus-visible,
.vgen-generation-surface .vgen-generation-reference-add:focus-visible { border-color: #ff9c2a; outline: none; }
.vgen-generation-surface .vgen-generation-reference:disabled,
.vgen-generation-surface .vgen-generation-reference-add:disabled { cursor: not-allowed; opacity: .45; }
.vgen-generation-surface .vgen-frame { background-position: center; background-size: cover; background-repeat: no-repeat; }
.vgen-generation-empty { display: flex; width: min(440px, calc(100% - 40px)); flex-direction: column; align-items: center; justify-content: center; color: rgba(255,255,255,.6); text-align: center; transform: translateY(7px); }
.vgen-generation-empty > img { display: block; width: 163.81px; max-width: 60%; height: 120px; object-fit: contain; }
.vgen-generation-empty p { margin: 11px 0 0; color: rgba(255,255,255,.6); font-size: 14px; line-height: 21px; white-space: nowrap; }
.vgen-generation-history-head { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); color: #fff; font-size: 12px; }
.vgen-generation-history-head span { color: rgba(255,255,255,.42); }

.generation-prompt-composer {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  color: #f6f1e9;
}
.generation-prompt-top { min-width: 0; }
.generation-prompt-body {
  box-sizing: border-box;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  border-radius: 12px;
  background: rgba(0,0,0,.2);
}
.generation-prompt-body:focus-within { box-shadow: 0 0 0 2px rgba(255,156,42,.42); }
.generation-prompt-prefix {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.generation-prompt-composer .vgen-mention-editor-wrap {
  min-height: 74px;
  flex: 1 1 auto;
}
.generation-prompt-composer .vgen-mention-editor {
  box-sizing: border-box;
  width: 100%;
  min-height: 74px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #fff;
  font: inherit;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.generation-prompt-composer .vgen-mention-editor:focus-visible { outline: 0; }
.generation-prompt-composer .vgen-mention-editor[aria-disabled="true"] { opacity: .55; }
.generation-prompt-error { margin: 0; color: #ff8f8f; font-size: 12px; line-height: 1.5; }
.generation-prompt-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.generation-prompt-tools,
.generation-prompt-submit-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.generation-prompt-tools { flex-wrap: wrap; }
.generation-prompt-submit-actions { justify-content: flex-end; }
.generation-prompt-composer button {
  box-sizing: border-box;
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 6px;
  background: rgba(0,0,0,.2);
  color: rgba(255,255,255,.82);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.generation-prompt-composer button:hover:not(:disabled),
.generation-prompt-composer button:focus-visible {
  border-color: #ff9c2a;
  background: rgba(255,255,255,.08);
  color: #fff;
  outline: none;
}
.generation-prompt-composer button:focus-visible {
  box-shadow: 0 0 0 2px rgba(255,156,42,.24);
}
.generation-prompt-composer button:disabled { cursor: not-allowed; opacity: .45; }
.generation-prompt-submit-actions button:last-child {
  border-color: #ff9c2a;
  background: linear-gradient(90deg, #ff7001, #ff9c2a);
  color: #16110d;
  font-weight: 700;
}

.generation-parameters { display: flex; min-width: 0; flex-direction: column; gap: 16px; }
.generation-parameters-title {
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,.1);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
}
.generation-parameters-fields { display: flex; flex-direction: column; gap: 14px; }
.generation-parameter-field { display: flex; flex-direction: column; gap: 7px; }
.generation-parameter-label { display: flex; flex-direction: column; gap: 2px; color: rgba(255,255,255,.8); font-size: 12px; }
.generation-parameter-label small { color: rgba(255,255,255,.45); font-size: 10px; }
.generation-parameter-control { min-width: 0; }
.generation-parameter-control[data-disabled="true"] { cursor: not-allowed; opacity: .62; }
.generation-select-field { display: block; min-width: 0; }
.generation-select-field select {
  box-sizing: border-box;
  width: 100%;
  min-height: 34px;
  padding: 0 9px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 6px;
  outline: 0;
  background: #1a1a1a;
  color: #fff;
  font: inherit;
  font-size: 12px;
}
.generation-select-field select:focus-visible { border-color: #ff9c2a; box-shadow: 0 0 0 2px rgba(255,156,42,.2); }
.generation-select-field select:disabled { cursor: not-allowed; opacity: .7; }
.generation-option-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.generation-option-group button {
  min-width: 0;
  min-height: 42px;
  padding: 6px 8px;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 6px;
  background: #1a1a1a;
  color: rgba(255,255,255,.78);
  text-align: left;
}
.generation-option-group button span,
.generation-option-group button small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.generation-option-group button small { margin-top: 2px; color: rgba(255,255,255,.45); font-size: 10px; }
.generation-option-group button.is-selected { border-color: #ff9c2a; background: rgba(255,156,42,.16); color: #fff; }
.generation-range-field { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 10px; align-items: center; }
.generation-range-field label { overflow: hidden; color: rgba(255,255,255,.65); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.generation-range-field output { color: #ffb25b; font-size: 12px; font-variant-numeric: tabular-nums; }
.generation-range-field input { grid-column: 1 / -1; width: 100%; accent-color: #ff9c2a; }
.generation-toggle-field { display: flex; align-items: center; gap: 7px; color: rgba(255,255,255,.78); font-size: 12px; }
.generation-toggle-field input { accent-color: #ff9c2a; }
.generation-toggle-field small { color: rgba(255,255,255,.45); font-size: 10px; }
.generation-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.generation-preview-frame { box-sizing: border-box; display: flex; width: 100%; min-width: 0; min-height: 0; height: 100%; flex-direction: column; color: #f6f1e9; }
.generation-preview-frame__header { flex: 0 0 auto; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
.generation-preview-frame__stage { position: relative; display: grid; min-width: 0; min-height: 0; flex: 1 1 auto; place-items: center; overflow: hidden; background: #1f1f1f; }
.generation-preview-frame__footer { display: flex; min-width: 0; flex: 0 0 auto; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; background: rgba(0,0,0,.2); }
.generation-preview-frame__status { color: rgba(255,255,255,.58); font-size: 11px; }
.generation-preview-frame__error { min-width: 0; flex: 1 1 100%; color: #ff8f8f; font-size: 12px; line-height: 1.4; }
.generation-preview-frame__empty { display: grid; width: 100%; height: 100%; place-items: center; color: rgba(255,255,255,.45); }
.generation-preview-image-like,
.generation-preview-video { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: #111; }
.generation-preview-image-like__media,
.generation-preview-video > video { display: block; width: 100%; height: 100%; object-fit: contain; }
.generation-preview-image-like__placeholder,
.generation-preview-video__placeholder { display: grid; width: 100%; height: 100%; place-items: center; color: rgba(255,255,255,.35); font-size: 30px; }
.generation-preview-image-like__actions { position: absolute; right: 0; bottom: 0; left: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 9px; background: linear-gradient(to top, rgba(0,0,0,.8), transparent); }
.generation-preview-image-like__actions button { min-height: 26px; padding: 3px 8px; border: 0; border-radius: 5px; background: rgba(0,0,0,.54); color: #fff; cursor: pointer; font: inherit; font-size: 11px; }
.generation-preview-image-like__actions button:disabled { cursor: not-allowed; opacity: .45; }
.generation-preview-video__close { position: absolute; z-index: 4; top: 5px; right: 5px; display: grid; box-sizing: border-box; width: 28px; height: 28px; place-items: center; padding: 0; border: 0; border-radius: 6px; background: rgba(0,0,0,.18); color: #fff; cursor: pointer; font: inherit; font-size: 20px; line-height: 1; }
.generation-preview-video__close:hover, .generation-preview-video__close:focus-visible { background: rgba(0,0,0,.6); outline: 0; }
.generation-preview-video__controls { position: absolute; z-index: 3; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; padding: 54px 16px 15px; background: linear-gradient(to top,rgba(0,0,0,.9),rgba(0,0,0,.5) 50%,transparent); }
.generation-preview-video__control-row { display: flex; height: 16px; align-items: center; gap: 4px; color: rgba(255,255,255,.4); font-size: 10px; font-variant-numeric: tabular-nums; }
.generation-preview-video__control-row button { display: grid; box-sizing: border-box; min-width: 16px; height: 16px; place-items: center; padding: 0; border: 0; background: transparent; color: rgba(255,255,255,.82); cursor: pointer; font: inherit; }
.generation-preview-video__control-row button:disabled { cursor: not-allowed; opacity: .45; }
.generation-preview-video__control-row button svg { display: block; width: 13px; height: 13px; }
.generation-preview-video__time.is-current { color: rgba(255,255,255,.8); }
.generation-preview-video__control-row .generation-preview-video__rate { margin-left: auto; color: #ff9c2a; }
.generation-preview-video__fullscreen img { display: block; width: 13px; height: 13px; }
.generation-preview-video__progress { --generation-preview-progress: 0%; box-sizing: border-box; width: 100%; height: 4px; margin: 0; padding: 0; appearance: none; border: 0; border-radius: 999px; outline: 0; background: linear-gradient(to right,#ff9c2a 0 var(--generation-preview-progress),rgba(255,255,255,.2) var(--generation-preview-progress) 100%); cursor: pointer; }
.generation-preview-video__progress::-webkit-slider-thumb { width: 0; height: 0; appearance: none; }
.generation-preview-video__progress::-moz-range-thumb { width: 0; height: 0; border: 0; }
.generation-preview-video__progress:focus-visible { outline: 2px solid rgba(255,156,42,.55); outline-offset: 3px; }
.generation-preview-video__actions { display: flex; min-height: 32px; align-items: center; justify-content: center; gap: 12px; }
.generation-preview-video__actions button { box-sizing: border-box; min-height: 32px; padding: 0 28px; border: 0; border-radius: 8px; background: rgba(0,0,0,.54); color: #fff; cursor: pointer; font: inherit; font-size: 12px; }
.generation-preview-video__actions .generation-preview-video__apply { width: 145px; background: linear-gradient(90deg,#ff7001,#ff9c2a); color: #000; font-size: 14px; font-weight: 700; }
.generation-preview-video__actions button:disabled { cursor: not-allowed; opacity: .45; }
.generation-preview-video__apply-error { margin: -4px 0 0; color: #ff8f8f; font-size: 11px; line-height: 1.4; text-align: center; }

.generation-history-list { display: flex; min-width: 0; min-height: 0; height: 100%; flex-direction: column; overflow: auto; color: #f6f1e9; }
.generation-history-list__loading,
.generation-history-list__empty { margin: auto; padding: 18px; color: rgba(255,255,255,.45); font-size: 12px; }
.generation-history-list__items { display: flex; min-width: 0; flex-direction: column; gap: 5px; padding: 6px; }
.generation-history-item { display: grid; min-width: 0; grid-template-columns: 58px minmax(0, 1fr); gap: 8px; padding: 6px; border: 1px solid transparent; border-radius: 7px; background: transparent; }
.generation-history-item.is-selected { border-color: rgba(255,156,42,.6); background: rgba(255,255,255,.07); }
.generation-history-item__preview { display: grid; width: 58px; height: 58px; place-items: center; overflow: hidden; border-radius: 5px; background: #303030; color: #ff9c2a; }
.generation-history-item__preview img,
.generation-history-item__preview video { display: block; width: 100%; height: 100%; object-fit: cover; }
.generation-history-item__content { min-width: 0; }
.generation-history-item__content strong,
.generation-history-item__content p { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.generation-history-item__content strong { color: #fff; font-size: 12px; }
.generation-history-item__content p { margin: 4px 0; color: rgba(255,255,255,.58); font-size: 11px; }
.generation-history-item__status { color: rgba(255,255,255,.42); font-size: 10px; }
.generation-history-item__actions { display: flex; grid-column: 1 / -1; flex-wrap: wrap; gap: 5px; }
.generation-history-item__actions button { min-height: 24px; padding: 3px 7px; border: 1px solid rgba(255,255,255,.1); border-radius: 5px; background: rgba(0,0,0,.18); color: rgba(255,255,255,.76); cursor: pointer; font: inherit; font-size: 10px; }
.generation-history-item__actions button:disabled { cursor: not-allowed; opacity: .45; }
.generation-history-item.is-cover { position: relative; display: block; box-sizing: border-box; width: 67px; height: 67px; min-height: 67px; padding: 0; overflow: hidden; border: 1px solid transparent; border-radius: 10px; background: transparent; opacity: .4; }
.generation-history-item.is-cover.is-selected { border-color: rgba(255,156,42,.6); background: transparent; opacity: 1; }
.generation-history-item.is-cover:focus-within { border-color: #ff9c2a; outline: 2px solid rgba(255,156,42,.35); outline-offset: 1px; }
.generation-history-item.is-cover.is-disabled { opacity: .2; }
.generation-history-item__cover { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
.generation-history-item__cover:focus { outline: 0; }
.generation-history-item__cover:disabled { cursor: not-allowed; }
.generation-history-item.is-cover .generation-history-item__preview { width: 100%; height: 100%; border-radius: 9px; }

.generation-upload { display: flex; min-width: 0; flex-direction: column; gap: 8px; }
.generation-upload-trigger { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; background: rgba(255,255,255,.06); color: rgba(255,255,255,.8); cursor: pointer; font-size: 12px; }
.generation-upload-trigger:hover,
.generation-upload-trigger:focus-within { border-color: #ff9c2a; background: rgba(255,156,42,.12); color: #fff; }
.generation-upload-trigger input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.generation-upload[data-disabled="true"] .generation-upload-trigger { cursor: not-allowed; opacity: .45; }
.generation-upload-error,
.uploaded-asset-list-error { margin: 0; color: #ff8f8f; font-size: 11px; }
.uploaded-asset-list { display: flex; min-width: 0; flex-direction: column; gap: 6px; }
.uploaded-asset-list-status,
.uploaded-asset-empty { margin: 0; color: rgba(255,255,255,.45); font-size: 11px; }
.uploaded-asset { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 7px; align-items: center; min-width: 0; padding: 5px; border-radius: 6px; background: rgba(255,255,255,.05); }
.uploaded-asset img,
.uploaded-asset-placeholder { display: block; width: 34px; height: 34px; border-radius: 4px; object-fit: cover; background: #303030; }
.uploaded-asset-label { overflow: hidden; color: rgba(255,255,255,.8); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.uploaded-asset button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: rgba(255,255,255,.7); cursor: pointer; font-size: 16px; }
.uploaded-asset button:disabled { cursor: not-allowed; opacity: .4; }

.generation-dialog { position: fixed; inset: 0; z-index: 222; display: grid; place-items: end center; }
.generation-dialog__backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.58); }
.generation-dialog__panel { position: relative; z-index: 1; display: flex; width: min(1180px, 100%); height: min(92vh, 900px); min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid #403830; border-bottom: 0; border-radius: 14px 14px 0 0; background: #1a1a1a; color: #f6f1e9; box-shadow: 0 -14px 42px rgba(0,0,0,.35); }
.generation-dialog__header { display: flex; flex: 0 0 auto; align-items: center; gap: 12px; padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,.1); background: #242424; }
.generation-dialog__header h2 { margin: 0; color: #fff; font-size: 15px; font-weight: 600; }
.generation-dialog__header button { width: 30px; height: 30px; margin-left: auto; padding: 0; border: 0; border-radius: 5px; background: transparent; color: rgba(255,255,255,.7); cursor: pointer; font: inherit; font-size: 21px; }
.generation-dialog__header button:hover,
.generation-dialog__header button:focus-visible { background: rgba(255,255,255,.08); color: #fff; outline: 2px solid rgba(255,156,42,.6); outline-offset: 1px; }
.generation-dialog__header button:disabled { cursor: not-allowed; opacity: .45; }
.generation-dialog__loading { margin: auto; color: rgba(255,255,255,.55); font-size: 12px; }
.generation-dialog__panel > .generation-page-layout { flex: 1 1 auto; min-height: 0; }

/* Preserve the established image generation page composition while the
   implementation underneath is split into reusable atoms. */
.igen-workspace.generation-surface {
  grid-template-columns: 225px minmax(0, 1fr);
  grid-template-rows: minmax(300px, 1.9fr) minmax(255px, 1fr);
  grid-template-areas: none;
  gap: 5px;
  padding: 5px;
}
.igen-workspace.generation-surface.has-history { grid-template-columns: 225px minmax(0, 1fr) 67px; }
.igen-workspace > .generation-surface__parameters { grid-area: auto; grid-column: 1; grid-row: 1; border-radius: 0; }
.igen-workspace > .generation-surface__preview { grid-area: auto; grid-column: 2; grid-row: 1; border-radius: 0; background: transparent; }
.igen-workspace > .generation-surface__history { width: 67px; min-width: 0; grid-area: auto; grid-column: 3; grid-row: 1; overflow: hidden; border-radius: 0; background: transparent; }
.igen-workspace > .generation-surface__composer { grid-area: auto; grid-column: 1 / -1; grid-row: 2; overflow: hidden; padding: 0; border-radius: 0; background: transparent; }
.igen-workspace > .generation-surface__composer > .igen-composer { height: 100%; }
.igen-workspace .igen-preview { width: 100%; height: 100%; grid-template-columns: minmax(0, 1fr); }
.igen-workspace .igen-history { height: 100%; }
.igen-workspace .igen-history-head { box-sizing: border-box; display: grid; width: 67px; min-height: 30px; place-items: center; padding: 6px; border: 0; border-radius: 8px; background: rgba(255,255,255,.05); color: rgba(255,255,255,.6); font-size: 11px; line-height: 16.5px; }
.igen-workspace .igen-history-head span { display: none; }
.igen-workspace .igen-history-list { padding: 0; background: transparent; }
.igen-workspace .igen-history-list .generation-history-list__items { gap: 7px; padding: 7px 0 0; }
.igen-panel.is-page .igen-empty-frame.is-idle .generation-preview-frame__footer { display: none; }
.igen-settings .generation-parameters-title { display: none; }
.igen-settings .generation-parameters-fields { gap: 22px; }
.igen-settings .generation-parameter-field { gap: 12px; }
.igen-settings .generation-parameter-label { position: relative; padding-left: 11px; color: #fff; font-size: 14px; line-height: 20px; }
.igen-settings .generation-parameter-label::before { position: absolute; top: 4px; bottom: 4px; left: 0; width: 3px; border-radius: 3px; background: #e8864a; content: ''; }
.igen-settings .generation-select-field select { height: 40px; padding: 0 12px; border-radius: 8px; font-size: 13px; }
.igen-settings .generation-option-group { gap: 8px; }
.igen-settings .generation-option-group button { min-height: 52px; padding: 7px 9px; border-radius: 7px; color: #fff; }
.igen-composer .generation-prompt-composer { height: 100%; gap: 0; }
.igen-composer .generation-prompt-top { flex: 0 0 auto; margin-bottom: 15px; }
.igen-composer .generation-prompt-body { min-height: 126px; padding: 15px 19px; }
.igen-composer .generation-prompt-body > .vgen-mention-editor-wrap { min-height: 74px; }
.igen-composer .vgen-mention-editor { min-height: 63px; color: rgba(255,255,255,.6); font-size: 14px; line-height: 21px; }
.igen-composer .generation-prompt-actions { min-height: 32px; }
.igen-composer .generation-prompt-body button { border: 0; background: transparent; }
.igen-composer .generation-prompt-mention { display: grid; width: 24px; min-height: 24px; place-items: center; padding: 0; font-size: 16px; }
.igen-composer .generation-prompt-style { display: inline-flex; max-width: 180px; min-height: 24px; align-items: center; gap: 8px; overflow: hidden; padding: 0 8px; white-space: nowrap; }
.igen-composer .generation-prompt-style > span { overflow: hidden; text-overflow: ellipsis; }
.igen-composer .generation-prompt-style img { width: 12px; height: 12px; }
.igen-composer .generation-prompt-style.has-style { color: #ffb25b; }
.igen-composer .generation-prompt-clear,
.igen-composer .generation-prompt-cancel { display: grid; width: 16px; min-height: 24px; place-items: center; padding: 0; }
.igen-composer .generation-prompt-clear img,
.igen-composer .generation-prompt-cancel img { width: 16px; height: 16px; }
.igen-composer .generation-prompt-style,
.igen-composer .generation-prompt-clear,
.igen-composer .generation-prompt-cancel,
.igen-composer .generation-prompt-polish { border-radius: 4px; color: rgba(255,255,255,.8); }
.igen-composer .generation-prompt-polish { display: inline-flex; min-height: 24px; align-items: center; gap: 8px; padding: 0 8px; }
.igen-composer .generation-prompt-submit-actions { width: 289px; flex: 0 0 289px; gap: 15px; }
.igen-composer .generation-prompt-composer .generation-prompt-submit { display: grid; width: 32px; min-height: 32px; place-items: center; padding: 0; border-radius: 50%; background: #ff9c2a; box-shadow: 0 2px 8px rgba(255,112,1,.18); }
.igen-composer .generation-prompt-submit img { width: 20px; height: 18px; transform: rotate(45deg) scaleX(-1); }

/* The original full-page video generator used a two-column upper stage and a
   full-width composer. Dialog surfaces keep the generic atom layout. */
.vgen-generation-layout.is-page .vgen-design-workspace {
  grid-template-columns: 225px minmax(0, 1fr);
  grid-template-rows: minmax(300px, 1fr) 330px;
  grid-template-areas: none;
  gap: 5px;
  padding: 5px;
  background: #1a1a1a;
}
.vgen-generation-layout.is-page .vgen-design-workspace.has-history { grid-template-columns: 225px minmax(0, 1fr) 67px; }
.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__parameters { grid-area: auto; grid-column: 1; grid-row: 1; border-radius: 0; }
.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__preview { grid-area: auto; grid-column: 2; grid-row: 1; border-radius: 10px; }
.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__history { grid-area: auto; grid-column: 3; grid-row: 1; width: 67px; overflow: hidden; border-radius: 0; background: transparent; }
.vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__composer { grid-area: auto; grid-column: 1 / -1; grid-row: 2; border-radius: 0; }
.vgen-generation-layout.is-page .vgen-page-history .vgen-generation-history-head { box-sizing: border-box; display: grid; width: 67px; min-height: 30px; place-items: center; padding: 6px; border: 0; border-radius: 8px; background: rgba(255,255,255,.05); color: rgba(255,255,255,.6); font-size: 11px; line-height: 16.5px; }
.vgen-generation-layout.is-page .vgen-page-history .vgen-generation-history-head span { display: none; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-list__items { gap: 7px; padding: 7px 0 0; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item { position: relative; display: block; box-sizing: border-box; width: 67px; height: 67px; min-height: 67px; padding: 0; overflow: hidden; border: 1px solid transparent; border-radius: 10px; opacity: .4; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item.is-selected { border-color: rgba(255,156,42,.6); background: transparent; opacity: 1; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__preview { width: 100%; height: 100%; border-radius: 9px; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__preview img,
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__preview video { object-fit: cover; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__content { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__actions { position: absolute; inset: 0; display: block; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__actions button { position: absolute; width: 1px; height: 1px; overflow: hidden; padding: 0; border: 0; clip: rect(0 0 0 0); white-space: nowrap; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__actions button[data-action='inspect'] { z-index: 2; inset: 0; width: 100%; height: 100%; clip: auto; opacity: 0; cursor: pointer; }
.vgen-generation-layout.is-page .vgen-page-history .generation-history-item__actions button:focus-visible { z-index: 3; top: auto; right: 3px; bottom: 3px; left: 3px; width: auto; height: 22px; overflow: visible; clip: auto; border-radius: 5px; background: rgba(0,0,0,.78); color: #fff; opacity: 1; outline: 1px solid rgba(255,156,42,.6); }
.vgen-generation-layout.is-page .generation-preview-frame.is-idle .generation-preview-frame__footer { display: none; }
.vgen-generation-layout.is-page .vgen-settings .generation-parameters-title { display: none; }
.vgen-generation-layout.is-page .vgen-settings .generation-parameters-fields { gap: 20px; }
.vgen-generation-layout.is-page .vgen-settings .generation-parameter-field { gap: 12px; }
.vgen-generation-layout.is-page .vgen-settings .generation-parameter-label { position: relative; padding-left: 11px; color: #fff; font-size: 14px; line-height: 21px; }
.vgen-generation-layout.is-page .vgen-settings .generation-parameter-label::before { position: absolute; top: 5px; bottom: 5px; left: 0; width: 3px; border-radius: 3px; background: #e8864a; content: ''; }
.vgen-generation-layout.is-page .vgen-settings .generation-select-field select { height: 40px; padding: 0 12px; border-radius: 8px; font-size: 14px; }
.vgen-generation-layout.is-page .vgen-settings .generation-select-field select { border-color: rgba(255,255,255,.08); }
.vgen-generation-layout.is-page .vgen-settings .generation-option-group { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
.vgen-generation-layout.is-page .vgen-settings .generation-option-group button { min-height: 28px; padding: 5px 12px; border-color: rgba(255,255,255,.08); border-radius: 6px; background: #1a1a1a; color: #fff; font-size: 12px; line-height: 18px; }
.vgen-generation-layout.is-page .vgen-settings .generation-option-group button.is-selected { border-color: #e8864a; background: #e8864a; color: #000; }
.vgen-generation-layout.is-page .vgen-settings .generation-range-field input { box-sizing: border-box; height: 12px; margin: 0; padding: 0; appearance: none; border: 0; outline: 0; background: transparent; cursor: pointer; }
.vgen-generation-layout.is-page .vgen-settings .generation-range-field input::-webkit-slider-runnable-track { height: 4px; border-radius: 999px; background: rgba(255,255,255,.1); }
.vgen-generation-layout.is-page .vgen-settings .generation-range-field input::-webkit-slider-thumb { width: 12px; height: 12px; margin-top: -4px; appearance: none; border: 2px solid #e8864a; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.1), 0 4px 6px rgba(0,0,0,.1); }
.vgen-generation-layout.is-page .vgen-settings .generation-range-field input:focus-visible { outline: 2px solid rgba(255,156,42,.48); outline-offset: 3px; border-radius: 4px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-composer { gap: 0; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-top { display: flex; flex-direction: column; gap: 12px; margin-bottom: 15px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-body { height: auto; min-height: 164px; flex: 1 1 0%; padding: 15px 19px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-body > .vgen-mention-editor-wrap { min-height: 48px; }
.vgen-generation-layout.is-page .vgen-composer .vgen-mention-editor { min-height: 48px; font-size: 14px; line-height: 32px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-actions { min-height: 32px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-body button { border: 0; background: transparent; }
.vgen-generation-layout.is-page .vgen-composer .vgen-mode-tabs button { height: 30px; min-height: 30px; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,.6); font-size: 13px; font-weight: 500; line-height: normal; }
.vgen-generation-layout.is-page .vgen-composer .vgen-mode-tabs button:hover:not(:disabled),
.vgen-generation-layout.is-page .vgen-composer .vgen-mode-tabs button:focus-visible { background: rgba(255,255,255,.05); color: rgba(255,255,255,.6); }
.vgen-generation-layout.is-page .vgen-composer .vgen-mode-tabs button.is-on,
.vgen-generation-layout.is-page .vgen-composer .vgen-mode-tabs button.is-on:hover:not(:disabled) { background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.2); color: #000; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-mention { display: grid; width: 24px; min-height: 24px; place-items: center; padding: 0; font-size: 16px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-style { display: inline-flex; min-height: 24px; align-items: center; gap: 8px; padding: 0 8px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-style img { width: 12px; height: 12px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-clear,
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-cancel { display: grid; width: 16px; min-height: 24px; place-items: center; padding: 0; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-clear img,
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-cancel img { width: 16px; height: 16px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-style,
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-clear,
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-cancel,
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-polish { border-radius: 4px; color: rgba(255,255,255,.8); }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-polish { display: inline-flex; min-height: 24px; align-items: center; gap: 8px; padding: 0 8px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-submit-actions { width: 289px; flex: 0 0 289px; gap: 15px; }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-composer .generation-prompt-submit { display: grid; width: 32px; min-height: 32px; place-items: center; padding: 0; border-radius: 50%; background: #ff9c2a; box-shadow: 0 2px 8px rgba(255,112,1,.18); }
.vgen-generation-layout.is-page .vgen-composer .generation-prompt-submit img { width: 20px; height: 18px; transform: rotate(45deg) scaleX(-1); }

@media (max-width: 860px) {
  .generation-surface { grid-template-columns: minmax(170px, 205px) minmax(0, 1fr); }
  .vgen-generation-layout.is-page .vgen-design-workspace {
    grid-template-columns: minmax(170px, 205px) minmax(0, 1fr);
    grid-template-rows: minmax(300px, 1.65fr) minmax(255px, 1fr);
  }
  .vgen-generation-layout.is-page .vgen-design-workspace.has-history { grid-template-columns: minmax(170px, 205px) minmax(0, 1fr) 67px; }
  .vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__history { grid-column: 3; grid-row: 1; max-height: none; }
  .vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__composer { grid-column: 1 / -1; grid-row: 2; min-width: 0; }
  .generation-prompt-actions { align-items: flex-end; flex-direction: column; }
  .generation-prompt-tools,
  .generation-prompt-submit-actions { width: 100%; justify-content: flex-end; }
}
@media (max-width: 640px) {
  .generation-surface { display: flex; flex-direction: column; gap: 6px; }
  .vgen-generation-layout.is-page .vgen-design-workspace { display: flex; height: auto; flex-direction: column; overflow: auto; }
  .vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__parameters { max-height: 280px; }
  .vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__preview { min-height: 300px; }
  .vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__history { min-height: 180px; max-height: none; }
  .vgen-generation-layout.is-page .vgen-design-workspace > .generation-surface__composer { min-height: 250px; }
  .generation-surface__parameters { max-height: 280px; }
  .generation-surface__preview { min-height: 300px; }
  .generation-surface__history { min-height: 180px; }
  .generation-surface__composer { min-height: 250px; }
  .generation-option-group { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .generation-dialog__panel { height: 96vh; border-radius: 10px 10px 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .generation-dialog__panel { transition: none; }
}
`

export function ensureGenerationComponentsStyles(): void {
  injectStyleOnce('game-video-generation-components', GENERATION_COMPONENTS_CSS)
}
