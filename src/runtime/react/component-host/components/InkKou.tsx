import { t as translateUi } from '@/i18n'
/**
 * 叩击（component id: `InkKou`）。
 * 按键由 RuntimeComponentHost 以扁平 props 传入；此处只展示与交互。
 */
import { useEffect, useRef, useState } from 'react'
import { injectCss, ensureInkFilters, ensureBrushFont, previewTStyle } from './skinRuntime'

export { InkKouManifest } from '@/runtime/core/component-catalog/InkKou.manifest'

export interface InkKouProps {
  triggerKey?: string
  emit?: (key: string) => void
  preview?: boolean
  previewTimeMs?: number
  previewPlaying?: boolean
}

export function InkKou({
  triggerKey: triggerKeyInput = 'A',
  emit,
  preview,
  previewTimeMs,
  previewPlaying,
}: InkKouProps) {
  injectCss('ink-kou-layer', KOU_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const knockedRef = useRef(false)
  const [exiting, setExiting] = useState(false)
  const triggerKey = triggerKeyInput.trim() || 'A'

  function knock(): void {
    if (preview || knockedRef.current) return
    knockedRef.current = true
    setExiting(true)
    emit?.('kou')
  }

  useEffect(() => {
    if (preview) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.key.localeCompare(triggerKey, undefined, { sensitivity: 'accent' }) !== 0) return
      event.preventDefault()
      knock()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [preview, triggerKey])

  const frozen = preview && !previewPlaying
  return (
    <div
      className={`pvn-opts pvn-opts--kou show${frozen ? ' is-frozen' : ''}${exiting ? ' is-exiting' : ''}`}
      style={frozen ? previewTStyle(previewTimeMs ?? 0) : undefined}
      aria-label={translateUi('ui.copy.90a7937b6248')}
    >
      <button type="button" className="pvn-opt pvn-opt--kou" aria-label={translateUi('ui.copy.57c4ca897497')} data-overlay-fit-target disabled={preview} onClick={knock}>
        <span className="pvn-kou-orn" aria-hidden="true">
          <i className="pvn-kou-dot" />
          <i className="pvn-kou-diamond" />
          <i className="pvn-kou-dot" />
        </span>
        <span className="pvn-kou-glyph">{translateUi('ui.copy.57c4ca897497')}</span>
        <span className="pvn-kou-hint" aria-hidden="true">
          <i className="pvn-kou-space">{triggerKey}</i>
        </span>
      </button>
    </div>
  )
}

const KOU_CSS = `
.pvn-opts--kou{position:relative;inline-size:100%;block-size:100%;min-inline-size:72px;min-block-size:112px;z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.pvn-opts--kou.show{pointer-events:auto;}
.pvn-opts--kou.is-frozen{pointer-events:none!important;}
.pvn-opts--kou.is-exiting{pointer-events:none;animation:pvnKouExit .32s ease-in forwards;}
.pvn-opts--kou.is-frozen .pvn-kou-orn,.pvn-opts--kou.is-frozen .pvn-kou-glyph,.pvn-opts--kou.is-frozen .pvn-kou-hint{animation-play-state:paused;}
.pvn-opts--kou.is-frozen .pvn-kou-orn{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--kou.is-frozen .pvn-kou-glyph,.pvn-opts--kou.is-frozen .pvn-kou-hint{animation-delay:calc(0.12s - var(--preview-t,0ms));}
.pvn-opt--kou{border:none;background:none;cursor:pointer;padding:0;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(4cqh,6cqmin,9cqh);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
.pvn-kou-hint{display:flex;align-items:center;justify-content:center;margin-top:4px;pointer-events:none;animation:pvnKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-kou-space{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:1.5em;height:1.5em;position:relative;background:transparent;border:1.5px solid rgba(244,239,228,.94);border-radius:50%;color:#f8f4ec;font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:1.35cqh;font-style:normal;font-weight:800;line-height:1;box-shadow:0 0 10px rgba(255,248,235,.12);}
@keyframes pvnKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pvnKouExit{from{opacity:1;transform:translateY(0) scale(1)}to{opacity:0;transform:translateY(-12px) scale(.94)}}
`
