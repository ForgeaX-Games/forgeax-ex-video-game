import { pluginFetch } from '../../lib/plugin-http'
import { readExtensionJson } from '../../lib/extension-host'

export async function deleteProjectComponent(componentId: string): Promise<void> {
  const response = await pluginFetch(`components/${encodeURIComponent(componentId)}`, {
    method: 'DELETE',
  })
  const body = await readExtensionJson(response) as { ok?: unknown; componentId?: unknown }
  if (body.ok !== true || body.componentId !== componentId) {
    throw new Error('Extension returned an invalid component deletion response')
  }
}
