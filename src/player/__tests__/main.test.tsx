// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../RuntimeGameApp', () => ({
  RuntimeGameApp: () => <div data-testid="runtime-game-app" />,
}))

function stubBrowserLanguages(languages: string[]): void {
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true })
  Object.defineProperty(navigator, 'language', { value: languages[0], configurable: true })
}

/**
 * Boots the real entry module in a fresh registry, so the i18n store starts at
 * its untouched 'en' default. The global test setup forces Chinese on every
 * other suite, which is exactly what hid the missing locale bootstrap here.
 */
async function bootEntry(): Promise<string> {
  vi.resetModules()
  document.body.innerHTML = '<div id="root"></div>'
  await import('../main')
  const { getLocale } = await import('@/i18n')
  return getLocale()
}

describe('published player entry', () => {
  beforeEach(() => {
    localStorage.clear()
    history.replaceState({}, '', '/')
  })

  it('renders Chinese for a Chinese browser with no stored preference', async () => {
    stubBrowserLanguages(['zh-CN', 'en'])

    expect(await bootEntry()).toBe('zh')
  })

  it('stays English for a browser that asks for English', async () => {
    stubBrowserLanguages(['en-US'])

    expect(await bootEntry()).toBe('en')
  })

  it('honours an explicit locale in the query string over the browser language', async () => {
    stubBrowserLanguages(['zh-CN'])
    history.replaceState({}, '', '/?locale=en')

    expect(await bootEntry()).toBe('en')
  })
})
