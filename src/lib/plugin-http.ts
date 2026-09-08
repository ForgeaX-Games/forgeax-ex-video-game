import { rewriteUrl } from '@forgeax/extension-host/browser'
import { getActiveRewriteRules } from './forgeax-http'
import { getExtensionHost } from './extension-host'

/** Resolves an extension-relative media path from the accepted handshake. */
export function pluginUrl(path: string): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  const rewritten = rewriteUrl(path, getActiveRewriteRules())
  if (/^(?:https?:|blob:|data:)/.test(rewritten)) return rewritten
  const queryIndex = rewritten.indexOf('?')
  if (queryIndex < 0) return getExtensionHost().extension.url(rewritten)
  const pathname = rewritten.slice(0, queryIndex)
  const query = rewritten.slice(queryIndex + 1)
  const hostUrl = getExtensionHost().extension.url(pathname)
  return query.length === 0
    ? hostUrl
    : `${hostUrl}${hostUrl.includes('?') ? '&' : '?'}${query}`
}

/**
 * Rewrite the logical path once, then dispatch through the extension host
 * (or raw fetch for absolute/opaque URLs).
 */
export async function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  const rewritten = rewriteUrl(input, getActiveRewriteRules())
  if (/^(?:https?:|blob:|data:)/.test(rewritten)) return fetch(rewritten, init)
  const host = getExtensionHost()
  if (!rewritten.includes('?')) return host.extension.fetch(rewritten, init)
  if (typeof host.ready !== 'function') return host.extension.fetch(rewritten, init)
  await host.ready()
  return fetch(pluginUrl(rewritten), init)
}

/** Resolves a product-owned same-origin route without routing it through the extension backend. */
export function productUrl(path: string): string {
  return rewriteUrl(path, getActiveRewriteRules())
}

/** Fetches a product-owned route directly from the browser, after host-specific URL rewriting. */
export async function productFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(productUrl(input), init)
}
