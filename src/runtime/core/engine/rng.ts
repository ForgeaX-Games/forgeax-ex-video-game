/**
 * 可复现伪随机（seeded PRNG）—— mulberry32。
 *
 * 为什么需要它：游戏要随机（暴击 / 闪避 / 加权分支 / 随机结算），但引擎必须能
 * **回放、可视化、单测**——所以随机绝不能用 `Math.random()`，而是由「种子 seed +
 * 步进计数 step」完全决定：同一个 seed + 同一串调用序列 ⇒ 同一串结果。
 *
 * 状态 `{ seed, step }` 可序列化，随 RuntimeState 存档 / 落 json，保证：
 *   - 同一份 scenarios.json + 同一 seed 每次跑出的随机走向一致（可复现）；
 *   - 调试时把 seed 固定，就能稳定重现某条"随机走出来"的路径。
 */
export interface RngState {
  seed: number
  /** 已抽取次数；决定下一个数，故序列化它即可精确恢复序列。 */
  step: number
}

export interface Rng {
  /** 返回 [0, 1) 的浮点，并步进。 */
  next(): number
  /** 闭区间整数 [min, max]。 */
  randInt(min: number, max: number): number
  /** 以概率 p (0~1) 返回 true。 */
  chance(p: number): boolean
  getState(): RngState
  setState(s: RngState): void
}

/**
 * mulberry32：把一个 32bit 整数种子散列成 [0,1) 浮点。纯函数、无外部状态，
 * 便于用 (seed + step*黄金比) 直接寻址第 N 个随机数，天然可复现。
 */
function mulberry32(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function createRng(seed: number, step = 0): Rng {
  const state: RngState = { seed: seed | 0, step: step | 0 }
  const next = (): number => {
    // 用 seed + step*黄金比常数 派生第 step 个随机数；step 单调递增。
    const v = mulberry32((state.seed + Math.imul(state.step, 0x9e3779b9)) | 0)
    state.step = (state.step + 1) | 0
    return v
  }
  return {
    next,
    randInt: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    getState: () => ({ ...state }),
    setState: (s) => {
      state.seed = s.seed | 0
      state.step = s.step | 0
    },
  }
}
