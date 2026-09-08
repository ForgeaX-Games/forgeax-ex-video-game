import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectSystemLocale, getLocale, initLocaleSync, setLocale, t, tf } from '..'

function stubBrowserLanguages(languages: string[]): void {
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true })
  Object.defineProperty(navigator, 'language', { value: languages[0], configurable: true })
}

describe('game video i18n', () => {
  const originalHref = window.location.href

  beforeEach(() => {
    localStorage.clear()
    setLocale('en')
    window.history.replaceState({}, '', originalHref)
  })

  afterEach(() => {
    window.history.replaceState({}, '', originalHref)
  })

  it('translates and interpolates asset-management messages', () => {
    expect(t('videoAssets.rename')).toBe('Rename')
    expect(tf('videoAssets.renameAria', { name: 'Intro' })).toBe('Rename Intro')

    setLocale('zh')

    expect(t('videoAssets.rename')).toBe('重命名')
    expect(tf('videoAssets.renameAria', { name: '序章' })).toBe('重命名 序章')
  })

  it('keeps the video duration unit as seconds', () => {
    expect(t('ui.copy.a0f1490a20d0')).toBe('s')

    setLocale('zh')

    expect(t('ui.copy.a0f1490a20d0')).toBe('秒')
  })

  it('labels the automatic graph layout action in both locales', () => {
    expect(t('ui.copy.c10427c6d740')).toBe('Auto Layout')

    setLocale('zh')

    expect(t('ui.copy.c10427c6d740')).toBe('自动布局')
  })

  it('translates the video game bootstrap guide', () => {
    expect(t('bootstrap.guide.title')).toBe('Create a video game from template')
    expect(t('bootstrap.guide.yes')).toBe('Create from template')

    setLocale('zh')

    expect(t('bootstrap.guide.title')).toBe('从模板新建视频游戏')
    expect(t('bootstrap.guide.yes')).toBe('从模板新建')
  })

  it('labels the published player end overlay in both locales', () => {
    expect(t('player.ended')).toBe('Game over')
    expect(t('player.restart')).toBe('Restart')

    setLocale('zh')

    expect(t('player.ended')).toBe('游戏结束')
    expect(t('player.restart')).toBe('重新开始')
  })

  it('reacts to the host locale message', () => {
    initLocaleSync()
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'forgeax:locale-changed', locale: 'zh' },
    }))

    expect(getLocale()).toBe('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('uses an in-process host locale instead of URL or storage defaults', () => {
    localStorage.setItem('forgeax.locale', 'zh')

    initLocaleSync('en')

    expect(getLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('accepts Studio and Zaohua BCP-47 locale query params', () => {
    window.history.replaceState({}, '', '/?locale=zh-CN')

    initLocaleSync()

    expect(getLocale()).toBe('zh')
  })

  it('reads Zaohua lang=zh-CN when locale is absent', () => {
    window.history.replaceState({}, '', '/?lang=zh-CN')

    initLocaleSync()

    expect(getLocale()).toBe('zh')
  })

  it('reads the browser language, treating every zh variant as Chinese', () => {
    stubBrowserLanguages(['zh-TW', 'en-US'])
    expect(detectSystemLocale()).toBe('zh')

    stubBrowserLanguages(['fr-FR', 'en-US'])
    expect(detectSystemLocale()).toBe('en')
  })

  it('falls back to the supplied locale only when nothing is stored', () => {
    initLocaleSync(undefined, 'zh')

    expect(getLocale()).toBe('zh')
  })

  it('lets a stored preference beat the fallback', () => {
    localStorage.setItem('forgeax.locale', 'en')

    initLocaleSync(undefined, 'zh')

    expect(getLocale()).toBe('en')
  })
})
