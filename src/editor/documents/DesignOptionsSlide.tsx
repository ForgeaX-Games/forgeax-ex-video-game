import { useEffect, useRef, useState } from 'react'
import { t, tf, useLocale } from '../../i18n'
import { injectStyleOnce } from '@/editor/styles/injectStyle'
import { applyDesignOptions, fetchProjectDocument, type ProjectDocument } from './document-client'
import { parseDesignOptions, type DesignOption, type DesignOptionId } from '@/authoring/documents/core-design-options'
import { useDesignOptionsGate } from './design-options-gate'
import { useDocumentNav } from '../persist/documentNavStore'
import applyIcon from '../ui-assets/design-options-apply.svg'
import leftArrowIcon from '../ui-assets/design-options-arrow-left.png'
import rightArrowIcon from '../ui-assets/design-options-arrow-right.png'
import regenerateIcon from '../ui-assets/design-options-regenerate.svg'

const CSS = `
.gdo-root{position:relative;height:100%;min-height:0;display:flex;flex-direction:column;align-items:center;background:#232323;color:#fff;font-family:'PingFang SC',system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden;padding:clamp(12px,2.4vh,24px) 22px clamp(10px,1.8vh,18px);box-sizing:border-box}
.gdo-prompt{position:absolute;z-index:10;top:calc(50% - min(327px,50%) - 16px);left:50%;margin:0;padding:2px 24px;transform:translate(-50%,-100%);border-radius:4px;background:#141414;color:#FF9C2A;font-size:16px;font-weight:600;line-height:24px;letter-spacing:.02em;white-space:nowrap}
.gdo-carousel{position:relative;flex:1;min-height:0;width:min(100%,1221px);display:flex;align-items:center;justify-content:center;touch-action:pan-y}
.gdo-stage{position:absolute;inset:0}
.gdo-option{position:absolute;top:50%;left:50%;width:640px;height:654px;min-height:0;overflow:hidden;border:2px solid rgba(255,255,255,.18);border-radius:12px;background:#141414;color:#fff;box-sizing:border-box;will-change:transform,opacity,filter;transition:transform 500ms cubic-bezier(.22,.74,.18,1),opacity 500ms cubic-bezier(.22,.74,.18,1),filter 500ms cubic-bezier(.22,.74,.18,1),box-shadow 500ms cubic-bezier(.22,.74,.18,1),border-color 500ms cubic-bezier(.22,.74,.18,1)}
.gdo-slot-center{z-index:3;transform:translate(-50%,-50%);border-color:#FF9C2A;opacity:1;filter:saturate(1);box-shadow:0 24px 70px rgba(0,0,0,.34)}
.gdo-slot-left{z-index:1;transform:translate(-92%,-50%) scale(.86);opacity:.3;filter:saturate(.75);box-shadow:0 16px 42px rgba(0,0,0,.2)}
.gdo-slot-right{z-index:1;transform:translate(-8%,-50%) scale(.86);opacity:.3;filter:saturate(.75);box-shadow:0 16px 42px rgba(0,0,0,.2)}
.gdo-side:hover{opacity:.55;filter:saturate(.92)}
.gdo-card-select{position:absolute;inset:0;z-index:4;width:100%;height:100%;border:0;background:transparent;color:transparent;cursor:pointer}.gdo-card-select:disabled{pointer-events:none}.gdo-card-select:focus-visible{outline:2px solid #fff;outline-offset:-6px;border-radius:14px}
.gdo-card{height:100%;min-height:0;box-sizing:border-box;padding:32px 32px 40px;text-align:left;overflow-x:hidden;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,156,42,.55) transparent}.gdo-card::-webkit-scrollbar{width:6px}.gdo-card::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(255,156,42,.55)}
.gdo-badge{display:inline-flex;align-items:center;padding:4px 16px;border-radius:8px;background:#FF9C2A;color:#141414;font-size:16px;line-height:24px;font-weight:700}
.gdo-title{height:36px;margin:8px 0 0;font-size:24px;line-height:36px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gdo-tags{display:flex;flex-wrap:wrap;gap:8px;min-height:32px;margin:16px 0 0;overflow:hidden}.gdo-tag{flex:none;padding:6px 12px;border:1px solid rgba(255,156,42,.2);border-radius:20px;color:rgba(255,255,255,.6);background:rgba(255,156,42,.1);font-size:12px;line-height:18px}
.gdo-intro{display:flex;align-items:center;box-sizing:border-box;margin:16px 0 0;padding:12px;border-left:3px solid #FF9C2A;border-radius:6px;background:rgba(255,255,255,.05);color:#fff;font-size:16px;line-height:24px}
.gdo-meta{display:grid;grid-template-columns:80px minmax(0,1fr);column-gap:16px;row-gap:16px;margin-top:16px;font-size:16px;line-height:24px}.gdo-meta-label{color:#FF9C2A;font-weight:700}.gdo-meta-value{color:rgba(255,255,255,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gdo-divider{position:relative;flex:none;width:100%;height:16px}.gdo-divider::after{position:absolute;right:0;bottom:0;left:0;height:1px;background:rgba(255,255,255,.102);content:""}.gdo-section{padding-top:16px}.gdo-section h3{margin:0 0 8px;color:#FF9C2A;font-size:16px;line-height:24px}.gdo-section p{margin:0;color:rgba(255,255,255,.8);font-size:16px;line-height:24px}.gdo-section-theme{margin:0}
.gdo-arrow{position:absolute;z-index:20;top:50%;left:50%;display:flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;transform:translate(-50%,-50%);border:1px solid rgba(255,156,42,.6);border-radius:50%;background:#4f4f4f;color:#FF9C2A;cursor:pointer;pointer-events:auto;box-shadow:0 4px 18px rgba(0,0,0,.28)}.gdo-arrow img{display:block;width:24px;height:24px;object-fit:contain}.gdo-arrow-left img{transform:translateX(-1px)}.gdo-arrow-right img{transform:translateX(1px)}.gdo-arrow:hover{background:#656565}
.gdo-actions{flex:none;display:flex;justify-content:center;gap:24px;padding:clamp(10px,1.8vh,18px) 0 0}.gdo-action{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:10px;width:148px;height:40px;padding:2px 16px;border:0;border-radius:8px;font:600 16px/24px 'PingFang SC',system-ui,sans-serif;cursor:pointer}.gdo-action-icon{display:block;flex:none;width:24px;height:24px}.gdo-action-regenerate{background:#fff;color:#141414}.gdo-action-apply{background:#FF9C2A;color:#141414}.gdo-action:disabled{cursor:not-allowed;opacity:.58}
.gdo-mask{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:rgba(20,20,20,.76);color:#FF9C2A;font-size:18px}.gdo-error{flex:none;width:min(100%,900px);margin:0 0 10px;padding:10px 14px;border:1px solid rgba(255,120,120,.6);border-radius:8px;background:rgba(120,30,30,.3);color:#ffc2c2}.gdo-status{flex:none;min-height:18px;margin:6px 0 0;color:rgba(255,255,255,.68);font-size:12px}
@media (max-width:760px){.gdo-root{padding:12px}.gdo-prompt{font-size:16px;padding:2px 24px}.gdo-slot-left,.gdo-slot-right{opacity:0;pointer-events:none}.gdo-card{padding:18px 22px}.gdo-meta{grid-template-columns:92px 1fr}.gdo-actions{width:100%;gap:10px}.gdo-action{width:auto;min-width:0;flex:1}}
@media (max-height:700px){.gdo-root{padding-top:8px;padding-bottom:6px}.gdo-prompt{margin-bottom:8px}.gdo-card{padding-top:18px;padding-bottom:18px}.gdo-actions{padding-top:8px}.gdo-status{min-height:14px;margin-top:2px}}
@media (prefers-reduced-motion:reduce){.gdo-option{transition:none}}
`

export type CarouselSlot = 'left' | 'center' | 'right'
type CardFrame = { top: number; left: number; width: number; height: number }

const REGENERATE_REFRESH_INTERVAL_MS = 1_000
const REGENERATE_REFRESH_TIMEOUT_MS = 90_000

export function resolveCarouselSlot(
  optionIndex: number,
  activeIndex: number,
  optionCount: number,
): CarouselSlot {
  const relative = (optionIndex - activeIndex + optionCount) % optionCount
  if (relative === 0) return 'center'
  return relative === 1 ? 'right' : 'left'
}

function designOptionTagline(option: DesignOption): string {
  const quoteLines: string[] = []
  let collecting = false
  for (const line of option.markdown.split(/\r?\n/)) {
    const match = /^\s*>\s?(.*)$/.exec(line)
    if (match) {
      collecting = true
      const value = match[1]?.trim()
      if (value) quoteLines.push(value)
      continue
    }
    if (collecting) break
  }
  return quoteLines.join(' ').trim() || option.projectIntroduction
}

function DesignOptionCard({ option }: { option: DesignOption }): JSX.Element {
  return (
    <div className="gdo-card">
      <div className="gdo-badge">{tf('videoGame.designOptions.badge', { id: option.id })}{option.recommended ? t('videoGame.designOptions.recommended') : ''}</div>
      <h2 className="gdo-title">{option.title}</h2>
      <div className="gdo-tags">{option.tags.map((tag) => <span className="gdo-tag" key={tag}>{tag}</span>)}</div>
      <blockquote className="gdo-intro">{designOptionTagline(option)}</blockquote>
      <div className="gdo-meta">
        <span className="gdo-meta-label">{t('videoGame.designOptions.type')}</span><span className="gdo-meta-value">{option.genre}</span>
        <span className="gdo-meta-label">{t('videoGame.designOptions.visualStyle')}</span><span className="gdo-meta-value">{option.visualStyle}</span>
        <span className="gdo-meta-label">{t('videoGame.designOptions.scale')}</span><span className="gdo-meta-value">{option.scale}</span>
      </div>
      <div className="gdo-divider" aria-hidden="true" />
      <section className="gdo-section gdo-section-project"><h3>{t('videoGame.designOptions.projectIntroduction')}</h3><p>{option.projectIntroduction}</p></section>
      <div className="gdo-divider" aria-hidden="true" />
      <section className="gdo-section gdo-section-theme"><h3>{t('videoGame.designOptions.themeExpression')}</h3><p>{option.themeExpression}</p></section>
    </div>
  )
}

export function DesignOptionsSlide({
  content,
  documentId,
  documentUpdatedAt,
  onContentReload,
  onApplied,
}: {
  content: string
  documentId?: string
  documentUpdatedAt?: number
  onContentReload?: (document: ProjectDocument) => void
  onApplied?: () => void
}): JSX.Element {
  useLocale()
  injectStyleOnce('game-design-options-slide', CSS)
  const gate = useDesignOptionsGate()
  const setDocumentType = useDocumentNav((state) => state.setDocumentType)
  const [options, setOptions] = useState<DesignOption[] | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [centerCardFrame, setCenterCardFrame] = useState<CardFrame | null>(null)
  const [arrowCardFrame, setArrowCardFrame] = useState<CardFrame | null>(null)
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 760px)').matches ?? false)
  ))
  const rootRef = useRef<HTMLElement>(null)
  const touchStart = useRef<number | null>(null)
  const transitioning = useRef(false)
  const transitionTimer = useRef<number | null>(null)
  const reducedMotion = useRef(false)
  const regenerationToken = useRef(0)

  useEffect(() => {
    regenerationToken.current += 1
    try {
      setOptions(parseDesignOptions(content))
      setError(null)
    } catch (cause) {
      setOptions(null)
      setError(cause instanceof Error ? cause.message : t('videoGame.designOptions.invalid'))
    }
  }, [content])

  useEffect(() => () => {
    regenerationToken.current += 1
  }, [])

  useEffect(() => {
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const compactQuery = window.matchMedia?.('(max-width: 760px)')
    const updateMotion = (matches: boolean) => {
      reducedMotion.current = matches
      if (!matches) return
      transitioning.current = false
      if (transitionTimer.current !== null) {
        window.clearTimeout(transitionTimer.current)
        transitionTimer.current = null
      }
    }
    const onMotionChange = (event: MediaQueryListEvent) => updateMotion(event.matches)
    const onCompactChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    updateMotion(motionQuery?.matches ?? false)
    setCompact(compactQuery?.matches ?? false)
    motionQuery?.addEventListener('change', onMotionChange)
    compactQuery?.addEventListener('change', onCompactChange)
    return () => {
      motionQuery?.removeEventListener('change', onMotionChange)
      compactQuery?.removeEventListener('change', onCompactChange)
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current)
    }
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const setInitialCardFrame = () => {
      const centerCard = root.querySelector<HTMLElement>('.gdo-slot-center')
      if (!centerCard) return
      const rootRect = root.getBoundingClientRect()
      const cardRect = centerCard.getBoundingClientRect()
      setCenterCardFrame({
        top: cardRect.top - rootRect.top,
        left: cardRect.left - rootRect.left,
        width: cardRect.width,
        height: cardRect.height,
      })
    }
    const frame = window.requestAnimationFrame(setInitialCardFrame)
    return () => window.cancelAnimationFrame(frame)
  }, [options])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let frame: number | null = null
    const updateArrowCardFrame = () => {
      const centerCard = root.querySelector<HTMLElement>('.gdo-slot-center')
      if (!centerCard) return
      const rootRect = root.getBoundingClientRect()
      const cardRect = centerCard.getBoundingClientRect()
      setArrowCardFrame({
        top: cardRect.top - rootRect.top,
        left: cardRect.left - rootRect.left,
        width: cardRect.width,
        height: cardRect.height,
      })
    }
    const scheduleUpdate = () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = null
        updateArrowCardFrame()
      })
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleUpdate)
    resizeObserver?.observe(root)
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [options])

  const active = options?.[activeIndex]
  const isBusy = busy || Boolean(gate?.busy)
  const promptTop = centerCardFrame !== null
    ? (() => {
        const promptHeight = 28
        const promptGap = 16
        return centerCardFrame.top >= promptHeight + promptGap * 2
          ? centerCardFrame.top - promptGap
          : (centerCardFrame.top + promptHeight) / 2
      })()
    : undefined
  const arrowTop = arrowCardFrame ? arrowCardFrame.top + arrowCardFrame.height / 2 : undefined
  const leftArrowLeft = arrowCardFrame ? arrowCardFrame.left - 36 : undefined
  const rightArrowLeft = arrowCardFrame ? arrowCardFrame.left + arrowCardFrame.width + 36 : undefined

  const finishTransition = () => {
    transitioning.current = false
    if (transitionTimer.current !== null) {
      window.clearTimeout(transitionTimer.current)
      transitionTimer.current = null
    }
  }

  const move = (delta: number) => {
    if (!options || transitioning.current) return
    if (!reducedMotion.current) {
      transitioning.current = true
      transitionTimer.current = window.setTimeout(finishTransition, 600)
    }
    setActiveIndex((current) => (current + delta + options.length) % options.length)
    setStatus('')
  }

  const apply = async () => {
    if (!active || isBusy) return
    setBusy(true)
    setError(null)
    setStatus(t('videoGame.designOptions.applying'))
    try {
      await applyDesignOptions(active.id as DesignOptionId)
      // The host author gate is what advances the orchestration workflow.
      // Keep the chooser mounted until it confirms success; otherwise a
      // rejected review would still navigate to the materialized core doc and
      // remove the only retry affordance while the workflow remains blocked.
      await gate?.onApplied?.(active.id as DesignOptionId, { title: active.title })
      setDocumentType('core')
      onApplied?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('videoGame.designOptions.applyFailed'))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const refreshAfterRegeneration = async (
    initialContent: string,
    initialUpdatedAt: number | undefined,
    token: number,
  ): Promise<void> => {
    if (!documentId || !onContentReload) return
    const deadline = Date.now() + REGENERATE_REFRESH_TIMEOUT_MS
    while (regenerationToken.current === token && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, REGENERATE_REFRESH_INTERVAL_MS)
      })
      if (regenerationToken.current !== token) return
      try {
        const next = await fetchProjectDocument(documentId)
        const changed = next.content !== initialContent
          || (initialUpdatedAt !== undefined && next.updatedAt !== initialUpdatedAt)
        if (!changed) continue
        const refreshedOptions = parseDesignOptions(next.content)
        setOptions(refreshedOptions)
        setError(null)
        setStatus('')
        onContentReload(next)
        return
      } catch {
        // A peer may briefly expose a partially written document; keep polling
        // until the content is valid or the bounded refresh window expires.
      }
    }
    if (regenerationToken.current === token) {
      setError(t('videoGame.designOptions.regenerateFailed'))
      setStatus('')
    }
  }

  const regenerate = async () => {
    if (isBusy) return
    const initialContent = content
    const initialUpdatedAt = documentUpdatedAt
    const token = ++regenerationToken.current
    setBusy(true)
    setError(null)
    setStatus(t('videoGame.designOptions.regenerating'))
    try {
      await gate?.onRegenerate?.()
      await refreshAfterRegeneration(initialContent, initialUpdatedAt, token)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('videoGame.designOptions.regenerateFailed'))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
  }

  if (!options) {
    return <section className="gdo-root" aria-label={t('videoGame.designOptions.ariaLabel')}><p className="gdo-error" role="alert">{error ?? t('videoGame.designOptions.reading')}</p></section>
  }

  return (
    <section ref={rootRef} className="gdo-root" aria-label={t('videoGame.designOptions.ariaLabel')} tabIndex={0} onKeyDown={onKeyDown}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null }}
      onTouchEnd={(event) => { if (touchStart.current === null) return; const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStart.current; touchStart.current = null; if (Math.abs(delta) > 40) move(delta > 0 ? -1 : 1) }}>
      {error ? <p className="gdo-error" role="alert">{error}</p> : null}
      <p className="gdo-prompt" style={promptTop === undefined ? undefined : { top: promptTop }}>{t('videoGame.designOptions.prompt')}</p>
      <div className="gdo-carousel" role="region" aria-roledescription="carousel" aria-label={t('videoGame.designOptions.region')}>
        <div className="gdo-stage">
          {options.map((option, optionIndex) => {
            const slot = resolveCarouselSlot(optionIndex, activeIndex, options.length)
            const isCenter = slot === 'center'
            return (
              <article
                className={`gdo-option gdo-slot-${slot}${isCenter ? ' gdo-active' : ` gdo-side gdo-side-${slot}`}`}
                data-carousel-slot={slot}
                data-option-id={option.id}
                key={option.id}
                aria-hidden={!isCenter && compact ? true : undefined}
                aria-label={tf('videoGame.designOptions.viewOption', { id: option.id })}
                onTransitionEnd={(event) => {
                  if (event.target === event.currentTarget && slot === 'center') finishTransition()
                }}
              >
                <DesignOptionCard option={option} />
                <button
                  className="gdo-card-select"
                  type="button"
                  disabled={isCenter || isBusy}
                  tabIndex={isCenter || compact ? -1 : 0}
                  onClick={() => move(slot === 'left' ? -1 : 1)}
                  aria-label={tf('videoGame.designOptions.viewOption', { id: option.id })}
                />
              </article>
            )
          })}
        </div>
      </div>
      <button className="gdo-arrow gdo-arrow-left" style={arrowTop === undefined || leftArrowLeft === undefined ? undefined : { top: arrowTop, left: leftArrowLeft }} type="button" onClick={() => move(-1)} aria-label={t('videoGame.designOptions.previous')}><img src={leftArrowIcon} alt="" /></button>
      <button className="gdo-arrow gdo-arrow-right" style={arrowTop === undefined || rightArrowLeft === undefined ? undefined : { top: arrowTop, left: rightArrowLeft }} type="button" onClick={() => move(1)} aria-label={t('videoGame.designOptions.next')}><img src={rightArrowIcon} alt="" /></button>
      <div className="gdo-actions">
        <button className="gdo-action gdo-action-regenerate" type="button" onClick={() => void regenerate()} disabled={isBusy}><img className="gdo-action-icon" src={regenerateIcon} alt="" />{t('videoGame.designOptions.regenerate')}</button>
        <button className="gdo-action gdo-action-apply" type="button" onClick={() => void apply()} disabled={isBusy}><img className="gdo-action-icon" src={applyIcon} alt="" />{t('videoGame.designOptions.apply')}</button>
      </div>
      <p className="gdo-status" role="status">{status}</p>
      {isBusy ? <div className="gdo-mask" role="status">{t('videoGame.designOptions.processing')}</div> : null}
    </section>
  )
}
