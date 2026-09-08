import { afterEach, expect, test, vi } from 'vitest'
import { getComponent } from '@/runtime/core/registry/component-registry'
import { defaultSkinRegistry } from '../rendererRegistry'

const initialRemoteModule = [
  'data:text/javascript,',
  'export default [{',
  '  component: function RemoteComp() { return null },',
  '  manifest: { id: "remote-test", label: "Remote", events: [] },',
  '}]',
].join('')

let remoteModule = initialRemoteModule

const moduleUrl = vi.fn(() => remoteModule)

vi.mock('@/lib/extension-host', () => ({
  getExtensionHost: () => ({ gameComponents: { moduleUrl } }),
}))

afterEach(() => {
  moduleUrl.mockClear()
  remoteModule = initialRemoteModule
})

test('bootComponents loads catalog-shaped game components through the Extension endpoint', async () => {
  const { bootComponents } = await import('../index')
  const slug = `game-${crypto.randomUUID()}`

  await expect(bootComponents(slug)).resolves.toBeUndefined()
  expect(moduleUrl).toHaveBeenCalledWith('index.js')
  expect(getComponent('remote-test')).toMatchObject({ id: 'remote-test', label: 'Remote' })
})

test('refreshGameComponentsFromUrl loads an explicitly supplied SDK component module', async () => {
  const { refreshGameComponentsFromUrl } = await import('../index')
  const slug = `sdk-game-${crypto.randomUUID()}`

  await expect(refreshGameComponentsFromUrl(slug, initialRemoteModule)).resolves.toBe(true)
  expect(moduleUrl).not.toHaveBeenCalled()
  expect(getComponent('remote-test')).toMatchObject({ id: 'remote-test', label: 'Remote' })
})

test('refreshGameComponentsFromUrl treats a missing module as optional', async () => {
  const { createDefaultComponentRegistry, refreshGameComponentsFromUrl } = await import('../index')

  await expect(refreshGameComponentsFromUrl(`sdk-game-${crypto.randomUUID()}`, null)).resolves.toEqual(
    expect.any(Boolean),
  )
  expect(moduleUrl).not.toHaveBeenCalled()
  expect(createDefaultComponentRegistry().getManifest('Dialogue')).toBeDefined()
})

test('refreshGameComponents reloads a changed project catalog and notifies subscribers', async () => {
  const { isProjectComponent, refreshGameComponents, subscribeGameComponents } = await import('../index')
  const slug = `game-${crypto.randomUUID()}`
  const changed = vi.fn()
  const unsubscribe = subscribeGameComponents(changed)

  await expect(refreshGameComponents(slug)).resolves.toBe(true)
  await expect(refreshGameComponents(slug)).resolves.toBe(false)

  remoteModule = [
    'data:text/javascript,',
    'export default [{',
    '  component: function OptionButton() { return null },',
    '  manifest: { id: "project-option-button", label: "选项按钮", inputs: [{ key: "label", valueType: "string" }], events: [{ id: "select" }] },',
    '}]',
  ].join('')
  await expect(refreshGameComponents(slug)).resolves.toBe(true)

  expect(getComponent('project-option-button')).toMatchObject({
    id: 'project-option-button',
    label: '选项按钮',
  })
  expect(changed).toHaveBeenLastCalledWith(slug)
  expect(isProjectComponent('project-option-button')).toBe(true)
  expect(isProjectComponent('Subtitle')).toBe(false)
  unsubscribe()
})

test('project ownership follows the installed catalog rather than a caller game key', async () => {
  const { isProjectComponent, refreshGameComponents } = await import('../index')
  const loadedGame = `game-${crypto.randomUUID()}`

  await expect(refreshGameComponents(loadedGame)).resolves.toBe(true)

  expect(isProjectComponent('remote-test')).toBe(true)
})

test('switching games clears the previous project catalog before a failed load', async () => {
  const { isProjectComponent, refreshGameComponents } = await import('../index')
  const firstGame = `game-${crypto.randomUUID()}`
  const secondGame = `game-${crypto.randomUUID()}`
  await expect(refreshGameComponents(firstGame)).resolves.toBe(true)
  expect(isProjectComponent('remote-test')).toBe(true)

  moduleUrl.mockImplementationOnce(() => '')
  await expect(refreshGameComponents(secondGame)).resolves.toBe(true)

  expect(isProjectComponent('remote-test')).toBe(false)
  expect(getComponent('remote-test')).toBeUndefined()
})

test('refreshGameComponents unregisters project ids removed from a changed catalog', async () => {
  const { refreshGameComponents } = await import('../index')
  const slug = `game-${crypto.randomUUID()}`

  await expect(refreshGameComponents(slug)).resolves.toBe(true)
  expect(getComponent('remote-test')).toBeDefined()
  expect(defaultSkinRegistry.getOverlayRenderer('remote-test')).toBeDefined()

  remoteModule = 'data:text/javascript,export default []'
  await expect(refreshGameComponents(slug)).resolves.toBe(true)

  expect(getComponent('remote-test')).toBeUndefined()
  expect(defaultSkinRegistry.getOverlayRenderer('remote-test')).toBeUndefined()
})
