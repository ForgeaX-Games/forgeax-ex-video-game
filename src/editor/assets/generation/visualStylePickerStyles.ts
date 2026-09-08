import { injectStyleOnce } from '@/editor/styles/injectStyle'

export const VISUAL_STYLE_PICKER_CSS = `
.vgen-style-layer { position: fixed; inset: 0; z-index: 330; display: grid; place-items: center; padding: 24px; background: rgba(0,0,0,.68); }
.vgen-style-dialog { box-sizing: border-box; display: flex; width: min(971px,calc(100vw - 48px)); height: min(680px,calc(100vh - 48px)); flex-direction: column; overflow: hidden; padding: 24px 40px; border: 1px solid rgba(255,255,255,.2); border-radius: 14px; background: #141414; color: #fff; box-shadow: 0 24px 72px rgba(0,0,0,.5); }
.vgen-style-head { display: flex; min-height: 55px; flex: 0 0 auto; align-items: flex-start; border-bottom: 1px solid rgba(255,255,255,.1); }
.vgen-style-head h3 { margin: 0; font-size: 24px; font-weight: 400; line-height: 36px; }
.vgen-style-head button { display: grid; width: 24px; height: 24px; margin: 6px 0 0 auto; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.vgen-style-head button img { display: block; width: 20px; height: 20px; transform: rotate(-45deg); }
.vgen-style-head button:hover, .vgen-style-head button:focus-visible { background: rgba(255,255,255,.08); color: #fff; outline: none; }
.vgen-style-toolbar { display: flex; min-height: 40px; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 16px; margin: 18px 0 24px; }
.vgen-style-categories { display: flex; width: min(558px,calc(100% - 219px)); min-width: 0; flex: 0 1 558px; gap: 18px; overflow-x: auto; }
.vgen-style-categories button { min-height: 40px; flex: none; padding: 8px 15px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,.4); cursor: pointer; font: inherit; font-size: 16px; line-height: 24px; }
.vgen-style-categories button.is-on { background: rgba(255,255,255,.1); color: #fff; }
.vgen-style-search { box-sizing: border-box; display: flex; width: 203px; height: 40px; flex: 0 0 203px; align-items: center; gap: 16px; padding: 8px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: transparent; }
.vgen-style-search > img { display: block; width: 24px; height: 24px; flex: 0 0 24px; opacity: .4; }
.vgen-style-search > input { min-width: 0; height: 22px; flex: 1 1 auto; padding: 0; border: 0; outline: none; background: transparent; color: #fff; font: inherit; font-size: 14px; line-height: 21px; }
.vgen-style-search > input:focus, .vgen-style-search > input:focus-visible { border: 0; outline: 0; background: transparent; box-shadow: none; }
.vgen-style-search > input::placeholder { color: rgba(255,255,255,.4); }
.vgen-style-search:focus-within { border-color: #e8864a; }
.vgen-style-grid { display: grid; min-height: 0; flex: 1 1 auto; grid-template-columns: repeat(5,minmax(0,1fr)); grid-auto-rows: 119px; align-content: start; gap: 15px 18px; overflow-y: auto; }
.vgen-style-card { position: relative; min-width: 0; height: 119px; overflow: hidden; padding: 0; border: 1px solid transparent; border-radius: 10.553px; background: #242424; color: #fff; cursor: pointer; }
.vgen-style-card img { display: block; width: 100%; height: 100%; object-fit: cover; }
.vgen-style-card span { position: absolute; inset: auto 0 0; box-sizing: border-box; height: 33px; overflow: hidden; padding: 8px; background: linear-gradient(to top,#000 10.8%,transparent); font-size: 14px; line-height: 21px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.vgen-style-card:hover, .vgen-style-card:focus-visible, .vgen-style-card.is-selected { border-color: rgba(255,156,42,.8); outline: none; }
.vgen-style-message { display: grid; min-height: 160px; grid-column: 1/-1; place-items: center; margin: 0; color: rgba(255,255,255,.55); font-size: 13px; }
.vgen-style-message.error { color: #ff8f8f; }
@media (max-width:700px) { .vgen-style-dialog { padding: 20px; } .vgen-style-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@media (max-width:520px) { .vgen-style-toolbar { height: auto; align-items: stretch; flex-direction: column; } .vgen-style-categories, .vgen-style-search { width: 100%; flex-basis: auto; } .vgen-style-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
`

export function ensureVisualStylePickerStyles(): void {
  injectStyleOnce('game-video-visual-style-picker', VISUAL_STYLE_PICKER_CSS)
}
