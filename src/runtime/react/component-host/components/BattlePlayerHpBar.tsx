import { t as translateUi } from '@/i18n'
import type { ReactNode } from 'react'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export { BattlePlayerHpBarManifest } from '@/runtime/core/component-catalog/BattlePlayerHpBar.manifest'

export interface BattlePlayerHpBarProps {
  current?: number
  max?: number
  label?: string
  qi?: number
  qiMax?: number
}

/** 数值由 RuntimeComponentHost 解析后以扁平 props 传入；此处只展示。 */
export function BattlePlayerHpBar({
  current = 50,
  max = 90,
  label = '我方',
  qi = 3,
  qiMax: qiMaxInput = 5,
}: BattlePlayerHpBarProps): ReactNode {
  injectCss('graph-battle-player-hud', PLAYER_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const low = max > 0 && current / max <= 0.3
  const qiMax = qiMaxInput > 0 ? Math.min(100, Math.floor(qiMaxInput)) : 5
  const pips = Array.from({ length: qiMax }, (_, index) => index < qi)

  return (
    <div className="ks-hud-bottom">
      <div className={`ks-hud-hp ks-hud-me-unit${low ? ' is-low' : ''}`} data-overlay-fit-target>
        <div className="ks-hud-hp-name">{label}</div>
        <div className="ks-hud-hp-bar">
          <span className="ks-hud-hp-ghost" style={{ width: hpBarPercent(current, max) }} />
          <span className="ks-hud-hp-fill me" style={{ width: hpBarPercent(current, max) }} />
        </div>
        {pips.length > 0 && (
          <div className="ks-hud-rage" aria-label={`${translateUi('ui.template.5f721cc8c8d9')}${qi}/${qiMax}`}>
            {pips.map((on, index) => <span key={index} className={`ks-hud-pip${on ? ' on' : ''}`} aria-hidden />)}
          </div>
        )}
      </div>
    </div>
  )
}

function hpBarPercent(current: number, max: number): string {
  return `${(max > 0 ? Math.max(0, Math.min(1, current / max)) : 0) * 100}%`
}

const PLAYER_CSS = `
.ks-hud-missing-bind { position:absolute; top:4cqh; left:1.5cqw; z-index:999; padding:4px 10px; border-radius:6px; background:rgba(120,70,10,.92); border:1px solid #f0a840; color:#ffe9c2; font-size:1.4cqh; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.5); }
.ks-hud-bottom { position:absolute; right:2.5cqw; bottom:2.5cqh; display:flex; flex-direction:column; gap:1cqh; align-items:flex-end; max-width:40%; pointer-events:none; }
.ks-hud-hp { display:flex; flex-direction:column; align-items:flex-end; width:23cqw; text-align:right; }
.ks-hud-hp-name { font-family:'HYShangWei','STKaiti','KaiTi',serif; font-size:2.2cqh; font-weight:800; color:#efe7d6; letter-spacing:3px; margin-bottom:3px; text-shadow:0 2px 7px rgba(0,0,0,.8); }
.ks-hud-hp-bar { position:relative; width:100%; height:1.3cqh; filter:url(#inkRough); transform:rotate(.5deg) scaleX(-1); }
.ks-hud-hp-bar::before { content:''; position:absolute; inset:0; border-radius:7px 8px 6px 7px / 5px 7px 5px 6px; background:linear-gradient(180deg,#2b2620,#0c0a08); box-shadow:0 2px 6px rgba(0,0,0,.5) inset; -webkit-mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-hp-ghost,.ks-hud-hp-fill { position:absolute; left:0; top:0; bottom:0; width:100%; border-radius:7px 8px 6px 7px / 5px 7px 5px 6px; -webkit-mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-hp-ghost { z-index:1; background:rgba(255,255,255,.5); transition:width .6s cubic-bezier(.2,.7,.3,1) .22s; }
.ks-hud-hp-fill { z-index:2; transition:width .16s linear; background:linear-gradient(90deg,#7398cf,#a6c6ee); }
.ks-hud-hp.is-low .ks-hud-hp-fill { background:linear-gradient(90deg,#f87171,#ef4444); animation:ks-hud-lowpulse 1s ease-in-out infinite; }
.ks-hud-rage { display:flex; flex-direction:row-reverse; justify-content:flex-end; gap:.8cqh; margin-top:1cqh; }
.ks-hud-pip { width:1.6cqmin; height:1.6cqmin; border-radius:50%; background:radial-gradient(circle at 35% 30%,#5a5346,#262219); border:1px solid rgba(0,0,0,.5); box-shadow:0 1px 2px rgba(0,0,0,.5); transition:all .2s; }
.ks-hud-pip.on { background:radial-gradient(circle at 35% 30%,#ffe49c,#c8902f); border-color:rgba(255,220,150,.7); box-shadow:0 0 7px rgba(255,190,90,.7),0 1px 2px rgba(0,0,0,.4); }
@keyframes ks-hud-lowpulse { 0%,100% { opacity:1; } 50% { opacity:.55; } }
`
