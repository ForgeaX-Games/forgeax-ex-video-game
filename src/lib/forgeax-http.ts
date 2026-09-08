/**
 * @deprecated Prefer `rewriteUrl` / `createRewritingFetch` from
 * `@forgeax/extension-host/browser`. This shim keeps mount-lifecycle rules
 * for one transition release.
 */
import {
  assertRewriteRules,
  createRewritingFetch,
  rewriteUrl as hostRewriteUrl,
  type RewriteRule,
} from '@forgeax/extension-host/browser'

export type { RewriteRule }

export type ForgeaxHttpDefaults = { rewrite: RewriteRule[] }

export type ForgeaxHttp = {
  defaults: ForgeaxHttpDefaults
  fetch: typeof fetch
  rewriteUrl: (url: string) => string
}

let activeRules: RewriteRule[] = []

export function getActiveRewriteRules(): readonly RewriteRule[] {
  return activeRules
}

export function rewriteUrlWithRules(
  url: string,
  rules: readonly RewriteRule[],
): string {
  return hostRewriteUrl(url, rules)
}

export function createForgeaxHttp(
  defaults?: Partial<ForgeaxHttpDefaults>,
): ForgeaxHttp {
  const state: ForgeaxHttpDefaults = {
    rewrite: defaults?.rewrite ? [...defaults.rewrite] : [],
  }
  assertRewriteRules(state.rewrite)
  return {
    defaults: state,
    rewriteUrl: (url) => hostRewriteUrl(url, state.rewrite),
    fetch: createRewritingFetch(state.rewrite),
  }
}

const defaults: ForgeaxHttpDefaults = {} as ForgeaxHttpDefaults
Object.defineProperty(defaults, 'rewrite', {
  get() {
    return activeRules
  },
  set(next: RewriteRule[]) {
    assertRewriteRules(next)
    activeRules = [...next]
  },
  enumerable: true,
  configurable: true,
})

/** @deprecated */
export const forgeaxHttp: ForgeaxHttp = {
  defaults,
  rewriteUrl: (url) => hostRewriteUrl(url, activeRules),
  fetch: ((input, init) =>
    createRewritingFetch(activeRules)(input, init)) as typeof fetch,
}

let hostInitCount = 0

export function acquireHostInit(rules: RewriteRule[] | undefined): void {
  const next = rules ?? []
  assertRewriteRules(next)
  activeRules = [...next]
  hostInitCount += 1
}

export function releaseHostInit(): void {
  if (hostInitCount <= 0) return
  hostInitCount -= 1
  if (hostInitCount === 0) activeRules = []
}

export function resetHostInitForTests(): void {
  hostInitCount = 0
  activeRules = []
}

export { assertRewriteRules }
