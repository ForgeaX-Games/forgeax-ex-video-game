const REFRESHABLE_MEDIA_PATH = /\/(?:__gva__\/media\/[^/]+|games\/[^/]+\/media\/[^/]+|extension\/runtime\/media\/resources\/[^/]+\/content|api\/v1\/kino\/resources\/[^/]+\/content)$/

/** Re-enter a stable media gateway without mutating direct provider-signed URLs. */
export function refreshPlaybackUrl(src: string, revision: number): string | null {
  let url: URL
  try {
    url = new URL(src, 'http://runtime.invalid')
  } catch {
    return null
  }
  if (!REFRESHABLE_MEDIA_PATH.test(url.pathname)) return null
  url.searchParams.set('__gva_refresh', String(revision))
  return /^(?:https?:)?\/\//.test(src)
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`
}
