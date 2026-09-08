import '@testing-library/jest-dom/vitest'
import { beforeEach } from 'vitest'
import { setLocale } from '../i18n'

/**
 * Vitest 全局 setup。
 *
 * 为什么需要：happy-dom 20.9.0 在 vitest 3 环境下 `window.localStorage` 的方法
 * （clear / getItem / setItem …）经其 Proxy 暴露后取不到（`typeof ...clear === 'undefined'`），
 * 导致一切依赖 localStorage 的测试（videoTaskStore 等）整片 `is not a function` 失败。
 *
 * 修法：用一个确定可用的内存版 Storage 覆盖 `globalThis` 与 `window` 上的 localStorage /
 * sessionStorage（同一实例，保证「测试里 clear」与「被测代码里读写」作用于同一份数据）。
 * 仅测试期生效，不进生产构建。
 */
/**
 * 数据存为「实例自有属性」（方法都在 prototype 上，不可枚举），因此
 * `Object.keys(storage)` 会像真实 `Storage` 一样枚举出已存的键。生产代码
 * （`bootMigrateLegacyKeys` 遍历旧前缀键）依赖这个语义，用 Map 做背板的替身
 * 会让它枚举不到任何键而静默空转。
 */
class MemoryStorage {
  [key: string]: unknown

  get length(): number {
    return Object.keys(this).length
  }

  clear(): void {
    for (const key of Object.keys(this)) delete this[key]
  }

  getItem(key: string): string | null {
    return Object.hasOwn(this, key) ? String(this[key]) : null
  }

  setItem(key: string, value: string): void {
    this[key] = String(value)
  }

  removeItem(key: string): void {
    delete this[key]
  }

  key(index: number): string | null {
    return Object.keys(this)[index] ?? null
  }
}

function needsPolyfill(target: object, prop: 'localStorage' | 'sessionStorage'): boolean {
  const probe = (target as Record<string, unknown>)[prop] as { clear?: unknown } | undefined
  return !probe || typeof probe.clear !== 'function'
}

function install(targets: object[], prop: 'localStorage' | 'sessionStorage'): void {
  // 同一实例铺到所有目标，保证 `window.x` 与全局 `x` 读写同一份数据
  const shared = new MemoryStorage()
  for (const t of targets) {
    if (!needsPolyfill(t, prop)) continue
    Object.defineProperty(t, prop, { value: shared, configurable: true, writable: true })
  }
}

const targets: object[] = [globalThis]
if (typeof window !== 'undefined' && window !== (globalThis as unknown)) targets.push(window)
install(targets, 'localStorage')
install(targets, 'sessionStorage')

// Existing component tests assert the product's Chinese baseline. Tests that
// exercise English or host-driven switching override this explicitly.
beforeEach(() => {
  setLocale('zh')
})
