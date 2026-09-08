import { describe, expect, it } from 'vitest'
import { BgmStack, DOC_BGM_OWNER, type BgmApplyInput } from '../core/engine/bgm-stack'
import type { DocumentBgm, NodeBgm } from '../core/schema/graph-schema'

const DOC = DOC_BGM_OWNER

describe('BgmStack.apply — push', () => {
  it('文档床压栈：owner __doc__ 成栈顶，命令带上补齐后的默认值', () => {
    const s = new BgmStack()
    const cmd = s.apply({ owner: DOC, ref: 'bgm-story' })

    expect(s.top()?.owner).toBe(DOC)
    expect(s.frames()).toHaveLength(1)
    expect(cmd).toEqual({
      ref: 'bgm-story',
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      loop: true,
      // 从静音起播 = 换曲，必须从头
      restart: true,
    })
  })

  it('显式字段覆盖默认值，并原样落进帧', () => {
    const s = new BgmStack()
    const cmd = s.apply({
      owner: 'combat',
      ref: 'bgm-battle',
      volume: 0.6,
      fadeInMs: 800,
      fadeOutMs: 600,
      loop: false,
    })

    expect(cmd.volume).toBe(0.6)
    expect(cmd.fadeInMs).toBe(800)
    expect(cmd.loop).toBe(false)
    expect(s.top()).toEqual({
      owner: 'combat',
      ref: 'bgm-battle',
      volume: 0.6,
      fadeInMs: 800,
      fadeOutMs: 600,
      restart: false,
      loop: false,
    })
  })

  it('帧上不再记 mode：v2 里没人问「这层当初是 push 还是 replace」', () => {
    const s = new BgmStack()
    s.apply({ owner: 'combat', ref: 'bgm-battle', mode: 'replace' })
    expect(s.top()).not.toHaveProperty('mode')
  })

  it('push 加深栈；换曲的命令 restart === true', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    const cmd = s.apply({ owner: 'combat', ref: 'bgm-battle' })

    expect(s.frames()).toHaveLength(2)
    expect(s.top()?.owner).toBe('combat')
    expect(cmd.ref).toBe('bgm-battle')
    expect(cmd.restart).toBe(true)
  })

  it('新曲没配置音量时继承当前音量，显式音量才覆盖', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story', volume: 0.35 })
    expect(s.apply({ owner: 'combat', ref: 'bgm-battle' }).volume).toBe(0.35)
    expect(s.apply({ owner: 'boss', ref: 'bgm-boss', volume: 0.8 }).volume).toBe(0.8)
  })

  it('不改写入参对象（getNodeBgm 返回的是落盘活对象）', () => {
    const s = new BgmStack()
    const nodeBgm: NodeBgm = { ref: 'bgm-battle', fadeInMs: 800 }
    // 引擎那侧也是这样摊平的：`mode: 'stop'` 早分流去了 `stop()`，到这儿 ref 必有。
    const input: BgmApplyInput = { owner: 'combat', ref: nodeBgm.ref!, fadeInMs: nodeBgm.fadeInMs }
    s.apply(input)

    expect(nodeBgm).toEqual({ ref: 'bgm-battle', fadeInMs: 800 })
    expect(input).toEqual({ owner: 'combat', ref: 'bgm-battle', fadeInMs: 800 })
    expect(s.top()).not.toBe(input)
  })
})

describe('BgmStack.apply — replace', () => {
  it('replace 换栈顶不加深栈', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'combat', ref: 'bgm-battle' })
    const cmd = s.apply({ owner: 'combat', ref: 'bgm-boss', mode: 'replace' })

    expect(s.frames()).toHaveLength(2)
    expect(s.top()?.ref).toBe('bgm-boss')
    expect(cmd.ref).toBe('bgm-boss')
    expect(cmd.restart).toBe(true)
  })

  it('replace 换曲不换层主：这一层仍归开它的那个作用域（D8「同场切 BOSS 曲」）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'bp-combat::enter', ref: 'bgm-battle' })
    // 包内 boss 节点同场切曲：换的是曲子，不是 enter 开的那一层
    s.apply({ owner: 'bp-combat::boss', ref: 'bgm-boss', mode: 'replace', fadeOutMs: 900 })

    expect(s.frames()).toHaveLength(2)
    expect(s.frames().map((f) => f.owner)).toEqual([DOC, 'bp-combat::enter'])
    expect(s.top()?.ref).toBe('bgm-boss')

    // 一条 stop 就收掉这一层（不是两层）：叙事床按 BOSS 曲自己的 900 淡出后回来
    const cmd = s.stop()
    expect(cmd?.ref).toBe('bgm-story')
    expect(cmd?.fadeOutMs).toBe(900)
    expect(s.frames()).toHaveLength(1)
  })

  it('空栈上 replace 退化成 push（无栈顶可换，深度 0 → 1，入参 owner 成层主）', () => {
    const s = new BgmStack()
    const cmd = s.apply({ owner: 'combat', ref: 'bgm-battle', mode: 'replace' })

    expect(s.frames()).toHaveLength(1)
    expect(s.top()?.ref).toBe('bgm-battle')
    expect(s.top()?.owner).toBe('combat')
    expect(cmd.ref).toBe('bgm-battle')
    // 退化成 push 后这层确实存在，可被 stop 弹掉（不是静默丢弃）
    expect(s.stop()?.ref).toBeNull()
  })

  it('栈顶是文档床时 replace 也退化成 push：地板改不动，之后 stop 回得到原床轨（D13）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story', fadeOutMs: 1200 })
    // 作者在战斗入口选了「换曲，不记住上一首」——地板不是他要换掉的那一层
    const cmd = s.apply({ owner: 'g::enter', ref: 'bgm-battle', mode: 'replace', fadeOutMs: 600 })

    expect(cmd).toMatchObject({ ref: 'bgm-battle', fadeOutMs: 1200, restart: true })
    expect(s.frames().map((f) => f.owner)).toEqual([DOC, 'g::enter'])
    expect(s.frames()[0]?.ref).toBe('bgm-story') // 地板原样
    // 若 replace 就地改写了地板，这条 stop 会返回 null，整局再也结束不掉战斗床
    expect(s.stop()).toMatchObject({ ref: 'bgm-story', fadeOutMs: 600, restart: true })
    expect(s.frames().map((f) => f.owner)).toEqual([DOC])
  })

  it('地板之上的 replace 照旧换栈顶不加深栈（退化只发生在「栈顶就是地板」那一刻）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'g::enter', ref: 'bgm-battle', mode: 'replace' })
    s.apply({ owner: 'g::boss', ref: 'bgm-boss', mode: 'replace' })

    expect(s.frames()).toHaveLength(2)
    expect(s.frames().map((f) => f.owner)).toEqual([DOC, 'g::enter'])
  })

  it('退化出来的那层是货真价实的一层：stop 收得掉，也退得回地板', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'bp-combat::enter', ref: 'bgm-battle', mode: 'replace', fadeOutMs: 600 })

    expect(s.top()?.owner).toBe('bp-combat::enter')
    expect(s.stop()).toMatchObject({ ref: 'bgm-story', fadeOutMs: 600 })
    expect(s.frames().map((f) => f.owner)).toEqual([DOC])
  })
})

describe('BgmStack.setVolume', () => {
  it('只改当前栈顶音量，不换曲、不重开、不加深栈', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story', volume: 0.8, fadeInMs: 500 })
    const cmd = s.setVolume(0.35)

    expect(s.frames()).toHaveLength(1)
    expect(s.top()).toMatchObject({ owner: DOC, ref: 'bgm-story', volume: 0.35, fadeInMs: 500 })
    expect(cmd).toEqual({ ref: 'bgm-story', volume: 0.35, fadeInMs: 0, fadeOutMs: 0, loop: true, restart: false })
  })

  it('栈空或音量相同均为无操作', () => {
    const s = new BgmStack()
    expect(s.setVolume(0.4)).toBeNull()
    s.apply({ owner: DOC, ref: 'bgm-story', volume: 0.4 })
    expect(s.setVolume(0.4)).toBeNull()
  })

  it('上层结束后恢复到下层调整过的音量', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.setVolume(0.45)
    s.apply({ owner: 'combat', ref: 'bgm-battle' })
    expect(s.stop()).toMatchObject({ ref: 'bgm-story', volume: 0.45 })
  })
})

describe('BgmStack — 续播（同 ref 不重开）', () => {
  it('同 ref 再 push：restart false → 命令 restart === false', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    const cmd = s.apply({ owner: 'n_open', ref: 'bgm-story' })

    expect(cmd.ref).toBe('bgm-story')
    expect(cmd.restart).toBe(false)
    expect(s.frames()).toHaveLength(2)
  })

  it('同 ref 再 push：显式 restart true → 命令 restart === true', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    const cmd = s.apply({ owner: 'n_open', ref: 'bgm-story', restart: true })

    expect(cmd.restart).toBe(true)
  })

  it('同 ref replace 也续播（换音量不重开），且不改层主', () => {
    const s = new BgmStack()
    s.apply({ owner: 'combat', ref: 'bgm-battle' })
    const cmd = s.apply({ owner: 'n_boss', ref: 'bgm-battle', mode: 'replace', volume: 0.5 })

    expect(cmd.restart).toBe(false)
    expect(cmd.volume).toBe(0.5)
    expect(s.top()?.owner).toBe('combat')
  })

  it('replace 换曲但没配置音量时保留当前音量', () => {
    const s = new BgmStack()
    s.apply({ owner: 'combat', ref: 'bgm-battle', volume: 0.4 })
    const cmd = s.apply({ owner: 'boss', ref: 'bgm-boss', mode: 'replace' })
    expect(cmd.volume).toBe(0.4)
    expect(s.top()?.volume).toBe(0.4)
  })

})

describe('BgmStack.stop — mode: stop（结束当前层，回到上一层未结束的）', () => {
  it('弹掉栈顶，回到下面那层还没结束的那首', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'g::enter', ref: 'bgm-battle', fadeOutMs: 600 })

    const cmd = s.stop()
    expect(cmd?.ref).toBe('bgm-story')
    expect(cmd?.fadeOutMs).toBe(600)
    expect(s.frames().map((f) => f.owner)).toEqual([DOC])
  })

  it('连着 stop：一层层回到更早那首（BGM3 → BGM2 → BGM1）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-1' })
    s.apply({ owner: 'g::a', ref: 'bgm-2' })
    s.apply({ owner: 'g::b', ref: 'bgm-3' })

    expect(s.stop()?.ref).toBe('bgm-2')
    expect(s.stop()?.ref).toBe('bgm-1')
    expect(s.frames()).toHaveLength(1)
  })

  it('文档床是地板：栈顶是 __doc__ 时 stop 不弹、不发指令（D13）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })

    expect(s.stop()).toBeNull()
    expect(s.frames()).toHaveLength(1)
    expect(s.top()?.ref).toBe('bgm-story')
    // 反复 stop 依然弹不动它
    expect(s.stop()).toBeNull()
    expect(s.frames()).toHaveLength(1)
  })

  it('空栈 stop → null（无指令）', () => {
    const s = new BgmStack()
    expect(s.stop()).toBeNull()
    expect(s.frames()).toHaveLength(0)
  })

  it('没有文档床时 stop 到空栈 → 停播指令（ref null，带离场帧的 fadeOutMs）', () => {
    const s = new BgmStack()
    s.apply({ owner: 'g::combat', ref: 'bgm-battle', fadeOutMs: 600 })

    expect(s.stop()).toEqual({
      ref: null,
      volume: 0,
      fadeInMs: 0,
      fadeOutMs: 600,
      loop: false,
      restart: false,
    })
    expect(s.top()).toBeUndefined()
  })

  it('stop 回到同 ref 的下层帧 → 续播，不重开', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'g::n_open', ref: 'bgm-story' })

    expect(s.stop()).toMatchObject({ ref: 'bgm-story', restart: false })
  })

  it('下层帧自己的 restart 标记不会在 stop 回来时再触发重开', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story', restart: true })
    s.apply({ owner: 'g::n_open', ref: 'bgm-story' })

    expect(s.stop()?.restart).toBe(false)
  })

  it('stop 换曲 → restart true', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'g::combat', ref: 'bgm-battle' })

    expect(s.stop()?.restart).toBe(true)
  })
})

describe('BgmStack — 交叉淡入淡出取值', () => {
  it('fadeOutMs 来自离场帧、fadeInMs/volume/loop 来自将响的帧', () => {
    const doc: DocumentBgm = { ref: 'bgm-story', volume: 0.7, fadeInMs: 1200, loop: true }
    const battle: NodeBgm = { ref: 'bgm-battle', fadeInMs: 800, fadeOutMs: 600 }

    const s = new BgmStack()
    s.apply({ owner: DOC, ...doc })
    const enter = s.apply({ owner: 'g::combat', ref: battle.ref!, fadeInMs: battle.fadeInMs, fadeOutMs: battle.fadeOutMs })
    // 进战斗：新曲淡入 800；旧曲（doc 未配 fadeOutMs）立即让位
    expect(enter.fadeInMs).toBe(800)
    expect(enter.fadeOutMs).toBe(0)

    const leave = s.stop()
    // 出战斗：战斗曲按自己的 600 淡出，床轨按自己的 1200 淡入
    expect(leave?.fadeOutMs).toBe(600)
    expect(leave?.fadeInMs).toBe(1200)
    expect(leave?.volume).toBe(0.7)
  })
})

describe('BgmStack.clear', () => {
  it('清空并返回停播指令（清局路径；连文档床一起清）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.apply({ owner: 'g::combat', ref: 'bgm-battle', fadeOutMs: 600 })

    const cmd = s.clear()
    expect(cmd.ref).toBeNull()
    expect(cmd.fadeOutMs).toBe(600)
    expect(s.frames()).toHaveLength(0)
    expect(s.top()).toBeUndefined()
    expect(s.stop()).toBeNull()
  })

  it('空栈 clear 幂等，仍返回停播指令', () => {
    const s = new BgmStack()
    const cmd = s.clear()
    expect(cmd.ref).toBeNull()
    expect(cmd.fadeOutMs).toBe(0)
    expect(s.frames()).toHaveLength(0)
  })

  it('clear 后重新起播视为换曲（restart true）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    s.clear()
    expect(s.apply({ owner: DOC, ref: 'bgm-story' }).restart).toBe(true)
  })
})

describe('BgmStack — 快照隔离', () => {
  it('frames() 是快照，后续压栈不改已取到的数组', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    const snap = s.frames()
    s.apply({ owner: 'combat', ref: 'bgm-battle' })

    expect(snap).toHaveLength(1)
    expect(s.frames()).toHaveLength(2)
  })

  it('改不动交出去的帧（冻结）', () => {
    const s = new BgmStack()
    s.apply({ owner: DOC, ref: 'bgm-story' })
    const frame = s.top()!
    expect(() => {
      ;(frame as { ref: string }).ref = 'hacked'
    }).toThrow()
    expect(s.top()?.ref).toBe('bgm-story')
  })
})
