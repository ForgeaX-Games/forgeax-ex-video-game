import { t as translateUi } from '@/i18n'
/**
 * 應/默抉择（component id: `InkYingMo`）。
 * 无 wiring 输入；Host 仅透传 emit / preview。
 */
import { useRef } from 'react'
import { injectCss, ensureInkFilters, ensureBrushFont, previewTStyle } from './skinRuntime'

export { InkYingMoManifest } from '@/runtime/core/component-catalog/InkYingMo.manifest'

export interface InkYingMoProps {
  emit?: (key: string) => void
  preview?: boolean
  previewTimeMs?: number
  previewPlaying?: boolean
}

export function InkYingMo({ emit, preview, previewTimeMs, previewPlaying }: InkYingMoProps) {
  injectCss('ink-yingmo-layer', YINGMO_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const pickedRef = useRef(false)

  function pick(id: 'ying' | 'mo'): void {
    if (preview || pickedRef.current) return
    pickedRef.current = true
    emit?.(id)
  }

  const frozen = preview && !previewPlaying
  return (
    <div
      className={`pvn-opts pvn-opts--yingmo show${frozen ? ' is-frozen' : ''}`}
      style={frozen ? previewTStyle(previewTimeMs ?? 0) : undefined}
      aria-label={translateUi('ui.copy.4d88194b7285')}
    >
      <div className="pvn-yingmo-pair" data-overlay-fit-target>
        <ChoiceButton label={translateUi('ui.copy.c604c2dbe74e')} event="ying" preview={preview} onPick={pick} />
        <ChoiceButton label={translateUi('ui.copy.1387fe967c95')} event="mo" preview={preview} onPick={pick} />
      </div>
    </div>
  )
}

function ChoiceButton({ label, event, preview, onPick }: { label: string; event: 'ying' | 'mo'; preview?: boolean; onPick: (event: 'ying' | 'mo') => void }) {
  return (
    <button type="button" className="pvn-opt pvn-opt--kou pvn-opt--ying" aria-label={label} disabled={preview} onClick={() => onPick(event)}>
      <span className="pvn-kou-orn" aria-hidden="true">
        <i className="pvn-kou-dot" />
        <i className="pvn-kou-diamond" />
        <i className="pvn-kou-dot" />
      </span>
      <span className="pvn-kou-glyph">{label}</span>
    </button>
  )
}

const YINGMO_CSS = `
.pvn-opts--yingmo{position:relative;inline-size:100%;block-size:100%;min-inline-size:180px;min-block-size:96px;z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.pvn-opts--yingmo.show{pointer-events:auto;}
.pvn-opts--yingmo.is-frozen{pointer-events:none!important;}
.pvn-opts--yingmo.is-frozen .pvn-kou-orn,.pvn-opts--yingmo.is-frozen .pvn-kou-glyph{animation-play-state:paused;}
.pvn-opts--yingmo.is-frozen .pvn-kou-orn{animation-delay:calc(0s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-kou-glyph{animation-delay:calc(0.12s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:calc(0.28s - var(--preview-t,0ms));}
.pvn-opts--yingmo.is-frozen .pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:calc(0.2s - var(--preview-t,0ms));}
.pvn-yingmo-pair{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:clamp(4cqmin,9cqw,9cqmin);}
.pvn-opts--yingmo .pvn-opt--kou{position:relative;padding:0;border:none;background:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-opts--yingmo .pvn-opt--kou:hover:not(.dis):not(:disabled){transform:translateY(-2px) scale(1.03);}
.pvn-opts--yingmo .pvn-opt--kou.dis,.pvn-opts--yingmo .pvn-opt--kou:disabled{opacity:.38;cursor:not-allowed;filter:grayscale(.35);}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:.28s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:.2s;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;animation:pvnYmKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(4cqh,6cqmin,9cqh);font-weight:800;line-height:1;letter-spacing:.08em;color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);animation:pvnYmKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opts--yingmo .pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
@keyframes pvnYmKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnYmKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
`
