/**
 * 一次性 localStorage 迁移 —— game-video 是从 reel fork 出来的，
 * 历史上所有持久键使用旧前缀；现已统一改名为 `game-video`，避免与 reel
 * 同源嵌入时键冲突。
 *
 * 为什么是「模块顶层副作用」而非函数调用：
 *   多个 store（如 shellStore 的 zustand persist）在 **模块求值期** 就会读
 *   localStorage 完成 hydrate。迁移必须早于那一刻，所以 main.tsx 把本模块作为
 *   **第一条 import** —— ES 模块按序求值，本模块无任何依赖，会在 App 及其 store
 *   被求值前先跑完这段拷贝。
 *
 * 语义：把每个旧前缀键拷到对应新键（新键已存在则不覆盖，保护新数据），再删旧键。
 * 幂等：旧键删完后再次运行为 no-op。SSR / 无 localStorage 环境静默跳过。
 */
const LEGACY_PREFIXES = ['reel-studio', 'gamevideo', 'gvid'] as const
const NEW_PREFIX = 'game-video'

function migrateLegacyLocalStorageKeys(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const ls = window.localStorage
  let legacyKeys: string[]
  try {
    legacyKeys = Object.keys(ls).filter((key) =>
      LEGACY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    )
  } catch {
    return
  }
  for (const oldKey of legacyKeys) {
    const prefix = LEGACY_PREFIXES.find((candidate) => oldKey.startsWith(candidate))
    if (!prefix) continue
    // 只替换前缀，保留分隔符（':' 或 '.'）及其后的命名空间。
    const newKey = NEW_PREFIX + oldKey.slice(prefix.length)
    try {
      const value = ls.getItem(oldKey)
      if (value !== null && ls.getItem(newKey) === null) {
        ls.setItem(newKey, value)
      }
      ls.removeItem(oldKey)
    } catch {
      /* best-effort：单键失败不阻断其余迁移 */
    }
  }
}

migrateLegacyLocalStorageKeys()

export {}
