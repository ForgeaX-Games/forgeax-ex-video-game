import { expect, test, vi } from 'vitest'

vi.mock('../../../lib/extension-host', () => ({
  getExtensionHost: () => {
    throw new Error('SDK explicit component loading must not read the global host')
  },
}))

test('SDK project components keep precedence over builtins when the session starts', async () => {
  const { createDefaultComponentRegistry, refreshGameComponentsFromUrl } = await import('../index')
  const projectDialogue = [
    'data:text/javascript,',
    'export default [{',
    '  component: function ProjectDialogue() { return null },',
    '  manifest: { id: "Dialogue", label: "Project Dialogue", events: [] },',
    '}]',
  ].join('')

  await expect(refreshGameComponentsFromUrl('sdk-shadow-game', projectDialogue)).resolves.toBe(true)

  expect(createDefaultComponentRegistry().getManifest('Dialogue')?.label).toBe('Project Dialogue')
})
