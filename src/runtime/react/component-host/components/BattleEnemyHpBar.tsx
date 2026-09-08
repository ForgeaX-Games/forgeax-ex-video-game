import type { ReactNode } from 'react'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export { BattleEnemyHpBarManifest } from '@/runtime/core/component-catalog/BattleEnemyHpBar.manifest'

export interface BattleEnemyHpBarProps {
  current?: number
  max?: number
  label?: string
}

/** 数值由 RuntimeComponentHost 解析后以扁平 props 传入；此处只展示。 */
export function BattleEnemyHpBar({
  current = 50,
  max = 90,
  label = '敌方',
}: BattleEnemyHpBarProps): ReactNode {
  injectCss('graph-battle-enemy-hud', ENEMY_CSS)
  ensureInkFilters()
  ensureBrushFont()

  return (
    <div className="ks-hud-boss ks-hud-foe-unit" data-overlay-fit-target>
      <div className="ks-hud-boss-name">{label}</div>
      <div className="ks-hud-boss-bar">
        <span className="ks-hud-boss-ghost" style={{ width: hpBarPercent(current, max) }} />
        <span className="ks-hud-boss-fill foe" style={{ width: hpBarPercent(current, max) }} />
      </div>
    </div>
  )
}

function hpBarPercent(current: number, max: number): string {
  return `${(max > 0 ? Math.max(0, Math.min(1, current / max)) : 0) * 100}%`
}

const ENEMY_CSS = `
.ks-hud-missing-bind { position:absolute; top:4cqh; left:1.5cqw; z-index:999; padding:4px 10px; border-radius:6px; background:rgba(120,70,10,.92); border:1px solid #f0a840; color:#ffe9c2; font-size:1.4cqh; pointer-events:none; box-shadow:0 2px 8px rgba(0,0,0,.5); }
.ks-hud-boss { position:absolute; top:2cqh; left:50%; transform:translateX(-50%); width:30cqw; display:flex; flex-direction:column; align-items:center; gap:3px; text-align:center; pointer-events:none; }
.ks-hud-boss-name { font-family:'HYShangWei','STKaiti','KaiTi',serif; font-size:2.2cqh; font-weight:800; color:#efe7d6; letter-spacing:3px; text-shadow:0 2px 7px rgba(0,0,0,.8); }
.ks-hud-boss-bar { position:relative; width:100%; height:1.3cqh; filter:url(#inkRough); transform:rotate(-.7deg); }
.ks-hud-boss-bar::before { content:''; position:absolute; inset:0; border-radius:7px 8px 6px 7px / 5px 7px 5px 6px; background:linear-gradient(180deg,#2b2620,#0c0a08); box-shadow:0 2px 6px rgba(0,0,0,.5) inset; -webkit-mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-boss-ghost,.ks-hud-boss-fill { position:absolute; left:0; top:0; bottom:0; width:100%; border-radius:7px 8px 6px 7px / 5px 7px 5px 6px; -webkit-mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); mask:linear-gradient(90deg,transparent 0,#000 3%,#000 97%,transparent 100%); }
.ks-hud-boss-ghost { z-index:1; background:rgba(255,255,255,.5); transition:width .6s cubic-bezier(.2,.7,.3,1) .22s; }
.ks-hud-boss-fill { z-index:2; transition:width .16s linear; background:linear-gradient(90deg,#d06d5b,#e89a8d); }
`
