/**
 * `bgm` directive → SessionSnapshot.bgm 的传输层行为：床轨是**会话级**的，
 * 不随 playClip / overlay 清理；「从未播」与「停播」必须能分开读。
 */
import { describe, expect, it } from 'vitest'
import { GraphSession } from '../core/engine/session'
import type { RuntimeDirective } from '../core/engine/directives'
import { node, scnOf } from './test-fixtures'

/** 单节点图：本测只关心 session 怎么消费 directive，不需要引擎跑流程。 */
function newSession(): GraphSession {
  return new GraphSession(scnOf({ nodes: [node('n1', { durationMs: 100 })], edges: [] }))
}

/**
 * 替掉 runtime 的产出，让任意一条 directive 走 session 的公开路径。
 * 本文件只钉传输层（directive → 快照）：引擎在哪些钩子上发这些指令由 `engine.bgm.test.ts` 钉，
 * 所以这里刻意不跑真图 —— 「从未播」与「显式停播」这两种快照要能单独构造出来。
 */
function feed(s: GraphSession, dirs: RuntimeDirective[]) {
  s.runtime.tick = () => dirs
  return s.tick(0)
}

const PLAY_BATTLE: RuntimeDirective = {
  type: 'bgm',
  ref: 'bgm-battle',
  volume: 0.8,
  fadeInMs: 500,
  fadeOutMs: 0,
  loop: true,
  restart: true,
}

describe('SessionSnapshot bgm（会话级床轨）', () => {
  it('开局为 null —— 「还没发过 bgm 指令」不是停播令', () => {
    expect(newSession().start().bgm).toBeNull()
  })

  it('bgm 指令落到快照，载荷 = 播放命令（不带 type tag）+ 指令序号', () => {
    const s = newSession()
    s.start()
    const snap = feed(s, [PLAY_BATTLE])
    expect(snap.bgm).toEqual({
      ref: 'bgm-battle',
      volume: 0.8,
      fadeInMs: 500,
      fadeOutMs: 0,
      loop: true,
      restart: true,
      seq: 1,
    })
  })

  // `seq` 是壳层分辨「引擎又发了一条」的唯一凭据：逐字段相同的两条重开指令（回合循环里
  // 每轮都发一条）必须看得出是两次，否则 BgmPlayer 的去重会把第二次吃掉（见 BgmSnapshot）。
  it('每条 bgm 指令的 seq 递增，字段全同的两条也分得开', () => {
    const s = newSession()
    s.start()
    expect(feed(s, [PLAY_BATTLE]).bgm?.seq).toBe(1)
    expect(feed(s, [{ type: 'hudUpdate', nodeId: 'n1' }]).bgm?.seq).toBe(1) // 没发指令 → 不动
    const { seq, ...fields } = feed(s, [PLAY_BATTLE]).bgm!
    expect(seq).toBe(2)
    expect(fields).toEqual({ ref: 'bgm-battle', volume: 0.8, fadeInMs: 500, fadeOutMs: 0, loop: true, restart: true })
  })

  it('后续 playClip 清叠层但不清床轨', () => {
    const s = newSession()
    s.start()
    feed(s, [
      PLAY_BATTLE,
      { type: 'renderOverlay', nodeId: 'n1', elementId: 'e1', component: 'floatText', inputs: {} },
    ])
    const snap = feed(s, [{ type: 'playClip', nodeId: 'n2', name: '下一节点', loop: false }])
    expect(snap.overlayMounts).toEqual([]) // 节点级：换节点就清
    expect(snap.bgm?.ref).toBe('bgm-battle') // 会话级：留着，等下一条 bgm 指令
  })

  it('停播（ref: null）与从未播可区分：快照非 null，只有 fadeOutMs 有意义', () => {
    const s = newSession()
    s.start()
    feed(s, [PLAY_BATTLE])
    const snap = feed(s, [
      { type: 'bgm', ref: null, volume: 0, fadeInMs: 0, fadeOutMs: 800, loop: false, restart: false },
    ])
    expect(snap.bgm).not.toBeNull()
    expect(snap.bgm?.ref).toBeNull()
    expect(snap.bgm?.fadeOutMs).toBe(800)
  })

  // 床轨的失败样子是「没声」/「点了结束没反应」，节点流水看不出所以然，日志是唯一线索。
  // 尤其要分得开「续播」和「起播」：战斗多回合不断曲，靠的就是 restart: false。
  it('每条 bgm 指令都写一行运行日志：起播 / 续播 / 停播', () => {
    const s = newSession()
    s.start()
    expect(feed(s, [PLAY_BATTLE]).log.at(-1)).toBe('♪ 起播 bgm-battle')
    expect(feed(s, [{ ...PLAY_BATTLE, restart: false }]).log.at(-1)).toBe('♪ 续播 bgm-battle')
    expect(
      feed(s, [{ type: 'bgm', ref: null, volume: 0, fadeInMs: 0, fadeOutMs: 800, loop: false, restart: false }])
        .log.at(-1),
    ).toBe('♪ 停播')
  })

  it('每次返回的新快照引用都带同一份床轨（React 重渲染后仍读得到）', () => {
    const s = newSession()
    s.start()
    const a = feed(s, [PLAY_BATTLE])
    const b = feed(s, [{ type: 'hudUpdate', nodeId: 'n1' }])
    expect(b).not.toBe(a)
    expect(b.bgm?.ref).toBe('bgm-battle')
    expect(b.bgm).toEqual(a.bgm)
    // 且是**同一个对象**：只有新的 bgm 指令才换掉它（`cloned()` 是浅拷贝）。这条读作
    // 「这一步压根没发指令」，`bgm.acceptance.test.ts` 的「多回合不重开」整行就靠它表达。
    // 壳层的去重**不**依赖这条引用同一性（它比的是字段 + `seq`，见 BgmPlayer）。
    expect(b.bgm).toBe(a.bgm)
  })
})
