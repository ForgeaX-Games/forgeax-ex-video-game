import { t as translateUi } from '@/i18n'
/**
 * 防反 QTE（component id: `BattleParry`）。
 * 按键由 RuntimeComponentHost 以扁平 props 传入；此处只展示与结算。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { injectCss, ensureInkFilters, ensureBrushFont, previewTStyle } from './skinRuntime'

export { BattleParryManifest } from '@/runtime/core/component-catalog/BattleParry.manifest'

export interface BattleParryProps {
  firstKey?: string
  secondKey?: string
  emit?: (key: string) => void
  preview?: boolean
  previewTimeMs?: number
}

export function BattleParry({
  firstKey: firstKeyInput = 'A',
  secondKey: secondKeyInput = 'B',
  emit,
  preview,
  previewTimeMs,
}: BattleParryProps) {
  const qteRingMs = 1400
  const qteEntryStaggerMs = 100
  const qteWindowMs = qteRingMs + qteEntryStaggerMs
  injectCss('battle-parry-layer', PARRY_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const runtimeRef = useRef({ hitKeys: new Set<string>(), settled: false, emit, preview })
  const [hitKeys, setHitKeys] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  runtimeRef.current.emit = emit
  runtimeRef.current.preview = preview
  const firstKey = resolveKey(firstKeyInput, 'A')
  const secondKey = resolveKey(secondKeyInput, 'B')

  function settle(result: 'greatSuccess' | 'success' | 'fail', animate = true): void {
    if (runtimeRef.current.settled) return
    runtimeRef.current.settled = true
    if (animate) setFinished(true)
    runtimeRef.current.emit?.(result)
  }

  function pick(id: string): void {
    if (preview || runtimeRef.current.settled || runtimeRef.current.hitKeys.has(id)) return
    runtimeRef.current.hitKeys.add(id)
    setHitKeys([...runtimeRef.current.hitKeys])
    if (runtimeRef.current.hitKeys.size === 2) settle('greatSuccess', false)
  }

  useEffect(() => {
    if (preview) return
    const timeout = window.setTimeout(() => {
      settle(runtimeRef.current.hitKeys.size === 1 ? 'success' : 'fail')
    }, qteWindowMs)
    return () => {
      window.clearTimeout(timeout)
      if (runtimeRef.current.preview || runtimeRef.current.settled) return
      settle(runtimeRef.current.hitKeys.size === 1 ? 'success' : 'fail', false)
    }
  }, [preview])

  useEffect(() => {
    if (preview) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) return
      if (sameKey(event.key, firstKey)) {
        event.preventDefault()
        pick('first')
      } else if (sameKey(event.key, secondKey)) {
        event.preventDefault()
        pick('second')
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [firstKey, preview, secondKey])

  return (
    <div
      className={`pvb-parry${finished ? ' is-finished' : ''}${preview ? ' is-frozen' : ''}`}
      style={preview ? previewTStyle(previewTimeMs ?? 0) : undefined}
      aria-label={translateUi('ui.copy.1280d495403f')}
    >
      <div className="pvb-parry-keys" data-overlay-hit-target>
        <span className="pvb-parry-visual-bounds" data-overlay-hit-target aria-hidden="true" />
        <button
          type="button"
          className={`pvb-key${hitKeys.includes('first') ? ' hit' : ''}`}
          aria-label={translateUi('ui.copy.48faa6f1f048')}
          disabled={preview || hitKeys.includes('first')}
          onClick={() => pick('first')}
          style={{ '--qte-entry-delay': '0ms', '--qte-ring-duration': `${qteRingMs}ms` } as CSSProperties}
        >
          <span className="pvb-key-label">{firstKey}</span>
        </button>
        <button
          type="button"
          className={`pvb-key${hitKeys.includes('second') ? ' hit' : ''}`}
          aria-label={translateUi('ui.copy.5644fd4406e0')}
          disabled={preview || hitKeys.includes('second')}
          onClick={() => pick('second')}
          style={{ '--qte-entry-delay': `${qteEntryStaggerMs}ms`, '--qte-ring-duration': `${qteRingMs}ms` } as CSSProperties}
        >
          <span className="pvb-key-label">{secondKey}</span>
        </button>
      </div>
    </div>
  )
}

function resolveKey(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function sameKey(key: string, expected: string): boolean {
  return key.localeCompare(expected, undefined, { sensitivity: 'accent' }) === 0
}

const PARRY_CSS = `
.pvb-parry{position:relative;inline-size:100%;block-size:100%;z-index:46;display:flex;align-items:center;justify-content:center;pointer-events:none}
.pvb-parry.is-finished{pointer-events:none;animation:pvbParryFinish .2s ease-out forwards}
.pvb-parry.is-frozen{pointer-events:none!important}
.pvb-parry.is-frozen .pvb-key,.pvb-parry.is-frozen .pvb-key::after{animation-play-state:paused}
.pvb-parry.is-frozen .pvb-key{animation-delay:calc(var(--qte-entry-delay,0ms) - var(--preview-t,0ms))}
.pvb-parry.is-frozen .pvb-key::after{animation-delay:calc(var(--qte-entry-delay,0ms) - var(--preview-t,0ms))}
.pvb-parry-keys{position:relative;inline-size:20cqmin;block-size:20cqmin;pointer-events:auto}
.pvb-parry-visual-bounds{position:absolute;inset:-5cqmin;pointer-events:none}
.pvb-key{position:relative;inline-size:8cqmin;block-size:8cqmin;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4cqh;cursor:pointer;background:none;border:none;padding:0;color:#efe7d6;transition:transform .14s,opacity .14s;animation:pvbParryKeyLifetime var(--qte-ring-duration,1400ms) linear var(--qte-entry-delay,0ms) both}
.pvb-key:nth-child(1){position:absolute;inset-block-start:1cqmin;inset-inline-start:1cqmin}
.pvb-key:nth-child(2){position:absolute;inset-block-end:1cqmin;inset-inline-end:1cqmin}
.pvb-key::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.5);box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.6);filter:url(#inkRough)}
.pvb-key::after{content:'';position:absolute;inset:-32%;border:2px solid rgba(95,224,138,.9);border-radius:50%;box-shadow:0 0 12px rgba(95,224,138,.55);pointer-events:none;animation:pvbParryApproach var(--qte-ring-duration,1400ms) linear var(--qte-entry-delay,0ms) both}
.pvb-key:hover:not(:disabled){transform:translateY(-2px) scale(1.03)}
.pvb-key.hit{transform:scale(1.08);animation:pvbParryHit .32s ease-in forwards}
.pvb-key.hit::before{border-color:#5fe08a;background:linear-gradient(180deg,#234a32,#0e2417);box-shadow:0 0 20px rgba(95,224,138,.8),0 2px 6px rgba(0,0,0,.5) inset}
.pvb-key.hit::after{animation:none;opacity:0}
.pvb-key:disabled:not(.hit){opacity:.38;cursor:not-allowed}
.pvb-key-label{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:2.6cqh;font-weight:800;line-height:1;text-shadow:0 2px 6px rgba(0,0,0,.85)}
@keyframes pvbParryKeyLifetime{from{opacity:0}12%{opacity:1}84%{opacity:1}to{opacity:0}}
@keyframes pvbParryApproach{from{opacity:0;transform:scale(1.45)}20%{opacity:1}82%{opacity:1;transform:scale(.42)}to{opacity:0;transform:scale(.36)}}
@keyframes pvbParryHit{0%{opacity:1;transform:translateY(0) scale(1)}30%{opacity:1;transform:translateY(-.4cqmin) scale(1.1)}100%{opacity:0;transform:translateY(-1.4cqmin) scale(.9)}}
@keyframes pvbParryFinish{to{opacity:0}}
`
