/**
 * GamePlayer —— 运行时试玩组件 SSOT（runtime/play）。**只订阅 GraphSession 的 snapshot 渲染 +
 * 回灌事件**,游戏逻辑全在纯 TS 引擎/会话里(已 headless 单测)。
 *
 * 与宿主解耦:靠两个注入项跑起来,不 import editor/宿主:
 *   - `resolveAsset(mediaId, game)`:把节点媒体 id 解析成可播 url(宿主专属——forgeax 走
 *     Kino/__gva__,将来 manifest/COS;arrival 走自己的实现)。runtime 不认识这些。
 *   - `game`:当前游戏 slug(宿主决定,如 iframe `?slug=`),作 prop 传入,runtime 不读 URL。
 *
 * 渲染帧交给共享的 <GameStage>;这里只管会话生命周期 + 根容器/焦点/占位。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameScenario } from '@/runtime/core/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '@/runtime/core/engine/session'
import { PlayerRootContext, type SkinCtx } from '../component-host/rendererRegistry'
import { createCoreSkinRegistry } from '../component-host'
import { claimPlayerFocus, releasePlayerFocus } from '../input/playerFocus'
import { useClipPerformanceEnd } from './useClipPerformanceEnd'
import { GameStage } from './GameStage'
import { BgmPlayer } from './BgmPlayer'
import { createSessionSeed } from './sessionSeed'

/** 媒体解析注入契约:节点媒体 id → 可播 url(宿主实现)。 */
export type ResolveAsset = (mediaId: string | undefined, game: string) => string | undefined

export interface GamePlayerProps {
  scenario: GameScenario
  /** 当前游戏 slug（宿主注入）。 */
  game: string
  /** 媒体解析器（宿主注入）。 */
  resolveAsset: ResolveAsset
  /** 固定 seed 可用于回放/调试；缺省时每个新会话自动生成。 */
  rngSeed?: number
  /** 本局进入 `ended` 时通知宿主一次；结束态 UI 与重开策略归宿主，runtime 不渲染。 */
  onEnded?: () => void
  /** 冻结这一局：视频停在当前帧、床轨挂起、无视频节点也不再计时推进。 */
  paused?: boolean
}

export function GamePlayer({ scenario, game, resolveAsset, rngSeed, onEnded, paused = false }: GamePlayerProps): JSX.Element {
  const session = useMemo(
    () => new GraphSession(scenario, { rngSeed: rngSeed ?? createSessionSeed() }),
    [scenario, rngSeed],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const skins = useMemo(() => createCoreSkinRegistry(), [])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const endedNotified = useRef(false)
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap.clipSeq, session)
  const videoSrc = resolveAsset(snap.clip?.mediaId, game)
  const preloadVideos = useMemo(
    () => session.preloadClips().map((candidate) => ({
      videoSrc: resolveAsset(candidate.mediaId, game),
      clip: candidate,
    })),
    [session, snap.currentNodeId, game, resolveAsset],
  )
  // 床轨与视频共用同一个宿主解析器（audio id 走同一 assets/manifest 路径）；BgmPlayer 只吃单参签名。
  const resolveBgm = useCallback((id: string | undefined) => resolveAsset(id, game), [resolveAsset, game])

  useEffect(() => {
    const el = rootRef.current
    setRootEl(el)
    if (el) claimPlayerFocus(el)
    return () => releasePlayerFocus(el)
  }, [])

  useEffect(() => {
    if (snap.phase !== 'ended') {
      endedNotified.current = false
      return
    }
    if (endedNotified.current) return
    endedNotified.current = true
    onEnded?.()
  }, [snap.phase, onEnded])

  useEffect(() => {
    // 无视频：durationMs 到点推进；有视频：durationMs 作播放时长上限，走 <video> onTimeUpdate。
    if (paused || snap.phase === 'ended' || !snap.clip?.durationMs || snap.clip.mediaId) return
    const t = setTimeout(() => endPerformance(), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [paused, snap.clipSeq, snap.phase, snap.clip?.durationMs, snap.clip?.mediaId, endPerformance])

  const skinCtx: SkinCtx = {
    hud: snap.hud,
    condition: { state: session.runtime.state, visited: session.runtime.state.visited },
  }

  return (
    <PlayerRootContext.Provider value={rootEl}>
      <div
        ref={rootRef}
        className="gv-graph-player"
        tabIndex={0}
        onPointerDown={() => claimPlayerFocus(rootRef.current)}
        onFocus={() => claimPlayerFocus(rootRef.current)}
        style={{ position: 'relative', width: '100%', height: '100%', background: '#000', color: '#fff', outline: 'none' }}
      >
        <BgmPlayer bgm={snap.bgm} resolveAsset={resolveBgm} paused={paused} active={snap.phase !== 'ended'} />
        <GameStage
          paused={paused}
          videoSrc={videoSrc}
          videoKey={`clip-${snap.clipSeq}`}
          overlayKey={snap.clipSeq}
          clip={snap.clip}
          preloadVideos={preloadVideos}
          overlayMounts={snap.overlayMounts}
          skins={skins}
          skinCtx={skinCtx}
          onEmit={(elementId, key) => setSnap(sessionRef.current.emitEvent(elementId, key))}
          onTick={(nowMs) => setSnap(sessionRef.current.tick(nowMs))}
          onPerformanceEnd={endPerformance}
        />
      </div>
    </PlayerRootContext.Provider>
  )
}
