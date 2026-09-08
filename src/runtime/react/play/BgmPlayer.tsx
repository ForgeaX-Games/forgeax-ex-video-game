/**
 * BgmPlayer —— 把「栈顶此刻该响什么」（`SessionSnapshot.bgm`）落成真实声音的**唯一**壳层件。
 *
 * 分工（SPEC §4.1）：引擎只抛资产 id + 播放意图，URL 与音频元素归壳层；解析器由调用方
 * 注入（同 `GamePlayer` 给视频注入 `resolveAsset` 的路子），故本文件不 import editor/宿主。
 * 与视频原声开关无关：床轨是**独立通道**，不搭视频音轨。
 *
 * 无 UI（返回 `null`）：音频元素由本件自己 `createElement` 并挂到 `document.body`——
 * 挂上去而非游离，是为了 devtools 能看见「有几条轨在响」，测试也能直接查 DOM；
 * 卸载时全部回收。React 不参与 `src` 的 diff，播放头是我们自己的状态。
 *
 * ## 三条不可违的语义（`BgmPlaybackCommand` 的定义，非本件自选）
 * - `fadeOutMs` 说的是**离场那条**，`ref`/`volume`/`fadeInMs`/`loop` 说的是**将要响那条**：
 *   一条指令 = 一次交叉淡变。故换轨时**两条轨同时在线**（单元素做不到交叉，只能把作者
 *   写在 `combat.data.bgm.fadeOutMs` 上的淡出悄悄吃掉——那正是它唯一被作者写的地方）。
 * - `ref === null` = 停播；此时 `volume: 0` 是钉死的填充，**不是**「静音但继续播」。
 * - `restart: false` = 同一条轨继续响，**别碰播放头**：不 `load()`、不 `currentTime = 0`。
 *   多回合战斗每回合都会重新走到同一条 `bgm` 指令，重载一次就断一次，本能力就废了。
 */
import { useEffect, useRef } from 'react'
import type { BgmSnapshot } from '@/runtime/core/engine/session'

/** 淡变步长；50ms ≈ 20 步/秒，耳朵听不出台阶，也不至于把主线程铺满 timer。 */
const FADE_STEP_MS = 50

export interface BgmPlayerProps {
  /** 当前床轨指令（= `SessionSnapshot.bgm`）；`null` = 本局还没发过 bgm 指令，什么都别做。 */
  bgm: BgmSnapshot | null
  /** 资产 id → 可播 url（宿主注入）。引擎只给 id，URL 只住 manifest。 */
  resolveAsset: (id: string | undefined) => string | undefined
  paused?: boolean
  playbackRate?: number
  /** false 时立即收掉所有床轨；试玩最后一个节点结束时使用。 */
  active?: boolean
  /** 壳层统一声音开关；静音不停止床轨，也不重置播放头。 */
  muted?: boolean
  /**
   * 壳层主音量（0..1，缺省 1 = 不缩放）。指令里的 `volume` 是**曲子之间的相对配比**，
   * 主音量再乘一次：作者调壳层滑杆不该改写蓝图里配好的配比。
   */
  masterVolume?: number
}

/**
 * 「这条指令已经施加过了吗」——**逐字段比**，不比引用。
 *
 * 快照一旦被序列化（宿主把 session 快照 `postMessage` 进 iframe 是最现成的路子），每次到手
 * 都是**新对象**：靠引用判等于每一帧都当新指令施加一遍，`restart: true` 的床轨于是每帧回零，
 * 等于没在播。反过来只比播放字段也不行：回合循环里每轮那条重开指令逐字段相同，却真的是
 * 两次「从头播」。`seq` 是引擎发了第几条的凭据，把两头都兜住（见 `BgmSnapshot`）。
 */
function isSameCommand(a: BgmSnapshot | null, b: BgmSnapshot): boolean {
  return a !== null
    && a.seq === b.seq
    && a.ref === b.ref
    && a.volume === b.volume
    && a.fadeInMs === b.fadeInMs
    && a.fadeOutMs === b.fadeOutMs
    && a.loop === b.loop
    && a.restart === b.restart
}

/** 一条正在响（或正在淡出）的轨：元素 + 它播的 id + 它自己那条淡变 timer。 */
interface Deck {
  el: HTMLAudioElement
  ref: string
  timer: ReturnType<typeof setInterval> | null
  /** 指令要的音量（未乘主音量）；主音量变化时按它重算，不丢曲间配比。 */
  cmdVolume: number
}

/** HTMLMediaElement.volume 越界会抛 DOMException；schema 已校验 0..1，这里兜底不让它炸播放器。 */
function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

function cancelRamp(deck: Deck): void {
  if (deck.timer === null) return
  clearInterval(deck.timer)
  deck.timer = null
}

/**
 * 线性淡变到目标音量；`ms <= 0` 即刻落值（硬切）。`done` 在到点后跑（淡出收尾用）。
 * `to` 是**指令音量**，落到元素上时再乘 `master`。
 */
function ramp(deck: Deck, to: number, ms: number, master: number, done?: () => void): void {
  cancelRamp(deck)
  deck.cmdVolume = clamp01(to)
  const target = clamp01(to * master)
  if (ms <= 0) {
    deck.el.volume = target
    done?.()
    return
  }
  const from = deck.el.volume
  const steps = Math.max(1, Math.ceil(ms / FADE_STEP_MS))
  let step = 0
  deck.timer = setInterval(() => {
    step += 1
    deck.el.volume = clamp01(from + ((target - from) * step) / steps)
    if (step < steps) return
    cancelRamp(deck)
    done?.()
  }, FADE_STEP_MS)
}

function newDeck(ref: string, url: string, loop: boolean, volume: number, master: number): Deck {
  const el = document.createElement('audio')
  el.setAttribute('data-gv-bgm', 'active')
  el.preload = 'auto'
  el.loop = loop
  el.volume = clamp01(volume * master)
  el.src = url
  document.body.appendChild(el)
  el.load()
  return { el, ref, timer: null, cmdVolume: clamp01(volume) }
}

/** 彻底下线一条轨：停 + 断源（否则清了 src 缓冲/解码器还挂着）+ 移出 DOM。 */
function dispose(deck: Deck): void {
  cancelRamp(deck)
  deck.el.pause()
  deck.el.removeAttribute('src')
  deck.el.load()
  deck.el.remove()
}

/**
 * 试播。浏览器在用户手势前拒绝有声自动播放（`NotAllowedError`）是**常态**，不是 bug：
 * 既不能让 rejection 冒成 unhandled，也不能每条指令刷一行 warn。故每挂载一次只喊一声；
 * 其余错误（解码 / 网络 / 404）照喊——不然「没声音」就成了查不动的哑失败。
 */
function tryPlay(deck: Deck, blockedWarned: { current: boolean }): void {
  const started = deck.el.play() as Promise<void> | undefined
  void started?.catch((e: unknown) => {
    if ((e as { name?: string } | undefined)?.name === 'NotAllowedError') {
      if (blockedWarned.current) return
      blockedWarned.current = true
      console.warn('[bgm] 浏览器拒绝无手势自动播放，首个用户手势后自动重试：', deck.ref)
      return
    }
    console.warn('[bgm] 床轨播放失败：', deck.ref, e)
  })
}

export function BgmPlayer({ bgm, resolveAsset, paused = false, playbackRate = 1, active = true, muted = false, masterVolume = 1 }: BgmPlayerProps): null {
  const master = clamp01(masterVolume)
  const masterRef = useRef(master)
  masterRef.current = master
  const soundingRef = useRef<Deck | null>(null)
  const retiringRef = useRef<Deck[]>([])
  /** 已施加的那条指令；同一条重复到达（父组件重渲染 / 解析器换引用 / 快照被序列化）不得二次施加。 */
  const appliedRef = useRef<BgmSnapshot | null>(null)
  const blockedWarned = useRef(false)

  const stopAll = (): void => {
    for (const deck of [soundingRef.current, ...retiringRef.current]) if (deck) dispose(deck)
    soundingRef.current = null
    retiringRef.current = []
    appliedRef.current = null
  }

  useEffect(() => {
    for (const deck of [soundingRef.current, ...retiringRef.current]) {
      if (!deck) continue
      deck.el.muted = muted
      deck.el.playbackRate = playbackRate
      // 淡变进行中不改写：那一段有自己的起止值，插一脚只会听出跳变；淡完后的下一条指令按新主音量算。
      if (deck.timer === null) deck.el.volume = clamp01(deck.cmdVolume * master)
      if (paused) deck.el.pause()
      else tryPlay(deck, blockedWarned)
    }
  }, [muted, paused, playbackRate, master])

  // 卸载 = 收摊。引擎在 `phase === 'ended'` **刻意不发**停播（SPEC D6：win 节点仍带着床轨），
  // 所以「停」这件事只由壳层生命周期负责：试玩面关掉 / 重开时别把声音漏到下一局。
  useEffect(() => () => stopAll(), [])

  useEffect(() => {
    if (!active) stopAll()
  }, [active])

  // 自动播放被拒后的最小补救：下一次用户手势时重试当前轨。刻意**不**建 unlock 系统——
  // 我们从不主动 pause 正响的轨（停播会把它整条下线），故「paused 的 active 轨」只可能是被策略拦下的。
  useEffect(() => {
    const retry = (): void => {
      const deck = soundingRef.current
      if (!paused && deck && deck.el.paused) tryPlay(deck, blockedWarned)
    }
    window.addEventListener('pointerdown', retry)
    window.addEventListener('keydown', retry)
    return () => {
      window.removeEventListener('pointerdown', retry)
      window.removeEventListener('keydown', retry)
    }
  }, [paused])

  useEffect(() => {
    // `null` = 还没发过指令：连元素都别建（别拿它当停播令）。
    if (!active || !bgm || isSameCommand(appliedRef.current, bgm)) return
    appliedRef.current = bgm

    /** 让一条轨按离场淡出时长下线；`fadeOutMs <= 0` = 硬切（数据说的，不是意外）。 */
    const retire = (deck: Deck, fadeOutMs: number): void => {
      deck.el.setAttribute('data-gv-bgm', 'retiring')
      retiringRef.current = [...retiringRef.current, deck]
      ramp(deck, 0, fadeOutMs, masterRef.current, () => {
        dispose(deck)
        retiringRef.current = retiringRef.current.filter((d) => d !== deck)
      })
    }

    const sounding = soundingRef.current

    // 停播：只有 fadeOutMs 有意义。
    if (bgm.ref === null) {
      if (sounding) {
        soundingRef.current = null
        retire(sounding, bgm.fadeOutMs)
      }
      return
    }

    const url = resolveAsset(bgm.ref)
    if (!url) {
      // 解析不到就**保持原样**：把正响的床轨换成静音，只会让「资产没登记」表现成随机断曲。
      console.warn('[bgm] 音频 id 解析不到 url，床轨保持原样：', bgm.ref)
      return
    }

    if (sounding && sounding.ref === bgm.ref) {
      if (!bgm.restart) {
        // 续播：绝不 load()/seek。这一条就是多回合战斗床跨回合连续的全部原因。
        sounding.el.loop = bgm.loop
        ramp(sounding, bgm.volume, bgm.fadeInMs, masterRef.current)
        if (sounding.el.paused) tryPlay(sounding, blockedWarned)
        return
      }
      // 同轨显式从头：没必要跟自己交叉淡变，就地回 0 秒。
      cancelRamp(sounding)
      sounding.el.currentTime = 0
      sounding.el.loop = bgm.loop
      sounding.cmdVolume = clamp01(bgm.fadeInMs > 0 ? 0 : bgm.volume)
      sounding.el.volume = clamp01(sounding.cmdVolume * masterRef.current)
      tryPlay(sounding, blockedWarned)
      if (bgm.fadeInMs > 0) ramp(sounding, bgm.volume, bgm.fadeInMs, masterRef.current)
      return
    }

    // 换轨：旧轨吃离场帧的 fadeOutMs、新轨吃新栈顶的 fadeInMs —— 一条指令一次交叉淡变。
    if (sounding) retire(sounding, bgm.fadeOutMs)
    // 要起的这条若还有一份在淡出（作用域短进短出），先让它即刻下线：同曲跟自己叠只会听出重影。
    for (const stale of retiringRef.current) if (stale.ref === bgm.ref) dispose(stale)
    retiringRef.current = retiringRef.current.filter((d) => d.ref !== bgm.ref)
    const deck = newDeck(bgm.ref, url, bgm.loop, bgm.fadeInMs > 0 ? 0 : bgm.volume, masterRef.current)
    deck.el.muted = muted
    deck.el.playbackRate = playbackRate
    soundingRef.current = deck
    if (!paused) tryPlay(deck, blockedWarned)
    if (bgm.fadeInMs > 0) ramp(deck, bgm.volume, bgm.fadeInMs, masterRef.current)
  }, [active, bgm, resolveAsset, muted, paused, playbackRate])

  return null
}
