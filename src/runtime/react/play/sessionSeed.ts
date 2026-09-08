/** 为一次新的玩家会话生成 32 位随机种子；状态机本身仍只消费显式 seed。 */
export function createSessionSeed(): number {
  const values = new Uint32Array(1)
  globalThis.crypto.getRandomValues(values)
  return values[0]! | 0
}
