/**
 * BgmPlayer —— 壳层音频输出的行为钉子（happy-dom）。
 *
 * 最要紧的一条：`restart: false` 的**续播不得重载、不得回零**——多回合战斗床全靠它连续，
 * 弄错就是本能力最显眼的失败。其次是 `fadeOutMs` 描述**离场那条**：换轨时若把它吃掉，
 * 作者写在 `combat.data.bgm.fadeOutMs` 上的淡出就永远听不到。
 */
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BgmSnapshot } from '@/runtime/core/engine/session'
import { BgmPlayer } from '../BgmPlayer'

let seq = 0
/**
 * 指令默认取「换曲」形态（restart: true）——栈换 ref 时引擎恒给 true。
 * `seq` 默认每调一次 +1 = 「引擎又发了一条」；要模拟同一条快照再送一遍就显式传同一个 seq。
 */
function cmd(over: Partial<BgmSnapshot> = {}): BgmSnapshot {
  seq += 1
  return { ref: 'bgm-story', volume: 1, fadeInMs: 0, fadeOutMs: 0, loop: true, restart: true, seq, ...over }
}

/** 注入的解析器（宿主职责）：id → url。 */
const resolve = (id: string | undefined): string | undefined => (id ? `/__gva__/media/${id}` : undefined)

const decks = (): HTMLAudioElement[] => [...document.querySelectorAll('audio[data-gv-bgm]')] as HTMLAudioElement[]
const active = (): HTMLAudioElement => document.querySelector('audio[data-gv-bgm="active"]') as HTMLAudioElement

/** 微任务落地（play() 的 rejection 走 promise 链）。 */
const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0) })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('BgmPlayer', () => {
  it('切换静音时保持同一条床轨和播放头', () => {
    const same = cmd()
    const { rerender } = render(<BgmPlayer bgm={same} resolveAsset={resolve} muted />)
    const deck = document.querySelector<HTMLAudioElement>('audio[data-gv-bgm="active"]')!
    deck.currentTime = 12
    expect(deck.muted).toBe(true)

    rerender(<BgmPlayer bgm={same} resolveAsset={resolve} muted={false} />)
    expect(document.querySelector('audio[data-gv-bgm="active"]')).toBe(deck)
    expect(deck.muted).toBe(false)
    expect(deck.currentTime).toBe(12)
  })

  it('bgm=null 不建任何音频元素（「本局还没发过指令」≠ 停播令）', () => {
    render(<BgmPlayer bgm={null} resolveAsset={resolve} />)
    expect(decks()).toHaveLength(0)
  })

  it('首条指令起播一条轨：src / loop / volume 落位', () => {
    render(<BgmPlayer bgm={cmd({ volume: 0.8 })} resolveAsset={resolve} />)
    const el = active()
    expect(el.getAttribute('src')).toBe('/__gva__/media/bgm-story')
    expect(el.loop).toBe(true)
    expect(el.volume).toBe(0.8)
    expect(el.paused).toBe(false)
  })

  it('暂停和倍速同步到当前床轨', () => {
    const same = cmd()
    const { rerender } = render(<BgmPlayer bgm={same} resolveAsset={resolve} paused playbackRate={2} />)
    const el = active()
    expect(el.paused).toBe(true)
    expect(el.playbackRate).toBe(2)

    rerender(<BgmPlayer bgm={same} resolveAsset={resolve} paused={false} playbackRate={0.5} />)
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(0.5)
  })

  it('ref 变了就换轨：active 轨的 src 指向新曲', () => {
    const { rerender } = render(<BgmPlayer bgm={cmd()} resolveAsset={resolve} />)
    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-battle' })} resolveAsset={resolve} />)
    expect(active().getAttribute('src')).toBe('/__gva__/media/bgm-battle')
    expect(decks()).toHaveLength(1) // fadeOutMs=0 → 旧轨即刻下线
  })

  it('同 ref + restart:false 续播：不重载、不动播放头，只跟音量/loop', () => {
    const load = vi.spyOn(window.HTMLMediaElement.prototype, 'load')
    const { rerender } = render(<BgmPlayer bgm={cmd({ ref: 'bgm-battle' })} resolveAsset={resolve} />)
    const el = active()
    const loadsAfterStart = load.mock.calls.length
    el.currentTime = 12

    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-battle', volume: 0.5, restart: false })} resolveAsset={resolve} />)

    expect(active()).toBe(el) // 还是同一条轨
    expect(el.currentTime).toBe(12) // 播放头没被碰
    expect(load.mock.calls.length).toBe(loadsAfterStart) // 没重新解码
    expect(el.volume).toBe(0.5)
    expect(el.paused).toBe(false)
  })

  it('同 ref + restart:true 回到 0 秒', () => {
    const { rerender } = render(<BgmPlayer bgm={cmd({ ref: 'bgm-battle' })} resolveAsset={resolve} />)
    const el = active()
    el.currentTime = 12
    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-battle', restart: true })} resolveAsset={resolve} />)
    expect(active()).toBe(el)
    expect(el.currentTime).toBe(0)
  })

  it('同一条指令重复到达（resolver 换引用等）不重复施加', () => {
    const same = cmd({ ref: 'bgm-battle' })
    const { rerender } = render(<BgmPlayer bgm={same} resolveAsset={(id) => resolve(id)} />)
    const el = active()
    el.currentTime = 7
    rerender(<BgmPlayer bgm={same} resolveAsset={(id) => resolve(id)} />)
    expect(el.currentTime).toBe(7)
  })

  // 引用相等是**巧合**：今天成立只因为 `GraphSession.cloned()` 是浅拷贝、快照里那条 bgm 原样带过。
  // 任何把快照序列化再送过来的消费者（宿主的 iframe postMessage 是最现成的）每帧都给新对象，
  // 靠引用判就等于每帧重开一次 restart 的床轨 —— 逐字段比才是这条判据的本意。
  it('结构相同但**新建**的对象（快照被序列化过）不重复施加：restart 的床轨不会每帧回零', () => {
    const first = cmd({ ref: 'bgm-battle', restart: true })
    const { rerender } = render(<BgmPlayer bgm={first} resolveAsset={resolve} />)
    const el = active()
    el.currentTime = 7
    for (let i = 0; i < 3; i++) {
      rerender(<BgmPlayer bgm={JSON.parse(JSON.stringify(first)) as BgmSnapshot} resolveAsset={resolve} />)
      expect(active()).toBe(el)
      expect(el.currentTime).toBe(7)
    }
  })

  // 反面：字段全同但**序号变了** = 引擎真的又发了一条（回合循环里每轮那条重开指令）。
  it('引擎又发了一条逐字段相同的重开指令 → 照常从头播', () => {
    const first = cmd({ ref: 'bgm-battle', restart: true })
    const { rerender } = render(<BgmPlayer bgm={first} resolveAsset={resolve} />)
    const el = active()
    el.currentTime = 7
    rerender(<BgmPlayer bgm={{ ...first, seq: first.seq + 1 }} resolveAsset={resolve} />)
    expect(active()).toBe(el)
    expect(el.currentTime).toBe(0)
  })

  it('停播令（ref:null）暂停并清 src——不是「静音但继续播」', () => {
    const { rerender } = render(<BgmPlayer bgm={cmd()} resolveAsset={resolve} />)
    const el = active()
    rerender(
      <BgmPlayer bgm={cmd({ ref: null, volume: 0, fadeInMs: 0, loop: false, restart: false })} resolveAsset={resolve} />,
    )
    expect(el.paused).toBe(true)
    expect(el.getAttribute('src')).toBeNull()
    expect(decks()).toHaveLength(0)
  })

  it('停播的 fadeOutMs 真的淡出：淡完才停', () => {
    vi.useFakeTimers()
    const { rerender } = render(<BgmPlayer bgm={cmd()} resolveAsset={resolve} />)
    const el = active()
    rerender(
      <BgmPlayer bgm={cmd({ ref: null, volume: 0, fadeOutMs: 400, loop: false, restart: false })} resolveAsset={resolve} />,
    )

    expect(el.paused).toBe(false) // 还在响
    vi.advanceTimersByTime(200)
    expect(el.volume).toBeGreaterThan(0)
    expect(el.volume).toBeLessThan(1)
    vi.advanceTimersByTime(200)
    expect(el.paused).toBe(true)
    expect(decks()).toHaveLength(0)
  })

  it('换轨 = 交叉淡变：旧轨吃 fadeOutMs，新轨吃 fadeInMs', () => {
    vi.useFakeTimers()
    const { rerender } = render(<BgmPlayer bgm={cmd({ ref: 'bgm-battle' })} resolveAsset={resolve} />)
    const battle = active()

    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-story', fadeOutMs: 400, fadeInMs: 400 })} resolveAsset={resolve} />)
    const story = active()
    expect(story).not.toBe(battle)
    expect(story.volume).toBe(0)
    expect(battle.volume).toBe(1)
    expect(decks()).toHaveLength(2) // 两条同时在线才叫交叉淡变

    vi.advanceTimersByTime(200)
    expect(battle.volume).toBeLessThan(1)
    expect(battle.volume).toBeGreaterThan(0)
    expect(story.volume).toBeGreaterThan(0)

    vi.advanceTimersByTime(200)
    expect(story.volume).toBe(1)
    expect(battle.paused).toBe(true)
    expect(decks()).toEqual([story])
  })

  it('同曲在淡出期间又回来：不叠两份（别听出重影）', () => {
    vi.useFakeTimers()
    const { rerender } = render(<BgmPlayer bgm={cmd({ ref: 'bgm-story' })} resolveAsset={resolve} />)
    const firstStory = active()

    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-battle', fadeOutMs: 800 })} resolveAsset={resolve} />)
    expect(decks()).toHaveLength(2) // story 正在淡出

    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-story' })} resolveAsset={resolve} />)
    expect(decks().filter((el) => el.getAttribute('src')!.endsWith('bgm-story'))).toHaveLength(1)
    expect(firstStory.getAttribute('src')).toBeNull() // 淡出那份已即刻下线
  })

  it('解析不到 url 时保持原床轨并出声警告（别哑着换成静音）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { rerender } = render(<BgmPlayer bgm={cmd({ ref: 'bgm-battle' })} resolveAsset={resolve} />)
    const el = active()
    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-missing' })} resolveAsset={() => undefined} />)
    expect(active()).toBe(el)
    expect(el.getAttribute('src')).toBe('/__gva__/media/bgm-battle')
    expect(warn).toHaveBeenCalled()
  })

  it('卸载即收摊：引擎在 ended 不发停播，漏音由壳层生命周期兜', () => {
    const { unmount } = render(<BgmPlayer bgm={cmd()} resolveAsset={resolve} />)
    const el = active()
    unmount()
    expect(el.paused).toBe(true)
    expect(decks()).toHaveLength(0)
  })

  it('试玩进入 ended 时立即关闭 BGM', () => {
    const same = cmd()
    const { rerender } = render(<BgmPlayer bgm={same} resolveAsset={resolve} active />)
    const el = active()
    rerender(<BgmPlayer bgm={same} resolveAsset={resolve} active={false} />)
    expect(el.paused).toBe(true)
    expect(decks()).toHaveLength(0)
  })

  it('自动播放被拒：不抛、只喊一声，首个用户手势后重试', async () => {
    const blocked = Object.assign(new Error('autoplay blocked'), { name: 'NotAllowedError' })
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockRejectedValue(blocked)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { rerender } = render(<BgmPlayer bgm={cmd()} resolveAsset={resolve} />)
    rerender(<BgmPlayer bgm={cmd({ ref: 'bgm-battle' })} resolveAsset={resolve} />)
    await flush()

    expect(warn).toHaveBeenCalledTimes(1) // 两条指令、两次被拒，只喊一声
    const callsBeforeGesture = play.mock.calls.length
    window.dispatchEvent(new Event('pointerdown'))
    await flush()
    expect(play.mock.calls.length).toBeGreaterThan(callsBeforeGesture)
  })
})
