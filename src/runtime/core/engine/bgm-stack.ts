/**
 * BGM 作用域栈（会话级纯数据结构；无 I/O、无定时器、无音频 API）。
 *
 * 语义 SSOT：`docs/superpowers/specs/2026-07-24-bgm-runtime-scope-stack-design.md` §4.1/§4.2。
 * 一句话：**配了就一直播**。`apply` 压一层就一直响下去，**离开那个节点不是结束信号**；
 * 栈顶帧 = 此刻该响的那条。结束只有两个出口：`stop()`（作者在某节点写 `mode: 'stop'`）、
 * `clear()`（清局）。`callStack` 弹帧/清空一律不动这个栈。
 *
 * 与引擎的分工：引擎只在生命周期检查点上调这三个方法，把返回的 command 转成 directive 交给壳层播。
 * 「什么也别做」一律用 `null` 表达（不是空指令）——绝大多数检查点与 BGM 无关，靠这条保持安静。
 */
import type { AudioRef } from '../schema/graph-schema'

/** 文档默认床轨那一层的 owner（栈底地板，`stop` 弹不掉它，见 D13）。 */
export const DOC_BGM_OWNER = '__doc__'

/**
 * `'__doc__'` = 文档默认床轨；其余 = 开这层作用域的节点，形状 `` `${blueprintId}::${nodeId}` ``。
 * 带蓝图前缀是硬要求：nodeId 只在单张蓝图内唯一，跨图同名节点若共用 owner 会互认对方的层
 * （见 `engine.ts` 的 `bgmOwner`）。本类只做字符串相等匹配，不解析这个形状。
 */
export type BgmOwner = typeof DOC_BGM_OWNER | string

/**
 * 栈帧 = 一层作用域的完整播放意图（默认值已补齐）。运行时 `Object.freeze` 过，
 * 故字段全 `readonly`——想让类型和运行时说同一件事，别让 `frame.volume = .5` 过了
 * 编译却在跑时抛 TypeError。要改就 `apply` 一层新的。
 *
 * `owner` = **开这层的那个作用域**，不是最后一次改曲的节点（见 `apply` 的 replace 说明）。
 */
export interface BgmStackFrame {
  readonly owner: BgmOwner
  readonly ref: AudioRef
  readonly volume: number
  readonly fadeInMs: number
  readonly fadeOutMs: number
  readonly restart: boolean
  readonly loop: boolean
}

/** `apply` 入参：`DocumentBgm` / `NodeBgm` 补个 owner 即可直接展开传入。 */
export interface BgmApplyInput {
  owner: BgmOwner
  ref: AudioRef
  /** 默认 'push'；'replace' 换栈顶不加深栈。`NodeBgm` 的 `'stop'` 不走这里，走 `stop()`。 */
  mode?: 'push' | 'replace'
  /** 0..1，默认 1。 */
  volume?: number
  fadeInMs?: number
  fadeOutMs?: number
  /** 同 ref 再次成为栈顶时是否从头播；默认 false = 续播（回合循环友好）。 */
  restart?: boolean
  /** 默认 true——床轨都是循环垫；文档床可显式关掉。`NodeBgm` 无此字段，故节点恒为 true。 */
  loop?: boolean
}

/**
 * 给壳层的「当前应播什么」。
 *
 * - `ref: null` = 停播（栈空）。此时其余字段钉死成
 *   `volume: 0` / `fadeInMs: 0` / `loop: false` / `restart: false`，只有 `fadeOutMs` 有效
 *   （= 离场帧的淡出时长）：语义就是「把正响的那条在 fadeOutMs 内淡到 0」。壳层读到
 *   `ref === null` 应只看 `fadeOutMs`，别拿 `volume: 0` 当「静音但继续播」。
 * - `fadeOutMs` 描述**正在响的那条**怎么淡出（取自离场帧），`ref`/`volume`/`fadeInMs`/`loop`
 *   描述**将要响的那条**（取自新栈顶）——一条指令即一次交叉淡变。于是作者写在
 *   `combat.data.bgm.fadeOutMs` 上的值恰好在那一层结束的那一刻生效。
 * - `restart: true` = 必须从头解码播放；`false` = 同 ref 续播，壳层别碰播放头。
 */
export interface BgmPlaybackCommand {
  ref: AudioRef | null
  volume: number
  fadeInMs: number
  fadeOutMs: number
  loop: boolean
  restart: boolean
}

/** 补齐默认值 + 冻结，产出一帧；`owner` 由调用方决定（replace 时沿用旧帧的）。 */
function normalizeFrame(input: BgmApplyInput, owner: BgmOwner, inheritedVolume = 1): BgmStackFrame {
  // 入参可能是 getNodeBgm 返回的落盘活对象，只读不改，另起新帧。
  return Object.freeze({
    owner,
    ref: input.ref,
    volume: input.volume ?? inheritedVolume,
    fadeInMs: input.fadeInMs ?? 0,
    fadeOutMs: input.fadeOutMs ?? 0,
    restart: input.restart ?? false,
    loop: input.loop ?? true,
  })
}

export class BgmStack {
  private readonly stack: BgmStackFrame[] = []

  /**
   * 起播一层：这层从此一直响，直到 `stop()` / `clear()` 结束它。
   *
   * - `mode: 'push'`（默认）：压新帧，栈加深一层，`input.owner` 成为这层的主。
   * - `mode: 'replace'`：只换栈顶帧的**播放字段**（ref / 音量 / 淡变 / loop），栈深不变，
   *   **这层的 `owner` 保持不变**（同场切 BOSS 曲：换的是曲子，不是这段作用域）。
   *   §4.2 里引擎恒以「挂 `data.bgm` 的那个节点」为 owner 调 `apply`，所以 replace 几乎总是
   *   来自另一个节点；若让它顺手改写 owner，回合循环里那个「自己那层已在栈顶」的防叠层守卫
   *   就会认错人，一轮压一层地无界增长（见 `engine.ts` 的 `applyNodeBgm`）。
   * - **没有可换的栈顶时 replace 退化成 push**（深度 +1，`input.owner` 成为层主）。两种情形：
   *   栈空（没有栈顶）、以及**栈顶就是文档床**（`__doc__` 是地板，D13：`stop` 弹不掉它）。
   *   后者尤其要命：就地改写地板会把战斗曲写成 `owner: '__doc__'` 的那一帧，于是 `stop()`
   *   在 `:156` 就地返回 `null`——作者后面写的「结束当前音乐」变成静默 no-op，
   *   `unwindBgmToDocBed` 也再没有原床轨可退，整局的地板从此是战斗曲。两次普通面板操作
   *   （配 `scenario.bgm` + 在战斗入口选「换曲，不记住上一首」）就能走到。
   *   空栈那条同理：语义上唯一说得通的是「让它响起来」；静默丢弃 = 作者把 mode 从 push
   *   改成 replace 就整段没声，属于难查的哑失败。
   *
   * 续播：新栈顶 ref 与此刻正响的 ref 相同时，command 的 `restart` 为 `false`——
   * 除非本次入参显式 `restart: true`。换曲（含从静音起播）必然 `restart: true`。
   */
  apply(input: BgmApplyInput): BgmPlaybackCommand {
    const sounding = this.top()
    const replacesTop = input.mode === 'replace' && sounding !== undefined && sounding.owner !== DOC_BGM_OWNER
    // replace 换曲不换层主：这一层仍归开它的那个作用域。
    const frame = replacesTop
      ? normalizeFrame(input, sounding.owner, sounding.volume)
      : normalizeFrame(input, input.owner, sounding?.volume)
    if (replacesTop) this.stack[this.stack.length - 1] = frame
    else this.stack.push(frame)
    return {
      ref: frame.ref,
      volume: frame.volume,
      fadeInMs: frame.fadeInMs,
      fadeOutMs: sounding?.fadeOutMs ?? 0,
      loop: frame.loop,
      restart: frame.restart || sounding?.ref !== frame.ref,
    }
  }

  /**
   * 不换曲、不新建层，只调整当前栈顶音量。栈空或音量未变化时没有播放指令。
   * 更新后的音量写回栈帧，因此被上层曲目盖住再恢复时仍保持该值。
   */
  setVolume(volume: number): BgmPlaybackCommand | null {
    const sounding = this.top()
    if (!sounding || sounding.volume === volume) return null
    const frame = Object.freeze({ ...sounding, volume })
    this.stack[this.stack.length - 1] = frame
    return {
      ref: frame.ref,
      volume: frame.volume,
      fadeInMs: 0,
      fadeOutMs: 0,
      loop: frame.loop,
      restart: false,
    }
  }

  /**
   * 作者在某节点写了 `mode: 'stop'`：结束**当前这层**，回到上一层还没结束的那首。
   * 与 owner 无关——`stop` 是就近显式表达，写它的节点通常压根没开过层（§6.1 的 `win`/`lose`）。
   *
   * 文档床是地板（D13）：栈顶已是 `'__doc__'`（或栈空）时返回 `null` = 一条指令都不发。
   * 想静音起局就别配 `doc.bgm`；把地板也弹掉的话，「多写一个 stop」就会让整局哑掉，且再没有
   * 任何配置能把床轨请回来（`unwindBgmToDocBed` 的默认分支只保底不重建）。
   *
   * 回到下层帧时 `restart` 只看 ref 变没变：`restart` 是起播那一刻的意图，已在 `apply`
   * 时兑现过，不在恢复时二次触发——否则一个 `restart: true` 的下层帧会在每次上层结束时
   * 把已经响着的同一段曲子拽回开头。
   */
  stop(): BgmPlaybackCommand | null {
    const leaving = this.top()
    if (!leaving || leaving.owner === DOC_BGM_OWNER) return null
    this.stack.pop()
    return this.resume(leaving)
  }

  /** 清空整栈并停播（清局 / reset）。空栈调用幂等，仍返回一条停播指令。 */
  clear(): BgmPlaybackCommand {
    const leaving = this.top()
    this.stack.length = 0
    return this.resume(leaving)
  }

  /** 此刻该响的那一帧；栈空 = 静音。 */
  top(): BgmStackFrame | undefined {
    return this.stack[this.stack.length - 1]
  }

  /** 栈快照（底 → 顶）；调用后再压栈不影响已取到的数组。 */
  frames(): readonly BgmStackFrame[] {
    return [...this.stack]
  }

  /** 编辑器时间轴回放恢复用；只恢复内存态，不发播放指令。 */
  restore(frames: readonly BgmStackFrame[]): void {
    this.stack.splice(0, this.stack.length, ...frames.map((frame) => Object.freeze({ ...frame })))
  }

  /** 结束若干层后「回到新栈顶」（或栈空则停播）的指令；`leaving` 只贡献淡出时长。 */
  private resume(leaving: BgmStackFrame | undefined): BgmPlaybackCommand {
    const fadeOutMs = leaving?.fadeOutMs ?? 0
    const restored = this.top()
    if (!restored) return { ref: null, volume: 0, fadeInMs: 0, fadeOutMs, loop: false, restart: false }
    return {
      ref: restored.ref,
      volume: restored.volume,
      fadeInMs: restored.fadeInMs,
      fadeOutMs,
      loop: restored.loop,
      restart: leaving?.ref !== restored.ref,
    }
  }
}
